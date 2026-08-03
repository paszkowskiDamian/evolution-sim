import type { System } from '../System';
import type { World } from '../../world/world';
import type { GpuContext } from '../../gpu/GpuContext';
import { makeReadOnlyBuffer, makeWritableBuffer, readBuffer } from '../../gpu/gpuBuffers';
import { referenceBrainComplexity } from '../../neural/network';

const WORKGROUP_SIZE = 64;
// speed, carriedCount, complexity, radius, visionRadius, metabolism, maxHealth, x, y, energy, health, age, reproCooldown, signalLoudness
const IN_STRIDE = 14;
// energy, health, age, reproCooldown
const OUT_STRIDE = 4;

/**
 * Odpowiednik `EnergySystem` na GPU — metabolizm, regeneracja zdrowia
 * i bonus ze schronienia (patrz `World.isInShelter`). Per-agent skalarna
 * arytmetyka plus O(1) odczyt z przeliczonej na CPU mapy schronienia
 * (patrz `TerrainGrid.getShelterCells`) — bez zapisów między agentami,
 * więc bezpieczne pod względem równoległości.
 *
 * Sama klasyfikacja "czy komórka to schronienie" wymaga spójnych składowych
 * całej siatki terenu (patrz `TerrainGrid.recomputeShelterMap`) — to
 * z natury sekwencyjny algorytm grafowy, nie coś, co dałoby się rozsądnie
 * rozbić na niezależne wątki GPU. Dlatego liczymy go RAZ na CPU (tylko gdy
 * teren faktycznie się zmienił — wynik jest cache'owany) i wgrywamy jako
 * gotową tablicę wyszukiwania; shader robi tylko indeksowanie po komórce.
 *
 * NIEZWERYFIKOWANE NA PRAWDZIWYM SPRZĘCIE — patrz `GpuContext.ts`.
 */
export class GpuEnergySystem implements System {
  readonly name = 'GpuEnergySystem';

  private pipeline: GPUComputePipeline | null = null;

  constructor(private readonly ctx: GpuContext) {}

  async update(world: World): Promise<void> {
    const alive = world.agents.filter((a) => a.alive);
    if (alive.length === 0) return;

    const cfg = world.config;
    const device = this.ctx.device;
    const n = alive.length;
    const terrain = world.terrain;
    const shelterCells = terrain.getShelterCells(
      cfg.shelterExteriorMinCells,
      cfg.shelterMinDepth,
      cfg.shelterHeatLeakRadius,
    );
    const refComplexity = referenceBrainComplexity(cfg);
    const pipeline = this.ensurePipeline(device);

    const metaF32 = new Float32Array([
      cfg.agentRadiusMax,
      cfg.moveCost,
      cfg.sizeCost,
      cfg.brainCost,
      cfg.baseMetabolism,
      cfg.visionRadius,
      cfg.carryMetabolismMultiplier,
      cfg.shelterMetabolismDiscount,
      cfg.shelterHealthRegenMultiplier,
      cfg.healthRegenRate,
      cfg.worldSize,
      terrain.cellSize,
      refComplexity,
      cfg.signalEnergyCost,
    ]);
    const metaU32 = new Uint32Array([n, terrain.cols, 0, 0]);
    const metaBytes = new ArrayBuffer(metaF32.byteLength + metaU32.byteLength);
    new Float32Array(metaBytes, 0, metaF32.length).set(metaF32);
    new Uint32Array(metaBytes, metaF32.byteLength, metaU32.length).set(metaU32);

    // WGSL nie ma typu 8-bitowego w buforach storage — poszerzamy do u32.
    const shelterBuf32 = new Uint32Array(shelterCells.length);
    for (let i = 0; i < shelterCells.length; i++) shelterBuf32[i] = shelterCells[i];

    const agentIn = new Float32Array(n * IN_STRIDE);
    for (let i = 0; i < n; i++) {
      const a = alive[i];
      const base = i * IN_STRIDE;
      agentIn[base + 0] = a.speed;
      agentIn[base + 1] = a.carriedCount;
      agentIn[base + 2] = a.brain.complexity;
      agentIn[base + 3] = a.phenotype.radius;
      agentIn[base + 4] = a.phenotype.visionRadius;
      agentIn[base + 5] = a.phenotype.metabolism;
      agentIn[base + 6] = a.phenotype.maxHealth;
      agentIn[base + 7] = a.x;
      agentIn[base + 8] = a.y;
      agentIn[base + 9] = a.energy;
      agentIn[base + 10] = a.health;
      agentIn[base + 11] = a.age;
      agentIn[base + 12] = a.reproCooldown;
      // Tylko dodatnia część liczy się jako nadawanie — patrz EnergySystem (CPU).
      agentIn[base + 13] = Math.max(0, a.brain.outputs[6]);
    }

    const metaBuf = makeReadOnlyBuffer(device, new Uint32Array(metaBytes), 'energy-meta');
    const shelterBuf = makeReadOnlyBuffer(device, shelterBuf32, 'energy-shelter');
    const inBuf = makeReadOnlyBuffer(device, agentIn, 'energy-in');
    const outBuf = makeWritableBuffer(device, n * OUT_STRIDE * 4, 'energy-out');

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: metaBuf } },
        { binding: 1, resource: { buffer: shelterBuf } },
        { binding: 2, resource: { buffer: inBuf } },
        { binding: 3, resource: { buffer: outBuf } },
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
      a.energy = outData[base + 0];
      a.health = outData[base + 1];
      a.age = outData[base + 2];
      a.reproCooldown = outData[base + 3];
    }

    metaBuf.destroy();
    shelterBuf.destroy();
    inBuf.destroy();
    outBuf.destroy();
  }

  private ensurePipeline(device: GPUDevice): GPUComputePipeline {
    if (this.pipeline) return this.pipeline;
    const module = device.createShaderModule({ label: 'energy', code: SHADER_SOURCE });
    this.pipeline = device.createComputePipeline({
      label: 'energy-pipeline',
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    return this.pipeline;
  }
}

const SHADER_SOURCE = `
const IN_STRIDE: u32 = ${IN_STRIDE}u;
const OUT_STRIDE: u32 = ${OUT_STRIDE}u;

@group(0) @binding(0) var<storage, read> metaRaw: array<u32>;
@group(0) @binding(1) var<storage, read> shelterCells: array<u32>; // 1 = schronienie, [cy*cols+cx]
@group(0) @binding(2) var<storage, read> agentIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> agentOut: array<f32>;

fn wrapf(v: f32, size: f32) -> f32 {
  var x = v % size;
  if (x < 0.0) {
    x = x + size;
  }
  return x;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let rMax = bitcast<f32>(metaRaw[0]);
  let moveCost = bitcast<f32>(metaRaw[1]);
  let sizeCost = bitcast<f32>(metaRaw[2]);
  let brainCost = bitcast<f32>(metaRaw[3]);
  let baseMetabolism = bitcast<f32>(metaRaw[4]);
  let globalVision = bitcast<f32>(metaRaw[5]);
  let carryMult = bitcast<f32>(metaRaw[6]);
  let shelterMetabolismDiscount = bitcast<f32>(metaRaw[7]);
  let shelterHealthRegenMultiplier = bitcast<f32>(metaRaw[8]);
  let healthRegenRate = bitcast<f32>(metaRaw[9]);
  let worldSize = bitcast<f32>(metaRaw[10]);
  let cellSize = bitcast<f32>(metaRaw[11]);
  let refComplexity = bitcast<f32>(metaRaw[12]);
  let signalEnergyCost = bitcast<f32>(metaRaw[13]);
  let agentCount = metaRaw[14];
  let cols = metaRaw[15];

  let i = gid.x;
  if (i >= agentCount) {
    return;
  }

  let base = i * IN_STRIDE;
  let speed = agentIn[base + 0];
  let carriedCount = agentIn[base + 1];
  let complexity = agentIn[base + 2];
  let radius = agentIn[base + 3];
  let visionRadius = agentIn[base + 4];
  let metabolism = agentIn[base + 5];
  let maxHealth = agentIn[base + 6];
  let x = agentIn[base + 7];
  let y = agentIn[base + 8];
  var energy = agentIn[base + 9];
  var health = agentIn[base + 10];
  var age = agentIn[base + 11];
  var reproCooldown = agentIn[base + 12];
  let signalLoudness = agentIn[base + 13];

  let cx = u32(floor(wrapf(x, worldSize) / cellSize)) % cols;
  let cy = u32(floor(wrapf(y, worldSize) / cellSize)) % cols;
  let sheltered = shelterCells[cy * cols + cx] == 1u;

  let bodyFactor = (radius / rMax) * (radius / rMax);
  let visionFactor = visionRadius / globalVision;
  let complexityRatio = complexity / refComplexity;
  let carryFactor = 1.0 + (carryMult - 1.0) * carriedCount;
  let metabolismFactor = select(1.0, shelterMetabolismDiscount, sheltered);

  let cost = (baseMetabolism + moveCost * speed * speed + sizeCost * bodyFactor + brainCost * complexityRatio * (0.5 + visionFactor) + signalEnergyCost * signalLoudness) * metabolism * carryFactor * metabolismFactor;

  energy = energy - cost;
  let regenFactor = select(1.0, shelterHealthRegenMultiplier, sheltered);
  health = min(maxHealth, health + healthRegenRate * regenFactor);
  age = age + 1.0;
  reproCooldown = max(0.0, reproCooldown - 1.0);

  let outBase = i * OUT_STRIDE;
  agentOut[outBase + 0] = energy;
  agentOut[outBase + 1] = health;
  agentOut[outBase + 2] = age;
  agentOut[outBase + 3] = reproCooldown;
}
`;
