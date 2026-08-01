import type { System } from './System';
import type { World } from '../world/world';

/**
 * Przebudowuje siatki przestrzenne na początku ticka.
 *
 * Dzięki temu wszystkie kolejne systemy w tym ticku widzą spójny,
 * "zamrożony" obraz świata — sensory jednego agenta nie zależą od tego,
 * czy inny agent zdążył się już poruszyć.
 */
export class SpatialIndexSystem implements System {
  readonly name = 'SpatialIndexSystem';

  update(world: World): void {
    const ag = world.agentGrid;
    ag.clear();
    for (const a of world.agents) {
      if (a.alive) ag.insert(a.id, a.x, a.y);
    }

    const fg = world.foodGrid;
    fg.clear();
    const food = world.food;
    for (let i = 0; i < food.capacity; i++) {
      if (food.alive[i] === 1) fg.insert(i, food.xs[i], food.ys[i]);
    }
  }
}
