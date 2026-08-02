import type { System } from '../System';
import type { World } from '../../world/world';
import type { GpuContext } from '../../gpu/GpuContext';
import { makeReadOnlyBuffer, makeWritableBuffer, readBuffer } from '../../gpu/gpuBuffers';
import { computeBrainLayout, INPUT_COUNT, OUTPUT_COUNT } from '../../neural/network';

const WORKGROUP_SIZE = 64;

/**
 * Odpowiednik `BrainSystem` na GPU: jeden wątek shadera = jeden agent,
 * dokładnie ta sama matematyka co `NeuralNetwork.forward()` (patrz
 * `src/core/neural/network.ts`) — capacity genome (stałe przesunięcia
 * bloków wag z configu), warstwa 0 rekurencyjna, `layerCount`/`widths`
 * per agent odczytywane z bufora kształtu zamiast dekodowane na CPU co tick.
 *
 * NIEZWERYFIKOWANE NA PRAWDZIWYM SPRZĘCIE — patrz komentarz w GpuContext.ts.
 * Przenośna liczba warstw/szerokość per agent (ewoluowalna topologia) to
 * jedyne miejsce w tej całej ścieżce GPU, gdzie wątki w tej samej grupie
 * roboczej wykonują GENUINE różną liczbę iteracji (rozbieżna kontrola
 * przepływu) — GPU obsługuje to poprawnie przez maskowanie, kosztem
 * wydajności (nie funkcjonalności), więc powinno dawać poprawny wynik,
 * ale to najbardziej ryzykowny z trzech systemów GPU pod względem
 * "czy w ogóle się skompiluje / zachowuje zgodnie z oczekiwaniami".
 *
 * Bufory `genomes`/`shapes` są pakowane NA NOWO co tick z aktualnego stanu
 * agentów — genom i kształt sieci są w rzeczywistości NIEZMIENNE przez całe
 * życie agenta, więc cache'owanie ich między tickami (aktualizowane tylko
 * gdy populacja się zmienia) to oczywista optymalizacja na później.
 */
export class GpuBrainSystem implements System {
  readonly name = 'GpuBrainSystem';

  private pipeline: GPUComputePipeline | null = null;
  private pipelineKey = '';

  constructor(private readonly ctx: GpuContext) {}

  async update(world: World): Promise<void> {
    const alive = world.agents.filter((a) => a.alive);
    if (alive.length === 0) return;

    const cfg = world.config;
    const device = this.ctx.device;
    const layout = computeBrainLayout(cfg);
    const maxLayers = cfg.maxHiddenLayers;
    const maxWidth = cfg.maxLayerWidth;
    const genomeLen = alive[0].genome.length;
    const n = alive.length;

    const pipeline = this.ensurePipeline(device, maxLayers, maxWidth);

    // --- pakowanie buforów wejściowych (CPU -> płaskie typed arrays) ---
    const meta = new Uint32Array([
      layout.w1Offset,
      layout.b1Offset,
      layout.recOffset,
      layout.w2Offset,
      layout.b2Offset,
      genomeLen,
      n,
      0, // padding — struktura Meta w WGSL to 8x u32, patrz shader
    ]);
    // whOffsets i bhOffsets razem w JEDNYM buforze (indeks [0,maxLayers) =
    // wh, [maxLayers, 2*maxLayers) = bh) — WebGPU gwarantuje minimum tylko
    // 8 buforów typu storage na etap shadera; scalanie tych dwóch trzyma
    // ten shader dokładnie w limicie (patrz lista bindingów niżej).
    const layerOffsets = new Uint32Array(maxLayers * 2);
    for (let l = 1; l < maxLayers; l++) {
      layerOffsets[l] = layout.whOffset[l];
      layerOffsets[maxLayers + l] = layout.bhOffset[l];
    }

    const genomes = new Float32Array(n * genomeLen);
    const inputs = new Float32Array(n * INPUT_COUNT);
    const hiddenIn = new Float32Array(n * maxWidth);
    const shapes = new Int32Array(n * (maxLayers + 1));

    for (let i = 0; i < n; i++) {
      const a = alive[i];
      genomes.set(a.genome, i * genomeLen);
      inputs.set(a.lastInputs, i * INPUT_COUNT);
      hiddenIn.set(a.hiddenState, i * maxWidth); // krótsze niż maxWidth -> reszta zostaje 0 (dopełnienie pojemności)
      const shapeBase = i * (maxLayers + 1);
      shapes[shapeBase] = a.brainShape.layerCount;
      for (let l = 0; l < maxLayers; l++) shapes[shapeBase + 1 + l] = a.brainShape.widths[l];
    }

    const metaBuf = makeReadOnlyBuffer(device, meta, 'brain-meta');
    const layerOffsetsBuf = makeReadOnlyBuffer(device, layerOffsets, 'brain-layerOffsets');
    const genomeBuf = makeReadOnlyBuffer(device, genomes, 'brain-genomes');
    const inputBuf = makeReadOnlyBuffer(device, inputs, 'brain-inputs');
    const hiddenInBuf = makeReadOnlyBuffer(device, hiddenIn, 'brain-hiddenIn');
    const shapeBuf = makeReadOnlyBuffer(device, shapes, 'brain-shapes');
    const outputBuf = makeWritableBuffer(device, n * OUTPUT_COUNT * 4, 'brain-outputs');
    const hiddenOutBuf = makeWritableBuffer(device, n * maxWidth * 4, 'brain-hiddenOut');

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: metaBuf } },
        { binding: 1, resource: { buffer: layerOffsetsBuf } },
        { binding: 2, resource: { buffer: genomeBuf } },
        { binding: 3, resource: { buffer: inputBuf } },
        { binding: 4, resource: { buffer: hiddenInBuf } },
        { binding: 5, resource: { buffer: shapeBuf } },
        { binding: 6, resource: { buffer: outputBuf } },
        { binding: 7, resource: { buffer: hiddenOutBuf } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(n / WORKGROUP_SIZE));
    pass.end();
    device.queue.submit([encoder.finish()]);

    const [outData, hiddenData] = await Promise.all([
      readBuffer(device, outputBuf, n * OUTPUT_COUNT * 4),
      readBuffer(device, hiddenOutBuf, n * maxWidth * 4),
    ]);
    const outArr = new Float32Array(outData);
    const hiddenArr = new Float32Array(hiddenData);

    for (let i = 0; i < n; i++) {
      const a = alive[i];
      a.brain.outputs.set(outArr.subarray(i * OUTPUT_COUNT, (i + 1) * OUTPUT_COUNT));
      // hiddenState agenta ma DŁUGOŚĆ recurrentWidth (nie maxWidth) — czytamy
      // tylko jego aktywną część, resztę dopełnienia z shadera ignorujemy.
      a.hiddenState.set(hiddenArr.subarray(i * maxWidth, i * maxWidth + a.hiddenState.length));
    }

    metaBuf.destroy();
    layerOffsetsBuf.destroy();
    genomeBuf.destroy();
    inputBuf.destroy();
    hiddenInBuf.destroy();
    shapeBuf.destroy();
    outputBuf.destroy();
    hiddenOutBuf.destroy();
  }

  private ensurePipeline(device: GPUDevice, maxLayers: number, maxWidth: number): GPUComputePipeline {
    const key = `${maxLayers}:${maxWidth}`;
    if (this.pipeline && this.pipelineKey === key) return this.pipeline;
    const module = device.createShaderModule({
      label: 'brain-forward',
      code: buildShaderSource(maxLayers, maxWidth, INPUT_COUNT, OUTPUT_COUNT),
    });
    this.pipeline = device.createComputePipeline({
      label: 'brain-forward-pipeline',
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    this.pipelineKey = key;
    return this.pipeline;
  }
}

/**
 * `maxLayers`/`maxWidth` muszą być stałymi w czasie kompilacji shadera
 * (rozmiar tablic `array<f32, N>` w WGSL) — stąd generowanie źródła
 * jako string zamiast jednego statycznego shadera. Pipeline jest
 * przebudowywany tylko gdy te wartości się zmienią (patrz `ensurePipeline`).
 */
function buildShaderSource(maxLayers: number, maxWidth: number, inputCount: number, outputCount: number): string {
  return `
struct Meta {
  w1Offset: u32,
  b1Offset: u32,
  recOffset: u32,
  w2Offset: u32,
  b2Offset: u32,
  genomeLen: u32,
  agentCount: u32,
  _pad: u32,
};

const MAX_WIDTH: u32 = ${maxWidth}u;
const MAX_LAYERS: u32 = ${maxLayers}u;
const INPUT_COUNT: u32 = ${inputCount}u;
const OUTPUT_COUNT: u32 = ${outputCount}u;

// layerOffsets[0..MAX_LAYERS) = whOffset per warstwę, [MAX_LAYERS..2*MAX_LAYERS) = bhOffset.
@group(0) @binding(0) var<storage, read> meta: Meta;
@group(0) @binding(1) var<storage, read> layerOffsets: array<u32>;
@group(0) @binding(2) var<storage, read> genomes: array<f32>;
@group(0) @binding(3) var<storage, read> inputs: array<f32>;
@group(0) @binding(4) var<storage, read> hiddenIn: array<f32>;
@group(0) @binding(5) var<storage, read> shapes: array<i32>;
@group(0) @binding(6) var<storage, read_write> outputs: array<f32>;
@group(0) @binding(7) var<storage, read_write> hiddenOut: array<f32>;

fn tanhSafe(x: f32) -> f32 {
  return tanh(clamp(x, -20.0, 20.0));
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= meta.agentCount) {
    return;
  }

  let genomeBase = i * meta.genomeLen;
  let inputBase = i * INPUT_COUNT;
  let hiddenBase = i * MAX_WIDTH;
  let shapeBase = i * (MAX_LAYERS + 1u);
  let outBase = i * OUTPUT_COUNT;

  let layerCount = u32(shapes[shapeBase]);
  var widths: array<u32, MAX_LAYERS>;
  for (var l = 0u; l < MAX_LAYERS; l = l + 1u) {
    widths[l] = u32(shapes[shapeBase + 1u + l]);
  }

  // Warstwa 0 (rekurencyjna): czytamy CAŁY stary hiddenIn (h(t-1)) PRZED
  // zapisem — dokładnie jak CPU (patrz network.ts forward()).
  var layer0: array<f32, MAX_WIDTH>;
  let w0 = widths[0];
  for (var j = 0u; j < w0; j = j + 1u) {
    var sum = genomes[genomeBase + meta.b1Offset + j];
    let inBase = meta.w1Offset + j * INPUT_COUNT;
    for (var k = 0u; k < INPUT_COUNT; k = k + 1u) {
      sum = sum + genomes[genomeBase + inBase + k] * inputs[inputBase + k];
    }
    let recBase = meta.recOffset + j * MAX_WIDTH;
    for (var k = 0u; k < w0; k = k + 1u) {
      sum = sum + genomes[genomeBase + recBase + k] * hiddenIn[hiddenBase + k];
    }
    layer0[j] = tanhSafe(sum);
  }
  for (var j = 0u; j < MAX_WIDTH; j = j + 1u) {
    if (j < w0) {
      hiddenOut[hiddenBase + j] = layer0[j];
    } else {
      hiddenOut[hiddenBase + j] = 0.0;
    }
  }

  var prev: array<f32, MAX_WIDTH> = layer0;
  var prevW = w0;
  for (var l = 1u; l < layerCount; l = l + 1u) {
    var cur: array<f32, MAX_WIDTH>;
    let wCur = widths[l];
    let wOff = layerOffsets[l];
    let bOff = layerOffsets[MAX_LAYERS + l];
    for (var j = 0u; j < wCur; j = j + 1u) {
      var sum = genomes[genomeBase + bOff + j];
      let base = wOff + j * MAX_WIDTH;
      for (var k = 0u; k < prevW; k = k + 1u) {
        sum = sum + genomes[genomeBase + base + k] * prev[k];
      }
      cur[j] = tanhSafe(sum);
    }
    prev = cur;
    prevW = wCur;
  }

  for (var k = 0u; k < OUTPUT_COUNT; k = k + 1u) {
    var sum = genomes[genomeBase + meta.b2Offset + k];
    let base = meta.w2Offset + k * MAX_WIDTH;
    for (var j = 0u; j < prevW; j = j + 1u) {
      sum = sum + genomes[genomeBase + base + j] * prev[j];
    }
    outputs[outBase + k] = tanhSafe(sum);
  }
}
`;
}
