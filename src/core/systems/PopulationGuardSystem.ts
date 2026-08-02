import type { System } from './System';
import type { World } from '../world/world';
import { Agent } from '../agents/agent';
import { mutate, makeMutationReport } from '../genetics/mutation';
import { TAU, wrap } from '../utils/math';

/**
 * Zabezpieczenie przed całkowitym wymarciem populacji.
 *
 * To NIE jest mechanika ewolucyjna, tylko wygoda eksperymentatora:
 * przy `minPopulation = 0` system jest całkowicie wyłączony i świat
 * może wymrzeć na amen (co bywa najciekawszym wynikiem eksperymentu).
 *
 * Gdy jest włączony, dosiewa potomków ocalałych — a nie losowe genomy —
 * żeby nie kasować dorobku ewolucyjnego przy chwilowym załamaniu.
 */
export class PopulationGuardSystem implements System {
  readonly name = 'PopulationGuardSystem';
  private readonly report = makeMutationReport();

  update(world: World): void {
    const cfg = world.config;
    if (cfg.minPopulation <= 0) return;
    if (world.agents.length >= cfg.minPopulation) return;

    const survivors = world.agents.slice();

    while (world.agents.length < cfg.minPopulation) {
      if (survivors.length > 0) {
        const parent = survivors[world.rng.int(survivors.length)];
        const genome = mutate(parent.genome, cfg, world.rng, this.report);
        // Tuż obok rodzica, tak jak zwykłe rozmnażanie w MutationSystem —
        // bez tego potomek "teleportował się" w losowe miejsce na mapie,
        // mimo że ma prawdziwego rodzica tuż obok.
        const angle = world.rng.range(0, TAU);
        const dist = parent.phenotype.radius * 2 + 1;
        const child = new Agent(world.allocateAgentId(), genome, cfg, {
          x: wrap(parent.x + Math.cos(angle) * dist, cfg.worldSize),
          y: wrap(parent.y + Math.sin(angle) * dist, cfg.worldSize),
          heading: world.rng.range(0, TAU),
          energy: cfg.startEnergy,
          motherId: parent.id,
          generation: parent.generation + 1,
          bornAtTick: world.tick,
        });
        world.addAgent(child);
      } else {
        world.spawnRandomAgent();
      }
      world.events.reseeded++;
    }
  }
}
