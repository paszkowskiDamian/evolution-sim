import type { SimulationConfig } from '../../config/simulationConfig';
import {
  NeuralNetwork,
  INPUT_COUNT,
  MEMORY_READ_ADDRESS_OUTPUT,
  MEMORY_WRITE_ADDRESS_OUTPUT,
  MEMORY_WRITE_VALUE_OUTPUT,
  MEMORY_WRITE_GATE_OUTPUT,
  type BrainShape,
} from '../neural/network';
import { decodePhenotype, decodeBrainShape, type Phenotype } from '../genetics/genome';

/**
 * Agent — pojedynczy osobnik.
 *
 * Agent NIE zawiera żadnej logiki zachowania. Wszystko, co robi, wynika
 * z wyjść jego własnej sieci neuronowej. Ta klasa to wyłącznie stan.
 */
export class Agent {
  readonly id: number;

  // --- ciało ---
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** Kierunek, w który agent jest zwrócony (radiany). */
  heading = 0;
  speed = 0;

  // --- życie ---
  energy: number;
  age = 0;
  alive = true;
  /** Ticki pozostałe do możliwości ponownego rozmnożenia. */
  reproCooldown = 0;

  // --- walka ---
  health: number;
  /** Ticki pozostałe do możliwości ponownego ataku. */
  attackCooldown = 0;

  // --- przedmioty (wielosłotowy ekwipunek, patrz config.maxCarryItems) ---
  /**
   * Sloty [0, carriedCount) niosą typ przedmiotu (patrz world/items.ts),
   * reszta to -1 (puste). Podnoszenie dopisuje na koniec, upuszczanie
   * zdejmuje z końca (LIFO) — ostatnio podniesiony wychodzi pierwszy.
   */
  readonly carriedItems: Int8Array;
  carriedCount = 0;
  /** Ticki pozostałe do możliwości ponownego chwytu/upuszczenia. */
  carryCooldown = 0;
  /** ID dużego zasobu, przy którym agent pracuje w bieżącym ticku; -1 poza pracą. */
  cooperatingFoodId = -1;

  // --- dziedziczność ---
  readonly genome: Float32Array;
  readonly brain: NeuralNetwork;
  /** Zdekodowany kształt sieci (patrz decodeBrainShape) — potrzebny GPU do
   *  spakowania bufora bez ponownego dekodowania genów na CPU co tick. */
  readonly brainShape: BrainShape;
  readonly phenotype: Phenotype;
  readonly motherId: number;
  readonly fatherId: number;
  readonly generation: number;
  readonly bornAtTick: number;

  // --- fitness (obserwowany, nie narzucony) ---
  childrenCount = 0;
  foodEaten = 0;
  energyGained = 0;
  distanceTravelled = 0;

  /** Ostatni wektor wejść sieci — wyłącznie do podglądu w UI. */
  readonly lastInputs = new Float32Array(INPUT_COUNT);

  /**
   * Pamięć agenta: stan ukryty warstwy rekurencyjnej, przenoszony między
   * tickami. NIE jest częścią genomu — to stan uruchomieniowy, zerowany
   * przy narodzinach. Dziedziczone są wyłącznie wagi, które PRODUKUJĄ
   * użyteczną dynamikę tego stanu, nigdy sam stan.
   */
  readonly hiddenState: Float32Array;
  /** Duży, jawnie adresowany bank pamięci — stan życia, nie część genomu. */
  readonly externalMemory: Float32Array;
  memoryReadValue = 0;
  memoryReadAddress = 0;
  memoryWriteAddress = 0;

  constructor(
    id: number,
    genome: Float32Array,
    config: SimulationConfig,
    opts: {
      x: number;
      y: number;
      heading: number;
      energy: number;
      motherId?: number;
      fatherId?: number;
      generation?: number;
      bornAtTick?: number;
    },
  ) {
    this.id = id;
    this.genome = genome;
    const shape = decodeBrainShape(genome, config);
    this.brainShape = shape;
    this.brain = new NeuralNetwork(genome, config, shape);
    this.hiddenState = new Float32Array(this.brain.recurrentWidth);
    this.externalMemory = new Float32Array(config.externalMemorySlots);
    this.phenotype = decodePhenotype(genome, config);
    this.carriedItems = new Int8Array(config.maxCarryItems).fill(-1);
    this.x = opts.x;
    this.y = opts.y;
    this.heading = opts.heading;
    this.energy = opts.energy;
    this.health = this.phenotype.maxHealth;
    this.motherId = opts.motherId ?? -1;
    this.fatherId = opts.fatherId ?? -1;
    this.generation = opts.generation ?? 0;
    this.bornAtTick = opts.bornAtTick ?? 0;
  }

  /**
   * Fitness NIE jest funkcją celu, której ktokolwiek optymalizuje.
   * To wyłącznie miara opisowa dla wykresów: ile potomstwa zostawił
   * osobnik i jak długo przetrwał. Ewolucja działa nawet gdyby tej
   * liczby w ogóle nie liczyć.
   */
  get fitness(): number {
    return this.childrenCount * 10 + this.age / 100 + this.foodEaten;
  }

  /** Stosuje wyjścia kontrolera pamięci po forward passie, z efektem od następnego ticka. */
  applyExternalMemoryControls(enabled: boolean): void {
    const memory = this.externalMemory;
    if (!enabled || memory.length === 0) {
      memory.fill(0);
      this.memoryReadValue = 0;
      this.memoryReadAddress = 0;
      this.memoryWriteAddress = 0;
      return;
    }

    const addressOf = (value: number): number =>
      Math.min(memory.length - 1, Math.floor(((Math.max(-1, Math.min(1, value)) + 1) * 0.5) * memory.length));
    this.memoryWriteAddress = addressOf(this.brain.outputs[MEMORY_WRITE_ADDRESS_OUTPUT]);
    const gate = Math.max(0, Math.min(1, this.brain.outputs[MEMORY_WRITE_GATE_OUTPUT]));
    if (gate > 0) {
      const old = memory[this.memoryWriteAddress];
      memory[this.memoryWriteAddress] = old + (this.brain.outputs[MEMORY_WRITE_VALUE_OUTPUT] - old) * gate;
    }
    this.memoryReadAddress = addressOf(this.brain.outputs[MEMORY_READ_ADDRESS_OUTPUT]);
    this.memoryReadValue = memory[this.memoryReadAddress];
  }
}
