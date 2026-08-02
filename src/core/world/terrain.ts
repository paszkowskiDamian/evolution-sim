import { wrap, wrapDelta } from '../utils/math';

/** Pusta komórka — agent porusza się przez nią swobodnie. */
export const TILE_EMPTY = 0;
/** Lita skała — nieprzepuszczalna przeszkoda (patrz TerrainCollisionSystem). */
export const TILE_ROCK = 1;

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
   * Mapa "schronienia" (patrz `isShelterAt`) — 1 = pusta komórka należąca do
   * MAŁEGO otoczonego kieszonki (jaskinia, zbudowane pomieszczenie...),
   * 0 = lita komórka LUB pusta komórka będąca częścią wielkiego, otwartego
   * świata. Przeliczana leniwie (`ensureShelterMap`), unieważniana przy
   * każdej zmianie terenu (`set`) — kopanie i budowanie mogą zarówno
   * scalić kieszonkę ze światem zewnętrznym, jak i odciąć nowy fragment.
   */
  private shelterCells: Uint8Array | null = null;
  private shelterDirty = true;
  private shelterMaxCells = -1;
  private readonly shelterVisited: Uint8Array;
  private readonly shelterStack: Int32Array;
  private readonly shelterComponent: Int32Array;

  constructor(worldSize: number, cellSize: number) {
    this.worldSize = worldSize;
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.round(worldSize / cellSize));
    this.cells = new Uint8Array(this.cols * this.cols);
    const n = this.cols * this.cols;
    this.shelterVisited = new Uint8Array(n);
    this.shelterStack = new Int32Array(n);
    this.shelterComponent = new Int32Array(n);
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
   * Wypełnia pierścień (annulus) wokół `(cx,cy)` — używane do rzeźbienia
   * gór. Próbkuje środek KAŻDEJ komórki w kwadracie opisanym na promieniu
   * zewnętrznym (systematyczne wypełnienie, nie losowe próbkowanie punktów)
   * — dlatego wynikowy pierścień jest z definicji szczelny, bez dziur.
   */
  carveRing(centerX: number, centerY: number, innerRadius: number, outerRadius: number): void {
    const inner2 = innerRadius * innerRadius;
    const outer2 = outerRadius * outerRadius;
    const reach = Math.ceil(outerRadius / this.cellSize) + 1;
    const baseCx = Math.floor(centerX / this.cellSize);
    const baseCy = Math.floor(centerY / this.cellSize);

    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        const cx = baseCx + ox;
        const cy = baseCy + oy;
        const { x, y } = this.cellCenter(cx, cy);
        const dx = wrapDelta(x - centerX, this.worldSize);
        const dy = wrapDelta(y - centerY, this.worldSize);
        const d2 = dx * dx + dy * dy;
        if (d2 >= inner2 && d2 <= outer2) {
          this.set(cx, cy, TILE_ROCK);
        }
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
   * Czy `(x,y)` leży w PUSTEJ komórce należącej do małej, otoczonej ze
   * wszystkich stron kieszonki (jaskinia górska, zbudowane pomieszczenie —
   * cokolwiek, bez rozróżniania "naturalne" od "zbudowane") — używane przez
   * EnergySystem do biernej korzyści ze schronienia.
   *
   * Definicja jest topologiczna, nie geometryczna: liczymy SPÓJNE SKŁADOWE
   * pustych komórek (4-sąsiedztwo) i każdą składową mniejszą niż
   * `maxCells` uznajemy za "wnętrze"; ogromna spójna składowa obejmująca
   * większość mapy to po prostu otwarty świat. To działa jednakowo dla
   * naturalnych jaskiń i dowolnej struktury dobudowanej przez agentów —
   * nie ma specjalnego przypadku dla gór.
   */
  isShelterAt(x: number, y: number, maxCells: number): boolean {
    this.ensureShelterMap(maxCells);
    return this.shelterCells![this.index(this.cellX(x), this.cellY(y))] === 1;
  }

  /** Surowa mapa schronienia (1 = wnętrze) — do wgrania na GPU (GpuEnergySystem). */
  getShelterCells(maxCells: number): Uint8Array {
    this.ensureShelterMap(maxCells);
    return this.shelterCells!;
  }

  private ensureShelterMap(maxCells: number): void {
    if (!this.shelterDirty && this.shelterMaxCells === maxCells && this.shelterCells) return;
    this.recomputeShelterMap(maxCells);
    this.shelterDirty = false;
    this.shelterMaxCells = maxCells;
  }

  /**
   * Przeliczenie PEŁNEJ mapy — O(liczba komórek), ale wywoływane tylko gdy
   * teren faktycznie się zmienił (kopanie/budowanie), nie co tick. Prostsze
   * i bezpieczniejsze niż przyrostowe utrzymywanie spójnych składowych
   * (usunięcie komórki może ROZDZIELIĆ składową na kilka — to wymagałoby
   * pełnego przeszukania i tak), a kopanie/budowanie są rzadkie względem
   * liczby ticków.
   */
  private recomputeShelterMap(maxCells: number): void {
    const n = this.cells.length;
    if (!this.shelterCells || this.shelterCells.length !== n) {
      this.shelterCells = new Uint8Array(n);
    } else {
      this.shelterCells.fill(0);
    }
    const visited = this.shelterVisited;
    visited.fill(0);
    const stack = this.shelterStack;
    const component = this.shelterComponent;

    for (let start = 0; start < n; start++) {
      if (visited[start] || this.cells[start] === TILE_ROCK) continue;

      let stackLen = 0;
      let compLen = 0;
      visited[start] = 1;
      stack[stackLen++] = start;

      while (stackLen > 0) {
        const i = stack[--stackLen];
        component[compLen++] = i;
        const cy = Math.floor(i / this.cols);
        const cx = i % this.cols;
        const neighbors = [
          this.index(cx + 1, cy),
          this.index(cx - 1, cy),
          this.index(cx, cy + 1),
          this.index(cx, cy - 1),
        ];
        for (const nb of neighbors) {
          if (visited[nb] || this.cells[nb] === TILE_ROCK) continue;
          visited[nb] = 1;
          stack[stackLen++] = nb;
        }
      }

      if (compLen < maxCells) {
        for (let i = 0; i < compLen; i++) this.shelterCells[component[i]] = 1;
      }
    }
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
