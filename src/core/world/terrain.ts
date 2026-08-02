import { wrap, wrapDelta, TAU, clamp } from '../utils/math';
import type { Rng } from '../utils/rng';
import { fbm2D } from './noise';

/** Pusta komórka — agent porusza się przez nią swobodnie. */
export const TILE_EMPTY = 0;
/** Lita skała — nieprzepuszczalna przeszkoda (patrz TerrainCollisionSystem). */
export const TILE_ROCK = 1;

/**
 * Promień (w komórkach) użyty przez `TerrainGrid.isOpenField` do odróżnienia
 * komórki "na prawdziwym otwartym" od komórki, która tylko PRZYPADKIEM
 * należy do tej samej (dużej, scalonej) składowej co świat zewnętrzny —
 * patrz `recomputeShelterMap`. Stała wewnętrzna, nie config: to detal
 * implementacyjny algorytmu, nie coś, co ma sens stroić z UI.
 */
const OPEN_FIELD_RADIUS = 2;

/**
 * Teren jako siatka kwadratowych komórek — każda jest pusta albo lita.
 *
 * To ZASTĘPUJE dawny model "góry to chmura losowo rozrzuconych kamieni-
 * -przedmiotów": kółka pakowane losowo zawsze zostawiają szczeliny (agent
 * przechodził przez "ścianę" po prostu trafiając w lukę między kamieniami).
 * Siatka nie ma tego problemu z definicji — sąsiadujące lite komórki
 * stykają się krawędziami, bez przerw.
 *
 * Współrzędne świata są ciągłe (agenci poruszają się płynnie jak dotąd) —
 * siatka to WYŁĄCZNIE reprezentacja terenu, nie ogranicza ruchu do
 * dyskretnych kroków. Świat jest torusem, więc siatka też zawija się na
 * krawędziach (patrz `wrapCell`).
 */
export class TerrainGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly cells: Uint8Array;
  private readonly worldSize: number;

  /**
   * Mapa "schronienia" (patrz `isShelterAt`) — 1 = pusta komórka dostatecznie
   * głęboko wewnątrz (patrz `recomputeShelterMap`), 0 = lita komórka LUB
   * pusta komórka zbyt blisko otwartego świata. Przeliczana leniwie
   * (`ensureShelterMap`), unieważniana przy każdej zmianie terenu (`set`).
   */
  private shelterCells: Uint8Array | null = null;
  private shelterDirty = true;
  private shelterExteriorMinCells = -1;
  private shelterMinDepth = -1;
  private shelterHeatLeakRadius = -1;
  /** Odległość (kroki BFS) do najbliższej komórki należącej do "prawdziwie
   *  zewnętrznej" składowej; -1 = nieodwiedzona (całkowicie odizolowana). */
  private readonly shelterDist: Int32Array;
  /** Odległość (kroki BFS, w drugą stronę) od najbliższej komórki BĘDĄCEJ
   *  schronieniem, ograniczona do `heatLeakRadius` — "ciepło wyciekające"
   *  na zewnątrz przez wejście. -1 = poza zasięgiem wycieku. */
  private readonly shelterLeak: Int32Array;
  /** Reużywana jako bufor kolejki BFS w `recomputeShelterMap` (wszystkie etapy). */
  private readonly shelterStack: Int32Array;
  /** Reużywana jako znacznik "odwiedzony" przy szukaniu surowych składowych
   *  (etap 1 `recomputeShelterMap`) — osobna od `shelterDist`, bo TA
   *  ostatnia w tym etapie jeszcze nie niesie żadnej informacji. */
  private readonly shelterVisited: Uint8Array;

  constructor(worldSize: number, cellSize: number) {
    this.worldSize = worldSize;
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.round(worldSize / cellSize));
    this.cells = new Uint8Array(this.cols * this.cols);
    const n = this.cols * this.cols;
    this.shelterDist = new Int32Array(n);
    this.shelterLeak = new Int32Array(n);
    this.shelterStack = new Int32Array(n);
    this.shelterVisited = new Uint8Array(n);
  }

  private wrapCell(c: number): number {
    return ((c % this.cols) + this.cols) % this.cols;
  }

  private index(cx: number, cy: number): number {
    return this.wrapCell(cy) * this.cols + this.wrapCell(cx);
  }

  cellX(worldX: number): number {
    return Math.floor(wrap(worldX, this.worldSize) / this.cellSize);
  }

  cellY(worldY: number): number {
    return Math.floor(wrap(worldY, this.worldSize) / this.cellSize);
  }

  /** Środek komórki (cx,cy) we współrzędnych świata. */
  cellCenter(cx: number, cy: number): { x: number; y: number } {
    return { x: (cx + 0.5) * this.cellSize, y: (cy + 0.5) * this.cellSize };
  }

  get(cx: number, cy: number): number {
    return this.cells[this.index(cx, cy)];
  }

  set(cx: number, cy: number, value: number): void {
    this.cells[this.index(cx, cy)] = value;
    this.shelterDirty = true;
  }

  isSolidCell(cx: number, cy: number): boolean {
    return this.get(cx, cy) === TILE_ROCK;
  }

  isSolidAt(worldX: number, worldY: number): boolean {
    return this.isSolidCell(this.cellX(worldX), this.cellY(worldY));
  }

  clear(): void {
    this.cells.fill(TILE_EMPTY);
    this.shelterDirty = true;
  }

  /**
   * Wypełnia dysk wokół `(centerX,centerY)` wartością `value`. Próbkuje
   * środek KAŻDEJ komórki w kwadracie opisanym na promieniu (systematyczne
   * wypełnienie, nie losowe próbkowanie punktów) — dlatego wynik jest
   * z definicji szczelny, bez dziur.
   */
  private fillDisc(centerX: number, centerY: number, radius: number, value: number): void {
    const r2 = radius * radius;
    const reach = Math.ceil(radius / this.cellSize) + 1;
    const baseCx = Math.floor(centerX / this.cellSize);
    const baseCy = Math.floor(centerY / this.cellSize);

    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        const cx = baseCx + ox;
        const cy = baseCy + oy;
        const { x, y } = this.cellCenter(cx, cy);
        const dx = wrapDelta(x - centerX, this.worldSize);
        const dy = wrapDelta(y - centerY, this.worldSize);
        if (dx * dx + dy * dy <= r2) this.set(cx, cy, value);
      }
    }
  }

  /** Lity dysk skały — masyw góry, ZANIM wyrzeźbi się w nim system tuneli. */
  carveSolidDisc(centerX: number, centerY: number, radius: number): void {
    this.fillDisc(centerX, centerY, radius, TILE_ROCK);
  }

  /**
   * Lity masyw góry o NIEREGULARNYM, naturalnym obrysie — zamiast idealnego
   * koła (`carveSolidDisc`), mieszanka gradientu odległości od środka
   * (żeby masyw pozostał ograniczony, nie rozlał się po całej mapie) z
   * fraktalnym szumem (`fbm2D`) — dokładnie ta sama technika co generowanie
   * wybrzeży wysp w typowych generatorach map proceduralnych.
   *
   * `e(x,y) = gradient(x,y) * (1-noiseWeight) + noise(x,y) * noiseWeight`,
   * lita komórka gdy `e > 0`. Przy `noiseWeight = 0` wynik jest identyczny
   * z `carveSolidDisc` (czyste koło); rosnący `noiseWeight` robi obrys
   * coraz bardziej postrzępiony — przy wysokich wartościach masyw może się
   * nawet rozpaść na kilka osobnych brył, tak jak naturalne pasma górskie.
   *
   * Skanuje kwadrat o boku `2*radius*1.5` (zapas na "palce" wystające poza
   * nominalny promień) — hojniejszy niż `fillDisc`, bo szum z definicji
   * może wypchnąć obrys poza czysto kołowy zasięg.
   */
  carveOrganicMassif(
    centerX: number,
    centerY: number,
    radius: number,
    seed: number,
    opts: { octaves: number; frequency: number; lacunarity: number; gain: number; noiseWeight: number },
  ): void {
    const reach = Math.ceil((radius * 1.5) / this.cellSize) + 1;
    const baseCx = Math.floor(centerX / this.cellSize);
    const baseCy = Math.floor(centerY / this.cellSize);
    const noiseW = clamp(opts.noiseWeight, 0, 1);

    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        const cx = baseCx + ox;
        const cy = baseCy + oy;
        const { x, y } = this.cellCenter(cx, cy);
        const dx = wrapDelta(x - centerX, this.worldSize);
        const dy = wrapDelta(y - centerY, this.worldSize);
        const distNorm = Math.sqrt(dx * dx + dy * dy) / radius;

        // 1 w środku, 0 na nominalnym promieniu, ujemny poza nim.
        const gradient = 1 - distNorm;
        // fbm próbkowane we WSPÓŁRZĘDNYCH ŚWIATA, skalowane częstotliwością
        // niezależną od `radius` — ta sama `frequency` daje więcej "guzów"
        // na dużym masywie niż na małym, tak jak w prawdziwym terenie.
        const n = fbm2D(x * opts.frequency, y * opts.frequency, seed, opts.octaves, opts.lacunarity, opts.gain) * 2 - 1;
        const e = gradient * (1 - noiseW) + n * noiseW;
        if (e > 0) this.set(cx, cy, TILE_ROCK);
      }
    }
  }

  /**
   * Rzeźbi organiczny, rozgałęziony system tuneli/komnat wewnątrz litego
   * masywu (patrz `carveSolidDisc`) — "błądzenie pijaka" (drunkard's walk):
   * wirtualny kopacz startuje w środku góry, idzie losowo skręcającą
   * trasą, od czasu do czasu odgałęzia nowego kopacza albo poszerza
   * korytarz w małą komnatę. To celowo NIE jest okrąg — prawdziwe jaskinie
   * to sieć korytarzy, nie jedna okrągła sala.
   *
   * Trasa jest trzymana we współrzędnych WZGLĘDEM środka (nie świata) przez
   * cały spacer, żeby zawijanie świata (torus) nie komplikowało arytmetyki
   * kroku — zawijamy dopiero przy właściwym rzeźbieniu komórek.
   *
   * Kluczowy niezmiennik: żaden wykuty fragment (łącznie z promieniem
   * ewentualnej komnaty) nigdy nie sięga zewnętrznej krawędzi masywu —
   * boundaryRadius jest pomniejszony o promień komnaty WŁAŚNIE po to, żeby
   * to zagwarantować niezależnie od tego, jak akurat poprowadzi błądzenie.
   * Dzięki temu jaskinia zawsze zostaje szczelnie zamknięta w masywie —
   * zweryfikowane osobnym probe (flood-fill nigdy nie ucieka na zewnątrz).
   */
  carveTunnelNetwork(
    centerX: number,
    centerY: number,
    rng: Rng,
    opts: {
      /** Kroków głównego kopacza (odgałęzienia dostają ułamek pozostałych). */
      maxSteps: number;
      /** Losowy skręt (radiany) dodawany do kierunku po każdym kroku. */
      turnRadians: number;
      /** Szansa na odgałęzienie nowego kopacza przy danym kroku. */
      branchChance: number;
      /** Twardy limit łącznej liczby odgałęzień (chroni przed eksplozją). */
      maxBranches: number;
      /** Szansa na poszerzenie bieżącego miejsca w małą komnatę. */
      chamberChance: number;
      /** Promień masywu, w którym mieści się cały system (patrz `carveSolidDisc`). */
      mountainRadius: number;
      /** Zapas litej skały, który MUSI pozostać między tunelem a krawędzią masywu. */
      marginToEdge: number;
    },
  ): void {
    const tunnelRadius = this.cellSize * 0.6;
    const chamberRadius = this.cellSize * 1.3;
    // Środek żadnego wykutego kawałka (tunel ani komnata) nie może wyjść
    // poza ten promień — z zapasem na promień komnaty, żeby SAMO wykucie
    // (nie tylko środek trasy) zawsze zmieściło się w masywie.
    const boundaryRadius = Math.max(
      tunnelRadius + 1,
      opts.mountainRadius - opts.marginToEdge - chamberRadius,
    );

    interface Walker {
      ox: number;
      oy: number;
      angle: number;
      stepsLeft: number;
    }
    const pending: Walker[] = [
      { ox: 0, oy: 0, angle: rng.range(0, TAU), stepsLeft: opts.maxSteps },
    ];
    let branchesSpawned = 0;

    while (pending.length > 0) {
      const w = pending.pop()!;
      while (w.stepsLeft > 0) {
        w.stepsLeft--;
        const worldX = wrap(centerX + w.ox, this.worldSize);
        const worldY = wrap(centerY + w.oy, this.worldSize);
        this.fillDisc(worldX, worldY, tunnelRadius, TILE_EMPTY);
        if (rng.chance(opts.chamberChance)) {
          this.fillDisc(worldX, worldY, chamberRadius, TILE_EMPTY);
        }

        if (branchesSpawned < opts.maxBranches && w.stepsLeft > 5 && rng.chance(opts.branchChance)) {
          branchesSpawned++;
          const turn = (rng.chance(0.5) ? 1 : -1) * (Math.PI / 2 + rng.symmetric(0.4));
          pending.push({
            ox: w.ox,
            oy: w.oy,
            angle: w.angle + turn,
            stepsLeft: Math.floor(w.stepsLeft * 0.6),
          });
        }

        w.angle += rng.symmetric(opts.turnRadians);
        let nox = w.ox + Math.cos(w.angle) * this.cellSize;
        let noy = w.oy + Math.sin(w.angle) * this.cellSize;
        if (Math.hypot(nox, noy) > boundaryRadius) {
          // Zawróć w stronę środka zamiast wyjść poza bezpieczny promień.
          w.angle = Math.atan2(-noy, -nox) + rng.symmetric(0.3);
          nox = w.ox + Math.cos(w.angle) * this.cellSize;
          noy = w.oy + Math.sin(w.angle) * this.cellSize;
        }
        w.ox = nox;
        w.oy = noy;
      }
    }
  }

  /**
   * Najbliższa lita komórka w promieniu `maxDist` od `(x,y)` — do sensora
   * "najbliższa ściana" (patrz SensorSystem). Zwraca wektor DO najbliższego
   * PUNKTU na tej komórce (nie do jej środka), żeby "bliskość" i kierunek
   * odzwierciedlały faktyczną krawędź ściany, tak jak przy zderzeniach.
   */
  findNearestSolid(
    x: number,
    y: number,
    maxDist: number,
  ): { dx: number; dy: number; dist: number; cx: number; cy: number } | null {
    const reach = Math.ceil(maxDist / this.cellSize);
    const baseCx = Math.floor(x / this.cellSize);
    const baseCy = Math.floor(y / this.cellSize);
    let bestDist2 = maxDist * maxDist;
    let bestDx = 0;
    let bestDy = 0;
    let bestCx = 0;
    let bestCy = 0;
    let found = false;

    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        const cx = baseCx + ox;
        const cy = baseCy + oy;
        if (!this.isSolidCell(cx, cy)) continue;
        const { dx, dy, dist2 } = this.closestPointDelta(x, y, cx, cy);
        if (dist2 < bestDist2) {
          bestDist2 = dist2;
          bestDx = dx;
          bestDy = dy;
          bestCx = cx;
          bestCy = cy;
          found = true;
        }
      }
    }
    return found ? { dx: bestDx, dy: bestDy, dist: Math.sqrt(bestDist2), cx: bestCx, cy: bestCy } : null;
  }

  /**
   * Wektor OD punktu `(x,y)` DO najbliższego punktu prostokąta komórki
   * `(cx,cy)` — z uwzględnieniem zawinięcia świata (torus). Współdzielone
   * przez sensor ściany i kolizję (TerrainCollisionSystem).
   */
  closestPointDelta(
    x: number,
    y: number,
    cx: number,
    cy: number,
  ): { dx: number; dy: number; dist2: number } {
    const size = this.worldSize;
    const half = this.cellSize / 2;
    const center = this.cellCenter(cx, cy);
    // Wektor DO ŚRODKA komórki najkrótszą drogą po torusie (ta sama sztuczka,
    // co wszędzie indziej w kodzie — patrz `wrapDelta`/SpatialGrid). Reszta to
    // zwykłe "najbliższy punkt prostokąta" w układzie względem (x,y) — środek
    // prostokąta jest w (centerDx,centerDy), więc jego brzegi są w prostej
    // odległości `half` od niego, bez dalszego zawijania.
    const centerDx = wrapDelta(center.x - x, size);
    const centerDy = wrapDelta(center.y - y, size);

    const dx = Math.max(centerDx - half, Math.min(0, centerDx + half));
    const dy = Math.max(centerDy - half, Math.min(0, centerDy + half));
    return { dx, dy, dist2: dx * dx + dy * dy };
  }

  // ------------------------------------------------------------ schronienie

  /**
   * Czy `(x,y)` leży w PUSTEJ komórce dostatecznie GŁĘBOKO wewnątrz —
   * używane przez EnergySystem do biernej korzyści ze schronienia. Patrz
   * `shelterWarmthAt` po CIĄGŁĄ (nie progowaną) wersję tej samej odległości
   * — do sensora sieci, nie tylko efektu metabolicznego.
   *
   * Definicja jest odległościowa: liczymy dla KAŻDEJ pustej komórki
   * odległość (w krokach po siatce, 4-sąsiedztwo) do najbliższej komórki
   * należącej do "prawdziwie zewnętrznej" składowej (patrz
   * `recomputeShelterMap` — rozstrzyga to ROZMIAR surowej spójnej składowej,
   * nie lokalna geometria: pokój bez żadnego wyjścia, choćby duży, nigdy
   * sam nie należy do takiej składowej). Komórka liczy się jako schronienie,
   * jeśli ta odległość wynosi co najmniej `minDepth` (ALBO żadna komórka
   * zewnętrzna nie jest w ogóle osiągalna — pełna izolacja).
   *
   * To rozróżnia "wąskie drzwi" od "wyburzonej ściany" BEZ zgadywania
   * szerokości wyłomu: wejście, choćby szerokie, po prostu ZUŻYWA kilka
   * kroków głębokości, zanim dotrze do prawdziwego wnętrza — komórki blisko
   * wejścia wypadają z definicji, komórki głęboko w środku (nawet jeśli
   * technicznie "połączone ze światem") zostają schronieniem. Działa
   * jednakowo dla naturalnych jaskiń i dowolnej struktury dobudowanej przez
   * agentów — nie ma specjalnego przypadku dla gór.
   */
  isShelterAt(x: number, y: number, exteriorMinCells: number, minDepth: number, heatLeakRadius: number): boolean {
    this.ensureShelterMap(exteriorMinCells, minDepth, heatLeakRadius);
    return this.shelterCells![this.index(this.cellX(x), this.cellY(y))] === 1;
  }

  /**
   * Wersja CIĄGŁA `isShelterAt` — 1 = pełna głębokość `minDepth` lub więcej
   * (ciepło), narasta w głąb schronienia. Na ZEWNĄTRZ nie jest zerem
   * skokowo: ciepło WYCIEKA przez wejście i gaśnie z odległością aż do
   * `heatLeakRadius` komórek (patrz etap 4 `recomputeShelterMap`) — dzięki
   * temu agent stojący kawałek od wejścia też czuje gradient, nie tylko ten
   * dosłownie na progu. Komórki całkowicie odizolowane od świata
   * zewnętrznego (bez żadnego dostępu) dostają maksimum — są najgłębszym
   * możliwym wnętrzem, niezależnie od tego, że formalnie nie mają zmierzonej
   * odległości. Gradient jest łatwiejszy do wspinania ewolucyjnie niż twarda
   * granica tak/nie.
   */
  shelterWarmthAt(x: number, y: number, exteriorMinCells: number, minDepth: number, heatLeakRadius: number): number {
    this.ensureShelterMap(exteriorMinCells, minDepth, heatLeakRadius);
    const i = this.index(this.cellX(x), this.cellY(y));
    if (this.shelterCells![i] === 1) {
      const d = this.shelterDist[i];
      if (d === -1) return 1;
      if (minDepth <= 0) return d > 0 ? 1 : 0;
      return Math.min(1, d / minDepth);
    }
    // Na zewnątrz: ciepło zależy od bliskości do NAJBLIŻSZEGO schronienia
    // (`shelterLeak`), nie od głębokości TEGO konkretnego — leak[i] === -1
    // oznacza "poza zasięgiem wycieku z jakiegokolwiek wejścia w promieniu
    // heatLeakRadius", czyli zimno (0).
    const leak = this.shelterLeak[i];
    if (leak === -1 || heatLeakRadius <= 0) return 0;
    return Math.max(0, 1 - leak / heatLeakRadius);
  }

  /** Surowa mapa schronienia (1 = wnętrze) — do wgrania na GPU (GpuEnergySystem). */
  getShelterCells(exteriorMinCells: number, minDepth: number, heatLeakRadius: number): Uint8Array {
    this.ensureShelterMap(exteriorMinCells, minDepth, heatLeakRadius);
    return this.shelterCells!;
  }

  private ensureShelterMap(exteriorMinCells: number, minDepth: number, heatLeakRadius: number): void {
    if (
      !this.shelterDirty &&
      this.shelterExteriorMinCells === exteriorMinCells &&
      this.shelterMinDepth === minDepth &&
      this.shelterHeatLeakRadius === heatLeakRadius &&
      this.shelterCells
    ) {
      return;
    }
    this.recomputeShelterMap(exteriorMinCells, minDepth, heatLeakRadius);
    this.shelterDirty = false;
    this.shelterExteriorMinCells = exteriorMinCells;
    this.shelterMinDepth = minDepth;
    this.shelterHeatLeakRadius = heatLeakRadius;
  }

  /**
   * Przeliczenie PEŁNEJ mapy — O(liczba komórek), ale wywoływane tylko gdy
   * teren faktycznie się zmienił (kopanie/budowanie), nie co tick.
   *
   * Trzyetapowo:
   *  1. Zwykły flood-fill po pustych komórkach -> surowe spójne składowe +
   *     ich rozmiary. To NIE jest to samo pytanie co "czy jestem
   *     schronieniem" (patrz historia zmian — czysta wielkość składowej
   *     zawodzi na jednym wykopanym polu), tylko "czy w ogóle jestem
   *     CZĘŚCIĄ czegoś na tyle wielkiego, żeby być prawdziwym zewnętrzem".
   *  2. Komórki należące do składowej >= `exteriorMinCells` -> źródła
   *     odległości 0 (wielo-źródłowe BFS). Próg musi być WIELOKROTNIE
   *     większy niż jakakolwiek generowana jaskinia (rząd setek komórek),
   *     żeby duży, ale wciąż w pełni zamknięty pokój nigdy sam siebie nie
   *     uznał za "zewnętrze" — to dokładnie błąd, który miała czysto
   *     lokalna geometria (promień prześwitu) w poprzedniej wersji.
   *  3. BFS po WSZYSTKICH pustych komórkach (4-sąsiedztwo, bez rozróżniania
   *     mostów) od tych źródeł. Komórki nieosiągnięte (`dist === -1`) są
   *     całkowicie odizolowane od prawdziwego zewnętrza.
   *
   * `shelterCells[i] = 1` gdy `dist[i] === -1 || dist[i] >= minDepth`.
   */
  private recomputeShelterMap(exteriorMinCells: number, minDepth: number, heatLeakRadius: number): void {
    const n = this.cells.length;
    if (!this.shelterCells || this.shelterCells.length !== n) {
      this.shelterCells = new Uint8Array(n);
    } else {
      this.shelterCells.fill(0);
    }

    const dist = this.shelterDist;
    dist.fill(-1);
    // Zwykła (nie cykliczna) kolejka FIFO — każda komórka wchodzi do
    // każdego z dwóch flood-fillów co najwyżej raz, więc bufor rozmiaru
    // `n` nigdy się nie przepełni w żadnym z nich.
    const queue = this.shelterStack;

    // --- 1: surowe spójne składowe + rozmiary (reużywamy `dist` jako
    //     tymczasowy znacznik "odwiedzony w tym przebiegu", potem fill(-1)
    //     ponownie przed właściwym BFS) ---
    const visited = this.shelterVisited;
    visited.fill(0);
    for (let start = 0; start < n; start++) {
      if (visited[start] || this.cells[start] === TILE_ROCK) continue;

      let qHead = 0;
      let qTail = 0;
      visited[start] = 1;
      queue[qTail++] = start;
      let compLen = 0;
      const compStart = qTail - 1; // `queue` podwaja rolę: FIFO teraz, potem odczyt jako lista komórek

      while (qHead < qTail) {
        const u = queue[qHead++];
        compLen++;
        const cy = Math.floor(u / this.cols);
        const cx = u % this.cols;
        const neighbors = [
          this.index(cx + 1, cy),
          this.index(cx - 1, cy),
          this.index(cx, cy + 1),
          this.index(cx, cy - 1),
        ];
        for (const v of neighbors) {
          if (visited[v] || this.cells[v] === TILE_ROCK) continue;
          visited[v] = 1;
          queue[qTail++] = v;
        }
      }

      // Rozmiar składowej SAM w sobie NIE wystarcza: po scaleniu przez
      // wyłom cała jaskinia jest technicznie częścią tej samej ogromnej
      // składowej co prawdziwy świat, więc oznaczenie WSZYSTKICH jej
      // komórek jako źródeł zniweczyłoby całą resztę algorytmu (dokładnie
      // ten błąd złapał probe przy pierwszym podejściu). Źródłem może być
      // WYŁĄCZNIE komórka, która DODATKOWO jest lokalnie "na otwartym"
      // (`isOpenField`) — duża, ale wciąż wąska w każdym miejscu jaskinia
      // (typowy wynik generatora tuneli) nie ma TAKIEJ komórki w ogóle,
      // niezależnie od tego, ile ma łącznie pustych pól.
      if (compLen >= exteriorMinCells) {
        for (let i = compStart; i < compStart + compLen; i++) {
          const cell = queue[i];
          const cy = Math.floor(cell / this.cols);
          const cx = cell % this.cols;
          if (this.isOpenField(cx, cy, OPEN_FIELD_RADIUS)) dist[cell] = 0;
        }
      }
    }

    // --- 2+3: wielo-źródłowe BFS od komórek "prawdziwie zewnętrznych" ---
    let qHead = 0;
    let qTail = 0;
    for (let i = 0; i < n; i++) if (dist[i] === 0) queue[qTail++] = i;

    while (qHead < qTail) {
      const u = queue[qHead++];
      const cy = Math.floor(u / this.cols);
      const cx = u % this.cols;
      const neighbors = [
        this.index(cx + 1, cy),
        this.index(cx - 1, cy),
        this.index(cx, cy + 1),
        this.index(cx, cy - 1),
      ];
      for (const v of neighbors) {
        if (this.cells[v] === TILE_ROCK || dist[v] !== -1) continue;
        dist[v] = dist[u] + 1;
        queue[qTail++] = v;
      }
    }

    for (let i = 0; i < n; i++) {
      if (this.cells[i] === TILE_ROCK) continue;
      if (dist[i] === -1 || dist[i] >= minDepth) this.shelterCells[i] = 1;
    }

    // --- 4: ciepło WYCIEKA na zewnątrz przez wejścia ---
    // Drugie, OGRANICZONE wielo-źródłowe BFS, tym razem zasiane z komórek
    // BĘDĄCYCH schronieniem i idące W DRUGĄ STRONĘ (na zewnątrz), zatrzymane
    // po `heatLeakRadius` krokach. Bez tego "ciepło" istniałoby wyłącznie
    // jako binarna właściwość wnętrza — agent na zewnątrz, nawet tuż przy
    // wejściu, nie miałby żadnego gradientu do wspinania się w stronę
    // schronienia. Fizycznie to to samo zjawisko co ciepłe powietrze
    // wylatujące z jaskini: najsilniejsze przy progu, gaśnie z odległością.
    const leak = this.shelterLeak;
    leak.fill(-1);
    qHead = 0;
    qTail = 0;
    for (let i = 0; i < n; i++) {
      if (this.shelterCells[i] === 1) {
        leak[i] = 0;
        queue[qTail++] = i;
      }
    }
    while (qHead < qTail) {
      const u = queue[qHead++];
      const nextDist = leak[u] + 1;
      if (nextDist > heatLeakRadius) continue;
      const cy = Math.floor(u / this.cols);
      const cx = u % this.cols;
      const neighbors = [
        this.index(cx + 1, cy),
        this.index(cx - 1, cy),
        this.index(cx, cy + 1),
        this.index(cx, cy - 1),
      ];
      for (const v of neighbors) {
        if (this.cells[v] === TILE_ROCK || leak[v] !== -1) continue;
        leak[v] = nextDist;
        queue[qTail++] = v;
      }
    }
  }

  /**
   * Czy komórka `(cx,cy)` jest lokalnie "na otwartym" — zero litych komórek
   * w kwadracie o promieniu `OPEN_FIELD_RADIUS` wokół niej. WYŁĄCZNIE
   * geometryczny test, celowo NIEWYSTARCZAJĄCY sam w sobie (duży, ale w
   * pełni zamknięty pokój też by go przeszedł) — dlatego `recomputeShelterMap`
   * używa go tylko jako DODATKOWY warunek do przynależności do składowej
   * >= `exteriorMinCells`, nigdy samodzielnie.
   */
  private isOpenField(cx: number, cy: number, radius: number): boolean {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (this.cells[this.index(cx + dx, cy + dy)] === TILE_ROCK) return false;
      }
    }
    return true;
  }

  // ------------------------------------------------------------ linia wzroku

  /**
   * Czy odcinek OD `(x0,y0)` DO `(x0+dx, y0+dy)` przechodzi przez jakąkolwiek
   * litą komórkę — używane przez SensorSystem, żeby agent nie "widział"
   * przez ściany. `dx`/`dy` to już rozwiązany (najkrótszą drogą po torusie)
   * wektor przesunięcia — DOKŁADNIE to, co zwracają zapytania przestrzenne
   * (`SpatialGrid.forEachInRadius`), więc wywołujący nie musi nic dodatkowo
   * zawijać.
   *
   * Implementacja to standardowe przejście siatki (Amanatides–Woo/DDA):
   * odwiedza KAŻDĄ komórkę, przez którą faktycznie przechodzi odcinek, bez
   * ryzyka "przeskoczenia" cienkiej (1-komórkowej) ściany. Krok DOKŁADNIE
   * po przekątnej (przez sam róg dwóch litych komórek) traktujemy jako
   * zablokowany, jeśli KTÓRAKOLWIEK z tych dwóch komórek jest lita — to
   * samo ograniczenie, które fizycznie ma agent w `TerrainCollisionSystem`
   * (nie da się przecisnąć po przekątnej między dwiema litymi komórkami),
   * więc linia wzroku nie powinna "widzieć" tamtędy, mimo że sama w sobie
   * ma zerową szerokość.
   */
  hasLineOfSight(x0: number, y0: number, dx: number, dy: number): boolean {
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-9) return true;

    let cx = Math.floor(x0 / this.cellSize);
    let cy = Math.floor(y0 / this.cellSize);
    const endCx = Math.floor((x0 + dx) / this.cellSize);
    const endCy = Math.floor((y0 + dy) / this.cellSize);

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

    const tDeltaX = dx !== 0 ? Math.abs(this.cellSize / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(this.cellSize / dy) : Infinity;

    const nextBoundaryX = stepX > 0 ? (cx + 1) * this.cellSize : cx * this.cellSize;
    const nextBoundaryY = stepY > 0 ? (cy + 1) * this.cellSize : cy * this.cellSize;

    let tMaxX = dx !== 0 ? (nextBoundaryX - x0) / dx : Infinity;
    let tMaxY = dy !== 0 ? (nextBoundaryY - y0) / dy : Infinity;

    // Zabezpieczenie przed nieskończoną pętlą przy zdegenerowanych wejściach.
    const maxSteps = (Math.abs(cx - endCx) + Math.abs(cy - endCy) + 4) * 2;
    let steps = 0;

    while ((cx !== endCx || cy !== endCy) && steps < maxSteps) {
      steps++;
      if (Math.abs(tMaxX - tMaxY) < 1e-9) {
        if (this.isSolidCell(cx + stepX, cy) || this.isSolidCell(cx, cy + stepY)) return false;
        cx += stepX;
        cy += stepY;
        tMaxX += tDeltaX;
        tMaxY += tDeltaY;
      } else if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cy += stepY;
        tMaxY += tDeltaY;
      }
      if (this.isSolidCell(cx, cy)) return false;
    }
    return true;
  }
}
