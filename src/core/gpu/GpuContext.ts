/**
 * Cienki wrapper na urządzenie WebGPU — jedyne miejsce w `core/`, które
 * dotyka `navigator.gpu`. Import tego pliku jest bezpieczny w Node
 * (skrypty `headless`/`evolve`/`test:determinism`) — `navigator` może
 * w ogóle nie istnieć, więc każdy dostęp jest za feature-detection,
 * nigdy `throw` przy samym imporcie.
 *
 * UWAGA — ŚCIEŻKA EKSPERYMENTALNA, NIEZWERYFIKOWANA NA PRAWDZIWYM
 * SPRZĘCIE: środowisko, w którym to napisano, nie miało żadnego adaptera
 * WebGPU (`'gpu' in navigator` było `false` nawet z flagami
 * `--enable-unsafe-webgpu`/`--use-angle=swiftshader` w headless Chromium —
 * sandbox nie ma ani GPU, ani działającego Vulkan/ANGLE). Kod poniżej i we
 * wszystkich `Gpu*System` jest zgodny ze specyfikacją WebGPU/WGSL najlepiej,
 * jak dało się to ocenić BEZ możliwości uruchomienia — bufory, layouty
 * i shadery nigdy nie zostały realnie wykonane na karcie graficznej.
 * Wymaga sprawdzenia w przeglądarce z prawdziwym WebGPU (Chrome/Edge 113+
 * na sprzęcie z GPU) zanim ktokolwiek na tym polega produkcyjnie.
 *
 * Dlatego cała ścieżka GPU jest DOMYŚLNIE WYŁĄCZONA i czysto addytywna:
 * `Simulation` bez wywołania `enableGpu()` zachowuje się DOKŁADNIE tak
 * jak przed dodaniem tego pliku — CPU pozostaje jedynym gwarantowanym
 * i przetestowanym (`test:determinism`) trybem działania.
 */
export class GpuContext {
  private constructor(readonly device: GPUDevice) {}

  /** Zwraca `null` przy KAŻDYM braku wsparcia/błędzie — nigdy nie rzuca. */
  static async request(): Promise<GpuContext | null> {
    try {
      const nav = (globalThis as { navigator?: Navigator }).navigator;
      if (!nav || !('gpu' in nav) || !nav.gpu) return null;
      const adapter = await nav.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      if (!device) return null;
      device.lost
        .then((info) => {
          console.warn(`Urządzenie WebGPU utracone (${info.reason}): ${info.message}`);
        })
        .catch(() => {});
      return new GpuContext(device);
    } catch (err) {
      console.warn('Inicjalizacja WebGPU nie powiodła się — zostaję na CPU.', err);
      return null;
    }
  }

  destroy(): void {
    this.device.destroy();
  }
}
