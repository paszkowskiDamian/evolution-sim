import type { System } from './System';
import type { World } from '../world/world';
import { makeNearestResult, queryNearest } from '../utils/spatialHash';
// queryNearest zostaje dla jedzenia; sąsiadów liczymy jednym własnym przejściem.
import { normalizeAngle, clamp } from '../utils/math';

/**
 * Zbiera wejścia sieci neuronowej każdego agenta.
 *
 * Wszystkie sensory są LOKALNE i względne — agent nie zna swojej pozycji
 * globalnej ani stanu świata. Widzi tylko kierunek i bliskość rzeczy
 * w swoim promieniu widzenia. To warunek konieczny, żeby zachowania
 * mogły być emergentne, a nie odczytane z gotowej mapy.
 *
 * Kolejność wejść musi odpowiadać SENSOR_LABELS z neural/network.ts.
 */
export class SensorSystem implements System {
  readonly name = 'SensorSystem';
  private readonly nearestFood = makeNearestResult();
  private readonly nearestAgent = makeNearestResult();
  private readonly nearestItem = makeNearestResult();

  update(world: World): void {
    const cfg = world.config;
    const rng = world.rng;

    for (const a of world.agents) {
      if (!a.alive) continue;
      const vision = a.phenotype.visionRadius;
      const input = a.lastInputs;

      input[0] = 1; // bias
      input[1] = (a.energy / cfg.maxEnergy) * 2 - 1;
      input[2] = clamp(a.age / cfg.maxAge, 0, 1) * 2 - 1;
      input[3] = (a.speed / a.phenotype.maxSpeed) * 2 - 1;

      // --- najbliższe jedzenie ---
      const f = queryNearest(world.foodGrid, a.x, a.y, vision, this.nearestFood);
      if (f.found) {
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

      // --- najbliższy inny agent + zagęszczenie ---
      // Jedno przejście po siatce liczy oba sensory naraz. Rozbicie tego
      // na dwa zapytania podwajało koszt najdroższego systemu w ticku.
      const n = this.nearestAgent;
      n.found = false;
      n.dist2 = Infinity;
      let neighbours = 0;
      const densityRadius2 = (vision * 0.5) * (vision * 0.5);
      world.agentGrid.forEachInRadius(a.x, a.y, vision, (id, dx, dy, d2) => {
        if (id === a.id) return;
        if (d2 < n.dist2) {
          n.dist2 = d2;
          n.dx = dx;
          n.dy = dy;
          n.id = id;
          n.found = true;
        }
        if (d2 <= densityRadius2) neighbours++;
        return;
      });

      if (n.found) {
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

      // --- czy coś niosę ---
      input[12] = a.carriedItemType >= 0 ? 1 : -1;

      // --- najbliższy kamień (lustrzane odbicie sensora jedzenia) ---
      const it = queryNearest(world.itemGrid, a.x, a.y, vision, this.nearestItem);
      if (it.found) {
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
    }
  }
}
