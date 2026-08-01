import type { System } from './System';
import type { World } from '../world/world';

/**
 * Jedzenie: konsumpcja + odnawianie zasobu.
 *
 * Agent zjada wszystko, co dotknie — nie ma tu decyzji ani wyjścia sieci
 * "jedz". Dzięki temu presja selekcyjna dotyczy wyłącznie tego, czy agent
 * potrafi się DOSTAĆ do jedzenia.
 */
export class FoodSystem implements System {
  readonly name = 'FoodSystem';

  update(world: World): void {
    const cfg = world.config;
    const food = world.food;

    // --- konsumpcja ---
    for (const a of world.agents) {
      if (!a.alive) continue;
      const reach = a.phenotype.radius + cfg.foodRadius;
      world.foodGrid.forEachInRadius(a.x, a.y, reach, (foodId) => {
        if (food.alive[foodId] === 0) return; // ktoś zjadł w tym samym ticku
        food.remove(foodId);
        const before = a.energy;
        a.energy = Math.min(cfg.maxEnergy, a.energy + cfg.foodEnergy);
        a.energyGained += a.energy - before;
        a.foodEaten++;
        world.events.foodEaten++;
        return;
      });
    }

    // --- odnawianie ---
    world.driftClusters();
    let toSpawn = Math.floor(cfg.foodSpawnRate);
    const fractional = cfg.foodSpawnRate - toSpawn;
    if (fractional > 0 && world.foodRng.chance(fractional)) toSpawn++;
    for (let i = 0; i < toSpawn; i++) {
      world.spawnFood();
    }
  }
}
