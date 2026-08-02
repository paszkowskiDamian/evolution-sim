/** Pojedyncza próbka statystyk zapisywana co `statsInterval` ticków. */
export interface StatsSample {
  tick: number;
  population: number;
  foodCount: number;
  avgAge: number;
  avgEnergy: number;
  avgFitness: number;
  maxGeneration: number;
  avgGeneration: number;
  births: number; // w oknie próbkowania
  deaths: number;
  deathsByStarvation: number;
  deathsByAge: number;
  deathsByCombat: number;
  foodEaten: number;
  mutations: number;
  attacks: number;
  /** Ułamek populacji niosącej cokolwiek w danym momencie próbkowania. */
  carryingFraction: number;
  /** Średni dystans genetyczny w losowej próbce par — miara różnorodności. */
  diversity: number;
  avgSpeedGene: number;
  avgSizeGene: number;
  avgVisionGene: number;
}

export interface CumulativeStats {
  totalBirths: number;
  totalDeaths: number;
  totalFoodEaten: number;
  totalMutations: number;
  totalPickups: number;
  totalDrops: number;
  totalTilesDug: number;
  totalTilesBuilt: number;
  totalAttacks: number;
  totalDeathsByCombat: number;
}

/** Widok stanu agenta dla UI — bez wycieku referencji do obiektów silnika. */
export interface AgentView {
  id: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  energy: number;
  age: number;
  generation: number;
  motherId: number;
  fatherId: number;
  gender: number;
  childrenCount: number;
  foodEaten: number;
  fitness: number;
  radius: number;
  hue: number;
  maxSpeed: number;
  visionRadius: number;
  metabolism: number;
  reproThreshold: number;
  health: number;
  maxHealth: number;
  /** Typy przedmiotów w kolejności podniesienia (0=kamień, 1=jedzenie); długość = carriedCount. */
  carriedItems: number[];
  maxCarryItems: number;
  inShelter: boolean;
  inputs: number[];
  outputs: number[];
  hidden: number[];
  /** Pamięć: stan ukryty warstwy rekurencyjnej, przenoszony między tickami. */
  hiddenState: number[];
}
