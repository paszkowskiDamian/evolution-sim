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

/**
 * Stożek widzenia (patrz VISION_CONE_RAYS/VISION_CONE_FOV, SensorSystem) —
 * JEDYNY sposób, w jaki agent widzi jedzenie, innych agentów, partnerów,
 * ściany i ciepło. Wcześniej jedzenie/agent/partner miały osobne sensory
 * "kierunek + bliskość do NAJBLIŻSZEGO, gdziekolwiek dookoła" (360°, bez
 * przeszkód kątowych) — to ZASTĄPIONO wachlarzem promieni rzucanych przed
 * siebie (pole widzenia VISION_CONE_FOV, wyśrodkowane na kierunku agenta),
 * każdy zatrzymywany przez pierwszą literę: ścianę (TerrainGrid.castRay)
 * ALBO najbliższy widoczny obiekt w swoim kątowym wycinku, którykolwiek
 * jest bliżej. Agent dosłownie "patrzy przed siebie" — poza polem
 * widzenia jest ślepy, tak jak w prawdziwym wzroku kierunkowym (z tyłu
 * zostaje martwe pole, patrz VISION_CONE_FOV).
 *
 * Każdy promień niesie TRZY wartości:
 *   - odległość: 0 (nic w zasięgu) .. 1 (trafienie tuż przy agencie),
 *   - rodzaj trafienia (skalar, nie one-hot — te same pasma co reszta
 *     kategorycznych sensorów w tym pliku, np. "płeć"):
 *       0 = nic (pełny zasięg bez przeszkód), -1 = ściana,
 *       -0.5 = inny agent tej samej płci (rywal), +0.5 = agent przeciwnej
 *       płci (potencjalny partner), +0.8 = duże jedzenie wymagające grupy,
 *       +1 = zwykłe jedzenie,
 *   - ciepło (TerrainGrid.shelterWarmthAt) w punkcie trafienia — agent
 *     "widzi" gradient schronienia W GŁĘBI pola widzenia, nie tylko we
 *     własnej pozycji.
 */
export const SENSOR_LABELS = [
  'bias',
  'energia',
  'wiek',
  'prędkość',
  'zagęszczenie',
  'szum',
  'niosę',
  'sin(kąt→kamień)',
  'cos(kąt→kamień)',
  'bliskość kamienia',
  'zdrowie',
  'płeć',
  'niosę jedzenie',
  'odmienność najbliższego agenta',
  // --- sygnalizacja (patrz OUTPUT_LABELS "sygnał" + SensorSystem) ---
  // Agent nie odbiera "znaczenia" — tylko kierunek i głośność najgłośniejszego
  // WIDOCZNEGO nadawcy w zasięgu wzroku. Co ten kanał zacznie oznaczać
  // (ostrzeżenie, przywabianie partnera, rekrutacja do jedzenia, a może
  // fałszywy alarm) jest w całości emergentne — nic w silniku nie narzuca
  // znaczenia sygnału, tylko jego istnienie.
  'sin(kąt→sygnał)',
  'cos(kąt→sygnał)',
  'głośność sygnału',
  'stożek[0] odległość',
  'stożek[0] rodzaj',
  'stożek[0] ciepło',
  'stożek[1] odległość',
  'stożek[1] rodzaj',
  'stożek[1] ciepło',
  'stożek[2] odległość',
  'stożek[2] rodzaj',
  'stożek[2] ciepło',
  'stożek[3] odległość',
  'stożek[3] rodzaj',
  'stożek[3] ciepło',
  'stożek[4] odległość',
  'stożek[4] rodzaj',
  'stożek[4] ciepło',
  'stożek[5] odległość',
  'stożek[5] rodzaj',
  'stożek[5] ciepło',
  'stożek[6] odległość',
  'stożek[6] rodzaj',
  'stożek[6] ciepło',
  'stożek[7] odległość',
  'stożek[7] rodzaj',
  'stożek[7] ciepło',
  'stożek[8] odległość',
  'stożek[8] rodzaj',
  'stożek[8] ciepło',
  'stożek[9] odległość',
  'stożek[9] rodzaj',
  'stożek[9] ciepło',
  'stożek[10] odległość',
  'stożek[10] rodzaj',
  'stożek[10] ciepło',
] as const;

/** Liczba promieni stożka widzenia — stała wewnętrzna (nie config): zmiana
 *  zmienia layout genomu, więc nie ma sensu wystawiać jej jako suwaka na żywo. */
export const VISION_CONE_RAYS = 11;
/** Pole widzenia stożka (radiany), wyśrodkowane na kierunku agenta — 300°,
 *  zostawia celowe martwe pole 60° z tyłu (podkradanie się od tyłu staje
 *  się realną taktyką, nie tylko dekoracją). */
export const VISION_CONE_FOV = (300 * Math.PI) / 180;

/** Pasma skalara "rodzaj" na promieniu stożka — patrz dokumentacja wyżej. */
export const CONE_TYPE_NOTHING = 0;
export const CONE_TYPE_WALL = -1;
export const CONE_TYPE_AGENT_RIVAL = -0.5;
export const CONE_TYPE_AGENT_MATE = 0.5;
export const CONE_TYPE_COOPERATIVE_FOOD = 0.8;
export const CONE_TYPE_FOOD = 1;

export const OUTPUT_LABELS = [
  'obrót',
  'ruch',
  'chęć rozmnażania',
  'chwyć/upuść',
  'atak',
  'jedz',
  // Ciągłe (nie progowane) wyjście: dodatnia część = głośność nadawania,
  // odczytywana przez SensorSystem u innych agentów. NIE jest darmowe —
  // patrz `signalEnergyCost` w EnergySystem, inaczej ewolucja zawsze
  // wybrałaby "krzycz na maksa cały czas" i kanał straciłby znaczenie.
  'sygnał',
] as const;

export const INPUT_COUNT = SENSOR_LABELS.length; // 50
export const OUTPUT_COUNT = OUTPUT_LABELS.length; // 7

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
