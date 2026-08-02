/**
 * Typ przedmiotu w EKWIPUNKU agenta (Agent.carriedItems) — nie w tym
 * polu. Kamienie fizycznie żyją w `ItemField` (ta klasa), jedzenie
 * w `FoodField` — to dwa osobne pola, bo mają zupełnie inną semantykę
 * (kamień jest bryłą, jedzenie samo znika przy dotyku). Wspólny jest
 * wyłącznie wielosłotowy ekwipunek: CarrySystem umie podnieść i odłożyć
 * OBA typy tym samym mechanizmem, więc obie stałe żyją razem tutaj.
 */
export const ROCK_TYPE = 0;
export const FOOD_TYPE = 1;

/**
 * Pole przenoszalnych przedmiotów (kamienie i przyszłe warianty).
 *
 * Ta sama konstrukcja co `FoodField`: typed arrays o stałej pojemności
 * + stos wolnych slotów — dodanie i usunięcie przedmiotu to O(1) bez
 * alokacji i bez przesuwania tablic. Identyfikator przedmiotu = indeks
 * slotu.
 */
export class ItemField {
  readonly capacity: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly alive: Uint8Array;
  readonly itemType: Uint8Array;
  private freeSlots: Int32Array;
  private freeCount: number;
  private _count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.itemType = new Uint8Array(capacity);
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

  spawn(x: number, y: number, type: number = ROCK_TYPE): number {
    if (this.freeCount === 0) return -1;
    const slot = this.freeSlots[--this.freeCount];
    this.xs[slot] = x;
    this.ys[slot] = y;
    this.alive[slot] = 1;
    this.itemType[slot] = type;
    this._count++;
    return slot;
  }

  remove(id: number): void {
    if (id < 0 || id >= this.capacity || this.alive[id] === 0) return;
    this.alive[id] = 0;
    this.freeSlots[this.freeCount++] = id;
    this._count--;
  }

  clear(): void {
    this.alive.fill(0);
    for (let i = 0; i < this.capacity; i++) this.freeSlots[i] = this.capacity - 1 - i;
    this.freeCount = this.capacity;
    this._count = 0;
  }
}
