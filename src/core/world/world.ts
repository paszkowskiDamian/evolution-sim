import type { SimulationConfig } from '../../config/simulationConfig';
import { Rng } from '../utils/rng';
import { SpatialGrid } from '../utils/spatialHash';
import { Agent } from '../agents/agent';
import { FoodField } from './food';
import { createRandomGenome } from '../genetics/genome';
import { TAU, wrap } from '../utils/math';

/** Liczniki zdarzeń z pojedynczego ticka — czyszczone na jego początku. */
export interface TickEvents {
  births: number;
  deaths: number;
  deathsByStarvation: number;
  deathsByAge: number;
  foodEaten: number;
  pointMutations: number;
  swapMutations: number;
  bigMutations: number;
  reseeded: number;
}

export interface LineageRecord {
  id: number;
  motherId: number;
  fatherId: number;
  generation: number;
  bornAtTick: number;
  diedAtTick: number;
  children: number;
  age: number;
  hue: number;
}

export interface BirthRequest {
  parent: Agent;
  /** Energia przekazana potomkowi (już odjęta rodzicowi). */
  energy: number;
}

interface FoodCluster {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const LINEAGE_CAPACITY = 4000;

/**
 * Świat — jedyny właściciel stanu symulacji.
 *
 * Nie zawiera logiki mechanik (te są w `systems/`) i nie wie nic
 * o rendererze, Reactcie ani DOM-ie. Da się go uruchomić w Node.
 */
export class World {
  readonly config: SimulationConfig;
  /** Strumień losowości dla agentów: sensory, mutacje, starzenie. */
  readonly rng: Rng;
  /**
   * Osobny strumień losowości dla środowiska (rozsiew i dryf jedzenia).
   *
   * Rozdzielenie strumieni nie jest kosmetyką: dzięki niemu przebieg
   * środowiska nie zależy od tego, ile razy agenci sięgnęli po losowość.
   * To pozwala porównywać różne populacje w DOKŁADNIE tym samym świecie
   * (eksperyment we wspólnym ogrodzie — patrz `scripts/headless.ts`).
   */
  readonly foodRng: Rng;

  tick = 0;
  agents: Agent[] = [];
  readonly agentById = new Map<number, Agent>();
  readonly food: FoodField;

  readonly agentGrid: SpatialGrid;
  readonly foodGrid: SpatialGrid;

  readonly events: TickEvents = {
    births: 0,
    deaths: 0,
    deathsByStarvation: 0,
    deathsByAge: 0,
    foodEaten: 0,
    pointMutations: 0,
    swapMutations: 0,
    bigMutations: 0,
    reseeded: 0,
  };

  /** Ostatnio zmarli/urodzeni — materiał na drzewo genealogiczne. */
  readonly lineage: LineageRecord[] = [];

  /**
   * Kolejka narodzin: ReproductionSystem decyduje KTO się rozmnaża,
   * MutationSystem decyduje JAKI genom dostanie potomek.
   * Rozdzielone celowo — mutacje da się wymienić bez dotykania rozmnażania.
   */
  readonly pendingBirths: BirthRequest[] = [];

  private nextAgentId = 1;
  private clusters: FoodCluster[] = [];
  maxGeneration = 0;

  constructor(config: SimulationConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.foodRng = new Rng(config.seed ^ 0x5f356495);
    this.food = new FoodField(config.maxFood);
    // Rozmiar komórki dobrany pod typowy promień zapytania — 1 pierścień
    // sąsiadów wystarcza dla jedzenia, kilka dla wzroku agentów.
    this.agentGrid = new SpatialGrid(config.worldSize, Math.max(40, config.visionRadius / 3), config.wrapEdges);
    this.foodGrid = new SpatialGrid(config.worldSize, Math.max(40, config.visionRadius / 4), config.wrapEdges);
    this.reset();
  }

  reset(): void {
    this.tick = 0;
    this.agents = [];
    this.agentById.clear();
    this.food.clear();
    this.lineage.length = 0;
    this.pendingBirths.length = 0;
    this.nextAgentId = 1;
    this.maxGeneration = 0;
    this.rng.reseed(this.config.seed);
    this.foodRng.reseed(this.config.seed ^ 0x5f356495);

    this.clusters = [];
    for (let i = 0; i < this.config.foodClusterCount; i++) {
      this.clusters.push({
        x: this.foodRng.range(0, this.config.worldSize),
        y: this.foodRng.range(0, this.config.worldSize),
        vx: this.foodRng.symmetric(0.25),
        vy: this.foodRng.symmetric(0.25),
      });
    }

    for (let i = 0; i < this.config.initialPopulation; i++) {
      this.spawnRandomAgent();
    }
    // Startowy zapas jedzenia, żeby pierwsze pokolenie miało czego szukać.
    for (let i = 0; i < this.config.maxFood * 0.35; i++) {
      this.spawnFood();
    }
  }

  // ---------------------------------------------------------------- agenci

  allocateAgentId(): number {
    return this.nextAgentId++;
  }

  addAgent(agent: Agent): void {
    this.agents.push(agent);
    this.agentById.set(agent.id, agent);
    if (agent.generation > this.maxGeneration) this.maxGeneration = agent.generation;
  }

  spawnRandomAgent(): Agent {
    const cfg = this.config;
    const genome = createRandomGenome(cfg, this.rng);
    const agent = new Agent(this.allocateAgentId(), genome, cfg, {
      x: this.rng.range(0, cfg.worldSize),
      y: this.rng.range(0, cfg.worldSize),
      heading: this.rng.range(0, TAU),
      energy: cfg.startEnergy,
      generation: 0,
      bornAtTick: this.tick,
    });
    this.addAgent(agent);
    return agent;
  }

  recordLineage(agent: Agent, diedAtTick: number): void {
    this.lineage.push({
      id: agent.id,
      motherId: agent.motherId,
      fatherId: agent.fatherId,
      generation: agent.generation,
      bornAtTick: agent.bornAtTick,
      diedAtTick,
      children: agent.childrenCount,
      age: agent.age,
      hue: agent.phenotype.hue,
    });
    if (this.lineage.length > LINEAGE_CAPACITY) {
      this.lineage.splice(0, this.lineage.length - LINEAGE_CAPACITY);
    }
  }

  // -------------------------------------------------------------- jedzenie

  /** Jedzenie pojawia się w dryfujących płatach, nie równomiernie —
   *  to tworzy gradient, w którym w ogóle opłaca się cokolwiek szukać. */
  spawnFood(): number {
    if (this.food.isFull) return -1;
    const cfg = this.config;
    const cluster = this.clusters[this.foodRng.int(this.clusters.length)];
    const angle = this.foodRng.range(0, TAU);
    // sqrt daje równomierne wypełnienie koła zamiast skupiska w środku
    const dist = Math.sqrt(this.foodRng.next()) * cfg.foodClusterRadius;
    const x = wrap(cluster.x + Math.cos(angle) * dist, cfg.worldSize);
    const y = wrap(cluster.y + Math.sin(angle) * dist, cfg.worldSize);
    return this.food.spawn(x, y);
  }

  /** Powolny dryf płatów jedzenia — zmusza populację do ciągłej migracji. */
  driftClusters(): void {
    const cfg = this.config;
    for (const c of this.clusters) {
      if (this.foodRng.chance(0.002)) {
        c.vx = this.foodRng.symmetric(0.25);
        c.vy = this.foodRng.symmetric(0.25);
      }
      c.x = wrap(c.x + c.vx, cfg.worldSize);
      c.y = wrap(c.y + c.vy, cfg.worldSize);
    }
  }

  getClusters(): ReadonlyArray<{ x: number; y: number }> {
    return this.clusters;
  }

  // ------------------------------------------------------------- zdarzenia

  resetEvents(): void {
    const e = this.events;
    e.births = 0;
    e.deaths = 0;
    e.deathsByStarvation = 0;
    e.deathsByAge = 0;
    e.foodEaten = 0;
    e.pointMutations = 0;
    e.swapMutations = 0;
    e.bigMutations = 0;
    e.reseeded = 0;
  }
}
