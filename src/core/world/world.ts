import type { SimulationConfig } from '../../config/simulationConfig';
import { Rng } from '../utils/rng';
import { SpatialGrid } from '../utils/spatialHash';
import { Agent } from '../agents/agent';
import { FoodField } from './food';
import { ItemField } from './items';
import { TerrainGrid, TILE_ROCK, TILE_EMPTY } from './terrain';
import { createRandomGenome, genomeLength, bioGeneOffset, BIO_GENES } from '../genetics/genome';
import { mutate, makeMutationReport } from '../genetics/mutation';
import { TAU, wrap, wrapDelta } from '../utils/math';

/** Liczniki zdarzeń z pojedynczego ticka — czyszczone na jego początku. */
export interface TickEvents {
  births: number;
  deaths: number;
  deathsByStarvation: number;
  deathsByAge: number;
  deathsByCombat: number;
  foodEaten: number;
  itemsPickedUp: number;
  itemsDropped: number;
  tilesDug: number;
  tilesBuilt: number;
  attacks: number;
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
  mother: Agent;
  father: Agent;
  /** Energia przekazana potomkowi (już odjęta obojgu rodzicom). */
  energy: number;
}

interface FoodCluster {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Formacja górska: nieruchomy środek litego masywu skały z wyrzeźbioną
 * wewnątrz siecią tuneli (patrz `TerrainGrid.carveSolidDisc` /
 * `carveTunnelNetwork`). W przeciwieństwie do płatów jedzenia góry NIE
 * dryfują — to trwała rzeźba terenu, nie zasób. Sam obiekt trzyma tylko
 * środek — kształt masywu i tuneli żyje wyłącznie w siatce terenu, którą
 * kopanie/budowanie może trwale zmienić.
 */
interface Mountain {
  x: number;
  y: number;
}

const LINEAGE_CAPACITY = 4000;
/** Bufor zdarzeń walki jest drenowany co klatkę przez renderer (pierścienie
 *  trafień) — limit to wyłącznie zabezpieczenie dla biegów headless, gdzie
 *  nic go nigdy nie czyta. */
const COMBAT_EVENT_CAPACITY = 200;
/** Jak wyżej, ale dla narodzin (patrz `BirthEvent`). */
const BIRTH_EVENT_CAPACITY = 200;

/** Miejsce trafienia — do animacji w rendererze, nie do logiki symulacji. */
export interface CombatEvent {
  x: number;
  y: number;
}

/** Miejsce narodzin — do animacji w rendererze, nie do logiki symulacji. */
export interface BirthEvent {
  x: number;
  y: number;
}

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
  /** Luźne, przenoszalne kamienie (zasób) — NIE ściany, patrz `terrain`. */
  readonly items: ItemField;
  /** Teren: siatka pustych/litych komórek — patrz `core/world/terrain.ts`. */
  readonly terrain: TerrainGrid;

  readonly agentGrid: SpatialGrid;
  readonly foodGrid: SpatialGrid;
  readonly itemGrid: SpatialGrid;

  readonly events: TickEvents = {
    births: 0,
    deaths: 0,
    deathsByStarvation: 0,
    deathsByAge: 0,
    deathsByCombat: 0,
    foodEaten: 0,
    itemsPickedUp: 0,
    itemsDropped: 0,
    tilesDug: 0,
    tilesBuilt: 0,
    attacks: 0,
    pointMutations: 0,
    swapMutations: 0,
    bigMutations: 0,
    reseeded: 0,
  };

  /** Ostatnio zmarli/urodzeni — materiał na drzewo genealogiczne. */
  readonly lineage: LineageRecord[] = [];

  /**
   * Kolejka "gdzie właśnie doszło do trafienia" — wypełniana przez
   * AttackSystem, drenowana (i czyszczona) przez renderer co klatkę, żeby
   * narysować gasnący pierścień. To wyłącznie wizualny efekt uboczny, nie
   * stan symulacji — nic w core/ nigdy tego nie czyta z powrotem.
   */
  readonly combatEvents: CombatEvent[] = [];

  /**
   * Kolejka "gdzie właśnie ktoś się urodził" — wypełniana przez
   * MutationSystem (jedyne miejsce tworzące nowego agenta), drenowana przez
   * renderer co klatkę do narysowania efektu narodzin. Tak samo jak
   * `combatEvents` — czysto wizualne, core/ nigdy tego nie czyta z powrotem.
   */
  readonly birthEvents: BirthEvent[] = [];

  /**
   * Kolejka narodzin: ReproductionSystem decyduje KTO się rozmnaża,
   * MutationSystem decyduje JAKI genom dostanie potomek.
   * Rozdzielone celowo — mutacje da się wymienić bez dotykania rozmnażania.
   */
  readonly pendingBirths: BirthRequest[] = [];

  private nextAgentId = 1;
  private clusters: FoodCluster[] = [];
  private mountains: Mountain[] = [];
  maxGeneration = 0;

  /**
   * Genom "przodka" do zasiania startowej populacji (patrz `scripts/evolve.ts`)
   * — zamiast czysto losowej genezy, każdy startowy agent to zmutowana kopia
   * jednego sprawdzonego genomu. `null`, gdy nieużywany albo gdy jego długość
   * nie pasuje do aktualnej konfiguracji (np. inna głębokość mózgu) — w takim
   * wypadku po cichu wracamy do losowej genezy zamiast dekodować genom
   * niezgodny z aktualnym układem.
   */
  private readonly seedGenome: Float32Array | null;
  private readonly seedMutationReport = makeMutationReport();

  constructor(config: SimulationConfig, seedGenome?: Float32Array) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.foodRng = new Rng(config.seed ^ 0x5f356495);
    this.food = new FoodField(config.maxFood);
    this.items = new ItemField(config.maxLooseRocks);
    this.terrain = new TerrainGrid(config.worldSize, config.terrainCellSize);
    // Rozmiar komórki dobrany pod typowy promień zapytania — 1 pierścień
    // sąsiadów wystarcza dla jedzenia, kilka dla wzroku agentów.
    this.agentGrid = new SpatialGrid(config.worldSize, Math.max(40, config.visionRadius / 3), config.wrapEdges);
    this.foodGrid = new SpatialGrid(config.worldSize, Math.max(40, config.visionRadius / 4), config.wrapEdges);
    this.itemGrid = new SpatialGrid(config.worldSize, Math.max(40, config.visionRadius / 4), config.wrapEdges);
    if (seedGenome && seedGenome.length === genomeLength(config)) {
      this.seedGenome = seedGenome;
    } else {
      if (seedGenome) {
        console.warn(
          `Genom startowy ma długość ${seedGenome.length}, a aktualna konfiguracja oczekuje ${genomeLength(config)} — pomijam go i losuję populację od zera.`,
        );
      }
      this.seedGenome = null;
    }
    this.reset();
  }

  reset(): void {
    this.tick = 0;
    this.agents = [];
    this.agentById.clear();
    this.food.clear();
    this.items.clear();
    this.lineage.length = 0;
    this.combatEvents.length = 0;
    this.birthEvents.length = 0;
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
        vx: this.foodRng.symmetric(this.config.foodClusterDriftSpeed),
        vy: this.foodRng.symmetric(this.config.foodClusterDriftSpeed),
      });
    }

    // Góry są nieruchome — generowane raz, w przeciwieństwie do płatów
    // jedzenia nie mają własnej dynamiki dryfu. Każda to LITY masyw skały o
    // nieregularnym, naturalnym obrysie (carveOrganicMassif — gradient
    // odległości od środka zmieszany z fraktalnym szumem, ta sama technika
    // co generowanie wybrzeży wysp w typowych generatorach map), w którym
    // dopiero potem "błądzenie pijaka" (carveTunnelNetwork) rzeźbi
    // rozgałęzioną, organiczną sieć tuneli — nie jedną okrągłą salę. Oba
    // kroki są systematycznym wypełnieniem komórek (nie losowym rozrzutem
    // punktów), więc wynik jest szczelny — bez szczelin, przez które
    // dałoby się przejść bez kopania.
    //
    // DWA OSOBNE przebiegi (najpierw wszystkie masywy, potem wszystkie
    // tunele) są konieczne: przy losowych środkach gór sąsiednie masywy
    // czasem zachodzą na siebie (10 gór na mapie 3000x3000 — to się zdarza
    // regularnie, nie w rzadkim przypadku brzegowym). Gdyby tunel jednej
    // góry był rzeźbiony PRZED wykuciem masywu kolejnej, późniejszy lity
    // dysk mógłby zamurować z powrotem już wykuty korytarz sąsiada.
    this.terrain.clear();
    this.mountains = [];
    for (let i = 0; i < this.config.mountainCount; i++) {
      const x = this.foodRng.range(0, this.config.worldSize);
      const y = this.foodRng.range(0, this.config.worldSize);
      this.mountains.push({ x, y });
      // Osobny seed szumu na górę (wciąż deterministyczny — ciągnięty z
      // TEGO SAMEGO strumienia foodRng co pozycja) — bez tego wszystkie
      // masywy dzieliłyby identyczny wzór obrysu, tylko przesunięty.
      const noiseSeed = this.foodRng.int(0x7fffffff);
      this.terrain.carveOrganicMassif(x, y, this.config.mountainRadius, noiseSeed, {
        octaves: this.config.mountainNoiseOctaves,
        frequency: this.config.mountainNoiseFrequency,
        lacunarity: this.config.mountainNoiseLacunarity,
        gain: this.config.mountainNoiseGain,
        noiseWeight: this.config.mountainNoiseWeight,
      });
    }
    for (const m of this.mountains) {
      this.terrain.carveTunnelNetwork(m.x, m.y, this.foodRng, {
        maxSteps: this.config.tunnelSteps,
        turnRadians: this.config.tunnelTurnAngle,
        branchChance: this.config.tunnelBranchChance,
        maxBranches: this.config.tunnelMaxBranches,
        chamberChance: this.config.tunnelChamberChance,
        mountainRadius: this.config.mountainRadius,
        marginToEdge: this.config.tunnelMarginToEdge,
      });
    }

    // Luźne kamienie NIE są zasiewane na starcie — powstają wyłącznie
    // z kopania ściany (patrz CarrySystem). `items.clear()` powyżej już
    // zapewnia pusty ItemField (tylko pojemność jest zarezerwowana przez
    // `maxLooseRocks`).

    for (let i = 0; i < this.config.initialPopulation; i++) {
      if (this.seedGenome) this.spawnSeededAgent(this.seedGenome, i);
      else this.spawnRandomAgent();
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

  /**
   * Agent "pretrenowany": zmutowana kopia genomu-przodka zamiast losowej
   * genezy. Używa zwykłego `mutate()` — ta sama siła mutacji, którą i tak
   * steruje `mutationChance`/`mutationDelta`, więc startowa różnorodność
   * populacji rośnie z tych samych suwaków co reszta ewolucji.
   *
   * Płeć jest genem progowym (>=0 → samiec) — cała startowa populacja to
   * mutowane kopie JEDNEGO przodka, więc bez korekty odziedziczyłaby
   * niemal identyczną wartość tego genu (drobne mutacje prawie nigdy nie
   * przeskakują progu 0), a populacja startowa wychodziłaby niemal
   * jednopłciowa. `index` wymusza naprzemienność płci — deterministyczne,
   * bez zużywania RNG — dając obu płciom równy start; dziedziczenie płci
   * przez kolejne pokolenia (dzieci) pozostaje bez zmian.
   */
  spawnSeededAgent(seed: Float32Array, index: number): Agent {
    const cfg = this.config;
    const genome = mutate(seed, cfg, this.rng, this.seedMutationReport);
    const o = bioGeneOffset(cfg);
    const sign = index % 2 === 0 ? 1 : -1;
    genome[o + BIO_GENES.gender] = sign * Math.max(Math.abs(genome[o + BIO_GENES.gender]), 0.5);
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

  recordCombatEvent(x: number, y: number): void {
    this.combatEvents.push({ x, y });
    if (this.combatEvents.length > COMBAT_EVENT_CAPACITY) {
      this.combatEvents.splice(0, this.combatEvents.length - COMBAT_EVENT_CAPACITY);
    }
  }

  recordBirthEvent(x: number, y: number): void {
    this.birthEvents.push({ x, y });
    if (this.birthEvents.length > BIRTH_EVENT_CAPACITY) {
      this.birthEvents.splice(0, this.birthEvents.length - BIRTH_EVENT_CAPACITY);
    }
  }

  // -------------------------------------------------------------- jedzenie

  /**
   * Jedzenie pojawia się w dryfujących płatach, nie równomiernie — to
   * tworzy gradient, w którym w ogóle opłaca się cokolwiek szukać. Jedzenie
   * NIGDY nie ląduje w schronieniu (patrz `isInShelter`) — jaskinie i
   * zbudowane pomieszczenia mają zostać wyłącznie bezpieczną kryjówką
   * (bonus metaboliczny), a nie dodatkowo skarbnicą jedzenia.
   *
   * Płaty jedzenia są losowo rozrzucone PO CAŁEJ mapie, niezależnie od tego,
   * gdzie stoją góry — promień płata (`foodClusterRadius`, 220) jest
   * większy niż typowa góra, więc płat regularnie zachodzi na fragment
   * masywu. Bez sprawdzenia terenu próbkowanie punktu wewnątrz płata mogłoby
   * (i realnie potrafiło) wylądować NA litej komórce — jedzenie "rosnące"
   * w środku skały. Próbujemy do `MAX_ATTEMPTS` razy, odrzucając trafienia
   * w ścianę LUB w schronienie; przy typowych rozmiarach płatów/gór prawie
   * zawsze wystarcza pierwsza próba.
   */
  spawnFood(): number {
    if (this.food.isFull) return -1;
    const cfg = this.config;
    const MAX_ATTEMPTS = 20;

    const cluster = this.clusters[this.foodRng.int(this.clusters.length)];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const angle = this.foodRng.range(0, TAU);
      // sqrt daje równomierne wypełnienie koła zamiast skupiska w środku
      const dist = Math.sqrt(this.foodRng.next()) * cfg.foodClusterRadius;
      const x = wrap(cluster.x + Math.cos(angle) * dist, cfg.worldSize);
      const y = wrap(cluster.y + Math.sin(angle) * dist, cfg.worldSize);
      if (!this.terrain.isSolidAt(x, y) && !this.isInShelter(x, y)) return this.food.spawn(x, y);
    }
    return -1;
  }

  /** Dryf płatów jedzenia — zmusza populację do ciągłej migracji zamiast
   *  pozwalać obozować w jednym miejscu w nieskończoność. */
  driftClusters(): void {
    const cfg = this.config;
    for (const c of this.clusters) {
      if (this.foodRng.chance(cfg.foodClusterRedirectChance)) {
        c.vx = this.foodRng.symmetric(cfg.foodClusterDriftSpeed);
        c.vy = this.foodRng.symmetric(cfg.foodClusterDriftSpeed);
      }
      c.x = wrap(c.x + c.vx, cfg.worldSize);
      c.y = wrap(c.y + c.vy, cfg.worldSize);
    }
  }

  getClusters(): ReadonlyArray<{ x: number; y: number }> {
    return this.clusters;
  }

  // ------------------------------------------------------------ przedmioty
  // (luźne kamienie same w sobie żyją w `this.items`, tworzone/niszczone
  // wprost przez CarrySystem — kopanie i budowanie to zmiany TERENU, patrz
  // `this.terrain`, nie osobna logika tutaj.)

  /**
   * Czy punkt leży w "schronieniu" — używane przez EnergySystem do biernej
   * korzyści (szybsza regeneracja zdrowia, tańszy metabolizm). Definicja
   * jest topologiczna, nie "odległość od góry": każda mała, otoczona ze
   * wszystkich stron kieszonka terenu liczy się jednakowo, obojętnie czy to
   * naturalna jaskinia górska, czy pomieszczenie zbudowane przez agentów
   * (patrz `TerrainGrid.isShelterAt`) — nie ma tu żadnego specjalnego
   * przypadku dla gór.
   */
  isInShelter(x: number, y: number): boolean {
    return this.terrain.isShelterAt(
      x,
      y,
      this.config.shelterExteriorMinCells,
      this.config.shelterMinDepth,
      this.config.shelterHeatLeakRadius,
    );
  }

  getMountains(): ReadonlyArray<{ x: number; y: number }> {
    return this.mountains;
  }

  // ------------------------------------------------------- ręczna edycja
  // "Boska ręka" z UI (patrz `useSimulation.ts`, narzędzia malowania) —
  // NIE jest mechaniką symulacji, tylko wygodą do eksperymentowania z mapą
  // na żywo. Celowo respektuje te same reguły co procedury automatyczne
  // (jedzenie nie ląduje na litym terenie ani w schronieniu, budowanie
  // ściany sprząta jedzenie pod spodem), żeby ręczne edycje nigdy nie
  // wprowadzały tych samych błędów, które naprawiliśmy w generowaniu świata.

  /** Stawia jedno jedzenie w danym miejscu. `false`, jeśli miejsce jest zajęte/nielegalne. */
  addFoodAt(x: number, y: number): boolean {
    if (this.food.isFull) return false;
    if (this.terrain.isSolidAt(x, y)) return false;
    if (this.isInShelter(x, y)) return false;
    return this.food.spawn(x, y) >= 0;
  }

  /** Usuwa najbliższe jedzenie w promieniu `radius`. `true`, jeśli coś usunięto. */
  removeFoodNear(x: number, y: number, radius: number): boolean {
    const food = this.food;
    let bestId = -1;
    let bestD2 = radius * radius;
    for (let i = 0; i < food.capacity; i++) {
      if (food.alive[i] === 0) continue;
      const dx = wrapDelta(food.xs[i] - x, this.config.worldSize);
      const dy = wrapDelta(food.ys[i] - y, this.config.worldSize);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestId = i;
      }
    }
    if (bestId < 0) return false;
    food.remove(bestId);
    return true;
  }

  /** Stawia litą komórkę terenu w danym miejscu. */
  addWallAt(x: number, y: number): void {
    const cx = this.terrain.cellX(x);
    const cy = this.terrain.cellY(y);
    if (this.terrain.get(cx, cy) === TILE_ROCK) return;
    this.terrain.set(cx, cy, TILE_ROCK);
    // Jak przy naturalnym budowaniu (CarrySystem.maybeBuild) — jedzenie nie
    // może zostać zamurowane pod nowo postawioną ścianą.
    const food = this.food;
    for (let i = 0; i < food.capacity; i++) {
      if (food.alive[i] === 0) continue;
      if (this.terrain.cellX(food.xs[i]) === cx && this.terrain.cellY(food.ys[i]) === cy) {
        food.remove(i);
      }
    }
  }

  /** Usuwa (kopie) litą komórkę terenu w danym miejscu. */
  removeWallAt(x: number, y: number): void {
    this.terrain.set(this.terrain.cellX(x), this.terrain.cellY(y), TILE_EMPTY);
  }

  // ------------------------------------------------------------- zdarzenia

  resetEvents(): void {
    const e = this.events;
    e.births = 0;
    e.deaths = 0;
    e.deathsByStarvation = 0;
    e.deathsByAge = 0;
    e.deathsByCombat = 0;
    e.foodEaten = 0;
    e.itemsPickedUp = 0;
    e.itemsDropped = 0;
    e.tilesDug = 0;
    e.tilesBuilt = 0;
    e.attacks = 0;
    e.pointMutations = 0;
    e.swapMutations = 0;
    e.bigMutations = 0;
    e.reseeded = 0;
  }
}
