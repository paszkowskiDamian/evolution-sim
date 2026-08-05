import type { System } from './System';
import type { World } from '../world/world';
import { ageRamp } from '../utils/math';

/**
 * Walka: atak zadaje obrażenia zdrowiu, nigdy energii ani przedmiotom.
 *
 * Decyzja "czy atakować" (wyjście sieci "atak") jest w pełni behawioralna
 * i podlega ewolucji przez wagi mózgu, tak jak reszta zachowania. SIŁA
 * ataku skaluje się genem `aggression` — cechą ciała, zarezerwowaną w
 * genomie od początku właśnie pod tę mechanikę. To rozdziela "czy" (mózg)
 * od "jak mocno" (ciało), tak jak reszta symulacji rozdziela zachowanie
 * od fizjologii.
 *
 * Dodatkowo siła bojowa rośnie z wiekiem: młode osobniki zadają ułamek
 * pełnych obrażeń, dochodząc do 100% dopiero po `combatMaturationTicks` —
 * dłuższy narost niż przy prędkości (`speedMaturationTicks`), więc młody
 * osobnik jest niebezpieczny w ruchu szybciej, niż jest niebezpieczny w walce.
 *
 * Cel to najbliższy inny agent w zasięgu — wybór deterministyczny, bez
 * losowości. Nieudana próba (nikogo w zasięgu) nic nie kosztuje i nie
 * uruchamia cooldownu, tak jak nieudana próba chwytu w CarrySystem.
 */
export class AttackSystem implements System {
  readonly name = 'AttackSystem';

  update(world: World): void {
    const cfg = world.config;

    for (const a of world.agents) {
      if (!a.alive) continue;
      if (a.attackCooldown > 0) {
        a.attackCooldown--;
        continue;
      }
      if (a.brain.outputs[4] <= 0) continue;

      const reach = a.phenotype.radius + cfg.attackRange;
      let targetId = -1;
      let bestD2 = Infinity;
      world.agentGrid.forEachInRadius(a.x, a.y, reach, (id, _dx, _dy, d2) => {
        if (id === a.id) return;
        const candidate = world.agentById.get(id);
        if (
          candidate &&
          a.cooperatingFoodId >= 0 &&
          candidate.cooperatingFoodId === a.cooperatingFoodId
        ) {
          return;
        }
        if (d2 < bestD2) {
          bestD2 = d2;
          targetId = id;
        }
      });
      if (targetId < 0) continue;

      const target = world.agentById.get(targetId);
      if (!target || !target.alive) continue;

      const maturity = ageRamp(a.age, cfg.combatMaturationTicks, cfg.juvenileCombatFactor);
      const teamPower = a.cooperatingFoodId >= 0 ? cfg.cooperativeCombatMultiplier : 1;
      const damage = cfg.attackDamageBase * (0.4 + a.phenotype.aggression) * maturity * teamPower;
      target.health = Math.max(0, target.health - damage);
      a.energy -= cfg.attackEnergyCost;
      a.attackCooldown = cfg.attackCooldownTicks;
      world.events.attacks++;
      world.recordCombatEvent(target.x, target.y);
    }
  }
}
