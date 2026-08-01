import type { System } from './System';
import type { World } from '../world/world';
import { Agent } from '../agents/agent';
import { mutate, makeMutationReport } from '../genetics/mutation';
import { TAU, wrap } from '../utils/math';

/**
 * Realizuje narodziny zgłoszone przez ReproductionSystem:
 * kopiuje genom rodzica, mutuje go i tworzy nowego agenta z własną,
 * świeżo zbudowaną siecią neuronową.
 *
 * To jedyne miejsce w całym projekcie, w którym powstaje nowa informacja
 * genetyczna. Cała "nauka" systemu przechodzi przez te kilka linijek.
 */
export class MutationSystem implements System {
  readonly name = 'MutationSystem';
  private readonly report = makeMutationReport();

  update(world: World): void {
    const cfg = world.config;
    const births = world.pendingBirths;
    if (births.length === 0) return;

    for (const req of births) {
      const parent = req.parent;
      const genome = mutate(parent.genome, cfg, world.rng, this.report);

      world.events.pointMutations += this.report.pointMutations;
      world.events.swapMutations += this.report.swaps;
      world.events.bigMutations += this.report.bigMutations;

      // Potomek rodzi się tuż obok rodzica, z losowym kierunkiem —
      // dziedziczy pozycję, ale nie orientację.
      const angle = world.rng.range(0, TAU);
      const dist = parent.phenotype.radius * 2 + 1;

      const child = new Agent(world.allocateAgentId(), genome, cfg, {
        x: wrap(parent.x + Math.cos(angle) * dist, cfg.worldSize),
        y: wrap(parent.y + Math.sin(angle) * dist, cfg.worldSize),
        heading: world.rng.range(0, TAU),
        energy: req.energy,
        motherId: parent.id,
        fatherId: -1, // rozmnażanie płciowe: M5+
        generation: parent.generation + 1,
        bornAtTick: world.tick,
      });
      child.reproCooldown = cfg.reproductionCooldown;

      world.addAgent(child);
      world.events.births++;
    }

    births.length = 0;
  }
}
