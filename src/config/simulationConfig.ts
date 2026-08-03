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

  // --- teren (siatka: puste / lita skała) ---
  /** Bok kwadratowej komórki terenu — patrz `core/world/terrain.ts`. */
  terrainCellSize: number;

  // --- kamienie (luźne, przenoszalne przedmioty — NIE ściany, patrz teren) ---
  /** Pojemność pola luźnych kamieni (nie liczba na starcie — świat zaczyna
   *  się bez żadnych, powstają wyłącznie z kopania). */
  maxLooseRocks: number;
  /** Promień fizyczny luźnego kamienia (czysto wizualny/do chwytu — luźne
   *  kamienie NIE są przeszkodą, tylko teren nią jest). */
  rockRadius: number;
  /** Zasięg chwytu/upuszczenia/kopania względem promienia ciała. */
  pickupRange: number;
  /** Ticki blokady po podniesieniu/upuszczeniu — chroni przed migotaniem. */
  carryActionCooldown: number;
  /** Mnożnik kosztu metabolizmu ZA KAŻDY niesiony przedmiot. */
  carryMetabolismMultiplier: number;
  /** Ile przedmiotów agent może nieść naraz. */
  maxCarryItems: number;
  /** Ile luźnych kamieni musi trafić na PUSTĄ komórkę, żeby stężała w ścianę. */
  buildRockThreshold: number;

  // --- góry / jaskinie (formacje terenu) ---
  /** Ile formacji górskich istnieje w świecie. */
  mountainCount: number;
  /** Promień litego masywu góry (pełny dysk skały, ZANIM wyrzeźbi się w nim tunele). */
  mountainRadius: number;
  /**
   * Obrys masywu (patrz `TerrainGrid.carveOrganicMassif`) — 0 = idealne koło,
   * rośnie ku 1 -> coraz bardziej postrzępiony, naturalny kształt (przy
   * wysokich wartościach masyw może rozpaść się na kilka osobnych brył).
   */
  mountainNoiseWeight: number;
  /** Liczba oktaw fraktalnego szumu obrysu — więcej = więcej detalu na różnych skalach, kosztem czasu generacji (wyłącznie przy starcie świata). */
  mountainNoiseOctaves: number;
  /** Częstotliwość szumu obrysu (jednostki świata^-1) — mniejsza = szersze, łagodniejsze wybrzuszenia; większa = drobniejszy, bardziej "kudłaty" detal. */
  mountainNoiseFrequency: number;
  /** Mnożnik częstotliwości między kolejnymi oktawami szumu (standardowo 2). */
  mountainNoiseLacunarity: number;
  /** Mnożnik amplitudy między kolejnymi oktawami szumu (standardowo 0.5). */
  mountainNoiseGain: number;
  /** Kroków głównego kopacza sieci tuneli wewnątrz masywu (patrz `TerrainGrid.carveTunnelNetwork`). */
  tunnelSteps: number;
  /** Maks. losowy skręt (radiany) na krok — większe = bardziej kręta trasa. */
  tunnelTurnAngle: number;
  /** Szansa na odgałęzienie nowego korytarza przy danym kroku. */
  tunnelBranchChance: number;
  /** Twardy limit łącznej liczby odgałęzień na górę. */
  tunnelMaxBranches: number;
  /** Szansa na poszerzenie danego miejsca w małą komnatę. */
  tunnelChamberChance: number;
  /** Zapas litej skały, który musi pozostać między siecią tuneli a krawędzią masywu. */
  tunnelMarginToEdge: number;
  /**
   * Ile komórek musi mieć spójna pusta składowa, żeby liczyć się jako
   * "prawdziwie zewnętrzna" (patrz `TerrainGrid.recomputeShelterMap`) —
   * MUSI być rząd wielkości większe niż jakakolwiek generowana jaskinia,
   * inaczej duży, ale wciąż w pełni zamknięty pokój błędnie uznałby SAM
   * SIEBIE za "zewnętrze" i nigdy nie dostałby statusu schronienia.
   */
  shelterExteriorMinCells: number;
  /**
   * Ile kroków (komórek terenu) trzeba pokonać od najbliższej komórki
   * "prawdziwie zewnętrznej", żeby liczyć się jako "wewnątrz". WIĘKSZE niż
   * szerokość typowego wejścia — inaczej sam próg drzwi już liczyłby się
   * jako schronienie. Komórki całkowicie odizolowane od otwartego świata
   * (bez żadnego dostępu) zawsze liczą się jako schronienie, niezależnie od
   * tej wartości. Patrz `TerrainGrid.isShelterAt`/`shelterWarmthAt`.
   */
  shelterMinDepth: number;
  /**
   * Ile komórek terenu "ciepło" schronienia wycieka NA ZEWNĄTRZ przez
   * wejście, gasnąc z odległością (patrz `TerrainGrid.shelterWarmthAt`,
   * sensor "ciepło"). Bez tego agent poza schronieniem nie miałby żadnego
   * gradientu do wspinania się w jego stronę — czułby ciepło dopiero
   * dosłownie na progu.
   */
  shelterHeatLeakRadius: number;
  /** Mnożnik regeneracji zdrowia wewnątrz schronienia (bierna korzyść). */
  shelterHealthRegenMultiplier: number;
  /** Mnożnik kosztu metabolizmu wewnątrz schronienia (<1 = taniej tam istnieć). */
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

  // --- sygnalizacja ---
  /**
   * Koszt energii ZA TICK, proporcjonalny do głośności wyjścia "sygnał"
   * (0 przy ciszy, pełny koszt przy głośności 1). Bez tego kosztu ewolucja
   * zawsze wybrałaby "krzycz na maksa bez przerwy" — kanał sygnałowy
   * niosłby zero informacji, bo każdy nadawałby stale to samo.
   */
  signalEnergyCost: number;

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
  /** Mnożnik `reproductionCooldown` zastosowany WYŁĄCZNIE do matki — ciąża/połóg kosztują więcej niż ojca. */
  motherCooldownMultiplier: number;
  maturityAge: number;
  /** Zasięg szukania partnera przeciwnej płci, względem promienia ciała. */
  matingRange: number;
  /**
   * Próg (na ciągłym genie `gender`, zakres ok. -1..1) rozdzielający samce
   * od samic — patrz `decodePhenotype`. 0 = symetrycznie 50/50. Dodatni
   * oddaje samicom szerszy fragment zakresu genu (mniej wartości genu
   * wystarcza, żeby zdecydować "samiec"), więc zwiększa udział samic wśród
   * NOWYCH narodzin — nie zmienia płci już żyjących agentów, bo fenotyp
   * jest dekodowany raz, przy narodzinach.
   */
  genderMaleThreshold: number;

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
  // Rozmnażanie płciowe ma efekt Allee: poniżej pewnej gęstości partnerzy
  // przestają się w ogóle spotykać (wzrok + matingRange na mapie 3000x3000
  // to lokalne, nie globalne wyszukiwanie) — a przy garstce ocalałych łatwo
  // też o czysty przypadek "wszyscy tej samej płci". Oba to ZAPADNIĘCIA BEZ
  // POWROTU: populacja poniżej progu nigdy się nie odbuduje sama, niezależnie
  // od tego, jak dobre są genomy (zmierzone probe'em: nawet w pełni
  // wyewoluowany genom kolapsuje do zera przy minPopulation=0 — narodziny
  // płciowe zatrzymują się na dobre, zanim ktokolwiek umrze z tego powodu).
  //
  // 20 to celowo MAŁO (nie dawne 80, które odpalało się bez przerwy i
  // klonowało populację zamiast dać jej się rozmnażać naprawdę) — próg
  // rzadkiej awaryjnej interwencji, nie stałej podpórki: przy zdrowej
  // populacji siedzącej wyraźnie powyżej 20 system w ogóle nie działa,
  // uruchamia się wyłącznie żeby złapać populację TUŻ przed nieodwracalnym
  // zapadnięciem. `0` nadal jest dostępne (suwakiem w UI) dla kogoś, kto
  // świadomie chce dopuścić prawdziwe wymarcie jako możliwy wynik.
  minPopulation: 20,

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

  // Bok komórki: dzieli 3000 dokładnie na 120 kolumn. Wystarczająco duży,
  // żeby kopanie/budowanie pojedynczej komórki było odczuwalnym zdarzeniem
  // (nie mikro-ziarnem), wystarczająco mały, żeby ściana góry (poniżej)
  // miała realną grubość w komórkach zamiast być jedną cienką linią.
  terrainCellSize: 25,

  maxLooseRocks: 400,
  rockRadius: 5,
  pickupRange: 6,
  carryActionCooldown: 30,
  carryMetabolismMultiplier: 1.15,
  maxCarryItems: 5,
  // 3 kamienie odłożone na tę samą pustą komórkę zestalają ją w ścianę —
  // osiągalne bez gromadzenia ogromnych zapasów, ale nie z jednego rzutu.
  buildRockThreshold: 3,

  // Góra to LITY masyw skały (nominalny promień 150) o NIEREGULARNYM,
  // naturalnym obrysie (patrz TerrainGrid.carveOrganicMassif) — nie idealne
  // koło i nie pusty pierścień. Dopiero WEWNĄTRZ niego "błądzenie pijaka"
  // wyrzeźbia rozgałęzioną sieć tuneli (patrz TerrainGrid.carveTunnelNetwork).
  // Wypełnienie siatki jest z definicji szczelne — bez szczelin, przez które
  // dałoby się przejść bez kopania — a granica sieci tuneli ma wbudowany
  // zapas (tunnelMarginToEdge + promień komnaty) liczony od NOMINALNEGO
  // promienia. Przy umiarkowanym mountainNoiseWeight (poniżej) to nadal
  // praktycznie zawsze wystarcza; przy bardzo wysokich wartościach obrys
  // bywa lokalnie węższy niż nominalny promień, więc gwarancja "tunel nigdy
  // nie przebije się na zewnątrz sam z siebie" staje się przybliżona,
  // nie absolutna.
  mountainCount: 10,
  mountainRadius: 150,
  mountainNoiseWeight: 0.35,
  mountainNoiseOctaves: 4,
  // Okres podstawowej oktawy ~100 jednostek (1/0.01) -> przy promieniu 150
  // (średnica 300) daje ok. 3 wybrzuszenia na obwodzie masywu — rozpoznawalnie
  // nieregularny kształt, nie "poszarpane konfetti".
  mountainNoiseFrequency: 0.01,
  mountainNoiseLacunarity: 2,
  mountainNoiseGain: 0.5,
  tunnelSteps: 50,
  tunnelTurnAngle: 0.6,
  tunnelBranchChance: 0.03,
  tunnelMaxBranches: 3,
  tunnelChamberChance: 0.08,
  tunnelMarginToEdge: 25,
  // Naturalna sieć tuneli wychodzi w praktyce na rząd kilkudziesięciu-
  // -kilkuset komórek (zmierzone probe'em), a ręcznie zbudowane pomieszczenia
  // rzadko dorównują temu rozmiarowi. 1500 zostawia ogromny margines wobec
  // OBU tych przypadków, będąc wciąż o rząd wielkości mniejsze niż otwarty
  // świat (siatka 3000x3000 przy cellSize=25 to 14400 komórek, z czego
  // większość to nie-góry) — nie da się tego przez przypadek "przekopać".
  shelterExteriorMinCells: 1500,
  // 3 komórki (75 jednostek przy cellSize=25) to więcej niż typowe wejście
  // (1-2 komórki szerokości) — sam próg drzwi nie liczy się jeszcze jako
  // "wewnątrz", ale nie trzeba iść daleko w głąb korytarza, żeby zacząć
  // się liczyć.
  shelterMinDepth: 3,
  // 6 komórek (150 jednostek) — porównywalne z zasięgiem stożka widzenia
  // (ewoluowalny wzrok, domyślnie ~260), więc wyciek ciepła jest wyczuwalny
  // z sensownej części pola widzenia, nie tylko dosłownie na progu.
  shelterHeatLeakRadius: 6,
  shelterHealthRegenMultiplier: 3,
  shelterMetabolismDiscount: 0.6,

  attackRange: 10,
  attackDamageBase: 18,
  attackEnergyCost: 4,
  attackCooldownTicks: 40,
  baseMaxHealth: 100,
  healthRegenRate: 0.05,

  // 0.03 przy pełnej głośności to ok. 25% baseMetabolism (0.12) — odczuwalne
  // przy ciągłym nadawaniu (jak reszta kosztów w tym pliku), ale krótkie
  // "okrzyki" zostają praktycznie darmowe. Bez tego ewolucja nie miałaby
  // żadnego powodu, żeby kiedykolwiek zamilknąć.
  signalEnergyCost: 0.03,

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
  motherCooldownMultiplier: 2.5,
  maturityAge: 150,
  // Świat jest duży (worldSize=3000) i populacja przy tych ustawieniach
  // rzadka — przy wąskim zasięgu (np. 20, porównywalnym z attackRange)
  // szansa, że DWOJE konkretnych, gotowych osobników trafi na siebie
  // czysto losowym ruchem, jest bliska zeru (policzone: przy populacji 40
  // oczekiwana liczba KOGOKOLWIEK w zasięgu 20 to ~0.006). 60 nie czyni
  // spotkania pewnym, ale daje realną, niezerową szansę, którą ruch
  // (a nie czysty przypadek) może domknąć.
  matingRange: 60,
  // Dodatni: samice dostają szerszy fragment zakresu genu (-1..1) niż
  // samce, więc nowe narodziny ciągną w ich stronę bez wymuszania sztywnego
  // stosunku płci — dryf genetyczny wciąż może to przesunąć dalej, ale
  // start jest przechylony, nie idealnie symetryczny.
  genderMaleThreshold: 0.2,

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
