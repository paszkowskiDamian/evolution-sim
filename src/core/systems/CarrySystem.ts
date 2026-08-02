import type { System } from './System';
import type { World } from '../world/world';
import { ROCK_TYPE, FOOD_TYPE } from '../world/items';
import { wrap } from '../utils/math';

/**
 * Chwytanie, upuszczanie i kopanie przedmiotów — kamieni ORAZ jedzenia.
 *
 * W przeciwieństwie do zwykłego jedzenia (automatyczna konsumpcja na
 * dotyk, patrz FoodSystem) to jest AKCJA — bramkowana wyjściem sieci
 * "chwyć/upuść". Jedno wyjście obsługuje trzy konteksty (bez nowego
 * wyjścia NN — kontekst decyduje):
 *   1. jest miejsce w ekwipunku + coś w zasięgu -> PODNIEŚ (jedzenie lub
 *      kamień, wygrywa cokolwiek bliżej),
 *   2. jest miejsce, ale nic w zasięgu, a coś się niesie -> UPUŚĆ (ostatnio
 *      podniesiony przedmiot, LIFO) — pozwala celowo odłożyć jedzenie gdzie
 *      indziej, nawet mając wolne sloty,
 *   3. ekwipunek PEŁNY i kamień w zasięgu -> KOP (kamień jest niszczony
 *      NA MIEJSCU, nie trafia do ekwipunku) — "kopanie" ściany, gdy nie ma
 *      już gdzie nosić gruzu; jeśli pełny i nic do kopania, spada do (2).
 *
 * Ekwipunek to `Agent.carriedItems` (do `config.maxCarryItems` slotów).
 * Kamień i jedzenie żyją w osobnych polach świata (ItemField — bryły,
 * FoodField — samoznikające na dotyk).
 *
 * Kolejność w ticku ma znaczenie: CarrySystem działa PRZED FoodSystem —
 * jeśli agent aktywnie chwyta jedzenie, znika ono z FoodField zanim
 * FoodSystem zdąży je automatycznie zjeść. Bez tej kolejności zjadanie na
 * dotyk zawsze wygrywałoby z chwytaniem i podniesienie jedzenia byłoby
 * niemożliwe.
 *
 * Cooldown po każdej udanej akcji jest konieczny: bez niego bramka
 * poziomowa (a nie zboczowa) prowadziłaby do migotania — upuszczony
 * przedmiot ląduje dokładnie w zasięgu chwytu, więc bez blokady agent
 * podnosiłby go i odkładał w nieskończoność co tick.
 */
export class CarrySystem implements System {
  readonly name = 'CarrySystem';

  update(world: World): void {
    const cfg = world.config;
    const items = world.items;
    const food = world.food;

    for (const a of world.agents) {
      if (!a.alive) continue;
      if (a.carryCooldown > 0) {
        a.carryCooldown--;
        continue;
      }
      if (a.brain.outputs[3] <= 0) continue;

      const reach = a.phenotype.radius + cfg.pickupRange;
      const hasRoom = a.carriedCount < cfg.maxCarryItems;

      let pickedRockId = -1;
      let bestRockD2 = Infinity;
      world.itemGrid.forEachInRadius(a.x, a.y, reach, (id, _dx, _dy, d2) => {
        if (items.alive[id] === 0) return;
        if (d2 < bestRockD2) {
          bestRockD2 = d2;
          pickedRockId = id;
        }
      });

      if (hasRoom) {
        let pickedFoodId = -1;
        let bestFoodD2 = Infinity;
        world.foodGrid.forEachInRadius(a.x, a.y, reach, (id, _dx, _dy, d2) => {
          if (food.alive[id] === 0) return;
          if (d2 < bestFoodD2) {
            bestFoodD2 = d2;
            pickedFoodId = id;
          }
        });

        if (pickedFoodId >= 0 && (pickedRockId < 0 || bestFoodD2 <= bestRockD2)) {
          food.remove(pickedFoodId);
          a.carriedItems[a.carriedCount++] = FOOD_TYPE;
          a.carryCooldown = cfg.carryActionCooldown;
          world.events.itemsPickedUp++;
          continue;
        }
        if (pickedRockId >= 0) {
          items.remove(pickedRockId);
          a.carriedItems[a.carriedCount++] = ROCK_TYPE;
          a.carryCooldown = cfg.carryActionCooldown;
          world.events.itemsPickedUp++;
          continue;
        }
      } else if (pickedRockId >= 0) {
        // Ekwipunek pełny: kamień pod ręką jest KOPANY — zniszczony na
        // miejscu zamiast blokować akcję. Nie trafia do ekwipunku (nie ma
        // gdzie), ale otwiera przejście przez ścianę.
        items.remove(pickedRockId);
        a.carryCooldown = cfg.carryActionCooldown;
        world.events.rocksDug++;
        continue;
      }

      // Nic do podniesienia/wykopania w zasięgu — jeśli coś się niesie,
      // odłóż ostatnio podniesiony przedmiot (LIFO).
      if (a.carriedCount > 0) {
        const topType = a.carriedItems[a.carriedCount - 1];
        a.carriedItems[a.carriedCount - 1] = -1;
        a.carriedCount--;
        // Upuszczenie tuż przed agentem, nie dokładnie na nim: dla kamieni
        // to konieczność (są bryłami — patrz RockCollisionSystem, "wewnątrz
        // siebie" nie jest miejscem, w którym agent mógłby fizycznie stać);
        // dla jedzenia zapobiega natychmiastowemu ponownemu zjedzeniu go
        // automatem FoodSystem w kolejnym ticku. Zero losowości: kierunek
        // to bieżący heading agenta.
        const carriedRadius = topType === FOOD_TYPE ? cfg.foodRadius : cfg.rockRadius;
        const dropDist = a.phenotype.radius + carriedRadius + 1;
        const dropX = wrap(a.x + Math.cos(a.heading) * dropDist, cfg.worldSize);
        const dropY = wrap(a.y + Math.sin(a.heading) * dropDist, cfg.worldSize);
        if (topType === FOOD_TYPE) {
          food.spawn(dropX, dropY);
        } else {
          items.spawn(dropX, dropY);
        }
        a.carryCooldown = cfg.carryActionCooldown;
        world.events.itemsDropped++;
      }
    }
  }
}
