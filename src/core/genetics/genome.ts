import type { SimulationConfig } from '../../config/simulationConfig';
import type { Rng } from '../utils/rng';
import { geneToRange } from '../utils/math';
import { brainGeneCount, type BrainShape } from '../neural/network';

/**
 * Genom = jedna płaska tablica liczb (Float32Array).
 *
 * Układ:
 *   [0 .. brainGeneCount)                          — wagi i biasy sieci neuronowej (pojemność)
 *   [brainGeneCount .. +structGeneCount)            — geny strukturalne (kształt sieci)
 *   [+structGeneCount .. +BIO_GENE_COUNT)           — geny biologiczne
 *
 * Geny biologiczne i strukturalne trzymamy w tej samej tablicy celowo:
 * mutacja nie musi wiedzieć, co mutuje. Ewolucja może zmieniać ciało, mózg
 * i JEGO KSZTAŁT tym samym mechanizmem, a nowe cechy dodajemy przez
 * rozszerzenie tablicy.
 */

export const BIO_GENES = {
  size: 0, // promień ciała
  speed: 1, // maksymalna prędkość
  metabolism: 2, // mnożnik zużycia energii
  reproThreshold: 3, // próg energii do rozmnażania
  vision: 4, // zasięg widzenia
  hue: 5, // barwa (czysto fenotypowa, ale dziedziczna — widać linie rodowe)
  aggression: 6, // siła ataku — patrz AttackSystem
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
  maxHealth: number;
}

/** Liczba genów strukturalnych: 1 (liczba warstw) + 1 na każdy dopuszczalny slot warstwy. */
export function structGeneCount(config: SimulationConfig): number {
  return 1 + config.maxHiddenLayers;
}

export function structGeneOffset(config: SimulationConfig): number {
  return brainGeneCount(config);
}

export function genomeLength(config: SimulationConfig): number {
  return bioGeneOffset(config) + BIO_GENE_COUNT;
}

export function bioGeneOffset(config: SimulationConfig): number {
  return brainGeneCount(config) + structGeneCount(config);
}

/** Losowy genom startowy — wagi z rozkładu normalnego, geny strukturalne i bio jednostajnie. */
export function createRandomGenome(config: SimulationConfig, rng: Rng): Float32Array {
  const brainGenes = brainGeneCount(config);
  const structGenes = structGeneCount(config);
  const genome = new Float32Array(brainGenes + structGenes + BIO_GENE_COUNT);
  for (let i = 0; i < brainGenes; i++) {
    genome[i] = rng.gaussian(0, 0.8);
  }
  for (let i = 0; i < structGenes; i++) {
    genome[brainGenes + i] = rng.symmetric(1);
  }
  for (let i = 0; i < BIO_GENE_COUNT; i++) {
    genome[brainGenes + structGenes + i] = rng.symmetric(1);
  }
  return genome;
}

/**
 * Dekoduje geny strukturalne na konkretny kształt sieci (liczbę i szerokość
 * warstw ukrytych). Wywoływane WYŁĄCZNIE raz, przy narodzinach agenta —
 * nigdy w pętli ticka. To jedyne miejsce, w którym "gen strukturalny"
 * staje się realnym rozmiarem sieci.
 */
export function decodeBrainShape(genome: Float32Array, config: SimulationConfig): BrainShape {
  const o = structGeneOffset(config);
  const layerCount = Math.round(
    geneToRange(genome[o], config.minHiddenLayers, config.maxHiddenLayers),
  );
  const widths: number[] = [];
  for (let i = 0; i < config.maxHiddenLayers; i++) {
    widths.push(
      Math.round(geneToRange(genome[o + 1 + i], config.minLayerWidth, config.maxLayerWidth)),
    );
  }
  return { layerCount, widths };
}

/**
 * Dekoduje geny biologiczne na konkretne wartości fizyczne.
 * To jedyne miejsce, w którym "gen" staje się "cechą".
 */
export function decodePhenotype(genome: Float32Array, config: SimulationConfig): Phenotype {
  const o = bioGeneOffset(config);
  const radius = geneToRange(genome[o + BIO_GENES.size], config.agentRadiusMin, config.agentRadiusMax);
  const sizeFrac =
    config.agentRadiusMax > config.agentRadiusMin
      ? (radius - config.agentRadiusMin) / (config.agentRadiusMax - config.agentRadiusMin)
      : 0.5;
  return {
    radius,
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
    // Większe ciało = więcej wytrzymałości w walce — nie ma osobnego genu,
    // korzystamy wprost z już zdekodowanego promienia.
    maxHealth: config.baseMaxHealth * (0.5 + 0.5 * sizeFrac),
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
