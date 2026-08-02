import type { System } from './System';
import type { World } from '../world/world';
import { ROCK_TYPE } from '../world/items';
import { wrap } from '../utils/math';

/**
 * Chwytanie i upuszczanie przedmiotów (dziś: kamieni).
 *
 * W przeciwieństwie do jedzenia (automatyczna konsumpcja na dotyk) to
 * jest AKCJA — bramkowana wyjściem sieci "chwyć/upuść". Jedno wyjście
 * obsługuje oba kierunki: kontekst (pusty ekwipunek vs. coś niesione)
 * decyduje, czy to próba podniesienia, czy upuszczenia.
 *
 * Cooldown po każdej udanej akcji jest konieczny: bez niego bramka
 * poziomowa (a nie zboczowa) prowadziłaby do migotania — upuszczony
 * kamień ląduje dokładnie w zasięgu chwytu, więc bez blokady agent
 * podnosiłby go i odkładał w nieskończoność co tick.
 */
export class CarrySystem implements System {
  readonly name = 'CarrySystem';

  update(world: World): void {
    const cfg = world.config;
    const items = world.items;

    for (const a of world.agents) {
      if (!a.alive) continue;
      if (a.carryCooldown > 0) {
        a.carryCooldown--;
        continue;
      }
      if (a.brain.outputs[3] <= 0) continue;

      if (a.carriedItemType < 0) {
        const reach = a.phenotype.radius + cfg.pickupRange;
        let pickedId = -1;
        world.itemGrid.forEachInRadius(a.x, a.y, reach, (id) => {
          if (items.alive[id] === 0) return;
          pickedId = id;
          return false; // ekwipunek jednosłotowy — pierwsze trafienie wystarczy
        });
        if (pickedId >= 0) {
          items.remove(pickedId);
          a.carriedItemType = ROCK_TYPE;
          a.carryCooldown = cfg.carryActionCooldown;
          world.events.itemsPickedUp++;
        }
      } else {
        // Upuszczenie: tuż przed agentem, nie dokładnie na nim — kamienie
        // są bryłami (RockCollisionSystem), więc "wewnątrz siebie" nie
        // jest miejscem, w którym agent mógłby fizycznie stać. Zero
        // losowości: kierunek to bieżący heading agenta, deterministyczny.
        const dropDist = a.phenotype.radius + cfg.rockRadius + 1;
        const dropX = wrap(a.x + Math.cos(a.heading) * dropDist, cfg.worldSize);
        const dropY = wrap(a.y + Math.sin(a.heading) * dropDist, cfg.worldSize);
        items.spawn(dropX, dropY);
        a.carriedItemType = -1;
        a.carryCooldown = cfg.carryActionCooldown;
        world.events.itemsDropped++;
      }
    }
  }
}
