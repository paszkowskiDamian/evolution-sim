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
  /** Prędkość dryfu płata (jednostki/tick) — patrz World.driftClusters(). */
  foodClusterDriftSpeed: number;
  /** Szansa na tick, że płat zmieni kierunek dryfu. */
  foodClusterRedirectChance: number;

  // --- kamienie (przenoszalne przedmioty) ---
  /** Ile kamieni istnieje w świecie — pojemność pola przedmiotów. */
  rockCount: number;
  /** Ticki/kamień do dosiewania nowych (0 = brak — kamienie tylko krążą). */
  rockRespawnRate: number;
  /** Promień fizyczny kamienia — leżący kamień jest przeszkodą tej wielkości. */
  rockRadius: number;
  /** Zasięg chwytu/upuszczenia względem promienia ciała. */
  pickupRange: number;
  /** Ticki blokady po podniesieniu/upuszczeniu — chroni przed migotaniem. */
  carryActionCooldown: number;
  /** Mnożnik kosztu metabolizmu ZA KAŻDY niesiony przedmiot. */
  carryMetabolismMultiplier: number;
  /** Ile przedmiotów agent może nieść naraz. */
  maxCarryItems: number;

  // --- góry / jaskinie (klastry kamieni tworzące teren) ---
  /** Ile formacji górskich istnieje w świecie. */
  mountainCount: number;
  /** Promień pustego wnętrza (jaskini) — bez kamieni, tu chowa się jedzenie i działa schronienie. */
  mountainInnerRadius: number;
  /** Zewnętrzny promień pierścienia skalnego — kamienie góry mieszczą się między inner a outer. */
  mountainOuterRadius: number;
  /** Ułamek spawnów jedzenia kierowany do wnętrza losowej góry (jedzenie "za ścianą"). */
  caveFoodFraction: number;
  /** Mnożnik regeneracji zdrowia wewnątrz jaskini (bierna korzyść ze schronienia). */
  shelterHealthRegenMultiplier: number;
  /** Mnożnik kosztu metabolizmu wewnątrz jaskini (<1 = taniej istnieć w schronieniu). */
  shelterMetabolismDiscount: number;

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
  /**
   * Przejedzenie: energia z jedzenia, która nie mieści się już w maxEnergy
   * (bo agent jest pełny albo prawie pełny), zamienia się w obrażenia
   * zdrowia zamiast się po prostu marnować — mnożnik nadwyżki-energii na
   * utracone zdrowie. 0 = wyłączone (nadwyżka po prostu przepada).
   */
  overfeedHealthPenalty: number;
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

  // --- rozmnażanie (płciowe) ---
  reproductionEnergyThreshold: number; // ułamek maxEnergy
  reproductionCost: number; // ułamek energii KAŻDEGO z rodziców, przekazany + stracony
  reproductionCooldown: number; // ticki
  maturityAge: number;
  /** Zasięg szukania partnera przeciwnej płci, względem promienia ciała. */
  matingRange: number;

  // --- dojrzewanie fizjologiczne ---
  /** Ułamek maxSpeed dostępny przy wieku 0; narasta do 1.0 w `speedMaturationTicks`. */
  juvenileSpeedFactor: number;
  speedMaturationTicks: number;
  /** Ułamek pełnych obrażeń ataku przy wieku 0; narasta do 1.0 w `combatMaturationTicks`. */
  juvenileCombatFactor: number;
  combatMaturationTicks: number;

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
  // Rozmnażanie płciowe wymaga, żeby DWOJE konkretnych, gotowych osobników
  // znalazło się blisko siebie naraz — przy dawnym progu (12) na mapie
  // 3000x3000 to statystycznie prawie nigdy się nie zdarza. Próg musi
  // być na tyle wysoki, żeby awaryjne dosiewanie w ogóle dawało realną
  // szansę na spotkanie partnera.
  minPopulation: 80,

  // Przyrost jedzenia wyznacza pojemność środowiska. Zamierzenie skąpe —
  // presja na znalezienie i UTRZYMANIE dostępu do jedzenia (a nie tylko
  // jego zjedzenie) ma być odczuwalna.
  foodSpawnRate: 2.5,
  maxFood: 700,
  foodEnergy: 40,
  foodRadius: 4,
  foodClusterCount: 18,
  foodClusterRadius: 220,
  // Podniesione z 0.25/0.002: przy starej wartości płat porusza się tak
  // wolno, że stojący w miejscu agent średnio i tak siedzi WEWNĄTRZ
  // promienia klastra (zmierzone: śr. odległość do klastra 181 < promień
  // 220 — czyste obozowanie). Przy tej wartości średnia odległość
  // przekracza promień klastra (293 > 220), więc trwałe stanie w miejscu
  // przestaje się opłacać — a mimo to zjadane jedzenie ROŚNIE (9872 -> 12492
  // w 25000-tickowym teście), bo wymuszony ruch trafia na więcej płatów,
  // zamiast wyjadać jeden do zera.
  foodClusterDriftSpeed: 2.0,
  foodClusterRedirectChance: 0.006,

  // Znacząco podniesione (150 -> 1500): przy 150 na mapie 3000x3000
  // średni odstęp między kamieniami (~245 jednostek) jest porównywalny
  // z promieniem widzenia (260) — kamień to rzadkość, nie teren. Przy
  // 1500 średni odstęp spada do ~77 jednostek, więc agent ma zwykle
  // kilkanaście kamieni w polu widzenia naraz — realna, gęsta rzeźba
  // terenu do omijania, a nie pojedyncze osobliwości.
  rockCount: 1500,
  rockRespawnRate: 0,
  rockRadius: 5,
  pickupRange: 6,
  carryActionCooldown: 30,
  carryMetabolismMultiplier: 1.15,
  maxCarryItems: 5,

  // Góry to grube pierścienie kamieni (100-145 od środka) wokół pustego
  // wnętrza — gęstsza, bardziej "terenowa" struktura niż równomierny
  // rozsiew: agent napotyka zwartą ścianę, a nie pojedyncze przeszkody.
  // 1500 kamieni / 10 gór = ~150 kamieni/górę na pierścieniu o polu ~30000
  // jednostek² — pokrycie ~40%, wystarczające żeby wymagało kopania.
  mountainCount: 10,
  mountainInnerRadius: 100,
  mountainOuterRadius: 145,
  caveFoodFraction: 0.12,
  shelterHealthRegenMultiplier: 3,
  shelterMetabolismDiscount: 0.6,

  attackRange: 10,
  attackDamageBase: 18,
  attackEnergyCost: 4,
  attackCooldownTicks: 40,
  baseMaxHealth: 100,
  healthRegenRate: 0.05,

  maxEnergy: 100,
  startEnergy: 60,
  // Pełne foodEnergy (40) zmarnowane na pełnym żołądku kosztowałoby 20
  // zdrowia — odczuwalne, ale nie zabija za jedno kęsniecie. Zmusza
  // ewolucję do faktycznego rozpoznawania "czy jestem najedzony", zamiast
  // jeść bezmyślnie na dotyk.
  overfeedHealthPenalty: 0.5,
  // Koszt samego istnienia musi być odczuwalny. Gdy jest zbyt niski,
  // ewolucja znajduje strategię "stój w miejscu i czekaj aż jedzenie
  // samo na mnie spadnie" — działa, ale zabija całą resztę zachowań.
  baseMetabolism: 0.12,
  moveCost: 0.018,
  sizeCost: 0.02,
  brainCost: 0.003,

  maxSpeed: 2.6,
  maxTurnRate: 0.22,
  drag: 0.12,
  agentRadiusMin: 3,
  agentRadiusMax: 8,

  maxAge: 12000,
  senescenceStart: 6000,

  // Obniżony względem oryginału (0.62): przy skąpszym jedzeniu (mniej
  // i wolniej rosnące) średnia energia populacji osiada wyraźnie niżej —
  // przy starym progu rozmnażanie praktycznie w ogóle nie zachodziło
  // (zero narodzin w 15000-tickowym biegu testowym), mimo długowiecznej,
  // stabilnej populacji.
  reproductionEnergyThreshold: 0.4,
  reproductionCost: 0.45,
  reproductionCooldown: 120,
  maturityAge: 150,
  // Świat jest duży (worldSize=3000) i populacja przy tych ustawieniach
  // rzadka — przy wąskim zasięgu (np. 20, porównywalnym z attackRange)
  // szansa, że DWOJE konkretnych, gotowych osobników trafi na siebie
  // czysto losowym ruchem, jest bliska zeru (policzone: przy populacji 40
  // oczekiwana liczba KOGOKOLWIEK w zasięgu 20 to ~0.006). 60 nie czyni
  // spotkania pewnym, ale daje realną, niezerową szansę, którą ruch
  // (a nie czysty przypadek) może domknąć.
  matingRange: 60,

  juvenileSpeedFactor: 0.3,
  speedMaturationTicks: 400,
  juvenileCombatFactor: 0.15,
  combatMaturationTicks: 1000,

  mutationChance: 0.03,
  mutationDelta: 0.22,
  swapMutationChance: 0.02,
  bigMutationChance: 0.004,
  bigMutationSpan: 0.12,

  visionRadius: 260,
  neighborSampleLimit: 12,

  // Węższy zakres niż poprzednio (20-50): przy takiej głębokości mutacja
  // punktowa nie zdążała znaleźć działającej sieci szybciej, niż populacja
  // wymierała do awaryjnego progu — a to blokowało w praktyce WSZYSTKO,
  // łącznie z rozmnażaniem płciowym (potrzebuje dwojga sprawnych osobników
  // naraz w jednym miejscu). 4-10 warstw to wciąż wielokrotność pierwotnej
  // (1-3), ale w przeszukiwalnym zakresie.
  minHiddenLayers: 4,
  maxHiddenLayers: 10,
  minLayerWidth: 4,
  maxLayerWidth: 16,
  defaultLayerWidth: 32,

  statsInterval: 20,
  statsHistoryLength: 600,
};

export function makeConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return { ...defaultConfig, ...overrides };
}
