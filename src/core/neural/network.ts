import { tanh } from '../utils/math';

/**
 * Sieć neuronowa agenta.
 *
 * Topologia jest stała (MLP: wejścia -> warstwa ukryta [tanh] -> wyjścia [tanh]).
 * NIE MA tu uczenia gradientowego — wagi pochodzą wprost z genomu i zmieniają
 * się wyłącznie przez mutacje i dobór naturalny.
 *
 * Sieć nie alokuje pamięci przy każdym forward passie: bufory aktywacji
 * są własnością instancji.
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
] as const;

export const OUTPUT_LABELS = ['obrót', 'ruch', 'chęć rozmnażania'] as const;

export const INPUT_COUNT = SENSOR_LABELS.length; // 12
export const OUTPUT_COUNT = OUTPUT_LABELS.length; // 3

export function brainGeneCount(hidden: number): number {
  return INPUT_COUNT * hidden + hidden + hidden * OUTPUT_COUNT + OUTPUT_COUNT;
}

export class NeuralNetwork {
  readonly hidden: number;
  /** Widok na fragment genomu — sieć NIE kopiuje wag. */
  private readonly genes: Float32Array;
  private readonly hiddenAct: Float32Array;
  readonly outputs: Float32Array;

  private readonly w1Offset: number;
  private readonly b1Offset: number;
  private readonly w2Offset: number;
  private readonly b2Offset: number;

  constructor(genes: Float32Array, hidden: number) {
    this.genes = genes;
    this.hidden = hidden;
    this.hiddenAct = new Float32Array(hidden);
    this.outputs = new Float32Array(OUTPUT_COUNT);

    this.w1Offset = 0;
    this.b1Offset = this.w1Offset + INPUT_COUNT * hidden;
    this.w2Offset = this.b1Offset + hidden;
    this.b2Offset = this.w2Offset + hidden * OUTPUT_COUNT;
  }

  /** Forward pass. `inputs` musi mieć długość INPUT_COUNT. */
  forward(inputs: Float32Array): Float32Array {
    const g = this.genes;
    const h = this.hidden;
    const hiddenAct = this.hiddenAct;

    for (let j = 0; j < h; j++) {
      let sum = g[this.b1Offset + j];
      const base = this.w1Offset + j * INPUT_COUNT;
      for (let i = 0; i < INPUT_COUNT; i++) {
        sum += g[base + i] * inputs[i];
      }
      hiddenAct[j] = tanh(sum);
    }

    for (let k = 0; k < OUTPUT_COUNT; k++) {
      let sum = g[this.b2Offset + k];
      const base = this.w2Offset + k * h;
      for (let j = 0; j < h; j++) {
        sum += g[base + j] * hiddenAct[j];
      }
      this.outputs[k] = tanh(sum);
    }

    return this.outputs;
  }

  /** Aktywacje warstwy ukrytej — wyłącznie do podglądu w UI. */
  getHiddenActivations(): Float32Array {
    return this.hiddenAct;
  }
}
