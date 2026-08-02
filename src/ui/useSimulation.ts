import { useCallback, useEffect, useRef, useState } from 'react';
import { Simulation } from '../core/simulation/simulation';
import { PixiRenderer } from '../renderer/pixi/PixiRenderer';
import { defaultConfig, type SimulationConfig } from '../config/simulationConfig';
import type { AgentView, StatsSample } from '../shared/types';
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

export function useSimulation() {
  const simRef = useRef<Simulation | null>(null);
  if (simRef.current === null) simRef.current = new Simulation({}, SEED_GENOME);

  const rendererRef = useRef<PixiRenderer | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(true);
  const speedRef = useRef(1);
  const stepOnceRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [running, setRunningState] = useState(true);
  const [speed, setSpeedState] = useState(1);
  const [snapshot, setSnapshot] = useState<UiSnapshot>(EMPTY_SNAPSHOT);
  const [selected, setSelected] = useState<AgentView | null>(null);
  const [config, setConfig] = useState<SimulationConfig>(defaultConfig);
  const selectedIdRef = useRef<number | null>(null);

  // ---------------------------------------------------------------- pętla
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new PixiRenderer();
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
      renderer.camera.fitWorld(sim.config.worldSize);
      setReady(true);

      const loop = (now: number) => {
        if (cancelled) return;
        raf = requestAnimationFrame(loop);
        const current = simRef.current!;

        if (runningRef.current) {
          current.run(speedRef.current);
        } else if (stepOnceRef.current) {
          current.step();
          stepOnceRef.current = false;
        }

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
          setSnapshot({
            tick: current.tick,
            population: current.world.agents.length,
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
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let pinchDist = 0;

    const onPointerDown = (e: PointerEvent) => {
      host.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1) {
        dragging = true;
        moved = 0;
        lastX = e.clientX;
        lastY = e.clientY;
      } else if (pointers.size === 2) {
        // Drugi palec dotknął ekranu — koniec przeciągania, start pinch-zoomu.
        dragging = false;
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

  return {
    hostRef,
    ready,
    running,
    speed,
    snapshot,
    selected,
    config,
    setRunning,
    setSpeed,
    stepOnce,
    reset,
    follow,
    fitWorld,
    clearSelection,
  };
}
