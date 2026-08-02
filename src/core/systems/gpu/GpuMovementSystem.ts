import type { System } from '../System';
import type { World } from '../../world/world';
import type { GpuContext } from '../../gpu/GpuContext';
import { makeReadOnlyBuffer, makeWritableBuffer, readBuffer } from '../../gpu/gpuBuffers';

const WORKGROUP_SIZE = 64;
/** Kolejność pól w buforze wejściowym (jeden f32 na pole, przeplecione per agent). */
const IN_STRIDE = 9; // heading, speed, x, y, distanceTravelled, age, maxSpeed, out0, out1
const OUT_STRIDE = 7; // heading, speed, vx, vy, x, y, distanceTravelled

/**
 * Odpowiednik `MovementSystem` na GPU — czysta kinematyka per agent, bez
 * odczytów sąsiadów, więc to najbezpieczniejszy (najmniej ryzykowny) z trzech
 * systemów GPU: brak rozbieżnej kontroli przepływu, brak zależności między
 * wątkami. NIEZWERYFIKOWANE NA PRAWDZIWYM SPRZĘCIE — patrz `GpuContext.ts`.
 *
 * Pola są spakowane w JEDEN przeplatany bufor wejściowy i JEDEN wyjściowy
 * (zamiast osobnego bufora na pole) — trzyma liczbę bindingów bardzo nisko
 * (3, dla porównania gwarantowane minimum WebGPU to 8 buforów typu storage
 * na etap shadera), kosztem nieco mniej czytelnego indeksowania w WGSL.
 */
export class GpuMovementSystem implements System {
  readonly name = 'GpuMovementSystem';

  private pipeline: GPUComputePipeline | null = null;

  constructor(private readonly ctx: GpuContext) {}

  async update(world: World): Promise<void> {
    const alive = world.agents.filter((a) => a.alive);
    if (alive.length === 0) return;

    const cfg = world.config;
    const device = this.ctx.device;
    const n = alive.length;
    const pipeline = this.ensurePipeline(device);

    const metaF32 = new Float32Array([cfg.maxTurnRate, cfg.drag, cfg.speedMaturationTicks, cfg.juvenileSpeedFactor, cfg.worldSize]);
    const metaU32 = new Uint32Array([cfg.wrapEdges ? 1 : 0, n, 0, 0]);
    // Meta = 5x f32 + 4x u32 w JEDNYM buforze bajtowym (WGSL czyta go jako
    // dwa pola tablicowe o tym samym adresie bazowym — patrz shader).
    const metaBytes = new ArrayBuffer(metaF32.byteLength + metaU32.byteLength);
    new Float32Array(metaBytes, 0, metaF32.length).set(metaF32);
    new Uint32Array(metaBytes, metaF32.byteLength, metaU32.length).set(metaU32);

    const agentIn = new Float32Array(n * IN_STRIDE);
    for (let i = 0; i < n; i++) {
      const a = alive[i];
      const base = i * IN_STRIDE;
      agentIn[base + 0] = a.heading;
      agentIn[base + 1] = a.speed;
      agentIn[base + 2] = a.x;
      agentIn[base + 3] = a.y;
      agentIn[base + 4] = a.distanceTravelled;
      agentIn[base + 5] = a.age;
      agentIn[base + 6] = a.phenotype.maxSpeed;
      agentIn[base + 7] = a.brain.outputs[0];
      agentIn[base + 8] = a.brain.outputs[1];
    }

    const metaBuf = makeReadOnlyBuffer(device, new Uint32Array(metaBytes), 'movement-meta');
    const inBuf = makeReadOnlyBuffer(device, agentIn, 'movement-in');
    const outBuf = makeWritableBuffer(device, n * OUT_STRIDE * 4, 'movement-out');

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: metaBuf } },
        { binding: 1, resource: { buffer: inBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(n / WORKGROUP_SIZE));
    pass.end();
    device.queue.submit([encoder.finish()]);

    const outData = new Float32Array(await readBuffer(device, outBuf, n * OUT_STRIDE * 4));
    for (let i = 0; i < n; i++) {
      const a = alive[i];
      const base = i * OUT_STRIDE;
      a.heading = outData[base + 0];
      a.speed = outData[base + 1];
      a.vx = outData[base + 2];
      a.vy = outData[base + 3];
      a.x = outData[base + 4];
      a.y = outData[base + 5];
      a.distanceTravelled = outData[base + 6];
    }

    metaBuf.destroy();
    inBuf.destroy();
    outBuf.destroy();
  }

  private ensurePipeline(device: GPUDevice): GPUComputePipeline {
    if (this.pipeline) return this.pipeline;
    const module = device.createShaderModule({ label: 'movement', code: SHADER_SOURCE });
    this.pipeline = device.createComputePipeline({
      label: 'movement-pipeline',
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    return this.pipeline;
  }
}

const SHADER_SOURCE = `
const IN_STRIDE: u32 = ${IN_STRIDE}u;
const OUT_STRIDE: u32 = ${OUT_STRIDE}u;
const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

// Bajtowo: 5x f32 (turnRate,drag,maturationTicks,juvenileFactor,worldSize)
// natychmiast po nich 4x u32 (wrapEdges,agentCount,pad,pad) w TYM SAMYM buforze —
// WGSL nie ma "reinterpret" między typami buforów, więc udostępniamy go
// dwa razy pod różnymi bindingami tego samego zasobu nie da się w jednej
// grupie bindowania z różnymi typami (storage read wymaga jednego typu
// elementu) — zamiast tego czytamy WSZYSTKO jako u32 i bitcastujemy do f32.
@group(0) @binding(0) var<storage, read> metaRaw: array<u32>;
@group(0) @binding(1) var<storage, read> agentIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> agentOut: array<f32>;

fn wrapf(v: f32, size: f32) -> f32 {
  var x = v % size;
  if (x < 0.0) {
    x = x + size;
  }
  return x;
}

fn ageRamp(age: f32, ticks: f32, start: f32) -> f32 {
  if (ticks <= 0.0) {
    return 1.0;
  }
  return start + (1.0 - start) * clamp(age / ticks, 0.0, 1.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let turnRate = bitcast<f32>(metaRaw[0]);
  let drag = bitcast<f32>(metaRaw[1]);
  let maturationTicks = bitcast<f32>(metaRaw[2]);
  let juvenileFactor = bitcast<f32>(metaRaw[3]);
  let worldSize = bitcast<f32>(metaRaw[4]);
  let wrapEdges = metaRaw[5];
  let agentCount = metaRaw[6];

  let i = gid.x;
  if (i >= agentCount) {
    return;
  }

  let inBase = i * IN_STRIDE;
  var heading = agentIn[inBase + 0];
  var speed = agentIn[inBase + 1];
  var x = agentIn[inBase + 2];
  var y = agentIn[inBase + 3];
  var dist = agentIn[inBase + 4];
  let age = agentIn[inBase + 5];
  let maxSpeed = agentIn[inBase + 6];
  let out0 = agentIn[inBase + 7];
  let out1 = agentIn[inBase + 8];

  heading = heading + clamp(out0, -1.0, 1.0) * turnRate;
  if (heading > PI) {
    heading = heading - TAU;
  } else if (heading < -PI) {
    heading = heading + TAU;
  }

  let thrust = (clamp(out1, -1.0, 1.0) + 1.0) * 0.5;
  let maturity = ageRamp(age, maturationTicks, juvenileFactor);
  let target = thrust * maxSpeed * maturity;
  speed = speed + (target - speed) * drag;
  if (speed < 0.0) {
    speed = 0.0;
  }

  let vx = cos(heading) * speed;
  let vy = sin(heading) * speed;
  x = x + vx;
  y = y + vy;
  dist = dist + speed;

  if (wrapEdges == 1u) {
    x = wrapf(x, worldSize);
    y = wrapf(y, worldSize);
  } else {
    if (x < 0.0) {
      x = 0.0;
      speed = speed * 0.5;
    } else if (x > worldSize) {
      x = worldSize;
      speed = speed * 0.5;
    }
    if (y < 0.0) {
      y = 0.0;
      speed = speed * 0.5;
    } else if (y > worldSize) {
      y = worldSize;
      speed = speed * 0.5;
    }
  }

  let outBase = i * OUT_STRIDE;
  agentOut[outBase + 0] = heading;
  agentOut[outBase + 1] = speed;
  agentOut[outBase + 2] = vx;
  agentOut[outBase + 3] = vy;
  agentOut[outBase + 4] = x;
  agentOut[outBase + 5] = y;
  agentOut[outBase + 6] = dist;
}
`;
