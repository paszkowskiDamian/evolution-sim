import type { System } from './System';
import type { World } from '../world/world';
import { wrap } from '../utils/math';

/**
 * Teren (lita skała — patrz `core/world/terrain.ts`) jest nieprzepuszczalny.
 *
 * ZASTĘPUJE dawny `RockCollisionSystem`, który sprawdzał zderzenia
 * z pojedynczymi kamieniami-przedmiotami. To była przyczyna błędu "agent
 * przechodzi przez ścianę": losowo rozrzucone kółka prawie zawsze zostawiają
 * szczeliny. Siatka terenu nie ma tego problemu — sąsiadujące lite komórki
 * stykają się krawędziami, bez przerw, niezależnie od tego, jak drobny jest
 * agent (nawet punktowy nie przecisnąłby się przez róg, bo lita komórka
 * blokuje CAŁY swój prostokąt, a nie tylko środek).
 *
 * Technika identyczna jak poprzednio (miękkie rozpychanie z najbliższego
 * punktu przeszkody): po ruchu sprawdzamy WSZYSTKIE lite komórki, które
 * mogłyby nachodzić na okrąg agenta, i wypychamy go na zewnątrz każdej
 * po kolei.
 *
 * Luźne kamienie (ItemField) NIE są tu sprawdzane — to zwykły, nieblokujący
 * zasób do podniesienia, nie przeszkoda. Przeszkodą jest wyłącznie teren.
 */
export class TerrainCollisionSystem implements System {
  readonly name = 'TerrainCollisionSystem';

  update(world: World): void {
    const cfg = world.config;
    const terrain = world.terrain;
    const size = cfg.worldSize;
    const cellSize = terrain.cellSize;

    for (const a of world.agents) {
      if (!a.alive) continue;
      const r = a.phenotype.radius;
      const reach = Math.ceil(r / cellSize) + 1;
      const baseCx = terrain.cellX(a.x);
      const baseCy = terrain.cellY(a.y);

      for (let oy = -reach; oy <= reach; oy++) {
        for (let ox = -reach; ox <= reach; ox++) {
          const cx = baseCx + ox;
          const cy = baseCy + oy;
          if (!terrain.isSolidCell(cx, cy)) continue;
          const { dx, dy, dist2 } = terrain.closestPointDelta(a.x, a.y, cx, cy);
          if (dist2 >= r * r) continue;
          const dist = Math.sqrt(dist2) || 0.0001;
          const overlap = r - dist;
          // dx/dy wskazują OD agenta DO najbliższego punktu komórki —
          // odsuwamy agenta w stronę przeciwną.
          a.x -= (dx / dist) * overlap;
          a.y -= (dy / dist) * overlap;
        }
      }

      if (cfg.wrapEdges) {
        a.x = wrap(a.x, size);
        a.y = wrap(a.y, size);
      }
    }
  }
}
