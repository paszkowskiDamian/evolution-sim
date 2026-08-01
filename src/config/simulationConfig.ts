/**
 * Centralny plik konfiguracyjny symulacji.
 *
 * Zmiana parametrów NIE wymaga zmian w kodzie systemów — każdy system
 * czyta wyłącznie z tego obiektu (przekazywanego przez `World`).
 */

export interface SimulationConfig {
  // --- świat ---
  seed: number;
  worldSize: number;
  /** Świat zawija się na krawędziach (torus). Dzięki temu nie ma "ścian",
   *  a świat jest efektywnie nieskończony przy skończonej pamięci. */
  wrapEdges: boolean;

  // --- populacja ---
  initialPopulation: number;
  /** Twardy limit populacji — zabezpieczenie wydajności, nie mechanika ewolucji. */
  maxPopulation: number;
  /** Poniżej tego progu świat dosiewa losowych agentów, żeby symulacja nie umarła. */
  minPopulation: number;

  // --- pożywienie ---
  foodSpawnRate: number; // ile jednostek jedzenia pojawia się na tick
  maxFood: number;
  foodEnergy: number;
  foodRadius: number;
  /** Jedzenie pojawia się w klastrach (płatach) zamiast równomiernie. */
  foodClusterCount: number;
  foodClusterRadius: number;

  // --- kamienie (przenoszalne przedmioty) ---
  /** Ile kamieni istnieje w świecie — pojemność pola przedmiotów. */
  rockCount: number;
  /** Ticki/kamień do dosiewania nowych (0 = brak — kamienie tylko krążą). */
  rockRespawnRate: number;
  /** Zasięg chwytu/upuszczenia względem promienia ciała. */
  pickupRange: number;
  /** Ticki blokady po podniesieniu/upuszczeniu — chroni przed migotaniem. */
  carryActionCooldown: number;
  /** Mnożnik kosztu metabolizmu podczas niesienia czegokolwiek. */
  carryMetabolismMultiplier: number;

  // --- walka ---
  attackRange: number;
  attackDamageBase: number;
  /** Koszt energii ZA UDANY atak (nieudana próba nic nie kosztuje). */
  attackEnergyCost: number;
  attackCooldownTicks: number;
  baseMaxHealth: number;
  /** Bierna regeneracja zdrowia na tick (nie kosztuje energii). */
  healthRegenRate: number;

  // --- energia ---
  maxEnergy: number;
  startEnergy: number;
  /** Koszt samego istnienia na tick. */
  baseMetabolism: number;
  /** Współczynnik kosztu ruchu (koszt ~ v^2). */
  moveCost: number;
  /** Koszt proporcjonalny do rozmiaru ciała. */
  sizeCost: number;
  /** Koszt myślenia — przeciwdziała "darmowym" wielkim mózgom. */
  brainCost: number;

  // --- ciało / ruch ---
  maxSpeed: number;
  maxTurnRate: number; // radiany na tick
  drag: number; // 0..1, tłumienie prędkości na tick
  agentRadiusMin: number;
  agentRadiusMax: number;

  // --- czas życia ---
  maxAge: number;
  /** Wiek, od którego rośnie ryzyko śmierci ze starości. */
  senescenceStart: number;

  // --- rozmnażanie ---
  reproductionEnergyThreshold: number; // ułamek maxEnergy
  reproductionCost: number; // ułamek energii rodzica przekazany + stracony
  reproductionCooldown: number; // ticki
  maturityAge: number;

  // --- mutacje ---
  mutationChance: number; // prawdopodobieństwo mutacji na gen
  mutationDelta: number; // amplituda drobnej zmiany wagi
  swapMutationChance: number; // szansa na zamianę dwóch genów miejscami
  bigMutationChance: number; // szansa na przepisanie fragmentu genomu
  bigMutationSpan: number; // ułamek genomu objęty dużą mutacją

  // --- sensory ---
  visionRadius: number;
  /** Ile najbliższych agentów bierzemy pod uwagę przy liczeniu zagęszczenia. */
  neighborSampleLimit: number;

  // --- mózg (topologia ewoluowalna) ---
  minHiddenLayers: number;
  /** Też: liczba warstw, wobec której liczona jest pojemność genomu. */
  maxHiddenLayers: number;
  minLayerWidth: number;
  /** Też: szerokość warstwy, wobec której liczona jest pojemność genomu. */
  maxLayerWidth: number;
  /** Wyłącznie punkt odniesienia do kalibracji kosztu mózgu w EnergySystem. */
  defaultLayerWidth: number;

  // --- statystyki ---
  statsInterval: number; // co ile ticków zapisujemy próbkę
  statsHistoryLength: number;
}

export const defaultConfig: SimulationConfig = {
  seed: 1337,
  worldSize: 3000,
  wrapEdges: true,

  initialPopulation: 150,
  // Limit populacji jest wyłącznie bezpiecznikiem wydajnościowym.
  // Jeśli symulacja w niego uderza, to znaczy, że świat jest za bogaty
  // i selekcja przestała działać — wtedy zmniejsz `foodSpawnRate`.
  maxPopulation: 2500,
  minPopulation: 12,

  // Przyrost jedzenia wyznacza pojemność środowiska. Przy tych kosztach
  // metabolizmu jeden osobnik potrzebuje ~0.006 jednostki jedzenia na tick,
  // więc 5/tick utrzymuje rzędu 500–800 osobników — pod warunkiem, że
  // potrafią je znaleźć. Reszta to już robota doboru naturalnego.
  foodSpawnRate: 5,
  maxFood: 1500,
  foodEnergy: 26,
  foodRadius: 4,
  foodClusterCount: 18,
  foodClusterRadius: 220,

  rockCount: 40,
  rockRespawnRate: 0,
  pickupRange: 6,
  carryActionCooldown: 30,
  carryMetabolismMultiplier: 1.15,

  attackRange: 10,
  attackDamageBase: 18,
  attackEnergyCost: 4,
  attackCooldownTicks: 40,
  baseMaxHealth: 100,
  healthRegenRate: 0.05,

  maxEnergy: 100,
  startEnergy: 60,
  // Koszt samego istnienia musi być odczuwalny. Gdy jest zbyt niski,
  // ewolucja znajduje strategię "stój w miejscu i czekaj aż jedzenie
  // samo na mnie spadnie" — działa, ale zabija całą resztę zachowań.
  baseMetabolism: 0.12,
  moveCost: 0.018,
  sizeCost: 0.02,
  brainCost: 0.006,

  maxSpeed: 2.6,
  maxTurnRate: 0.22,
  drag: 0.12,
  agentRadiusMin: 3,
  agentRadiusMax: 8,

  maxAge: 6000,
  senescenceStart: 3000,

  reproductionEnergyThreshold: 0.62,
  reproductionCost: 0.45,
  reproductionCooldown: 120,
  maturityAge: 150,

  mutationChance: 0.03,
  mutationDelta: 0.22,
  swapMutationChance: 0.02,
  bigMutationChance: 0.004,
  bigMutationSpan: 0.12,

  visionRadius: 260,
  neighborSampleLimit: 12,

  minHiddenLayers: 1,
  maxHiddenLayers: 3,
  minLayerWidth: 4,
  maxLayerWidth: 16,
  defaultLayerWidth: 10,

  statsInterval: 20,
  statsHistoryLength: 600,
};

export function makeConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return { ...defaultConfig, ...overrides };
}
