import type { System } from './System';
import type { World } from '../world/world';
import type { Agent } from '../agents/agent';
import type { SimulationConfig } from '../../config/simulationConfig';

/**
 * Rozmnażanie dwuosobnicze, bez ograniczenia płcią.
 *
 * Warunki fizjologiczne (dojrzałość, brak cooldownu, energia) muszą spełniać
 * OBOJE rodzice niezależnie, i oboje muszą "chcieć" — trzecie wyjście sieci
 * ("chęć rozmnażania") działa jak wzajemna zgoda, nie ma osobnego wyjścia
 * "zaloty". Agent szuka najbliższego dowolnego partnera w zasięgu,
 * który też spełnia te warunki — to samo `matingRange`, ta sama logika
 * lokalnego wyszukiwania co reszta symulacji (bez wiedzy globalnej).
 *
 * System nie tworzy potomka — tylko zgłasza narodziny do kolejki i pobiera
 * energię od obojga rodziców. Genom (krzyżowanie + mutacja) powstaje
 * w MutationSystem.
 */
export class ReproductionSystem implements System {
  readonly name = 'ReproductionSystem';

  update(world: World): void {
    const cfg = world.config;
    if (world.agents.length >= cfg.maxPopulation) return;

    let slots = cfg.maxPopulation - world.agents.length;
    // Agent raz sparowany w tym ticku nie może być użyty drugi raz —
    // ani jako inicjator, ani jako cudzy partner.
    const claimed = new Set<number>();

    for (const a of world.agents) {
      if (slots <= 0) break;
      if (!a.alive || claimed.has(a.id)) continue;
      if (!this.isReady(a, cfg)) continue;

      const reach = a.phenotype.radius + cfg.matingRange;
      let partnerId = -1;
      let bestD2 = Infinity;
      world.agentGrid.forEachInRadius(a.x, a.y, reach, (id, _dx, _dy, d2) => {
        if (id === a.id || claimed.has(id)) return;
        const b = world.agentById.get(id);
        if (!b || !b.alive) return;
        if (!this.isReady(b, cfg)) return;
        if (d2 < bestD2) {
          bestD2 = d2;
          partnerId = id;
        }
      });
      if (partnerId < 0) continue;

      const partner = world.agentById.get(partnerId)!;
      claimed.add(a.id);
      claimed.add(partner.id);

      const investA = a.energy * cfg.reproductionCost;
      const investB = partner.energy * cfg.reproductionCost;
      a.energy -= investA;
      partner.energy -= investB;
      a.childrenCount++;
      partner.childrenCount++;

      // Nazwy mother/father pozostają wyłącznie dla kompatybilności drzewa
      // genealogicznego. Płeć nie ogranicza już doboru partnera.
      const mother = a;
      const father = partner;

      mother.reproCooldown = cfg.reproductionCooldown;
      father.reproCooldown = cfg.reproductionCooldown;

      // Część zainwestowanej energii ginie w samym akcie reprodukcji —
      // rozmnażanie nigdy nie jest darmowe, inaczej populacja eksploduje.
      world.pendingBirths.push({ mother, father, energy: (investA + investB) * 0.75 });
      slots--;
    }
  }

  private isReady(a: Agent, cfg: SimulationConfig): boolean {
    if (a.age < cfg.maturityAge) return false;
    if (a.reproCooldown > 0) return false;
    if (a.energy < a.phenotype.reproThreshold * cfg.maxEnergy) return false;
    return a.brain.outputs[2] > 0;
  }
}
