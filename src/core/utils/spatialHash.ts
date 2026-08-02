import { wrapDelta } from './math';

/**
 * Siatka przestrzenna oparta o listy jednokierunkowe w typed arrays.
 *
 * Zero alokacji w pętli ticka: bufory rosną tylko wtedy, gdy populacja
 * przekroczy dotychczasową pojemność. Wyszukiwanie sąsiadów jest O(k)
 * zamiast O(n), co jest jedyną rzeczą, która pozwala utrzymać tysiące
 * agentów i jedzenia przy 60 FPS.
 *
 * Siatka zna pojęcie świata zawijanego (torus) — zapytania na krawędzi
 * poprawnie widzą obiekty po drugiej stronie mapy.
 */
export class SpatialGrid {
  readonly cellSize: number;
  readonly cols: number;
  private readonly worldSize: number;
  private readonly wrapEdges: boolean;

  private head: Int32Array;
  private next: Int32Array;
  private xs: Float64Array;
  private ys: Float64Array;
  private ids: Int32Array;
  private count = 0;

  constructor(worldSize: number, cellSize: number, wrapEdges: boolean, capacity = 1024) {
    this.worldSize = worldSize;
    this.wrapEdges = wrapEdges;
    this.cols = Math.max(1, Math.ceil(worldSize / cellSize));
    this.cellSize = worldSize / this.cols;
    this.head = new Int32Array(this.cols * this.cols).fill(-1);
    this.next = new Int32Array(capacity);
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
    this.ids = new Int32Array(capacity);
  }

  private grow(needed: number): void {
    let cap = this.next.length;
    while (cap < needed) cap *= 2;
    const next = new Int32Array(cap);
    next.set(this.next);
    const xs = new Float64Array(cap);
    xs.set(this.xs);
    const ys = new Float64Array(cap);
    ys.set(this.ys);
    const ids = new Int32Array(cap);
    ids.set(this.ids);
    this.next = next;
    this.xs = xs;
    this.ys = ys;
    this.ids = ids;
  }

  clear(): void {
    this.head.fill(-1);
    this.count = 0;
  }

  private cellIndex(x: number, y: number): number {
    let cx = Math.floor(x / this.cellSize);
    let cy = Math.floor(y / this.cellSize);
    cx = ((cx % this.cols) + this.cols) % this.cols;
    cy = ((cy % this.cols) + this.cols) % this.cols;
    return cy * this.cols + cx;
  }

  insert(id: number, x: number, y: number): void {
    if (this.count + 1 > this.next.length) this.grow(this.count + 1);
    const slot = this.count++;
    this.xs[slot] = x;
    this.ys[slot] = y;
    this.ids[slot] = id;
    const cell = this.cellIndex(x, y);
    this.next[slot] = this.head[cell];
    this.head[cell] = slot;
  }

  /**
   * Iteruje po wszystkich obiektach w promieniu.
   * `dx`/`dy` to wektor OD punktu zapytania DO obiektu (już zawinięty).
   * Zwrócenie `false` z callbacka przerywa iterację.
   */
  forEachInRadius(
    x: number,
    y: number,
    radius: number,
    cb: (id: number, dx: number, dy: number, dist2: number) => boolean | void,
  ): void {
    const r2 = radius * radius;
    const reach = Math.ceil(radius / this.cellSize);
    const baseCx = Math.floor(x / this.cellSize);
    const baseCy = Math.floor(y / this.cellSize);
    const size = this.worldSize;

    for (let oy = -reach; oy <= reach; oy++) {
      let cy = baseCy + oy;
      if (this.wrapEdges) {
        cy = ((cy % this.cols) + this.cols) % this.cols;
      } else if (cy < 0 || cy >= this.cols) {
        continue;
      }
      for (let ox = -reach; ox <= reach; ox++) {
        let cx = baseCx + ox;
        if (this.wrapEdges) {
          cx = ((cx % this.cols) + this.cols) % this.cols;
        } else if (cx < 0 || cx >= this.cols) {
          continue;
        }
        let slot = this.head[cy * this.cols + cx];
        while (slot !== -1) {
          let dx = this.xs[slot] - x;
          let dy = this.ys[slot] - y;
          if (this.wrapEdges) {
            dx = wrapDelta(dx, size);
            dy = wrapDelta(dy, size);
          }
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            if (cb(this.ids[slot], dx, dy, d2) === false) return;
          }
          slot = this.next[slot];
        }
      }
    }
  }
}
