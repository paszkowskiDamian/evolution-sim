import { useCallback, useEffect, useRef, useState } from 'react';
import { Simulation } from '../core/simulation/simulation';
import { PixiRenderer, type RenderMode } from '../renderer/pixi/PixiRenderer';
import { defaultConfig, type SimulationConfig } from '../config/simulationConfig';
import type { AgentView, StatsSample } from '../shared/types';
import { FEMALE } from '../core/genetics/genome';
import seedGenomeData from '../config/seedGenome.json';

/**
 * Genom-przodek wygenerowany przez `npm run evolve` (patrz scripts/evolve.ts).
 * Startowa populacja to zmutowane kopie tego jednego, sprawdzonego genomu —
 * nie czysto losowa geneza. `World` po cichu wraca do losowej genezy, jeśli
 * długość genomu nie pasuje do aktualnej konfiguracji (np. inna głębokość
 * mózgu po zmianie configu), więc to bezpieczne nawet po edycji parametrów.
 */
const SEED_GENOME = new Float32Array(seedGenomeData.genome);

/**
 * Spina silnik z rendererem i Reactem.
 *
 * Kluczowa zasada: React NIE renderuje się co tick. Symulacja i rysowanie
 * chodzą w requestAnimationFrame poza cyklem Reacta, a do stanu UI trafia
 * jedynie odświeżana co ~150 ms migawka. Bez tego 60 przerysowań drzewa
 * komponentów na sekundę zabiłoby wydajność przy tysiącu agentów.
 */

export interface UiSnapshot {
  tick: number;
  population: number;
  femaleCount: number;
  maleCount: number;
  foodCount: number;
  maxGeneration: number;
  avgAge: number;
  avgEnergy: number;
  avgFitness: number;
  diversity: number;
  totalBirths: number;
  totalDeaths: number;
  totalFoodEaten: number;
  totalMutations: number;
  tickMs: number;
  fps: number;
  history: StatsSample[];
}

const EMPTY_SNAPSHOT: UiSnapshot = {
  tick: 0,
  population: 0,
  femaleCount: 0,
  maleCount: 0,
  foodCount: 0,
  maxGeneration: 0,
  avgAge: 0,
  avgEnergy: 0,
  avgFitness: 0,
  diversity: 0,
  totalBirths: 0,
  totalDeaths: 0,
  totalFoodEaten: 0,
  totalMutations: 0,
  tickMs: 0,
  fps: 0,
  history: [],
};

const UI_REFRESH_MS = 150;
const RENDER_MODE_STORAGE_KEY = 'evolution-sim.render-mode';

function initialRenderMode(): RenderMode {
  if (typeof window === 'undefined') return 'sprites';
  try {
    return window.localStorage.getItem(RENDER_MODE_STORAGE_KEY) === 'classic' ? 'classic' : 'sprites';
  } catch {
    return 'sprites';
  }
}

/**
 * Stan ścieżki GPU widoczny w UI — patrz `Controls.tsx` (przycisk "Spróbuj
 * GPU") i `GpuContext.ts` (dlaczego to jest EKSPERYMENTALNE/niezweryfikowane).
 * GPU nigdy nie włącza się samo — wymaga świadomego kliknięcia, żeby ewentualna
 * awaria (np. błąd shadera na sprzęcie, na którym tego nigdy nie sprawdzono)
 * nie zaskoczyła nikogo cichą zmianą zachowania przy zwykłym otwarciu strony.
 */
export type GpuStatus = 'cpu' | 'gpu' | 'unsupported';

/**
 * Narzędzie "boskiej ręki" — malowanie/wymazywanie jedzenia i terenu wprost
 * na płótnie. `'none'` to zwykły tryb (przeciąganie = pan, dotknięcie
 * agenta = zaznaczenie); dowolne inne narzędzie PRZEJMUJE jednopalcowe
 * gesty na malowanie (patrz efekt interakcji niżej) — drugi palec nadal
 * służy do zoomu, niezależnie od aktywnego narzędzia.
 */
export type EditTool = 'none' | 'addFood' | 'removeFood' | 'addWall' | 'removeWall';

/** Odstęp (w jednostkach świata) między kolejnymi "stemplami" przy przeciąganiu. */
const PAINT_SPACING = 20;
/** Promień wyszukiwania jedzenia do usunięcia narzędziem "wymaż jedzenie". */
const REMOVE_FOOD_RADIUS = 25;

export function useSimulation() {
  const simRef = useRef<Simulation | null>(null);
  if (simRef.current === null) simRef.current = new Simulation({}, SEED_GENOME);

  const rendererRef = useRef<PixiRenderer | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(true);
  const speedRef = useRef(1);
  const stepOnceRef = useRef(false);
  const tickBusyRef = useRef(false);
  const editToolRef = useRef<EditTool>('none');

  const [ready, setReady] = useState(false);
  const [running, setRunningState] = useState(true);
  const [speed, setSpeedState] = useState(1);
  const [snapshot, setSnapshot] = useState<UiSnapshot>(EMPTY_SNAPSHOT);
  const [selected, setSelected] = useState<AgentView | null>(null);
  const [config, setConfig] = useState<SimulationConfig>(defaultConfig);
  const [gpuStatus, setGpuStatus] = useState<GpuStatus>('cpu');
  const [editTool, setEditToolState] = useState<EditTool>('none');
  const [renderMode, setRenderModeState] = useState<RenderMode>(initialRenderMode);
  const selectedIdRef = useRef<number | null>(null);

  // ---------------------------------------------------------------- pętla
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new PixiRenderer();
    renderer.setRenderMode(renderMode);
    rendererRef.current = renderer;
    let raf = 0;
    let cancelled = false;
    let lastUi = 0;
    let frames = 0;
    let fpsWindowStart = 0;
    let fps = 0;

    renderer.init(host).then(() => {
      if (cancelled) return;
      const sim = simRef.current!;
      const size = renderer.viewportSize;
      renderer.camera.setViewport(size.width, size.height);
      renderer.camera.fitWorld(sim.config.worldSize, 2);
      setReady(true);

      const loop = async (now: number) => {
        if (cancelled) return;
        raf = requestAnimationFrame(loop);
        const current = simRef.current!;

        // Gdy GPU jest aktywne, odczyt wyniku ticka jest asynchroniczny
        // (patrz Simulation.stepAsync/runAsync i GpuContext.ts) — jeśli jeden
        // tick nie zdąży się zamknąć przed kolejną klatką, po prostu
        // POMIJAMY tę klatkę (nie renderujemy, nie odpalamy drugiego ticka
        // równolegle) zamiast ryzykować nakładające się, współbieżne ticki.
        if (tickBusyRef.current) return;
        tickBusyRef.current = true;
        try {
          if (runningRef.current) {
            if (current.gpuEnabled) await current.runAsync(speedRef.current);
            else current.run(speedRef.current);
          } else if (stepOnceRef.current) {
            if (current.gpuEnabled) await current.stepAsync();
            else current.step();
            stepOnceRef.current = false;
          }
        } finally {
          tickBusyRef.current = false;
        }
        if (cancelled) return;

        renderer.selectedId = selectedIdRef.current;
        renderer.render(current);

        frames++;
        if (now - fpsWindowStart >= 500) {
          fps = (frames * 1000) / (now - fpsWindowStart);
          frames = 0;
          fpsWindowStart = now;
        }

        if (now - lastUi >= UI_REFRESH_MS) {
          lastUi = now;
          const stats = current.statistics;
          const last = stats.history[stats.history.length - 1];
          // Liczone na żywo z bieżącej populacji (nie z próbki historii) —
          // podział płci ma być dokładnie tym, co widać teraz, nie migawką
          // sprzed statsInterval ticków.
          let femaleCount = 0;
          for (const a of current.world.agents) {
            if (a.phenotype.gender === FEMALE) femaleCount++;
          }
          setSnapshot({
            tick: current.tick,
            population: current.world.agents.length,
            femaleCount,
            maleCount: current.world.agents.length - femaleCount,
            foodCount: current.world.food.count,
            maxGeneration: current.world.maxGeneration,
            avgAge: last?.avgAge ?? 0,
            avgEnergy: last?.avgEnergy ?? 0,
            avgFitness: last?.avgFitness ?? 0,
            diversity: last?.diversity ?? 0,
            totalBirths: stats.cumulative.totalBirths,
            totalDeaths: stats.cumulative.totalDeaths,
            totalFoodEaten: stats.cumulative.totalFoodEaten,
            totalMutations: stats.cumulative.totalMutations,
            tickMs: current.lastTickMs,
            fps,
            history: stats.history.slice(),
          });
          const id = selectedIdRef.current;
          setSelected(id === null ? null : current.getAgentView(id));
        }
      };
      raf = requestAnimationFrame(loop);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // ------------------------------------------------------------- interakcja
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ready) return;

    // Śledzimy WSZYSTKIE aktywne wskaźniki (Map), żeby wykryć drugi palec
    // i przełączyć się z przeciągania na pinch-zoom — Pointer Events ujednolica
    // mysz/dotyk/pióro, ale rozróżnienie "1 palec = pan" / "2 palce = zoom"
    // trzeba zbudować samemu, bo `wheel` (dotychczasowy jedyny zoom) w ogóle
    // nie istnieje na dotyku.
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let painting = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let pinchDist = 0;
    let lastPaintX = 0;
    let lastPaintY = 0;

    // Wymalowuje/wymazuje pod jednym punktem ekranu narzędziem aktualnie
    // uzbrojonym w editToolRef — zwraca `false`, jeśli narzędzie jest
    // wyłączone (`'none'`), żeby wywołujący mógł spaść z powrotem na
    // zwykłe zachowanie (pan/zaznaczenie).
    const applyEditTool = (clientX: number, clientY: number): boolean => {
      const tool = editToolRef.current;
      if (tool === 'none') return false;
      const renderer = rendererRef.current;
      const sim = simRef.current;
      if (!renderer || !sim) return false;
      const rect = host.getBoundingClientRect();
      const world = renderer.camera.screenToWorld(clientX - rect.left, clientY - rect.top);
      switch (tool) {
        case 'addFood':
          sim.world.addFoodAt(world.x, world.y);
          break;
        case 'removeFood':
          sim.world.removeFoodNear(world.x, world.y, REMOVE_FOOD_RADIUS);
          break;
        case 'addWall':
          sim.world.addWallAt(world.x, world.y);
          break;
        case 'removeWall':
          sim.world.removeWallAt(world.x, world.y);
          break;
      }
      return true;
    };

    const onPointerDown = (e: PointerEvent) => {
      host.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1) {
        if (applyEditTool(e.clientX, e.clientY)) {
          painting = true;
          dragging = false;
          lastPaintX = e.clientX;
          lastPaintY = e.clientY;
          return;
        }
        dragging = true;
        moved = 0;
        lastX = e.clientX;
        lastY = e.clientY;
      } else if (pointers.size === 2) {
        // Drugi palec dotknął ekranu — koniec przeciągania/malowania, start pinch-zoomu.
        dragging = false;
        painting = false;
        const [p1, p2] = Array.from(pointers.values());
        pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2) {
        const [p1, p2] = Array.from(pointers.values());
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const renderer = rendererRef.current;
        if (renderer && pinchDist > 0 && dist > 0) {
          const rect = host.getBoundingClientRect();
          const midX = (p1.x + p2.x) / 2 - rect.left;
          const midY = (p1.y + p2.y) / 2 - rect.top;
          renderer.camera.zoomAt(midX, midY, dist / pinchDist);
        }
        pinchDist = dist;
        return;
      }

      if (painting) {
        // Stempluj tylko co PAINT_SPACING jednostek świata przeciągnięcia,
        // nie co klatkę — inaczej jeden szybki gest zalałby cały pas jedną
        // ciągłą smugą jedzenia/ścian zamiast rzadkich, kontrolowanych stempli.
        const renderer = rendererRef.current;
        if (renderer) {
          const dx = e.clientX - lastPaintX;
          const dy = e.clientY - lastPaintY;
          if (Math.hypot(dx, dy) * renderer.camera.zoom >= PAINT_SPACING) {
            applyEditTool(e.clientX, e.clientY);
            lastPaintX = e.clientX;
            lastPaintY = e.clientY;
          }
        }
        return;
      }

      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      rendererRef.current?.camera.panByScreen(dx, dy);
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasTracked = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      host.releasePointerCapture(e.pointerId);
      if (!wasTracked) return;

      if (painting) {
        painting = false;
        return;
      }

      if (pointers.size === 1) {
        // Wracamy z pinch-zoomu do jednego palca — wznów przeciąganie od
        // JEGO bieżącej pozycji (bez skoku kamery) i nie traktuj tego
        // podniesienia jak kliknięcia.
        const [remaining] = Array.from(pointers.values());
        dragging = true;
        moved = Infinity;
        lastX = remaining.x;
        lastY = remaining.y;
        return;
      }
      if (pointers.size > 0) return;

      if (!dragging) return;
      dragging = false;
      if (moved > 4) return; // to było przeciąganie (albo pinch), nie kliknięcie
      const renderer = rendererRef.current;
      const sim = simRef.current;
      if (!renderer || !sim) return;
      const rect = host.getBoundingClientRect();
      const world = renderer.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const id = sim.pickAgent(world.x, world.y, 30 / renderer.camera.zoom);
      selectedIdRef.current = id;
      setSelected(id === null ? null : sim.getAgentView(id));
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const renderer = rendererRef.current;
      if (!renderer) return;
      const rect = host.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      renderer.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    };

    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);
    host.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      host.removeEventListener('wheel', onWheel);
    };
  }, [ready]);

  // ---------------------------------------------------------------- akcje
  const setRunning = useCallback((value: boolean) => {
    runningRef.current = value;
    setRunningState(value);
  }, []);

  const setSpeed = useCallback((value: number) => {
    speedRef.current = value;
    setSpeedState(value);
  }, []);

  const stepOnce = useCallback(() => {
    stepOnceRef.current = true;
  }, []);

  const setEditTool = useCallback((tool: EditTool) => {
    editToolRef.current = tool;
    setEditToolState(tool);
  }, []);

  const setRenderMode = useCallback((mode: RenderMode) => {
    rendererRef.current?.setRenderMode(mode);
    try {
      window.localStorage.setItem(RENDER_MODE_STORAGE_KEY, mode);
    } catch {
      // Rendering still switches when storage is unavailable (private policy).
    }
    setRenderModeState(mode);
  }, []);

  const reset = useCallback(
    (overrides: Partial<SimulationConfig> = {}) => {
      const sim = simRef.current!;
      sim.reset(overrides);
      setConfig(sim.config);
      selectedIdRef.current = null;
      setSelected(null);
      setSnapshot(EMPTY_SNAPSHOT);
      rendererRef.current?.camera.fitWorld(sim.config.worldSize);
    },
    [],
  );

  const follow = useCallback((id: number | null) => {
    const renderer = rendererRef.current;
    if (renderer) renderer.camera.followId = id;
  }, []);

  const fitWorld = useCallback(() => {
    const sim = simRef.current!;
    rendererRef.current?.camera.fitWorld(sim.config.worldSize);
  }, []);

  const clearSelection = useCallback(() => {
    selectedIdRef.current = null;
    setSelected(null);
    follow(null);
  }, [follow]);

  /**
   * GPU nigdy nie włącza się samo (patrz komentarz przy `GpuStatus`) — to
   * jedyna droga do jego aktywacji, wywoływana z przycisku w UI.
   */
  const toggleGpu = useCallback(async () => {
    const sim = simRef.current!;
    if (sim.gpuEnabled) {
      sim.disableGpu();
      setGpuStatus('cpu');
      return;
    }
    const ok = await sim.enableGpu();
    setGpuStatus(ok ? 'gpu' : 'unsupported');
  }, []);

  return {
    hostRef,
    ready,
    running,
    speed,
    snapshot,
    selected,
    config,
    gpuStatus,
    editTool,
    renderMode,
    setEditTool,
    setRenderMode,
    setRunning,
    setSpeed,
    stepOnce,
    reset,
    follow,
    fitWorld,
    clearSelection,
    toggleGpu,
  };
}
