import type { SimulationConfig } from '../../config/simulationConfig';
import type { Rng } from '../utils/rng';
import { clamp } from '../utils/math';

/** Statystyka mutacji z jednego aktu rozmnażania — zbierana przez StatisticsSystem. */
export interface MutationReport {
  pointMutations: number;
  swaps: number;
  bigMutations: number;
}

const GENE_LIMIT = 8;

/**
 * Kopiuje genom rodzica i nakłada mutacje.
 *
 * Cztery mechanizmy, zgodnie ze specyfikacją:
 *  1. drobna zmiana wagi         w += random(-delta, delta)
 *  2. szum gaussowski            rzadziej, większa amplituda
 *  3. zamiana dwóch genów        przetasowanie struktury
 *  4. duża mutacja               przepisanie fragmentu genomu od zera
 */
export function mutate(
  parent: Float32Array,
  config: SimulationConfig,
  rng: Rng,
  report: MutationReport,
): Float32Array {
  const child = new Float32Array(parent.length);
  child.set(parent);

  report.pointMutations = 0;
  report.swaps = 0;
  report.bigMutations = 0;

  // 1 + 2: mutacje punktowe
  for (let i = 0; i < child.length; i++) {
    if (!rng.chance(config.mutationChance)) continue;
    report.pointMutations++;
    // Co czwarta mutacja punktowa jest "szumem" o większej amplitudzie —
    // pozwala wyskoczyć z lokalnego optimum bez rozbijania całego genomu.
    if (rng.chance(0.25)) {
      child[i] = clamp(child[i] + rng.gaussian(0, config.mutationDelta * 3), -GENE_LIMIT, GENE_LIMIT);
    } else {
      child[i] = clamp(child[i] + rng.symmetric(config.mutationDelta), -GENE_LIMIT, GENE_LIMIT);
    }
  }

  // 3: zamiana dwóch genów miejscami
  if (rng.chance(config.swapMutationChance) && child.length > 1) {
    const a = rng.int(child.length);
    const b = rng.int(child.length);
    if (a !== b) {
      const tmp = child[a];
      child[a] = child[b];
      child[b] = tmp;
      report.swaps++;
    }
  }

  // 4: duża mutacja — losowy fragment genomu zostaje przepisany od nowa
  if (rng.chance(config.bigMutationChance)) {
    const span = Math.max(1, Math.floor(child.length * config.bigMutationSpan));
    const start = rng.int(Math.max(1, child.length - span));
    for (let i = start; i < start + span && i < child.length; i++) {
      child[i] = rng.gaussian(0, 0.8);
    }
    report.bigMutations++;
  }

  return child;
}

/**
 * Krzyżowanie jednopunktowe — nieużywane w M3 (rozmnażanie bezpłciowe),
 * gotowe pod rozmnażanie płciowe w kolejnych milestone'ach.
 */
export function crossover(a: Float32Array, b: Float32Array, rng: Rng): Float32Array {
  const n = Math.min(a.length, b.length);
  const cut = rng.int(n);
  const child = new Float32Array(n);
  for (let i = 0; i < n; i++) child[i] = i < cut ? a[i] : b[i];
  return child;
}

export function makeMutationReport(): MutationReport {
  return { pointMutations: 0, swaps: 0, bigMutations: 0 };
}
