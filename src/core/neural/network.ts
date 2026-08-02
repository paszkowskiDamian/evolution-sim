import { tanh } from '../utils/math';
import type { SimulationConfig } from '../../config/simulationConfig';

/**
 * Sieć neuronowa agenta.
 *
 * Topologia (liczba i szerokość warstw ukrytych) różni się między
 * osobnikami — to geny — ale POJEMNOŚĆ genomu jest stała dla całej
 * populacji (patrz `brainGeneCount`), więc mutacja/dystans genetyczny nie
 * muszą nic wiedzieć o kształcie konkretnej sieci.
 *
 * Pierwsza warstwa ukryta jest rekurencyjna: jej aktywacja z poprzedniego
 * ticka wraca na wejście tej samej warstwy. To JEDYNY mechanizm pamięci —
 * NIE MA tu uczenia gradientowego ani żadnej struktury "planu". Wagi
 * rekurencyjne pochodzą z genomu i zmieniają się wyłącznie przez mutacje
 * i dobór naturalny, więc to, co sieć "zapamiętuje" (jeśli cokolwiek),
 * jest w całości emergentne.
 *
 * Sieć nie alokuje pamięci przy forward passie: bufory aktywacji są
 * tworzone raz w konstruktorze (kształt jest ustalony na całe życie
 * agenta) i później tylko nadpisywane.
 */

export const SENSOR_LABELS = [
  'bias',
  'energia',
  'wiek',
  'prędkość',
  'sin(kąt→jedzenie)',
  'cos(kąt→jedzenie)',
  'bliskość jedzenia',
  'sin(kąt→agent)',
  'cos(kąt→agent)',
  'bliskość agenta',
  'zagęszczenie',
  'szum',
  'niosę',
  'sin(kąt→kamień)',
  'cos(kąt→kamień)',
  'bliskość kamienia',
  'zdrowie',
  'płeć',
  'sin(kąt→partner)',
  'cos(kąt→partner)',
  'bliskość partnera',
] as const;

export const OUTPUT_LABELS = ['obrót', 'ruch', 'chęć rozmnażania', 'chwyć/upuść', 'atak'] as const;

export const INPUT_COUNT = SENSOR_LABELS.length; // 17
export const OUTPUT_COUNT = OUTPUT_LABELS.length; // 5

/** Zdekodowany kształt sieci danego agenta — patrz `decodeBrainShape` w genetics/genome.ts. */
export interface BrainShape {
  layerCount: number;
  widths: number[];
}

/**
 * Odsetki bloków wag w genomie — liczone WYŁĄCZNIE z configu
 * (`maxHiddenLayers`/`maxLayerWidth`), identyczne dla każdego agenta bez
 * względu na jego zdekodowany kształt. To jest sedno "genomu
 * pojemnościowego": agent czyta tylko podprostokąt [0..widths[l]) każdego
 * zarezerwowanego bloku.
 *
 * Współdzielone przez `NeuralNetwork` (odczyt wag) i `createRandomGenome`
 * (inicjalizacja) — jedno źródło prawdy, żeby te dwa miejsca nigdy się
 * nie rozjechały.
 */
export interface BrainLayout {
  /** Pojemnościowa szerokość warstwy (stride w genomie) — z configu. */
  capacityWidth: number;
  maxLayers: number;
  w1Offset: number;
  b1Offset: number;
  recOffset: number;
  /** Indeksowane od 1 (warstwa 0 nie ma "wejścia z poprzedniej warstwy"). */
  whOffset: number[];
  bhOffset: number[];
  w2Offset: number;
  b2Offset: number;
}

export function computeBrainLayout(config: SimulationConfig): BrainLayout {
  const w = config.maxLayerWidth;
  const maxLayers = config.maxHiddenLayers;

  const w1Offset = 0;
  const b1Offset = w1Offset + INPUT_COUNT * w;
  const recOffset = b1Offset + w;
  const whOffset: number[] = [];
  const bhOffset: number[] = [];
  let cursor = recOffset + w * w;
  for (let k = 1; k < maxLayers; k++) {
    whOffset[k] = cursor;
    bhOffset[k] = cursor + w * w;
    cursor += w * w + w;
  }
  const w2Offset = cursor;
  const b2Offset = w2Offset + w * OUTPUT_COUNT;

  return { capacityWidth: w, maxLayers, w1Offset, b1Offset, recOffset, whOffset, bhOffset, w2Offset, b2Offset };
}

/**
 * Rozmiar sekcji genomu zarezerwowanej na mózg — to POJEMNOŚĆ, nie rozmiar
 * faktycznie używany przez danego agenta. Dzięki temu długość genomu jest
 * identyczna w całej populacji niezależnie od tego, jaki kształt sieci
 * wylosował konkretny osobnik — niewykorzystana pojemność to po prostu
 * "nieaktywne DNA": wciąż mutowane, gotowe zostać "włączone" przez geny
 * strukturalne.
 */
export function brainGeneCount(config: SimulationConfig): number {
  return computeBrainLayout(config).b2Offset + OUTPUT_COUNT;
}

/**
 * Pojemność mózgu "odniesienia" (sieć jednowarstwowa o `defaultLayerWidth`,
 * BEZ rekurencji) — punkt odniesienia do kalibracji kosztu energetycznego,
 * żeby koszt mózgu nie zależał wyłącznie od pojemności genomu.
 */
export function referenceBrainComplexity(config: SimulationConfig): number {
  const w = config.defaultLayerWidth;
  return INPUT_COUNT * w + w + w * OUTPUT_COUNT + OUTPUT_COUNT;
}

export class NeuralNetwork {
  /** Szerokość warstwy 0 — tyle floatów potrzebuje bufor pamięci agenta. */
  readonly recurrentWidth: number;
  /** Faktyczna (nie pojemnościowa) liczba wag tej sieci — koszt energii. */
  readonly complexity: number;

  /** Widok na fragment genomu — sieć NIE kopiuje wag. */
  private readonly genes: Float32Array;
  private readonly widths: number[];
  private readonly layerCount: number;
  /** Pojemnościowa szerokość warstwy (stride w genomie) — z configu. */
  private readonly capacityWidth: number;
  private readonly layerActs: Float32Array[];
  readonly outputs: Float32Array;

  private readonly w1Offset: number;
  private readonly b1Offset: number;
  private readonly recOffset: number;
  private readonly whOffset: number[];
  private readonly bhOffset: number[];
  private readonly w2Offset: number;
  private readonly b2Offset: number;

  constructor(genes: Float32Array, config: SimulationConfig, shape: BrainShape) {
    this.genes = genes;
    this.widths = shape.widths.slice(0, shape.layerCount);
    this.layerCount = shape.layerCount;
    this.capacityWidth = config.maxLayerWidth;
    this.outputs = new Float32Array(OUTPUT_COUNT);
    this.layerActs = this.widths.map((w) => new Float32Array(w));
    this.recurrentWidth = this.widths[0];

    const layout = computeBrainLayout(config);
    this.w1Offset = layout.w1Offset;
    this.b1Offset = layout.b1Offset;
    this.recOffset = layout.recOffset;
    this.whOffset = layout.whOffset;
    this.bhOffset = layout.bhOffset;
    this.w2Offset = layout.w2Offset;
    this.b2Offset = layout.b2Offset;

    // Faktyczna (nie pojemnościowa) liczba wag — do kosztu energii w EnergySystem.
    let complexity = INPUT_COUNT * this.widths[0] + this.widths[0] + this.widths[0] * this.widths[0];
    for (let l = 1; l < this.layerCount; l++) {
      complexity += this.widths[l - 1] * this.widths[l] + this.widths[l];
    }
    complexity += this.widths[this.layerCount - 1] * OUTPUT_COUNT + OUTPUT_COUNT;
    this.complexity = complexity;
  }

  /**
   * Forward pass. `inputs` musi mieć długość INPUT_COUNT.
   * `hiddenState` to bufor pamięci agenta (długość `recurrentWidth`) —
   * czytany w całości jako h(t-1) PRZED nadpisaniem, żeby żaden neuron
   * nie zobaczył częściowo już zaktualizowanego stanu.
   */
  forward(inputs: Float32Array, hiddenState: Float32Array): Float32Array {
    const g = this.genes;
    const cw = this.capacityWidth;
    const w0 = this.widths[0];
    const layer0 = this.layerActs[0];

    for (let j = 0; j < w0; j++) {
      let sum = g[this.b1Offset + j];
      const inBase = this.w1Offset + j * INPUT_COUNT;
      for (let i = 0; i < INPUT_COUNT; i++) sum += g[inBase + i] * inputs[i];
      const recBase = this.recOffset + j * cw;
      for (let k = 0; k < w0; k++) sum += g[recBase + k] * hiddenState[k];
      layer0[j] = tanh(sum);
    }
    // Dopiero teraz nadpisujemy pamięć — h(t-1) było już w pełni odczytane.
    hiddenState.set(layer0);

    for (let l = 1; l < this.layerCount; l++) {
      const prev = this.layerActs[l - 1];
      const cur = this.layerActs[l];
      const wPrev = this.widths[l - 1];
      const wCur = this.widths[l];
      const wOff = this.whOffset[l];
      const bOff = this.bhOffset[l];
      for (let j = 0; j < wCur; j++) {
        let sum = g[bOff + j];
        const base = wOff + j * cw;
        for (let i = 0; i < wPrev; i++) sum += g[base + i] * prev[i];
        cur[j] = tanh(sum);
      }
    }

    const last = this.layerActs[this.layerCount - 1];
    const wLast = this.widths[this.layerCount - 1];
    for (let k = 0; k < OUTPUT_COUNT; k++) {
      let sum = g[this.b2Offset + k];
      const base = this.w2Offset + k * cw;
      for (let j = 0; j < wLast; j++) sum += g[base + j] * last[j];
      this.outputs[k] = tanh(sum);
    }

    return this.outputs;
  }

  /** Aktywacje ostatniej warstwy ukrytej — wyłącznie do podglądu w UI. */
  getHiddenActivations(): Float32Array {
    return this.layerActs[this.layerCount - 1];
  }
}
