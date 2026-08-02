import type { System } from './System';
import type { World } from '../world/world';
import { Agent } from '../agents/agent';
import { mutate, makeMutationReport } from '../genetics/mutation';
import { bioGeneOffset, BIO_GENES, FEMALE } from '../genetics/genome';
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
 *
 * Płeć wymaga dodatkowej ostrożności: przy bardzo małej populacji dryf
 * genetyczny łatwo doprowadza do sytuacji, w której WSZYSCY ocaleni są
 * tej samej płci — a skoro rozmnażanie jest płciowe, sama symulacja
 * nigdy by się z tego nie wydźwignęła (klonowanie ocalałych nie zmienia
 * płci). Dlatego ten system, o ile brakuje którejś płci, wymusza ją
 * u dosiewanego potomka — to wyłącznie odblokowanie normalnej ewolucji,
 * nie faworyzowanie żadnej strategii.
 */
export class PopulationGuardSystem implements System {
  readonly name = 'PopulationGuardSystem';
  private readonly report = makeMutationReport();

  update(world: World): void {
    const cfg = world.config;
    if (cfg.minPopulation <= 0) return;
    if (world.agents.length >= cfg.minPopulation) return;

    const survivors = world.agents.slice();
    let femaleCount = 0;
    let maleCount = 0;
    for (const s of survivors) {
      if (s.phenotype.gender === FEMALE) femaleCount++;
      else maleCount++;
    }

    while (world.agents.length < cfg.minPopulation) {
      if (survivors.length > 0) {
        const parent = survivors[world.rng.int(survivors.length)];
        const genome = mutate(parent.genome, cfg, world.rng, this.report);

        const needsFemale = femaleCount === 0;
        const needsMale = maleCount === 0;
        if (needsFemale || needsMale) {
          genome[bioGeneOffset(cfg) + BIO_GENES.gender] = needsFemale ? -1 : 1;
        }

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
        if (child.phenotype.gender === FEMALE) femaleCount++;
        else maleCount++;
      } else {
        world.spawnRandomAgent();
      }
      world.events.reseeded++;
    }
  }
}
