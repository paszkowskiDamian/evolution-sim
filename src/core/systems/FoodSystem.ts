import type { System } from './System';
import type { World } from '../world/world';
import type { SimulationConfig } from '../../config/simulationConfig';
import type { Agent } from '../agents/agent';
import { FOOD_TYPE } from '../world/items';

/**
 * Jedzenie: konsumpcja + odnawianie zasobu.
 *
 * Zjedzenie jest AKCJĄ — bramkowaną wyjściem sieci "jedz", tak samo jak
 * chwyt/upuszczenie czy atak. Dotknięcie jedzenia samo w sobie nic nie
 * robi: agent może stać na jedzeniu (albo je nieść) i świadomie go NIE
 * zjeść, np. żeby najpierw je podnieść (CarrySystem) i zabrać gdzie
 * indziej. Presja selekcyjna dotyczy więc nie tylko "czy potrafię się
 * dostać do jedzenia", ale i "czy rozpoznaję, KIEDY jeść".
 *
 * Gdy agent chce jeść, a nic nie leży w zasięgu na ziemi, je z WŁASNEGO
 * ekwipunku (jeśli coś tam niesie) — pozwala to na strategię "zbieraj,
 * potem jedz, kiedy trzeba", a nie tylko jedzenie na dotyk.
 *
 * Przejedzenie kosztuje zdrowie: energia, która nie mieści się już
 * w maxEnergy (bo agent jest pełny albo prawie pełny), nie znika po prostu
 * bez śladu — zamienia się w obrażenia, proporcjonalnie do nadwyżki. Im
 * więcej energii się marnuje, tym więcej zdrowia agent traci. To jedyny
 * sposób, żeby "zjedz, kiedy zechcesz" nie oznaczało "jedzenie nigdy nie
 * jest złym pomysłem" — najedzony agent, który zje kolejną porcję, płaci
 * za to realną cenę.
 */
export class FoodSystem implements System {
  readonly name = 'FoodSystem';

  update(world: World): void {
    const cfg = world.config;
    const food = world.food;

    // --- konsumpcja (wyłącznie na decyzję, wyjście "jedz") ---
    for (const a of world.agents) {
      if (!a.alive) continue;
      if (a.brain.outputs[5] <= 0) continue;

      const reach = a.phenotype.radius + cfg.foodRadius;
      let ateFromGround = false;
      world.foodGrid.forEachInRadius(a.x, a.y, reach, (foodId) => {
        if (food.alive[foodId] === 0) return; // ktoś zjadł w tym samym ticku
        food.remove(foodId);
        this.consume(a, cfg, world);
        ateFromGround = true;
      });

      // Nic na ziemi w zasięgu — spróbuj zjeść z własnego ekwipunku.
      if (!ateFromGround && a.carriedCount > 0) {
        for (let i = 0; i < a.carriedCount; i++) {
          if (a.carriedItems[i] !== FOOD_TYPE) continue;
          // Kolejność ekwipunku nie ma znaczenia poza LIFO przy odkładaniu —
          // usunięcie ze środka przez zamianę z ostatnim slotem jest bezpieczne.
          a.carriedItems[i] = a.carriedItems[a.carriedCount - 1];
          a.carriedItems[a.carriedCount - 1] = -1;
          a.carriedCount--;
          this.consume(a, cfg, world);
          break;
        }
      }
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

  private consume(a: Agent, cfg: SimulationConfig, world: World): void {
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
  }
}
