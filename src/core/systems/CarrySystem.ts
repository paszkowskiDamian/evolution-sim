import type { System } from './System';
import type { World } from '../world/world';
import { ROCK_TYPE, FOOD_TYPE } from '../world/items';
import { TILE_EMPTY, TILE_ROCK } from '../world/terrain';
import { wrap } from '../utils/math';

/**
 * Chwytanie, upuszczanie, kopanie i BUDOWANIE — jedno wyjście sieci
 * "chwyć/upuść" obsługuje wszystkie cztery konteksty, bez nowego wyjścia NN:
 *
 *   1. jest miejsce w ekwipunku + luźne jedzenie/kamień w zasięgu -> PODNIEŚ
 *      (wygrywa cokolwiek bliżej),
 *   2. jest miejsce, nic luźnego w zasięgu, ALE ściana (lita komórka terenu)
 *      w zasięgu -> WYKOP wprost do ekwipunku (kamień z rozbitej ściany),
 *   3. ekwipunek PEŁNY i ściana w zasięgu -> WYKOP, ale gruz ląduje na ziemi
 *      (nie ma gdzie go nieść) — otwiera przejście, nawet bez wolnych rąk,
 *   4. nic do podniesienia/wykopania -> UPUŚĆ ostatnio podniesiony przedmiot
 *      (LIFO). Upuszczenie KAMIENIA na pustą komórkę terenu, na której leży
 *      już `buildRockThreshold` luźnych kamieni, ZESTALA ją w ścianę — to
 *      cały mechanizm "budowania": czysta konsekwencja zwykłego odkładania,
 *      bez osobnej decyzji czy nowego wyjścia sieci.
 *
 * Ściana to KOMÓRKA TERENU (patrz `core/world/terrain.ts`), nie przedmiot —
 * to ona jest przeszkodą (TerrainCollisionSystem). Luźne kamienie
 * (ItemField) to wyłącznie zasób do noszenia, nigdy przeszkoda.
 *
 * Kolejność w ticku ma znaczenie: CarrySystem działa PRZED FoodSystem —
 * jeśli agent aktywnie chwyta jedzenie, znika ono z FoodField zanim
 * FoodSystem zdąży je automatycznie zjeść.
 *
 * Cooldown po każdej udanej akcji jest konieczny: bez niego bramka
 * poziomowa (a nie zboczowa) prowadziłaby do migotania.
 */
export class CarrySystem implements System {
  readonly name = 'CarrySystem';

  update(world: World): void {
    const cfg = world.config;
    const items = world.items;
    const food = world.food;
    const terrain = world.terrain;

    for (const a of world.agents) {
      if (!a.alive) continue;
      if (a.carryCooldown > 0) {
        a.carryCooldown--;
        continue;
      }
      if (a.brain.outputs[3] <= 0) continue;

      const reach = a.phenotype.radius + cfg.pickupRange;
      const hasRoom = a.carriedCount < cfg.maxCarryItems;

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
        let pickedRockId = -1;
        let bestRockD2 = Infinity;
        world.itemGrid.forEachInRadius(a.x, a.y, reach, (id, _dx, _dy, d2) => {
          if (items.alive[id] === 0) return;
          if (d2 < bestRockD2) {
            bestRockD2 = d2;
            pickedRockId = id;
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

        const wall = terrain.findNearestSolid(a.x, a.y, reach);
        if (wall) {
          terrain.set(wall.cx, wall.cy, TILE_EMPTY);
          a.carriedItems[a.carriedCount++] = ROCK_TYPE;
          a.carryCooldown = cfg.carryActionCooldown;
          world.events.tilesDug++;
          continue;
        }
      } else {
        const wall = terrain.findNearestSolid(a.x, a.y, reach);
        if (wall) {
          terrain.set(wall.cx, wall.cy, TILE_EMPTY);
          // Ekwipunek pełny — gruz ląduje na ziemi zamiast trafić do rąk.
          const center = terrain.cellCenter(wall.cx, wall.cy);
          items.spawn(wrap(center.x, cfg.worldSize), wrap(center.y, cfg.worldSize));
          a.carryCooldown = cfg.carryActionCooldown;
          world.events.tilesDug++;
          continue;
        }
      }

      // Nic do podniesienia/wykopania w zasięgu — jeśli coś się niesie,
      // odłóż ostatnio podniesiony przedmiot (LIFO).
      if (a.carriedCount > 0) {
        const topType = a.carriedItems[a.carriedCount - 1];
        a.carriedItems[a.carriedCount - 1] = -1;
        a.carriedCount--;
        // Upuszczenie tuż przed agentem, nie dokładnie na nim: zapobiega
        // natychmiastowemu ponownemu podniesieniu/zjedzeniu w kolejnym ticku.
        // Zero losowości: kierunek to bieżący heading agenta.
        const carriedRadius = topType === FOOD_TYPE ? cfg.foodRadius : cfg.rockRadius;
        const dropDist = a.phenotype.radius + carriedRadius + 1;
        const dropX = wrap(a.x + Math.cos(a.heading) * dropDist, cfg.worldSize);
        const dropY = wrap(a.y + Math.sin(a.heading) * dropDist, cfg.worldSize);
        if (topType === FOOD_TYPE) {
          food.spawn(dropX, dropY);
        } else {
          items.spawn(dropX, dropY);
          this.maybeBuild(world, dropX, dropY);
        }
        a.carryCooldown = cfg.carryActionCooldown;
        world.events.itemsDropped++;
      }
    }
  }

  /**
   * Jeśli odłożony kamień wylądował na PUSTEJ komórce terenu, na której leży
   * już >= `buildRockThreshold` luźnych kamieni, komórka zestala się w ścianę
   * — konsumując te kamienie. Liczymy przez surowe `ItemField`, nie przez
   * `world.itemGrid`: siatka przestrzenna jest przebudowywana raz na tick
   * PRZED CarrySystem, więc kamień odłożony chwilę wcześniej W TYM SAMYM
   * ticku (przez ten sam albo innego agenta) nie byłby jeszcze w niej widoczny.
   */
  private maybeBuild(world: World, x: number, y: number): void {
    const terrain = world.terrain;
    const items = world.items;
    const cx = terrain.cellX(x);
    const cy = terrain.cellY(y);
    if (terrain.get(cx, cy) !== TILE_EMPTY) return;

    const ids: number[] = [];
    for (let i = 0; i < items.capacity; i++) {
      if (items.alive[i] === 0) continue;
      if (terrain.cellX(items.xs[i]) === cx && terrain.cellY(items.ys[i]) === cy) {
        ids.push(i);
      }
    }
    if (ids.length < world.config.buildRockThreshold) return;

    for (const id of ids) items.remove(id);
    terrain.set(cx, cy, TILE_ROCK);
    world.events.tilesBuilt++;

    // Jedzenie akurat leżące na tej komórce (przypadkiem, z dryfującego
    // płata) nie może zostać "zamurowane" — usuwamy je razem z zestaleniem,
    // tak samo jak spawnFood() od razu unika litych komórek.
    const food = world.food;
    for (let i = 0; i < food.capacity; i++) {
      if (food.alive[i] === 0) continue;
      if (terrain.cellX(food.xs[i]) === cx && terrain.cellY(food.ys[i]) === cy) {
        food.remove(i);
      }
    }
  }
}
