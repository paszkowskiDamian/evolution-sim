import type { System } from './System';
import type { World } from '../world/world';
import { wrap } from '../utils/math';

/**
 * Kamienie leżące na ziemi są bryłami — agent nie może przez nie przejść.
 *
 * Ta sama technika co CollisionSystem (miękkie rozpychanie zamiast
 * twardego zatrzymania ruchu): po ruchu sprawdzamy nakładanie się z każdym
 * kamieniem w zasięgu i wypychamy agenta na zewnątrz, wzdłuż linii
 * kamień->agent. Jednostronne (tylko agent się rusza) — kamień nie ma
 * własnego ruchu, więc nie ma czego rozpychać w drugą stronę.
 *
 * Kamień NIESIONY (usunięty z ItemField przez CarrySystem) przestaje być
 * przeszkodą — nie da się zderzyć z czymś, co się właśnie niesie.
 */
export class RockCollisionSystem implements System {
  readonly name = 'RockCollisionSystem';

  update(world: World): void {
    const cfg = world.config;
    const items = world.items;
    const size = cfg.worldSize;

    for (const a of world.agents) {
      if (!a.alive) continue;
      const reach = a.phenotype.radius + cfg.rockRadius;
      const reach2 = reach * reach;
      world.itemGrid.forEachInRadius(a.x, a.y, reach, (id, dx, dy, d2) => {
        if (items.alive[id] === 0) return;
        if (d2 >= reach2) return;
        const dist = Math.sqrt(d2) || 0.0001;
        const overlap = reach - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        // dx/dy wskazują OD agenta DO kamienia — odsuwamy agenta w stronę przeciwną.
        a.x -= nx * overlap;
        a.y -= ny * overlap;
      });
      if (cfg.wrapEdges) {
        a.x = wrap(a.x, size);
        a.y = wrap(a.y, size);
      }
    }
  }
}
