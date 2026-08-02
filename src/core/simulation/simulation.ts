import type { SimulationConfig } from '../../config/simulationConfig';
import { makeConfig } from '../../config/simulationConfig';
import { World } from '../world/world';
import type { System } from '../systems/System';
import { SpatialIndexSystem } from '../systems/SpatialIndexSystem';
import { SensorSystem } from '../systems/SensorSystem';
import { BrainSystem } from '../systems/BrainSystem';
import { MovementSystem } from '../systems/MovementSystem';
import { CollisionSystem } from '../systems/CollisionSystem';
import { RockCollisionSystem } from '../systems/RockCollisionSystem';
import { FoodSystem } from '../systems/FoodSystem';
import { CarrySystem } from '../systems/CarrySystem';
import { AttackSystem } from '../systems/AttackSystem';
import { EnergySystem } from '../systems/EnergySystem';
import { DeathSystem } from '../systems/DeathSystem';
import { ReproductionSystem } from '../systems/ReproductionSystem';
import { MutationSystem } from '../systems/MutationSystem';
import { PopulationGuardSystem } from '../systems/PopulationGuardSystem';
import { StatisticsSystem } from '../systems/StatisticsSystem';
import type { AgentView } from '../../shared/types';
import { Agent } from '../agents/agent';
import { GpuContext } from '../gpu/GpuContext';
import { GpuBrainSystem } from '../systems/gpu/GpuBrainSystem';
import { GpuMovementSystem } from '../systems/gpu/GpuMovementSystem';
import { GpuEnergySystem } from '../systems/gpu/GpuEnergySystem';

/**
 * Silnik symulacji.
 *
 * Nie zna Reacta, PixiJS ani DOM-u. Da się go uruchomić w Node
 * (patrz `scripts/headless.ts`) i to jest test tej separacji.
 *
 * Kolejność systemów w ticku jest kontraktem — zmiana kolejności zmienia
 * przebieg symulacji nawet przy tym samym seedzie.
 */
export class Simulation {
  world: World;
  readonly statistics = new StatisticsSystem();
  private systems: System[] = [];
  /** Genom-przodek do zasiania startowej populacji — patrz World.spawnSeededAgent. */
  private readonly seedGenome?: Float32Array;

  /**
   * GPU (WebGPU) jest OPCJONALNE i wyłączone domyślnie — patrz `enableGpu()`
   * i komentarz w `GpuContext.ts` o tym, jak mało to zostało zweryfikowane.
   * Systemy GPU zastępują TYLKO Brain/Movement/Energy (najbardziej
   * "matematyczne", bezstanowe-między-agentami części ticka); reszta
   * (sensory, kolizje, przedmioty, walka, rozmnażanie, mutacje) zawsze
   * chodzi na CPU — patrz uzasadnienie w README/rozmowie, dlaczego akurat
   * te trzy, a nie "cały" silnik.
   */
  private gpu: GpuContext | null = null;
  private gpuBrain: GpuBrainSystem | null = null;
  private gpuMovement: GpuMovementSystem | null = null;
  private gpuEnergy: GpuEnergySystem | null = null;

  /** Czas wykonania ostatniego ticka w ms — do panelu wydajności. */
  lastTickMs = 0;

  constructor(config: Partial<SimulationConfig> = {}, seedGenome?: Float32Array) {
    this.seedGenome = seedGenome;
    this.world = new World(makeConfig(config), seedGenome);
    this.systems = this.buildSystems();
  }

  get gpuEnabled(): boolean {
    return this.gpu !== null;
  }

  /**
   * Próbuje przełączyć Brain/Movement/Energy na WebGPU. Zwraca `false`
   * (i zostaje na CPU) na KAŻDYM braku wsparcia/błędzie — bezpieczne do
   * wywołania zawsze, nawet w środowiskach bez WebGPU (Node, starsze
   * przeglądarki). Wywołanie na już-włączonym GPU jest no-opem (`true`).
   */
  async enableGpu(): Promise<boolean> {
    if (this.gpu) return true;
    const ctx = await GpuContext.request();
    if (!ctx) return false;
    this.gpu = ctx;
    this.gpuBrain = new GpuBrainSystem(ctx);
    this.gpuMovement = new GpuMovementSystem(ctx);
    this.gpuEnergy = new GpuEnergySystem(ctx);
    this.systems = this.buildSystems();
    return true;
  }

  /** Wraca na CPU. Bezpieczne, gdy GPU nie było w ogóle włączone. */
  disableGpu(): void {
    if (!this.gpu) return;
    this.gpu.destroy();
    this.gpu = null;
    this.gpuBrain = null;
    this.gpuMovement = null;
    this.gpuEnergy = null;
    this.systems = this.buildSystems();
  }

  private buildSystems(): System[] {
    return [
      new SpatialIndexSystem(), // 0. indeks przestrzenny
      new SensorSystem(), //       1. sensory
      this.gpuBrain ?? new BrainSystem(), //       2. decyzja sieci neuronowej
      this.gpuMovement ?? new MovementSystem(), // 3. ruch
      new CollisionSystem(), //    4. kolizje agent-agent
      new RockCollisionSystem(), // 5. kamienie jako przeszkody
      // CarrySystem PRZED FoodSystem: jeśli agent w tym samym ticku chce
      // I podnieść, I zjeść, podniesienie z ziemi ma pierwszeństwo — zjedzenie
      // wtedy sięga do właśnie napełnionego ekwipunku zamiast do ziemi.
      new CarrySystem(), //        6. chwyt/upuszczenie (kamienie i jedzenie)
      new FoodSystem(), //         7. jedzenie — wyłącznie na decyzję (wyjście "jedz")
      new AttackSystem(), //       8. walka
      this.gpuEnergy ?? new EnergySystem(), // 9. zużycie energii + regeneracja zdrowia
      new DeathSystem(), //        10. śmierć
      new ReproductionSystem(), // 11. rozmnażanie
      new MutationSystem(), //     12. mutacje
      new PopulationGuardSystem(), // opcjonalne zabezpieczenie
      this.statistics, //          13. zapis statystyk
    ];
  }

  get config(): SimulationConfig {
    return this.world.config;
  }

  get tick(): number {
    return this.world.tick;
  }

  /**
   * Wykonuje jeden tick symulacji — WYŁĄCZNIE CPU. Rzuca, jeśli GPU jest
   * włączone: odczyt wyniku z bufora WebGPU jest z definicji asynchroniczny
   * (`mapAsync`, patrz `gpuBuffers.ts`), więc synchroniczna pętla nie może
   * poprawnie zaczekać na wynik przed uruchomieniem kolejnego systemu —
   * użyj `stepAsync()`/`runAsync()`.
   */
  step(): void {
    if (this.gpu) {
      throw new Error(
        'Symulacja z aktywnym GPU wymaga stepAsync()/runAsync() zamiast step()/run().',
      );
    }
    const t0 = performance.now();
    const world = this.world;
    world.resetEvents();
    world.tick++;
    for (const system of this.systems) {
      system.update(world);
    }
    this.lastTickMs = performance.now() - t0;
  }

  /** Wykonuje `n` ticków (do przyspieszania i biegów headless). Tylko CPU — patrz `step()`. */
  run(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /**
   * Wersja async — jedyna poprawna droga, gdy GPU jest włączone (patrz
   * `enableGpu()`). Działa identycznie na CPU (systemy synchroniczne po
   * prostu `await`-ują natychmiast), więc bezpieczna do użycia zawsze.
   */
  async stepAsync(): Promise<void> {
    const t0 = performance.now();
    const world = this.world;
    world.resetEvents();
    world.tick++;
    for (const system of this.systems) {
      await system.update(world);
    }
    this.lastTickMs = performance.now() - t0;
  }

  async runAsync(n: number): Promise<void> {
    for (let i = 0; i < n; i++) await this.stepAsync();
  }

  /**
   * Restart z nową konfiguracją (albo tą samą — wtedy identyczny przebieg).
   * Genom startowy podany w konstruktorze (jeśli był) obowiązuje nadal —
   * restart świata nie kasuje "pretrenowanego" punktu startowego.
   */
  reset(config?: Partial<SimulationConfig>): void {
    const next = config ? makeConfig({ ...this.world.config, ...config }) : this.world.config;
    this.world = new World(next, this.seedGenome);
    this.statistics.reset();
    this.systems = this.buildSystems();
    this.lastTickMs = 0;
  }

  /**
   * Zastępuje populację zadanym zestawem genomów.
   *
   * Służy do eksperymentów kontrolowanych ("wspólny ogród"): wpuszczamy
   * dwie różne populacje do identycznego świata i porównujemy wyniki.
   * Bez tego nie da się odróżnić prawdziwej adaptacji od zmiany warunków.
   */
  seedPopulation(genomes: Float32Array[]): void {
    const world = this.world;
    const cfg = world.config;
    world.agents = [];
    world.agentById.clear();
    for (const genome of genomes) {
      const copy = new Float32Array(genome);
      const agent = new Agent(world.allocateAgentId(), copy, cfg, {
        x: world.rng.range(0, cfg.worldSize),
        y: world.rng.range(0, cfg.worldSize),
        heading: world.rng.range(0, Math.PI * 2),
        energy: cfg.startEnergy,
        generation: 0,
        bornAtTick: world.tick,
      });
      world.addAgent(agent);
    }
  }

  /** Zrzut stanu agenta dla UI — kopia, nie referencja do silnika. */
  getAgentView(id: number): AgentView | null {
    const a = this.world.agentById.get(id);
    if (!a || !a.alive) return null;
    return {
      id: a.id,
      x: a.x,
      y: a.y,
      heading: a.heading,
      speed: a.speed,
      energy: a.energy,
      age: a.age,
      generation: a.generation,
      motherId: a.motherId,
      fatherId: a.fatherId,
      gender: a.phenotype.gender,
      childrenCount: a.childrenCount,
      foodEaten: a.foodEaten,
      fitness: a.fitness,
      radius: a.phenotype.radius,
      hue: a.phenotype.hue,
      maxSpeed: a.phenotype.maxSpeed,
      visionRadius: a.phenotype.visionRadius,
      metabolism: a.phenotype.metabolism,
      reproThreshold: a.phenotype.reproThreshold,
      health: a.health,
      maxHealth: a.phenotype.maxHealth,
      carriedItems: Array.from(a.carriedItems.subarray(0, a.carriedCount)),
      maxCarryItems: this.world.config.maxCarryItems,
      inShelter: this.world.isInShelter(a.x, a.y),
      inputs: Array.from(a.lastInputs),
      outputs: Array.from(a.brain.outputs),
      hidden: Array.from(a.brain.getHiddenActivations()),
      hiddenState: Array.from(a.hiddenState),
    };
  }

  /** Najbliższy żywy agent do punktu świata — obsługa klikania w kanwę. */
  pickAgent(x: number, y: number, radius = 40): number | null {
    let best = -1;
    let bestD2 = radius * radius;
    for (const a of this.world.agents) {
      const dx = a.x - x;
      const dy = a.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = a.id;
      }
    }
    return best === -1 ? null : best;
  }
}
