import type { System } from './System';
import type { World } from '../world/world';
import { Agent } from '../agents/agent';
import { crossover, mutate, makeMutationReport } from '../genetics/mutation';
import { TAU, wrap } from '../utils/math';

/**
 * Realizuje narodziny zgłoszone przez ReproductionSystem:
 * krzyżuje genomy obojga rodziców, mutuje wynik i tworzy nowego agenta
 * z własną, świeżo zbudowaną siecią neuronową.
 *
 * To jedyne miejsce w całym projekcie, w którym powstaje nowa informacja
 * genetyczna. Krzyżowanie jednopunktowe (patrz `genetics/mutation.ts`)
 * działa tylko dlatego, że genom ma STAŁĄ długość w całej populacji
 * niezależnie od zdekodowanego kształtu mózgu — inaczej cięcie w
 * dowolnym miejscu byłoby niezgodne z długością drugiego rodzica.
 */
export class MutationSystem implements System {
  readonly name = 'MutationSystem';
  private readonly report = makeMutationReport();

  update(world: World): void {
    const cfg = world.config;
    const births = world.pendingBirths;
    if (births.length === 0) return;

    for (const req of births) {
      const { mother, father } = req;
      const combined = crossover(mother.genome, father.genome, world.rng);
      const genome = mutate(combined, cfg, world.rng, this.report);

      world.events.pointMutations += this.report.pointMutations;
      world.events.swapMutations += this.report.swaps;
      world.events.bigMutations += this.report.bigMutations;

      // Potomek rodzi się tuż obok matki, z losowym kierunkiem —
      // dziedziczy pozycję, ale nie orientację.
      const angle = world.rng.range(0, TAU);
      const dist = mother.phenotype.radius * 2 + 1;

      const child = new Agent(world.allocateAgentId(), genome, cfg, {
        x: wrap(mother.x + Math.cos(angle) * dist, cfg.worldSize),
        y: wrap(mother.y + Math.sin(angle) * dist, cfg.worldSize),
        heading: world.rng.range(0, TAU),
        energy: req.energy,
        motherId: mother.id,
        fatherId: father.id,
        generation: Math.max(mother.generation, father.generation) + 1,
        bornAtTick: world.tick,
      });
      child.reproCooldown = cfg.reproductionCooldown;

      world.addAgent(child);
      world.events.births++;
    }

    births.length = 0;
  }
}
