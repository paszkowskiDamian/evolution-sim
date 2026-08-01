/**
 * Deterministyczny generator liczb pseudolosowych (mulberry32).
 *
 * Cała symulacja korzysta WYŁĄCZNIE z tego generatora — nigdzie w `core/`
 * nie wolno użyć `Math.random()`. Dzięki temu ten sam seed + ta sama
 * konfiguracja zawsze dają identyczny przebieg.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = 0;
    this.reseed(seed);
  }

  /** Ustawia generator w stan startowy dla danego seeda. */
  reseed(seed: number): void {
    // Rozprowadzamy seed, żeby małe wartości (0, 1, 2) nie dawały
    // skorelowanych pierwszych próbek.
    this.state = (seed >>> 0) || 0x9e3779b9;
    for (let i = 0; i < 8; i++) this.next();
  }

  /** Surowy krok generatora — zwraca liczbę z [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Liczba z przedziału [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Liczba z przedziału [-a, a). */
  symmetric(a: number): number {
    return (this.next() * 2 - 1) * a;
  }

  /** Liczba całkowita z [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n) % Math.max(1, n);
  }

  /** Test prawdopodobieństwa. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Rozkład normalny (Box–Muller, bez cache'owania drugiej próbki,
   *  żeby liczba wywołań `next()` była przewidywalna). */
  gaussian(mean = 0, stdDev = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Snapshot stanu — pozwala zapisać/odtworzyć przebieg symulacji. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
