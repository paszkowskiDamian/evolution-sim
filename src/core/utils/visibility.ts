import type { TerrainGrid } from '../world/terrain';

/**
 * Bufor kandydatów do zapytania "najbliższy WIDOCZNY X" (jedzenie, agent,
 * partner, luźny kamień — patrz SensorSystem).
 *
 * Zwykłe zapytanie "najbliższy" (jeden przebieg po siatce, śledzenie
 * minimum) nie wystarcza, gdy trzeba pomijać zasłonięte cele: jeśli
 * najbliższy obiekt jest za ścianą, trzeba sprawdzić KOLEJNEGO najbliższego,
 * a to wymaga dostępu do więcej niż jednego kandydata. Stąd dwuetapowo:
 * zbierz do `cap` najbliższych (bez zerowej alokacji w gorącej pętli —
 * typed arrays, reużywane między tickami), potem przejrzyj w kolejności
 * rosnącej odległości i zwróć pierwszego z czystą linią wzroku.
 */
export class VisibilityCandidates {
  private readonly cap: number;
  private readonly ids: Int32Array;
  private readonly dx: Float64Array;
  private readonly dy: Float64Array;
  private readonly dist2: Float64Array;
  private count = 0;

  constructor(cap = 16) {
    this.cap = cap;
    this.ids = new Int32Array(cap);
    this.dx = new Float64Array(cap);
    this.dy = new Float64Array(cap);
    this.dist2 = new Float64Array(cap);
  }

  reset(): void {
    this.count = 0;
  }

  /** Dodaje kandydata, utrzymując zawsze `cap` NAJBLIŻSZYCH widzianych do tej pory. */
  add(id: number, dx: number, dy: number, dist2: number): void {
    if (this.count < this.cap) {
      this.ids[this.count] = id;
      this.dx[this.count] = dx;
      this.dy[this.count] = dy;
      this.dist2[this.count] = dist2;
      this.count++;
      return;
    }
    let worst = 0;
    for (let i = 1; i < this.cap; i++) {
      if (this.dist2[i] > this.dist2[worst]) worst = i;
    }
    if (dist2 < this.dist2[worst]) {
      this.ids[worst] = id;
      this.dx[worst] = dx;
      this.dy[worst] = dy;
      this.dist2[worst] = dist2;
    }
  }

  /**
   * Najbliższy kandydat z czystą linią wzroku — przeszukuje w kolejności
   * rosnącej odległości, pomijając zasłoniętych. Zużywa wewnętrzny bufor
   * (oznacza sprawdzonych jako nieskończenie dalekich) — bezpieczne, bo
   * bufor i tak czyści się przez `reset()` przed kolejnym użyciem.
   */
  pickNearestVisible(
    terrain: TerrainGrid,
    ax: number,
    ay: number,
  ): { id: number; dx: number; dy: number; dist2: number } | null {
    for (let iter = 0; iter < this.count; iter++) {
      let best = -1;
      let bestDist2 = Infinity;
      for (let i = 0; i < this.count; i++) {
        if (this.dist2[i] < bestDist2) {
          bestDist2 = this.dist2[i];
          best = i;
        }
      }
      if (best === -1) return null;
      const id = this.ids[best];
      const dx = this.dx[best];
      const dy = this.dy[best];
      this.dist2[best] = Infinity; // "zużyty" — pomiń w kolejnej iteracji
      if (terrain.hasLineOfSight(ax, ay, dx, dy)) {
        return { id, dx, dy, dist2: bestDist2 };
      }
    }
    return null;
  }
}

/**
 * Wariant `VisibilityCandidates` dla sensora sygnału (patrz SensorSystem):
 * zamiast "najbliższy widoczny" liczy się "najgłośniej SŁYSZANY widoczny" —
 * ranking po SCORE (głośność nadawcy * bliskość), nie po samym dystansie,
 * bo cichy nadawca tuż obok i głośny z daleka mogą wygrać zależnie od obu
 * czynników naraz. Ten sam dwuetapowy trik co przy dystansie: trzymaj top-K
 * po score, potem przejrzyj malejąco i zwróć pierwszego z czystą linią
 * wzroku (ściana tłumi sygnał tak samo jak zasłania widok — uproszczenie,
 * nie akustyka, ale spójne z resztą sensorów w tym pliku).
 */
export class SignalCandidates {
  private readonly cap: number;
  private readonly ids: Int32Array;
  private readonly dx: Float64Array;
  private readonly dy: Float64Array;
  private readonly dist2: Float64Array;
  private readonly score: Float64Array;
  private count = 0;

  constructor(cap = 8) {
    this.cap = cap;
    this.ids = new Int32Array(cap);
    this.dx = new Float64Array(cap);
    this.dy = new Float64Array(cap);
    this.dist2 = new Float64Array(cap);
    this.score = new Float64Array(cap);
  }

  reset(): void {
    this.count = 0;
  }

  /** Cisza (score <= 0) się nie liczy — nie ma sensu trzymać ją w buforze. */
  add(id: number, dx: number, dy: number, dist2: number, score: number): void {
    if (score <= 0) return;
    if (this.count < this.cap) {
      this.ids[this.count] = id;
      this.dx[this.count] = dx;
      this.dy[this.count] = dy;
      this.dist2[this.count] = dist2;
      this.score[this.count] = score;
      this.count++;
      return;
    }
    let worst = 0;
    for (let i = 1; i < this.cap; i++) {
      if (this.score[i] < this.score[worst]) worst = i;
    }
    if (score > this.score[worst]) {
      this.ids[worst] = id;
      this.dx[worst] = dx;
      this.dy[worst] = dy;
      this.dist2[worst] = dist2;
      this.score[worst] = score;
    }
  }

  pickLoudestVisible(
    terrain: TerrainGrid,
    ax: number,
    ay: number,
  ): { id: number; dx: number; dy: number; dist2: number; score: number } | null {
    for (let iter = 0; iter < this.count; iter++) {
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < this.count; i++) {
        if (this.score[i] > bestScore) {
          bestScore = this.score[i];
          best = i;
        }
      }
      if (best === -1) return null;
      const id = this.ids[best];
      const dx = this.dx[best];
      const dy = this.dy[best];
      const dist2 = this.dist2[best];
      this.score[best] = -Infinity; // "zużyty" — pomiń w kolejnej iteracji
      if (terrain.hasLineOfSight(ax, ay, dx, dy)) {
        return { id, dx, dy, dist2, score: bestScore };
      }
    }
    return null;
  }
}
