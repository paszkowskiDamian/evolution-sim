import type { System } from './System';
import type { World } from '../world/world';
import { wrap } from '../utils/math';

/**
 * Miękkie rozpychanie się ciał.
 *
 * Agenci nie mogą zajmować tego samego miejsca — nakładające się ciała
 * są delikatnie rozsuwane. To jedyna reguła "społeczna" wpisana w fizykę:
 * tworzy realny koszt tłoku i konkurencję o przestrzeń, ale nie mówi
 * agentom, co mają z tym zrobić.
 */
export class CollisionSystem implements System {
  readonly name = 'CollisionSystem';

  update(world: World): void {
    const cfg = world.config;
    const size = cfg.worldSize;
    const maxR = cfg.agentRadiusMax;

    for (const a of world.agents) {
      if (!a.alive) continue;
      const ra = a.phenotype.radius;
      world.agentGrid.forEachInRadius(a.x, a.y, ra + maxR, (id, dx, dy, d2) => {
        if (id <= a.id) return; // każdą parę rozpatrujemy raz
        const b = world.agentById.get(id);
        if (!b || !b.alive) return;
        const minDist = ra + b.phenotype.radius;
        if (d2 >= minDist * minDist) return;
        const dist = Math.sqrt(d2) || 0.0001;
        const overlap = (minDist - dist) * 0.5;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        if (cfg.wrapEdges) {
          a.x = wrap(a.x, size);
          a.y = wrap(a.y, size);
          b.x = wrap(b.x, size);
          b.y = wrap(b.y, size);
        }
        return;
      });
    }
  }
}
