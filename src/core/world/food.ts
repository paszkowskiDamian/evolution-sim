/**
 * Pole pożywienia.
 *
 * Trzymane w typed arrays ze stałą pojemnością i stosem wolnych slotów —
 * dodanie i usunięcie jednostki jedzenia to O(1) bez alokacji i bez
 * przesuwania tablic. Identyfikator jedzenia = indeks slotu.
 */
export const FOOD_NORMAL = 0;
export const FOOD_COOPERATIVE = 1;
export type FoodKind = typeof FOOD_NORMAL | typeof FOOD_COOPERATIVE;

export class FoodField {
  readonly capacity: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly alive: Uint8Array;
  /** Rodzaj zasobu: zwykły albo wymagający wspólnej pracy. */
  readonly kind: Uint8Array;
  /** Liczba kolejnych ticków, przez które wymagani współpracownicy działali razem. */
  readonly cooperationProgress: Uint16Array;
  private freeSlots: Int32Array;
  private freeCount: number;
  private _count = 0;
  private _normalCount = 0;
  private _cooperativeCount = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.cooperationProgress = new Uint16Array(capacity);
    this.freeSlots = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.freeSlots[i] = capacity - 1 - i;
    this.freeCount = capacity;
  }

  get count(): number {
    return this._count;
  }

  get isFull(): boolean {
    return this.freeCount === 0;
  }

  get normalCount(): number {
    return this._normalCount;
  }

  get cooperativeCount(): number {
    return this._cooperativeCount;
  }

  spawn(x: number, y: number, kind: FoodKind = FOOD_NORMAL): number {
    if (this.freeCount === 0) return -1;
    const slot = this.freeSlots[--this.freeCount];
    this.xs[slot] = x;
    this.ys[slot] = y;
    this.alive[slot] = 1;
    this.kind[slot] = kind;
    this.cooperationProgress[slot] = 0;
    this._count++;
    if (kind === FOOD_COOPERATIVE) this._cooperativeCount++;
    else this._normalCount++;
    return slot;
  }

  remove(id: number): void {
    if (id < 0 || id >= this.capacity || this.alive[id] === 0) return;
    if (this.kind[id] === FOOD_COOPERATIVE) this._cooperativeCount--;
    else this._normalCount--;
    this.alive[id] = 0;
    this.kind[id] = FOOD_NORMAL;
    this.cooperationProgress[id] = 0;
    this.freeSlots[this.freeCount++] = id;
    this._count--;
  }

  clear(): void {
    this.alive.fill(0);
    this.kind.fill(FOOD_NORMAL);
    this.cooperationProgress.fill(0);
    for (let i = 0; i < this.capacity; i++) this.freeSlots[i] = this.capacity - 1 - i;
    this.freeCount = this.capacity;
    this._count = 0;
    this._normalCount = 0;
    this._cooperativeCount = 0;
  }
}
