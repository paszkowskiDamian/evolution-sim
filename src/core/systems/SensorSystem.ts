import type { System } from './System';
import type { World } from '../world/world';
import { normalizeAngle, clamp } from '../utils/math';
import { FOOD_TYPE } from '../world/items';
import { VisibilityCandidates } from '../utils/visibility';

/**
 * Zbiera wejścia sieci neuronowej każdego agenta.
 *
 * Wszystkie sensory są LOKALNE i względne — agent nie zna swojej pozycji
 * globalnej ani stanu świata. Widzi tylko kierunek i bliskość rzeczy
 * w swoim promieniu widzenia. To warunek konieczny, żeby zachowania
 * mogły być emergentne, a nie odczytane z gotowej mapy.
 *
 * Sensory na obiekty (jedzenie, agent, partner, kamień) respektują ŚCIANY:
 * agent nie "widzi" przez lity teren, dokładnie jak w prawdziwym świecie —
 * jeśli najbliższy kandydat jest zasłonięty (patrz `TerrainGrid.hasLineOfSight`),
 * sensor szuka kolejnego najbliższego WIDOCZNEGO, aż do wyczerpania kandydatów
 * w zasięgu wzroku (patrz `VisibilityCandidates`). "Zagęszczenie" jest
 * jedynym wyjątkiem — to zgrubne wyczucie tłoku, nie namierzanie
 * konkretnego celu, więc zostaje bez filtrowania linii wzroku.
 *
 * Kolejność wejść musi odpowiadać SENSOR_LABELS z neural/network.ts.
 */
export class SensorSystem implements System {
  readonly name = 'SensorSystem';
  private readonly foodCandidates = new VisibilityCandidates();
  private readonly agentCandidates = new VisibilityCandidates();
  private readonly mateCandidates = new VisibilityCandidates();
  private readonly itemCandidates = new VisibilityCandidates();

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
      });

      const n = this.agentCandidates.pickNearestVisible(terrain, a.x, a.y);
      if (n) {
        const dist = Math.sqrt(n.dist2);
        const bearing = normalizeAngle(Math.atan2(n.dy, n.dx) - a.heading);
        input[7] = Math.sin(bearing);
        input[8] = Math.cos(bearing);
        input[9] = 1 - dist / vision;
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

      // --- najbliższa ściana (lita komórka terenu) — zasięg NIEZALEŻNY od
      // ewoluowalnego wzroku (patrz cfg.wallSenseRadius): ściana jest dużą,
      // fizyczną przeszkodą, którą agent "czuje" z bliska niezależnie od
      // tego, jak daleko sięga jego wzrok na drobne obiekty. Ten sensor
      // celowo NIE przechodzi przez filtr linii wzroku — szuka WPROST
      // najbliższej litej komórki, więc z definicji nie może być "za"
      // inną ścianą (byłaby wtedy bliższym wynikiem).
      const wall = terrain.findNearestSolid(a.x, a.y, cfg.wallSenseRadius);
      if (wall) {
        const bearing = normalizeAngle(Math.atan2(wall.dy, wall.dx) - a.heading);
        input[22] = Math.sin(bearing);
        input[23] = Math.cos(bearing);
        input[24] = 1 - wall.dist / cfg.wallSenseRadius;
      } else {
        input[22] = 0;
        input[23] = 0;
        input[24] = 0;
      }
    }
  }
}
