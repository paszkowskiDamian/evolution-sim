import type { System } from './System';
import type { World } from '../world/world';
import { normalizeAngle, clamp, wrap } from '../utils/math';
import { FOOD_TYPE } from '../world/items';
import { VisibilityCandidates, SignalCandidates } from '../utils/visibility';
import {
  VISION_CONE_RAYS as RAY_COUNT,
  VISION_CONE_FOV,
  CONE_TYPE_NOTHING,
  CONE_TYPE_WALL,
  CONE_TYPE_AGENT_RIVAL,
  CONE_TYPE_AGENT_MATE,
  CONE_TYPE_COOPERATIVE_FOOD,
  CONE_TYPE_FOOD,
} from '../neural/network';
import { FOOD_COOPERATIVE } from '../world/food';

/**
 * Zbiera wejścia sieci neuronowej każdego agenta.
 *
 * Wszystkie sensory są LOKALNE i względne — agent nie zna swojej pozycji
 * globalnej ani stanu świata. To warunek konieczny, żeby zachowania mogły
 * być emergentne, a nie odczytane z gotowej mapy.
 *
 * Jedzenie, inni agenci, partnerzy i ściany są widziane WYŁĄCZNIE przez
 * stożek widzenia (patrz VISION_CONE_RAYS/VISION_CONE_FOV w network.ts):
 * wachlarz promieni rzucanych przed siebie w polu widzenia agenta, każdy
 * zatrzymywany przez pierwszą literę — ścianę (TerrainGrid.castRay) albo
 * najbliższy widoczny obiekt w swoim kątowym wycinku, którykolwiek jest
 * bliżej. Poza polem widzenia agent jest ślepy — to prawdziwe pole
 * widzenia, nie sensor "gdziekolwiek dookoła" jak we wcześniejszej wersji.
 *
 * Kamień, sygnał i "zagęszczenie"/"odmienność najbliższego agenta" ZOSTAJĄ
 * osobnymi sensorami 360° (nie są częścią stożka) — to celowy, węższy
 * zakres tej zmiany: kamień i sygnał nie były częścią pytania, które ją
 * zainicjowało, a "zagęszczenie"/pokrewieństwo to zgrubne wyczucie otoczenia,
 * nie namierzanie konkretnego celu w konkretnym kierunku.
 *
 * Kolejność wejść musi odpowiadać SENSOR_LABELS z neural/network.ts.
 */
export class SensorSystem implements System {
  readonly name = 'SensorSystem';
  private readonly agentCandidates = new VisibilityCandidates();
  private readonly itemCandidates = new VisibilityCandidates();
  private readonly signalCandidates = new SignalCandidates();

  // Bufory stożka widzenia — reużywane między agentami/tickami, żeby
  // uniknąć alokacji w gorącej pętli.
  private readonly coneBestDist2 = new Float64Array(RAY_COUNT);
  private readonly coneBestType = new Float64Array(RAY_COUNT);
  private readonly coneBestDx = new Float64Array(RAY_COUNT);
  private readonly coneBestDy = new Float64Array(RAY_COUNT);

  update(world: World): void {
    const cfg = world.config;
    const rng = world.rng;
    const terrain = world.terrain;

    for (const a of world.agents) {
      if (!a.alive) continue;
      const vision = a.phenotype.visionRadius;
      const input = a.lastInputs;
      const myGender = a.phenotype.gender;

      input[0] = 1; // bias
      input[1] = (a.energy / cfg.maxEnergy) * 2 - 1;
      input[2] = clamp(a.age / cfg.maxAge, 0, 1) * 2 - 1;
      input[3] = (a.speed / a.phenotype.maxSpeed) * 2 - 1;

      // --- stożek widzenia: 1) rzut promieni na ścianę, jako punkt startowy ---
      const base = a.heading - VISION_CONE_FOV / 2;
      const step = RAY_COUNT > 1 ? VISION_CONE_FOV / (RAY_COUNT - 1) : 0;
      for (let r = 0; r < RAY_COUNT; r++) {
        const angle = base + step * r;
        const d = terrain.castRay(a.x, a.y, angle, vision);
        this.coneBestDist2[r] = d * d;
        this.coneBestType[r] = d < vision ? CONE_TYPE_WALL : CONE_TYPE_NOTHING;
        this.coneBestDx[r] = Math.cos(angle) * d;
        this.coneBestDy[r] = Math.sin(angle) * d;
      }

      // --- stożek widzenia: 2) jedzenie może przebić wynik ściany, jeśli bliżej i widoczne ---
      world.foodGrid.forEachInRadius(a.x, a.y, vision, (_id, dx, dy, d2) => {
        const idx = this.bucketOf(dx, dy, a.heading, base, step);
        if (idx < 0 || d2 >= this.coneBestDist2[idx]) return;
        if (!terrain.hasLineOfSight(a.x, a.y, dx, dy)) return;
        this.coneBestDist2[idx] = d2;
        this.coneBestType[idx] =
          world.food.kind[_id] === FOOD_COOPERATIVE ? CONE_TYPE_COOPERATIVE_FOOD : CONE_TYPE_FOOD;
        this.coneBestDx[idx] = dx;
        this.coneBestDy[idx] = dy;
      });

      // --- stożek widzenia: 3) inni agenci (rywal/partner wg płci) + zagęszczenie + sygnał ---
      // Jedno przejście po siatce zbiera wszystko naraz — rozbicie na osobne
      // zapytania mnożyło koszt najdroższego systemu w ticku.
      this.agentCandidates.reset(); // TYLKO do pokrewieństwa, patrz niżej — 360°, nie ograniczone stożkiem
      this.signalCandidates.reset();
      let neighbours = 0;
      const densityRadius2 = (vision * 0.5) * (vision * 0.5);
      world.agentGrid.forEachInRadius(a.x, a.y, vision, (id, dx, dy, d2) => {
        if (id === a.id) return;
        this.agentCandidates.add(id, dx, dy, d2);
        if (d2 <= densityRadius2) neighbours++;

        const other = world.agentById.get(id);
        if (!other) return;

        // Głośność odbierana = wyjście "sygnał" nadawcy (tylko dodatnia część
        // liczy się jako nadawanie) * bliskość. Czytamy STAN SPRZED tego
        // ticku (BrainSystem jeszcze nie policzył nowego forward passu), więc
        // to zawsze sygnał z t-1, tak jak pamięć rekurencyjna w network.ts.
        // Sygnał NIE jest ograniczony stożkiem — krzyk słychać zza pleców.
        const loudness = cfg.signalReceptionEnabled ? Math.max(0, other.brain.outputs[6]) : 0;
        if (loudness > 0) {
          const score = loudness * (1 - Math.sqrt(d2) / vision);
          this.signalCandidates.add(id, dx, dy, d2, score);
        }

        const idx = this.bucketOf(dx, dy, a.heading, base, step);
        if (idx < 0 || d2 >= this.coneBestDist2[idx]) return;
        if (!terrain.hasLineOfSight(a.x, a.y, dx, dy)) return;
        this.coneBestDist2[idx] = d2;
        this.coneBestType[idx] = other.phenotype.gender !== myGender ? CONE_TYPE_AGENT_MATE : CONE_TYPE_AGENT_RIVAL;
        this.coneBestDx[idx] = dx;
        this.coneBestDy[idx] = dy;
      });

      const limit = cfg.neighborSampleLimit;
      input[4] = (Math.min(neighbours, limit) / limit) * 2 - 1;

      // --- szum ---
      input[5] = rng.symmetric(1);

      // --- jak bardzo zapełniony ekwipunek ---
      input[6] = (a.carriedCount / cfg.maxCarryItems) * 2 - 1;

      // --- najbliższy WIDOCZNY kamień (360°, nie część stożka) ---
      this.itemCandidates.reset();
      world.itemGrid.forEachInRadius(a.x, a.y, vision, (id, dx, dy, d2) => {
        this.itemCandidates.add(id, dx, dy, d2);
      });
      const it = this.itemCandidates.pickNearestVisible(terrain, a.x, a.y);
      if (it) {
        const dist = Math.sqrt(it.dist2);
        const bearing = normalizeAngle(Math.atan2(it.dy, it.dx) - a.heading);
        input[7] = Math.sin(bearing);
        input[8] = Math.cos(bearing);
        input[9] = 1 - dist / vision;
      } else {
        input[7] = 0;
        input[8] = 0;
        input[9] = 0;
      }

      // --- własne zdrowie ---
      input[10] = (a.health / a.phenotype.maxHealth) * 2 - 1;

      // --- własna płeć ---
      input[11] = myGender === 1 ? 1 : -1;

      // --- czy wśród niesionych przedmiotów jest jedzenie ---
      let carryingFood = false;
      for (let i = 0; i < a.carriedCount; i++) {
        if (a.carriedItems[i] === FOOD_TYPE) {
          carryingFood = true;
          break;
        }
      }
      input[12] = carryingFood ? 1 : -1;

      // --- odmienność najbliższego agenta (360°, nie część stożka — patrz
      // komentarz klasowy: pokrewieństwo to zgrubne wyczucie otoczenia) ---
      // Zamiast surowego ID (nieograniczona, wciąż rosnąca liczba — bez sensu
      // dla sieci, i tak nie generalizuje się między osobnikami), agent
      // "rozpoznaje" sąsiada przez różnicę BARWY — genu dziedzicznego od
      // rodzica jak każdy inny, więc podobna barwa = bliskie pokrewieństwo.
      const n = this.agentCandidates.pickNearestVisible(terrain, a.x, a.y);
      const nearestOther = n ? world.agentById.get(n.id) : undefined;
      if (n && nearestOther) {
        input[13] = hueDistance(a.phenotype.hue, nearestOther.phenotype.hue) * 4 - 1;
      } else {
        input[13] = 0;
      }

      // --- najgłośniejszy WIDOCZNY sygnał (360°, nie część stożka) ---
      // Ranking po głośności, nie po odległości (patrz SignalCandidates) —
      // agent słyszy TEGO, kto krzyczy najwyraźniej, niekoniecznie tego, kto
      // stoi najbliżej. "Głośność" to gotowy wynik SignalCandidates (już
      // 0..1: głośność nadawcy razy bliskość), bez dalszego przeliczania.
      const sig = this.signalCandidates.pickLoudestVisible(terrain, a.x, a.y);
      if (sig) {
        const bearing = normalizeAngle(Math.atan2(sig.dy, sig.dx) - a.heading);
        input[14] = Math.sin(bearing);
        input[15] = Math.cos(bearing);
        input[16] = sig.score;
      } else {
        input[14] = 0;
        input[15] = 0;
        input[16] = 0;
      }

      // --- stożek widzenia: 4) zapisz finalnego zwycięzcę każdego promienia ---
      for (let r = 0; r < RAY_COUNT; r++) {
        const dist = Math.sqrt(this.coneBestDist2[r]);
        const hitX = wrap(a.x + this.coneBestDx[r], cfg.worldSize);
        const hitY = wrap(a.y + this.coneBestDy[r], cfg.worldSize);
        const warmth = terrain.shelterWarmthAt(
          hitX,
          hitY,
          cfg.shelterExteriorMinCells,
          cfg.shelterMinDepth,
          cfg.shelterHeatLeakRadius,
        );
        const idx = 17 + r * 3;
        input[idx] = 1 - dist / vision;
        input[idx + 1] = this.coneBestType[r];
        input[idx + 2] = warmth * 2 - 1;
      }
    }
  }

  /**
   * Który promień stożka (jeśli którykolwiek) obejmuje kierunek (dx,dy) —
   * zaokrąglenie do najbliższego kąta promienia, odrzucone jeśli poza
   * VISION_CONE_FOV (agent poza polem widzenia jest po prostu niewidoczny,
   * niezależnie od tego, jak blisko stoi). Zwraca -1, gdy poza polem widzenia.
   */
  private bucketOf(dx: number, dy: number, heading: number, base: number, step: number): number {
    const bearing = normalizeAngle(Math.atan2(dy, dx) - heading);
    const upper = base + step * (RAY_COUNT - 1);
    let rel = bearing;
    if (rel < base || rel > upper) {
      // Sprawdź zawinięcie w drugą stronę (bearing tuż poniżej -π, podczas
      // gdy pole widzenia rozciąga się tuż powyżej +π w tej samej fizycznej
      // przestrzeni) — bez tego wąski pas dokładnie za agentem po "złej"
      // stronie normalizeAngle byłby fałszywie odrzucany.
      const alt = bearing > 0 ? bearing - 2 * Math.PI : bearing + 2 * Math.PI;
      if (alt < base || alt > upper) return -1;
      rel = alt;
    }
    if (step <= 0) return 0;
    return Math.max(0, Math.min(RAY_COUNT - 1, Math.round((rel - base) / step)));
  }
}

/** Odległość na kole barw (0 = ten sam odcień, 0.5 = przeciwny kraniec koła). */
function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 1 - d);
}
