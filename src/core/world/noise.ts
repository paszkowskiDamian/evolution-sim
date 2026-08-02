import { lerp } from '../utils/math';

/**
 * Szum wartości (value noise) 2D — deterministyczny, BEZ generatora stanu
 * (`Rng`): wartość w danym punkcie zależy WYŁĄCZNIE od współrzędnych i
 * jawnego `seed`, nie od tego, ile razy ktoś wcześniej odpytał funkcję.
 * To celowe — w przeciwieństwie do reszty świata (agenci, jedzenie), kształt
 * terenu jest odpytywany dla dowolnych, nieuporządkowanych punktów siatki
 * (pętle po `cx,cy`), więc "kolejny numer w strumieniu" nie ma tu sensu.
 * Zamiast tego każdy punkt siatki dostaje pseudolosową wartość z hasha
 * (liczb całkowitych współrzędnych + seed) — ten sam punkt zawsze daje tę
 * samą wartość, niezależnie od kolejności odpytywania.
 */

/** Hash liczb całkowitych -> [0, 1). Standardowa technika mieszania bitowego
 *  (podobna do tych używanych w szumie proceduralnym w shaderach) — szybka,
 *  bez alokacji, w pełni deterministyczna na dowolnej platformie JS. */
function hash2D(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Szum wartości w punkcie (x,y) — interpolacja (smoothstep) między 4
 *  rogami komórki siatki jednostkowej zawierającej ten punkt. Wynik [0,1). */
export function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const v00 = hash2D(ix, iy, seed);
  const v10 = hash2D(ix + 1, iy, seed);
  const v01 = hash2D(ix, iy + 1, seed);
  const v11 = hash2D(ix + 1, iy + 1, seed);

  const sx = smoothstep(fx);
  const sy = smoothstep(fy);
  const top = lerp(v00, v10, sx);
  const bottom = lerp(v01, v11, sx);
  return lerp(top, bottom, sy);
}

/**
 * Fraktalny szum (fBm — fractal Brownian motion): suma kilku oktaw
 * `valueNoise2D` o rosnącej częstotliwości i malejącej amplitudzie —
 * naturalny, "górzysty" wygląd (duże formy + drobny detal) zamiast
 * gładkiego pojedynczego szumu. Wynik znormalizowany do [0,1).
 */
export function fbm2D(
  x: number,
  y: number,
  seed: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let maxAmp = 0;
  for (let o = 0; o < octaves; o++) {
    // Każda oktawa dostaje swój WŁASNY seed (przesunięty o stałą) — bez tego
    // kolejne oktawy próbkowałyby DOKŁADNIE tę samą siatkę hasha w innej
    // skali, co tworzy widoczne, powtarzalne artefakty zamiast szumu.
    sum += valueNoise2D(x * frequency, y * frequency, seed + o * 101317) * amplitude;
    maxAmp += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return maxAmp > 0 ? sum / maxAmp : 0;
}
