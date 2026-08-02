import { useState } from 'react';
import type { SimulationConfig } from '../../config/simulationConfig';

interface Props {
  running: boolean;
  speed: number;
  config: SimulationConfig;
  onRunning: (v: boolean) => void;
  onSpeed: (v: number) => void;
  onStep: () => void;
  onReset: (overrides: Partial<SimulationConfig>) => void;
  onFit: () => void;
}

/** Parametry, które da się sensownie zmieniać z UI (reszta — w pliku config). */
const TUNABLE: Array<{
  key: keyof SimulationConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Czy zmiana wymaga restartu świata. */
  restart?: boolean;
}> = [
  { key: 'seed', label: 'seed', min: 1, max: 99999, step: 1, restart: true },
  { key: 'initialPopulation', label: 'populacja startowa', min: 10, max: 800, step: 10, restart: true },
  { key: 'worldSize', label: 'rozmiar świata', min: 800, max: 8000, step: 100, restart: true },
  { key: 'foodSpawnRate', label: 'przyrost jedzenia / tick', min: 0, max: 60, step: 1 },
  { key: 'foodEnergy', label: 'energia z jedzenia', min: 5, max: 80, step: 1 },
  { key: 'mutationChance', label: 'szansa mutacji', min: 0, max: 0.25, step: 0.005 },
  { key: 'mutationDelta', label: 'amplituda mutacji', min: 0.01, max: 1, step: 0.01 },
  { key: 'baseMetabolism', label: 'metabolizm bazowy', min: 0.005, max: 0.4, step: 0.005 },
  { key: 'maxAge', label: 'maks. wiek', min: 500, max: 20000, step: 100 },
  { key: 'maxHiddenLayers', label: 'maks. warstw ukrytych', min: 1, max: 60, step: 1, restart: true },
  { key: 'maxLayerWidth', label: 'maks. szerokość warstwy', min: 4, max: 32, step: 1, restart: true },
  { key: 'rockCount', label: 'liczba kamieni', min: 0, max: 400, step: 10, restart: true },
  { key: 'pickupRange', label: 'zasięg chwytu', min: 1, max: 30, step: 1 },
  { key: 'carryMetabolismMultiplier', label: 'koszt niesienia', min: 1, max: 2, step: 0.05 },
  { key: 'attackRange', label: 'zasięg ataku', min: 1, max: 40, step: 1 },
  { key: 'attackDamageBase', label: 'obrażenia ataku', min: 0, max: 60, step: 1 },
  { key: 'matingRange', label: 'zasięg szukania partnera', min: 1, max: 100, step: 1 },
  { key: 'speedMaturationTicks', label: 'dojrzewanie prędkości (ticki)', min: 0, max: 3000, step: 50 },
  { key: 'combatMaturationTicks', label: 'dojrzewanie bojowe (ticki)', min: 0, max: 3000, step: 50 },
  { key: 'foodClusterDriftSpeed', label: 'prędkość dryfu klastrów', min: 0, max: 6, step: 0.1 },
];

const SPEEDS = [1, 2, 5, 10, 25, 100];

export function Controls({ running, speed, config, onRunning, onSpeed, onStep, onReset, onFit }: Props) {
  const [draft, setDraft] = useState<Partial<SimulationConfig>>({});
  const value = (key: keyof SimulationConfig): number =>
    (draft[key] as number | undefined) ?? (config[key] as number);
  const dirty = Object.keys(draft).length > 0;

  return (
    <div className="panel">
      <h2>Sterowanie</h2>

      <div className="row-buttons">
        <button className={running ? 'primary' : ''} onClick={() => onRunning(!running)}>
          {running ? '⏸ Pauza' : '▶ Start'}
        </button>
        <button onClick={onStep} disabled={running}>
          ⏭ Krok
        </button>
        <button onClick={onFit}>⤢ Dopasuj</button>
      </div>

      <label className="field">
        <span>
          prędkość: <b>{speed}×</b> ticków na klatkę
        </span>
        <div className="speed-row">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? 'chip active' : 'chip'} onClick={() => onSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </label>

      <h2>Parametry</h2>
      <p className="muted small">
        Suwaki bez gwiazdki działają na żywo. <b>*</b> = wymaga restartu świata.
      </p>

      {TUNABLE.map((t) => (
        <label className="field" key={String(t.key)}>
          <span>
            {t.label}
            {t.restart ? ' *' : ''}: <b>{value(t.key)}</b>
          </span>
          <input
            type="range"
            min={t.min}
            max={t.max}
            step={t.step}
            value={value(t.key)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDraft((d) => ({ ...d, [t.key]: v }));
              if (!t.restart) {
                // Parametry "na żywo" wpisujemy prosto do konfiguracji świata:
                // systemy czytają ją co tick, więc efekt jest natychmiastowy.
                (config as unknown as Record<string, number>)[t.key as string] = v;
              }
            }}
          />
        </label>
      ))}

      <div className="row-buttons">
        <button
          className="primary"
          onClick={() => {
            onReset(draft);
            setDraft({});
          }}
        >
          ⟳ Restart świata
        </button>
        <button
          onClick={() => {
            setDraft({});
          }}
          disabled={!dirty}
        >
          Cofnij zmiany
        </button>
      </div>

      <p className="muted small">
        Ten sam seed i te same parametry zawsze dają identyczny przebieg — symulacja jest w pełni
        deterministyczna.
      </p>
    </div>
  );
}
