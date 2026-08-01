export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Normalizuje kąt do przedziału (-PI, PI]. */
export function normalizeAngle(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x <= -Math.PI) x += TAU;
  return x;
}

/** Zawija współrzędną do świata-torusa o boku `size`. */
export function wrap(v: number, size: number): number {
  let x = v % size;
  if (x < 0) x += size;
  return x;
}

/**
 * Najkrótsza różnica na osi w świecie zawijanym (torus).
 * Zwraca wartość w przedziale [-size/2, size/2].
 */
export function wrapDelta(d: number, size: number): number {
  const half = size * 0.5;
  if (d > half) return d - size;
  if (d < -half) return d + size;
  return d;
}

export function tanh(x: number): number {
  // Math.tanh jest wystarczająco szybki i stabilny numerycznie,
  // ale przycinamy wejście żeby uniknąć NaN przy zdegenerowanych genomach.
  if (x > 20) return 1;
  if (x < -20) return -1;
  return Math.tanh(x);
}

/** Mapuje gen z (-1, 1) na przedział [min, max]. */
export function geneToRange(gene: number, min: number, max: number): number {
  return min + ((clamp(gene, -1, 1) + 1) * 0.5) * (max - min);
}

/** Konwersja HSL -> 24-bitowy kolor RGB (dla Pixi tint). */
export function hslToRgb(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const r = Math.round(clamp(f(0), 0, 1) * 255);
  const g = Math.round(clamp(f(8), 0, 1) * 255);
  const b = Math.round(clamp(f(4), 0, 1) * 255);
  return (r << 16) | (g << 8) | b;
}
