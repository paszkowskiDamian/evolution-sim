import type { SimulationConfig } from '../../config/simulationConfig';
import type { Rng } from '../utils/rng';
import { geneToRange } from '../utils/math';
import { brainGeneCount, computeBrainLayout, INPUT_COUNT, type BrainShape } from '../neural/network';

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

/** Odchylenie standardowe biasów — bias nie ma "fan-inu", więc dostaje małą stałą wariancję. */
const BIAS_STDDEV = 0.2;

/**
 * Czysta wariancja 1/fan_in (poniżej) trzyma sygnał w "uporządkowanej"
 * fazie sieci tanh — dla płytkiej sieci to bez znaczenia, ale przy
 * dziesiątkach kolejno ułożonych warstw sygnał eksponencjalnie zanika do
 * STAŁEGO PUNKTU niezależnego od wejścia (matematycznie zmierzone: przy
 * gain=1 i głębokości 40 różnica wyjścia między skrajnie różnymi wejściami
 * spada do ~0.05 — sieć w praktyce nie widzi sensorów). Pomnożenie
 * odchylenia przez stały współczynnik >1 przesuwa sieć w fazę "chaotyczną",
 * w której wejście realnie wpływa na wyjście na całej głębokości 20-50
 * warstw, bez pełnego nasycenia do ±1. Wartość dobrana empirycznie
 * (patrz eksperyment w historii zmian) — to wciąż wyłącznie parametr
 * ROZKŁADU STARTOWEGO, żadnego uczenia gradientowego.
 */
const CHAOTIC_GAIN = 1.2;

/**
 * Losowy genom startowy.
 *
 * Wagi sieci są inicjalizowane z wariancją skalowaną przez fan-in bloku
 * (1/√fan_in — standardowa technika, tu wyłącznie dla RÓWNOWAGI SYGNAŁU,
 * bez żadnego uczenia gradientowego). Bez tego stałe odchylenie 0.8 na
 * każdej wadze, powielone przez dziesiątki kolejnych warstw tanh, nasyca
 * sieć do stałego ±1 już po pierwszej-drugiej warstwie — agent staje się
 * ślepy na sensory niezależnie od tego, co widzi.
 *
 * Skalowanie liczymy od RZECZYWISTEJ (zdekodowanej) szerokości warstwy
 * TEGO konkretnego genomu, nie od pojemności (`maxLayerWidth`). Dlatego
 * geny strukturalne losujemy NAJPIERW i dekodujemy od razu — użycie samej
 * pojemności zakładałoby, że każda warstwa jest maksymalnie szeroka, co
 * przy szerokościach losowanych bliżej środka zakresu systematycznie
 * ZANIŻA sygnał, a po dziesiątkach warstw głębokości gubi go całkowicie
 * (dokładnie ten sam objaw co nasycenie, tylko w drugą stronę).
 *
 * Geny biologiczne pozostają jednostajne w (-1, 1) — to nie są wagi sieci,
 * tylko wskaźniki dekodowane przez `geneToRange`.
 */
export function createRandomGenome(config: SimulationConfig, rng: Rng): Float32Array {
  const layout = computeBrainLayout(config);
  const brainGenes = brainGeneCount(config);
  const structGenes = structGeneCount(config);
  const genome = new Float32Array(brainGenes + structGenes + BIO_GENE_COUNT);
  const w = layout.capacityWidth;

  const fill = (start: number, end: number, stddev: number): void => {
    for (let i = start; i < end; i++) genome[i] = rng.gaussian(0, stddev);
  };
  const fanInStddev = (fanIn: number): number => CHAOTIC_GAIN / Math.sqrt(Math.max(1, fanIn));

  for (let i = 0; i < structGenes; i++) {
    genome[brainGenes + i] = rng.symmetric(1);
  }
  const shape = decodeBrainShape(genome, config);

  fill(layout.w1Offset, layout.b1Offset, fanInStddev(INPUT_COUNT)); // wejście -> warstwa 0
  fill(layout.b1Offset, layout.recOffset, BIAS_STDDEV); // bias warstwy 0
  fill(layout.recOffset, layout.recOffset + w * w, fanInStddev(shape.widths[0])); // rekurencja warstwy 0
  for (let k = 1; k < layout.maxLayers; k++) {
    // Blok k czyta z warstwy k-1, więc jego fan-in to RZECZYWISTA
    // szerokość warstwy k-1 — niezależnie od tego, czy warstwa k mieści
    // się w aktualnej głębokości tego agenta (jeśli kiedyś "aktywuje" ją
    // mutacja genu strukturalnego, ma dziedziczyć sensownie skalowane wagi).
    fill(layout.whOffset[k], layout.whOffset[k] + w * w, fanInStddev(shape.widths[k - 1]));
    fill(layout.bhOffset[k], layout.bhOffset[k] + w, BIAS_STDDEV);
  }
  // Wyjście czyta z OSTATNIEJ FAKTYCZNIE UŻYWANEJ warstwy (layerCount-1),
  // nie z ostatniego slotu pojemności — to jedyny blok, dla którego te
  // dwa mogą się różnić, gdy layerCount < maxHiddenLayers.
  fill(layout.w2Offset, layout.b2Offset, fanInStddev(shape.widths[shape.layerCount - 1]));
  fill(layout.b2Offset, brainGenes, BIAS_STDDEV); // bias wyjścia

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
