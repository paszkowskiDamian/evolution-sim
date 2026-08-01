import type { SimulationConfig } from '../../config/simulationConfig';
import type { Rng } from '../utils/rng';
import { geneToRange } from '../utils/math';
import { brainGeneCount } from '../neural/network';

/**
 * Genom = jedna płaska tablica liczb (Float32Array).
 *
 * Układ:
 *   [0 .. brainGeneCount)                  — wagi i biasy sieci neuronowej
 *   [brainGeneCount .. +BIO_GENE_COUNT)    — geny biologiczne
 *
 * Geny biologiczne trzymamy w tej samej tablicy celowo: mutacja nie musi
 * wiedzieć, co mutuje. Ewolucja może zmieniać ciało i mózg tym samym
 * mechanizmem, a nowe cechy dodajemy przez rozszerzenie tablicy.
 */

export const BIO_GENES = {
  size: 0, // promień ciała
  speed: 1, // maksymalna prędkość
  metabolism: 2, // mnożnik zużycia energii
  reproThreshold: 3, // próg energii do rozmnażania
  vision: 4, // zasięg widzenia
  hue: 5, // barwa (czysto fenotypowa, ale dziedziczna — widać linie rodowe)
  aggression: 6, // rezerwa pod M5/M6 (drapieżnictwo, rywalizacja)
} as const;

export const BIO_GENE_COUNT = 7;

export interface Phenotype {
  radius: number;
  maxSpeed: number;
  metabolism: number;
  reproThreshold: number;
  visionRadius: number;
  hue: number;
  aggression: number;
}

export function genomeLength(config: SimulationConfig): number {
  return brainGeneCount(config.hiddenNeurons) + BIO_GENE_COUNT;
}

export function bioGeneOffset(config: SimulationConfig): number {
  return brainGeneCount(config.hiddenNeurons);
}

/** Losowy genom startowy — wagi z rozkładu normalnego, geny bio jednostajnie. */
export function createRandomGenome(config: SimulationConfig, rng: Rng): Float32Array {
  const brainGenes = brainGeneCount(config.hiddenNeurons);
  const genome = new Float32Array(brainGenes + BIO_GENE_COUNT);
  for (let i = 0; i < brainGenes; i++) {
    genome[i] = rng.gaussian(0, 0.8);
  }
  for (let i = 0; i < BIO_GENE_COUNT; i++) {
    genome[brainGenes + i] = rng.symmetric(1);
  }
  return genome;
}

/**
 * Dekoduje geny biologiczne na konkretne wartości fizyczne.
 * To jedyne miejsce, w którym "gen" staje się "cechą".
 */
export function decodePhenotype(genome: Float32Array, config: SimulationConfig): Phenotype {
  const o = bioGeneOffset(config);
  return {
    radius: geneToRange(genome[o + BIO_GENES.size], config.agentRadiusMin, config.agentRadiusMax),
    maxSpeed: geneToRange(genome[o + BIO_GENES.speed], config.maxSpeed * 0.45, config.maxSpeed),
    metabolism: geneToRange(genome[o + BIO_GENES.metabolism], 0.7, 1.6),
    reproThreshold: geneToRange(
      genome[o + BIO_GENES.reproThreshold],
      config.reproductionEnergyThreshold * 0.75,
      Math.min(0.97, config.reproductionEnergyThreshold * 1.35),
    ),
    visionRadius: geneToRange(
      genome[o + BIO_GENES.vision],
      config.visionRadius * 0.4,
      config.visionRadius,
    ),
    // Barwa omija zakres zieleni (0.25–0.5), zarezerwowany dla jedzenia —
    // inaczej przy oddaleniu nie da się odróżnić agenta od pokarmu.
    hue: (0.5 + geneToRange(genome[o + BIO_GENES.hue], 0, 0.75)) % 1,
    aggression: geneToRange(genome[o + BIO_GENES.aggression], 0, 1),
  };
}

/**
 * Dystans genetyczny (średnia różnica bezwzględna) — używany do pomiaru
 * różnorodności populacji. Nie wpływa na mechanikę symulacji.
 */
export function genomeDistance(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}
