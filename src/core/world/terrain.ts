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

  constructor(worldSize: number, cellSize: number) {
    this.worldSize = worldSize;
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.round(worldSize / cellSize));
    this.cells = new Uint8Array(this.cols * this.cols);
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
  }

  isSolidCell(cx: number, cy: number): boolean {
    return this.get(cx, cy) === TILE_ROCK;
  }

  isSolidAt(worldX: number, worldY: number): boolean {
    return this.isSolidCell(this.cellX(worldX), this.cellY(worldY));
  }

  clear(): void {
    this.cells.fill(TILE_EMPTY);
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
}
