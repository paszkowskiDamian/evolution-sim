import type { System } from './System';
import type { World } from '../world/world';
import type { StatsSample, CumulativeStats } from '../../shared/types';
import { genomeDistance, bioGeneOffset, BIO_GENES } from '../genetics/genome';

/**
 * Zbiera statystyki populacji.
 *
 * System jest wyłącznie obserwatorem — nie modyfikuje stanu świata.
 * Statystyki nie biorą udziału w selekcji; służą tylko do rysowania wykresów.
 */
export class StatisticsSystem implements System {
  readonly name = 'StatisticsSystem';

  readonly history: StatsSample[] = [];
  readonly cumulative: CumulativeStats = {
    totalBirths: 0,
    totalDeaths: 0,
    totalFoodEaten: 0,
    totalMutations: 0,
  };

  // akumulatory okna próbkowania
  private winBirths = 0;
  private winDeaths = 0;
  private winStarve = 0;
  private winAge = 0;
  private winFood = 0;
  private winMutations = 0;

  reset(): void {
    this.history.length = 0;
    this.cumulative.totalBirths = 0;
    this.cumulative.totalDeaths = 0;
    this.cumulative.totalFoodEaten = 0;
    this.cumulative.totalMutations = 0;
    this.winBirths = 0;
    this.winDeaths = 0;
    this.winStarve = 0;
    this.winAge = 0;
    this.winFood = 0;
    this.winMutations = 0;
  }

  update(world: World): void {
    const e = world.events;
    const mutations = e.pointMutations + e.swapMutations + e.bigMutations;

    this.winBirths += e.births;
    this.winDeaths += e.deaths;
    this.winStarve += e.deathsByStarvation;
    this.winAge += e.deathsByAge;
    this.winFood += e.foodEaten;
    this.winMutations += mutations;

    this.cumulative.totalBirths += e.births;
    this.cumulative.totalDeaths += e.deaths;
    this.cumulative.totalFoodEaten += e.foodEaten;
    this.cumulative.totalMutations += mutations;

    const cfg = world.config;
    if (world.tick % cfg.statsInterval !== 0) return;

    const agents = world.agents;
    const n = agents.length;
    let sumAge = 0;
    let sumEnergy = 0;
    let sumFitness = 0;
    let sumGen = 0;
    let sumSpeed = 0;
    let sumSize = 0;
    let sumVision = 0;

    for (const a of agents) {
      sumAge += a.age;
      sumEnergy += a.energy;
      sumFitness += a.fitness;
      sumGen += a.generation;
      sumSpeed += a.phenotype.maxSpeed;
      sumSize += a.phenotype.radius;
      sumVision += a.phenotype.visionRadius;
    }

    const sample: StatsSample = {
      tick: world.tick,
      population: n,
      foodCount: world.food.count,
      avgAge: n ? sumAge / n : 0,
      avgEnergy: n ? sumEnergy / n : 0,
      avgFitness: n ? sumFitness / n : 0,
      maxGeneration: world.maxGeneration,
      avgGeneration: n ? sumGen / n : 0,
      births: this.winBirths,
      deaths: this.winDeaths,
      deathsByStarvation: this.winStarve,
      deathsByAge: this.winAge,
      foodEaten: this.winFood,
      mutations: this.winMutations,
      diversity: this.sampleDiversity(world),
      avgSpeedGene: n ? sumSpeed / n : 0,
      avgSizeGene: n ? sumSize / n : 0,
      avgVisionGene: n ? sumVision / n : 0,
    };

    this.history.push(sample);
    if (this.history.length > cfg.statsHistoryLength) {
      this.history.splice(0, this.history.length - cfg.statsHistoryLength);
    }

    this.winBirths = 0;
    this.winDeaths = 0;
    this.winStarve = 0;
    this.winAge = 0;
    this.winFood = 0;
    this.winMutations = 0;
  }

  /**
   * Różnorodność genetyczna — średni dystans w 24 losowych parach.
   * Pełna macierz byłaby O(n²); próbka wystarcza do obserwacji trendu.
   * Losowanie idzie przez ten sam RNG, więc pomiar też jest deterministyczny.
   */
  private sampleDiversity(world: World): number {
    const agents = world.agents;
    if (agents.length < 2) return 0;
    const pairs = Math.min(24, agents.length);
    let sum = 0;
    for (let i = 0; i < pairs; i++) {
      const a = agents[world.rng.int(agents.length)];
      const b = agents[world.rng.int(agents.length)];
      if (a === b) continue;
      sum += genomeDistance(a.genome, b.genome);
    }
    return sum / pairs;
  }

  /** Rozkład wybranego genu biologicznego w populacji — pod histogram w UI. */
  geneHistogram(world: World, gene: keyof typeof BIO_GENES, bins = 20): number[] {
    const offset = bioGeneOffset(world.config) + BIO_GENES[gene];
    const hist = new Array<number>(bins).fill(0);
    for (const a of world.agents) {
      const v = Math.max(-1, Math.min(1, a.genome[offset]));
      const idx = Math.min(bins - 1, Math.floor(((v + 1) / 2) * bins));
      hist[idx]++;
    }
    return hist;
  }
}
