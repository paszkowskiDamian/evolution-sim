import type { System } from './System';
import type { World } from '../world/world';

/**
 * Rozmnażanie (bezpłciowe — etap M3).
 *
 * Warunki są czysto fizjologiczne: dojrzałość, brak cooldownu i wystarczający
 * zapas energii. O tym, CZY w danym momencie się rozmnożyć, decyduje sam agent
 * przez trzecie wyjście swojej sieci. To realny wybór ewolucyjny — rozmnażać
 * się wcześnie i tanio, czy późno i bezpiecznie.
 *
 * System nie tworzy potomka — tylko zgłasza narodziny do kolejki i pobiera
 * energię od rodzica. Genom powstaje w MutationSystem.
 */
export class ReproductionSystem implements System {
  readonly name = 'ReproductionSystem';

  update(world: World): void {
    const cfg = world.config;
    if (world.agents.length >= cfg.maxPopulation) return;

    let slots = cfg.maxPopulation - world.agents.length;

    for (const a of world.agents) {
      if (slots <= 0) break;
      if (!a.alive) continue;
      if (a.age < cfg.maturityAge) continue;
      if (a.reproCooldown > 0) continue;

      const threshold = a.phenotype.reproThreshold * cfg.maxEnergy;
      if (a.energy < threshold) continue;

      // Decyzja agenta — wyjście "chęć rozmnażania".
      if (a.brain.outputs[2] <= 0) continue;

      const invested = a.energy * cfg.reproductionCost;
      a.energy -= invested;
      a.reproCooldown = cfg.reproductionCooldown;
      a.childrenCount++;

      // Część energii ginie w samym akcie reprodukcji — rozmnażanie
      // nigdy nie jest darmowe, inaczej populacja eksploduje.
      world.pendingBirths.push({ parent: a, energy: invested * 0.75 });
      slots--;
    }
  }
}
