/**
 * Weryfikacja ALGORYTMU shadera GpuBrainSystem — NIE jego kompilacji WGSL,
 * której nie da się sprawdzić bez prawdziwego urządzenia WebGPU (patrz
 * `src/core/gpu/GpuContext.ts`). To, co da się zrobić bez GPU: przepisać
 * dokładnie te same wzory na indeksy i tę samą kolejność operacji co
 * w WGSL na czysty JS i porównać wynik z działającą, przetestowaną
 * implementacją CPU (`NeuralNetwork.forward()`). Zgodność tutaj dowodzi,
 * że algorytm (capacity genome, warstwa rekurencyjna, wielowarstwowość na
 * agenta) jest poprawnie przeniesiony — NIE dowodzi, że tekst WGSL w ogóle
 * się skompiluje na prawdziwej karcie (literówka składniowa temu testowi
 * umknie).
 *
 *   npx tsx scripts/gpu-shader-check.ts
 */
import { makeConfig } from '../src/config/simulationConfig';
import { Rng } from '../src/core/utils/rng';
import { createRandomGenome, decodeBrainShape } from '../src/core/genetics/genome';
import { NeuralNetwork, computeBrainLayout, INPUT_COUNT, OUTPUT_COUNT } from '../src/core/neural/network';

function tanhSafe(x: number): number {
  const c = Math.max(-20, Math.min(20, x));
  return Math.tanh(c);
}

/**
 * Interpreter 1:1 z tekstem WGSL w `GpuBrainSystem.ts` — te same wzory na
 * indeksy w tej samej kolejności. Każda przyszła zmiana algorytmu w jednym
 * miejscu musi być ręcznie powtórzona w drugim; to jest cena braku
 * możliwości uruchomienia prawdziwego shadera w tym środowisku.
 */
function interpretBrainShader(
  genome: Float32Array,
  layout: ReturnType<typeof computeBrainLayout>,
  maxWidth: number,
  layerCount: number,
  widths: number[],
  inputs: Float32Array,
  hiddenIn: Float32Array,
): { outputs: Float32Array; hiddenOut: Float32Array } {
  const w0 = widths[0];
  const layer0 = new Float32Array(maxWidth);
  for (let j = 0; j < w0; j++) {
    let sum = genome[layout.b1Offset + j];
    const inBase = layout.w1Offset + j * INPUT_COUNT;
    for (let k = 0; k < INPUT_COUNT; k++) sum += genome[inBase + k] * inputs[k];
    const recBase = layout.recOffset + j * maxWidth;
    for (let k = 0; k < w0; k++) sum += genome[recBase + k] * hiddenIn[k];
    layer0[j] = tanhSafe(sum);
  }
  const hiddenOut = new Float32Array(maxWidth);
  for (let j = 0; j < maxWidth; j++) hiddenOut[j] = j < w0 ? layer0[j] : 0;

  let prev: Float32Array = layer0;
  let prevW = w0;
  for (let l = 1; l < layerCount; l++) {
    const cur = new Float32Array(maxWidth);
    const wCur = widths[l];
    const wOff = layout.whOffset[l];
    const bOff = layout.bhOffset[l];
    for (let j = 0; j < wCur; j++) {
      let sum = genome[bOff + j];
      const base = wOff + j * maxWidth;
      for (let k = 0; k < prevW; k++) sum += genome[base + k] * prev[k];
      cur[j] = tanhSafe(sum);
    }
    prev = cur;
    prevW = wCur;
  }

  const outputs = new Float32Array(OUTPUT_COUNT);
  for (let k = 0; k < OUTPUT_COUNT; k++) {
    let sum = genome[layout.b2Offset + k];
    const base = layout.w2Offset + k * maxWidth;
    for (let j = 0; j < prevW; j++) sum += genome[base + j] * prev[j];
    outputs[k] = tanhSafe(sum);
  }
  return { outputs, hiddenOut };
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const configs = [
  makeConfig({ maxHiddenLayers: 4, maxLayerWidth: 16 }),
  makeConfig({ maxHiddenLayers: 10, maxLayerWidth: 16 }),
  makeConfig({ maxHiddenLayers: 1, minHiddenLayers: 1, maxLayerWidth: 8 }),
];

console.log('Weryfikacja algorytmu GpuBrainSystem (interpreter JS vs CPU NeuralNetwork)\n');

for (const cfg of configs) {
  const rng = new Rng(12345);
  const layout = computeBrainLayout(cfg);

  for (let trial = 0; trial < 8; trial++) {
    const genome = createRandomGenome(cfg, rng);
    const shape = decodeBrainShape(genome, cfg);
    const net = new NeuralNetwork(genome, cfg, shape);
    const cpuHidden = new Float32Array(net.recurrentWidth);
    // Bufor referencyjny dopełniony do maxLayerWidth, dokładnie jak
    // `hiddenIn`/`hiddenOut` w GpuBrainSystem — reszta poza recurrentWidth
    // nigdy nie jest czytana (ani tu, ani w WGSL), więc dopełnienie jest
    // nieszkodliwe.
    const refHidden = new Float32Array(cfg.maxLayerWidth);

    for (let tick = 0; tick < 5; tick++) {
      const inputs = new Float32Array(INPUT_COUNT);
      for (let i = 0; i < INPUT_COUNT; i++) inputs[i] = rng.symmetric(1);

      const cpuOut = net.forward(inputs, cpuHidden).slice();
      const { outputs: refOut, hiddenOut: refHiddenOut } = interpretBrainShader(
        genome,
        layout,
        cfg.maxLayerWidth,
        shape.layerCount,
        shape.widths,
        inputs,
        refHidden,
      );
      refHidden.set(refHiddenOut);

      let maxDiff = 0;
      for (let k = 0; k < OUTPUT_COUNT; k++) maxDiff = Math.max(maxDiff, Math.abs(cpuOut[k] - refOut[k]));
      check(
        `layers<=${cfg.maxHiddenLayers} width<=${cfg.maxLayerWidth} trial ${trial} tick ${tick} (rzeczywisty kształt: ${shape.layerCount}x[${shape.widths.slice(0, shape.layerCount).join(',')}])`,
        maxDiff < 1e-5,
        `maxDiff=${maxDiff}`,
      );
    }
  }
}

console.log(
  failures === 0
    ? '\nAlgorytm shadera (interpreter JS) zgadza się z CPU. UWAGA: to NIE dowodzi, że tekst WGSL faktycznie kompiluje się i wykonuje na prawdziwym GPU — patrz GpuContext.ts.'
    : `\n${failures} niezgodności — algorytm w GpuBrainSystem.ts najprawdopodobniej rozjechał się z CPU.`,
);
process.exit(failures === 0 ? 0 : 1);
