import type { System } from './System';
import type { World } from '../world/world';
import { normalizeAngle, clamp, wrap } from '../utils/math';
import { FOOD_TYPE } from '../world/items';
import { VisibilityCandidates, SignalCandidates } from '../utils/visibility';
import { VISION_CONE_RAYS as RAY_COUNT, VISION_CONE_FOV } from '../neural/network';

/**
 * Zbiera wejścia sieci neuronowej każdego agenta.
 *
 * Wszystkie sensory są LOKALNE i względne — agent nie zna swojej pozycji
 * globalnej ani stanu świata. Widzi tylko kierunek i bliskość rzeczy
 * w swoim promieniu widzenia. To warunek konieczny, żeby zachowania
 * mogły być emergentne, a nie odczytane z gotowej mapy.
 *
 * Sensory na obiekty (jedzenie, agent, partner, kamień, sygnał) respektują
 * ŚCIANY: agent nie "widzi" przez lity teren, dokładnie jak w prawdziwym
 * świecie — jeśli najbliższy kandydat jest zasłonięty (patrz
 * `TerrainGrid.hasLineOfSight`), sensor szuka kolejnego najbliższego
 * WIDOCZNEGO, aż do wyczerpania kandydatów w zasięgu wzroku (patrz
 * `VisibilityCandidates`). "Zagęszczenie" jest jedynym wyjątkiem — to
 * zgrubne wyczucie tłoku, nie namierzanie konkretnego celu, więc zostaje
 * bez filtrowania linii wzroku.
 *
 * Teren (ściany) NIE ma osobnego "kierunek+bliskość do najbliższej ściany"
 * — zamiast tego agent dostaje STOŻEK WIDZENIA: wachlarz promieni rzucanych
 * przed siebie, każdy zatrzymywany przez pierwszą litą komórkę (patrz
 * `TerrainGrid.castRay`), niosący zarówno dystans jak i "ciepło" w punkcie
 * trafienia. To bliżej rzeczywistej percepcji przestrzennej niż pojedynczy
 * skalar kierunku.
 *
 * Kolejność wejść musi odpowiadać SENSOR_LABELS z neural/network.ts.
 */
export class SensorSystem implements System {
  readonly name = 'SensorSystem';
  private readonly foodCandidates = new VisibilityCandidates();
  private readonly agentCandidates = new VisibilityCandidates();
  private readonly mateCandidates = new VisibilityCandidates();
  private readonly itemCandidates = new VisibilityCandidates();
  private readonly signalCandidates = new SignalCandidates();

  update(world: World): void {
    const cfg = world.config;
    const rng = world.rng;
    const terrain = world.terrain;

    for (const a of world.agents) {
      if (!a.alive) continue;
      const vision = a.phenotype.visionRadius;
      const input = a.lastInputs;

      input[0] = 1; // bias
      input[1] = (a.energy / cfg.maxEnergy) * 2 - 1;
      input[2] = clamp(a.age / cfg.maxAge, 0, 1) * 2 - 1;
      input[3] = (a.speed / a.phenotype.maxSpeed) * 2 - 1;

      // --- najbliższe WIDOCZNE jedzenie ---
      this.foodCandidates.reset();
      world.foodGrid.forEachInRadius(a.x, a.y, vision, (id, dx, dy, d2) => {
        this.foodCandidates.add(id, dx, dy, d2);
      });
      const f = this.foodCandidates.pickNearestVisible(terrain, a.x, a.y);
      if (f) {
        const dist = Math.sqrt(f.dist2);
        const bearing = normalizeAngle(Math.atan2(f.dy, f.dx) - a.heading);
        input[4] = Math.sin(bearing);
        input[5] = Math.cos(bearing);
        input[6] = 1 - dist / vision;
      } else {
        input[4] = 0;
        input[5] = 0;
        input[6] = 0;
      }

      // --- najbliższy WIDOCZNY inny agent + zagęszczenie + najbliższy WIDOCZNY partner ---
      // Jedno przejście po siatce zbiera kandydatów do obu naraz. Rozbicie
      // tego na osobne zapytania mnożyło koszt najdroższego systemu w ticku.
      this.agentCandidates.reset();
      this.mateCandidates.reset();
      this.signalCandidates.reset();
      let neighbours = 0;
      const densityRadius2 = (vision * 0.5) * (vision * 0.5);
      const myGender = a.phenotype.gender;
      world.agentGrid.forEachInRadius(a.x, a.y, vision, (id, dx, dy, d2) => {
        if (id === a.id) return;
        this.agentCandidates.add(id, dx, dy, d2);
        if (d2 <= densityRadius2) neighbours++;
        // Partner = najbliższy agent PRZECIWNEJ płci — osobny bufor (a nie
        // ten sam co "najbliższy agent") bo najbliższy agent bywa rywalem
        // tej samej płci, bezużytecznym jako cel nawigacji do rozmnażania.
        const other = world.agentById.get(id);
        if (other && other.phenotype.gender !== myGender) {
          this.mateCandidates.add(id, dx, dy, d2);
        }
        if (other) {
          // Głośność odbierana = wyjście "sygnał" nadawcy (tylko dodatnia
          // część liczy się jako nadawanie) * bliskość — ten sam kształt co
          // "bliskość jedzenia" wyżej. Czytamy STAN SPRZED tego ticku
          // (BrainSystem jeszcze nie policzył nowego forward passu), więc
          // to zawsze sygnał z t-1, tak jak pamięć rekurencyjna w network.ts.
          const loudness = Math.max(0, other.brain.outputs[6]);
          if (loudness > 0) {
            const score = loudness * (1 - Math.sqrt(d2) / vision);
            this.signalCandidates.add(id, dx, dy, d2, score);
          }
        }
      });

      const n = this.agentCandidates.pickNearestVisible(terrain, a.x, a.y);
      let nearestOther: ReturnType<typeof world.agentById.get> = undefined;
      if (n) {
        const dist = Math.sqrt(n.dist2);
        const bearing = normalizeAngle(Math.atan2(n.dy, n.dx) - a.heading);
        input[7] = Math.sin(bearing);
        input[8] = Math.cos(bearing);
        input[9] = 1 - dist / vision;
        nearestOther = world.agentById.get(n.id);
      } else {
        input[7] = 0;
        input[8] = 0;
        input[9] = 0;
      }

      const limit = cfg.neighborSampleLimit;
      input[10] = (Math.min(neighbours, limit) / limit) * 2 - 1;

      // --- szum ---
      input[11] = rng.symmetric(1);

      // --- jak bardzo zapełniony ekwipunek ---
      input[12] = (a.carriedCount / cfg.maxCarryItems) * 2 - 1;

      // --- najbliższy WIDOCZNY kamień (lustrzane odbicie sensora jedzenia) ---
      this.itemCandidates.reset();
      world.itemGrid.forEachInRadius(a.x, a.y, vision, (id, dx, dy, d2) => {
        this.itemCandidates.add(id, dx, dy, d2);
      });
      const it = this.itemCandidates.pickNearestVisible(terrain, a.x, a.y);
      if (it) {
        const dist = Math.sqrt(it.dist2);
        const bearing = normalizeAngle(Math.atan2(it.dy, it.dx) - a.heading);
        input[13] = Math.sin(bearing);
        input[14] = Math.cos(bearing);
        input[15] = 1 - dist / vision;
      } else {
        input[13] = 0;
        input[14] = 0;
        input[15] = 0;
      }

      // --- własne zdrowie ---
      input[16] = (a.health / a.phenotype.maxHealth) * 2 - 1;

      // --- własna płeć ---
      input[17] = myGender === 1 ? 1 : -1;

      // --- najbliższy WIDOCZNY partner (przeciwna płeć) ---
      const mate = this.mateCandidates.pickNearestVisible(terrain, a.x, a.y);
      if (mate) {
        const dist = Math.sqrt(mate.dist2);
        const bearing = normalizeAngle(Math.atan2(mate.dy, mate.dx) - a.heading);
        input[18] = Math.sin(bearing);
        input[19] = Math.cos(bearing);
        input[20] = 1 - dist / vision;
      } else {
        input[18] = 0;
        input[19] = 0;
        input[20] = 0;
      }

      // --- czy wśród niesionych przedmiotów jest jedzenie ---
      let carryingFood = false;
      for (let i = 0; i < a.carriedCount; i++) {
        if (a.carriedItems[i] === FOOD_TYPE) {
          carryingFood = true;
          break;
        }
      }
      input[21] = carryingFood ? 1 : -1;

      // --- odmienność najbliższego agenta ---
      // Zamiast surowego ID (nieograniczona, wciąż rosnąca liczba — bez
      // sensu dla sieci, i tak nie generalizuje się między osobnikami),
      // agent "rozpoznaje" sąsiada przez różnicę BARWY — genu dziedzicznego
      // od rodzica jak każdy inny, więc podobna barwa = bliskie
      // pokrewieństwo/linia genetyczna. To wystarcza do wyewoluowania
      // rozpoznawania krewnych/obcych bez twardo zakodowanej logiki.
      if (n && nearestOther) {
        input[22] = hueDistance(a.phenotype.hue, nearestOther.phenotype.hue) * 4 - 1;
      } else {
        input[22] = 0;
      }

      // --- najgłośniejszy WIDOCZNY sygnał ---
      // Ranking po głośności, nie po odległości (patrz SignalCandidates) —
      // agent słyszy TEGO, kto krzyczy najwyraźniej, niekoniecznie tego,
      // kto stoi najbliżej. "Głośność" na wyjściu (input[25]) to gotowy
      // wynik działania SignalCandidates (już 0..1: głośność nadawcy razy
      // bliskość), więc nie ma tu przeliczania jak przy sensorze jedzenia.
      const sig = this.signalCandidates.pickLoudestVisible(terrain, a.x, a.y);
      if (sig) {
        const bearing = normalizeAngle(Math.atan2(sig.dy, sig.dx) - a.heading);
        input[23] = Math.sin(bearing);
        input[24] = Math.cos(bearing);
        input[25] = sig.score;
      } else {
        input[23] = 0;
        input[24] = 0;
        input[25] = 0;
      }

      // --- stożek widzenia: wachlarz promieni przed agentem, zatrzymywanych
      // przez pierwszą litą komórkę (patrz TerrainGrid.castRay), każdy z
      // dystansem i "ciepłem" (TerrainGrid.shelterWarmthAt) w punkcie
      // trafienia. Zasięg = ewoluowalny wzrok agenta, tak jak reszta sensorów
      // — ściana jest widziana tym samym zmysłem co jedzenie czy inny
      // agent, nie osobnym, sztywnym "czuciem ściany".
      const base = a.heading - VISION_CONE_FOV / 2;
      const step = RAY_COUNT > 1 ? VISION_CONE_FOV / (RAY_COUNT - 1) : 0;
      for (let r = 0; r < RAY_COUNT; r++) {
        const angle = base + step * r;
        const dist = terrain.castRay(a.x, a.y, angle, vision);
        const hitX = wrap(a.x + Math.cos(angle) * dist, cfg.worldSize);
        const hitY = wrap(a.y + Math.sin(angle) * dist, cfg.worldSize);
        const warmth = terrain.shelterWarmthAt(
          hitX,
          hitY,
          cfg.shelterExteriorMinCells,
          cfg.shelterMinDepth,
          cfg.shelterHeatLeakRadius,
        );
        const idx = 26 + r * 2;
        input[idx] = 1 - dist / vision;
        input[idx + 1] = warmth * 2 - 1;
      }
    }
  }
}

/** Odległość na kole barw (0 = ten sam odcień, 0.5 = przeciwny kraniec koła). */
function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 1 - d);
}
