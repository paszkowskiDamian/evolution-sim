/**
 * Pomocnicze funkcje do buforów WebGPU — współdzielone przez wszystkie
 * `Gpu*System`. Bufory są tworzone/niszczone NA NOWO co tick zamiast
 * poolowane — prostsze i mniej podatne na błędy przy pisaniu bez
 * możliwości uruchomienia (patrz `GpuContext.ts`), kosztem GC/alokacji,
 * których nie dało się tu zmierzyć. Poolowanie buforów to jasna okazja
 * do optymalizacji PO potwierdzeniu poprawności na prawdziwym sprzęcie.
 */

/** Zaokrągla w górę do wielokrotności 4 bajtów — WebGPU wymaga tego dla rozmiaru bufora. */
function align4(byteLength: number): number {
  return Math.max(4, Math.ceil(byteLength / 4) * 4);
}

/** Bufor tylko-do-odczytu dla shadera, wypełniony danymi z CPU. */
export function makeReadOnlyBuffer(
  device: GPUDevice,
  data: Float32Array | Int32Array | Uint32Array,
  label: string,
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: align4(data.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  return buffer;
}

/** Pusty bufor do zapisu przez shader (read_write w WGSL), odczytywany później z CPU. */
export function makeWritableBuffer(device: GPUDevice, byteLength: number, label: string): GPUBuffer {
  return device.createBuffer({
    label,
    size: align4(byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
}

/**
 * Kopiuje zawartość bufora GPU z powrotem na CPU. Jedyny naprawdę
 * asynchroniczny krok w całej ścieżce GPU (`mapAsync` nie ma odpowiednika
 * synchronicznego — to fundamentalne ograniczenie WebGPU, nie coś, co da
 * się obejść). Stąd `Gpu*System.update()` zwraca `Promise`, a nie `void`
 * — patrz `System.ts` i `Simulation.stepAsync`.
 */
export async function readBuffer(device: GPUDevice, source: GPUBuffer, byteLength: number): Promise<ArrayBuffer> {
  const size = align4(byteLength);
  const readback = device.createBuffer({
    size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, readback, 0, size);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  // .slice(0) kopiuje poza mapowany zakres — getMappedRange() jest unieważniane przez unmap().
  const copy = readback.getMappedRange(0, byteLength).slice(0);
  readback.unmap();
  readback.destroy();
  return copy;
}
