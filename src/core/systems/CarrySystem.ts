import type { System } from './System';
import type { World } from '../world/world';
import { ROCK_TYPE, FOOD_TYPE } from '../world/items';
import { wrap } from '../utils/math';

/**
 * Chwytanie i upuszczanie przedmiotów — kamieni ORAZ jedzenia.
 *
 * W przeciwieństwie do zwykłego jedzenia (automatyczna konsumpcja na
 * dotyk, patrz FoodSystem) to jest AKCJA — bramkowana wyjściem sieci
 * "chwyć/upuść". Jedno wyjście obsługuje oba kierunki: kontekst (pusty
 * ekwipunek vs. coś niesione) decyduje, czy to próba podniesienia, czy
 * odłożenia. Kamień i jedzenie żyją w osobnych polach świata (ItemField —
 * bryły, FoodField — samoznikające na dotyk), ale dzielą ten sam
 * jednosłotowy ekwipunek: przy podnoszeniu wygrywa cokolwiek jest bliżej.
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

      if (a.carriedItemType < 0) {
        const reach = a.phenotype.radius + cfg.pickupRange;
        let pickedRockId = -1;
        let bestRockD2 = Infinity;
        world.itemGrid.forEachInRadius(a.x, a.y, reach, (id, _dx, _dy, d2) => {
          if (items.alive[id] === 0) return;
          if (d2 < bestRockD2) {
            bestRockD2 = d2;
            pickedRockId = id;
          }
        });
        let pickedFoodId = -1;
        let bestFoodD2 = Infinity;
        world.foodGrid.forEachInRadius(a.x, a.y, reach, (id, _dx, _dy, d2) => {
          if (food.alive[id] === 0) return;
          if (d2 < bestFoodD2) {
            bestFoodD2 = d2;
            pickedFoodId = id;
          }
        });

        // Ekwipunek jednosłotowy — wygrywa cokolwiek jest bliżej.
        if (pickedFoodId >= 0 && (pickedRockId < 0 || bestFoodD2 <= bestRockD2)) {
          food.remove(pickedFoodId);
          a.carriedItemType = FOOD_TYPE;
          a.carryCooldown = cfg.carryActionCooldown;
          world.events.itemsPickedUp++;
        } else if (pickedRockId >= 0) {
          items.remove(pickedRockId);
          a.carriedItemType = ROCK_TYPE;
          a.carryCooldown = cfg.carryActionCooldown;
          world.events.itemsPickedUp++;
        }
      } else {
        // Upuszczenie: tuż przed agentem, nie dokładnie na nim. Dla
        // kamieni to konieczność (są bryłami — patrz RockCollisionSystem,
        // "wewnątrz siebie" nie jest miejscem, w którym agent mógłby
        // fizycznie stać); dla jedzenia to zapobiega natychmiastowemu
        // ponownemu zjedzeniu go automatem FoodSystem w kolejnym ticku.
        // Zero losowości: kierunek to bieżący heading agenta.
        const carriedRadius = a.carriedItemType === FOOD_TYPE ? cfg.foodRadius : cfg.rockRadius;
        const dropDist = a.phenotype.radius + carriedRadius + 1;
        const dropX = wrap(a.x + Math.cos(a.heading) * dropDist, cfg.worldSize);
        const dropY = wrap(a.y + Math.sin(a.heading) * dropDist, cfg.worldSize);
        if (a.carriedItemType === FOOD_TYPE) {
          food.spawn(dropX, dropY);
        } else {
          items.spawn(dropX, dropY);
        }
        a.carriedItemType = -1;
        a.carryCooldown = cfg.carryActionCooldown;
        world.events.itemsDropped++;
      }
    }
  }
}
