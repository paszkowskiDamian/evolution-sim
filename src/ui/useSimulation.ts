import { useCallback, useEffect, useRef, useState } from 'react';
import { Simulation } from '../core/simulation/simulation';
import { PixiRenderer } from '../renderer/pixi/PixiRenderer';
import { defaultConfig, type SimulationConfig } from '../config/simulationConfig';
import type { AgentView, StatsSample } from '../shared/types';

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
  if (simRef.current === null) simRef.current = new Simulation();

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

    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      host.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      rendererRef.current?.camera.panByScreen(dx, dy);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      host.releasePointerCapture(e.pointerId);
      if (moved > 4) return; // to było przeciąganie, nie kliknięcie
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
