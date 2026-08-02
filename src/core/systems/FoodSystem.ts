import type { System } from './System';
import type { World } from '../world/world';

/**
 * Jedzenie: konsumpcja + odnawianie zasobu.
 *
 * Agent zjada wszystko, co dotknie — nie ma tu decyzji ani wyjścia sieci
 * "jedz". Dzięki temu presja selekcyjna dotyczy wyłącznie tego, czy agent
 * potrafi się DOSTAĆ do jedzenia.
 *
 * Przejedzenie kosztuje zdrowie: energia, która nie mieści się już
 * w maxEnergy (bo agent jest pełny albo prawie pełny), nie znika po prostu
 * bez śladu — zamienia się w obrażenia, proporcjonalnie do nadwyżki. Im
 * więcej energii się marnuje, tym więcej zdrowia agent traci. To jedyny
 * sposób, żeby "jem wszystko na dotyk" nie oznaczało "jedzenie nigdy nie
 * jest złym pomysłem" — najedzony agent, który wejdzie w kolejne jedzenie,
 * płaci za to realną cenę.
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
        const raw = before + cfg.foodEnergy;
        const overflow = Math.max(0, raw - cfg.maxEnergy);
        a.energy = Math.min(cfg.maxEnergy, raw);
        a.energyGained += a.energy - before;
        a.foodEaten++;
        world.events.foodEaten++;
        if (overflow > 0) {
          a.health = Math.max(0, a.health - overflow * cfg.overfeedHealthPenalty);
        }
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
