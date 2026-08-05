import { useMemo } from 'react';
import type { UiSnapshot } from '../useSimulation';
import { LineChart } from '../charts/LineChart';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export function StatsPanel({ snapshot }: { snapshot: UiSnapshot }) {
  const h = snapshot.history;

  const series = useMemo(
    () => ({
      population: [
        { label: 'populacja', color: '#60a5fa', values: h.map((s) => s.population) },
        { label: 'jedzenie /10', color: '#4ade80', values: h.map((s) => s.foodCount / 10) },
      ],
      vital: [
        { label: 'śr. wiek', color: '#fbbf24', values: h.map((s) => s.avgAge) },
        { label: 'śr. energia', color: '#f472b6', values: h.map((s) => s.avgEnergy) },
      ],
      flow: [
        { label: 'narodziny', color: '#4ade80', values: h.map((s) => s.births) },
        { label: 'zgony', color: '#f87171', values: h.map((s) => s.deaths) },
        { label: 'wspólne zbiory', color: '#f6c453', values: h.map((s) => s.cooperativeHarvests) },
      ],
      evolution: [
        { label: 'śr. pokolenie', color: '#a78bfa', values: h.map((s) => s.avgGeneration) },
        { label: 'różnorodność', color: '#22d3ee', values: h.map((s) => s.diversity * 10) },
      ],
      traits: [
        { label: 'prędkość', color: '#fb923c', values: h.map((s) => s.avgSpeedGene) },
        { label: 'rozmiar', color: '#94a3b8', values: h.map((s) => s.avgSizeGene) },
        { label: 'wzrok /50', color: '#38bdf8', values: h.map((s) => s.avgVisionGene / 50) },
        { label: 'sygnał ×10', color: '#e879f9', values: h.map((s) => s.avgSignal * 10) },
      ],
    }),
    [h],
  );

  return (
    <div className="panel">
      <h2>Populacja</h2>
      <div className="stat-grid">
        <Stat label="tick" value={snapshot.tick.toLocaleString('pl-PL')} />
        <Stat label="osobniki" value={snapshot.population} />
        <Stat label="płeć (Ż/M)" value={`${snapshot.femaleCount} / ${snapshot.maleCount}`} />
        <Stat label="jedzenie" value={snapshot.foodCount} />
        <Stat label="duże jedzenie" value={snapshot.cooperativeFoodCount} />
        <Stat label="pokolenie" value={snapshot.maxGeneration} />
        <Stat label="śr. wiek" value={snapshot.avgAge.toFixed(0)} />
        <Stat label="śr. energia" value={snapshot.avgEnergy.toFixed(1)} />
        <Stat label="śr. fitness" value={snapshot.avgFitness.toFixed(1)} />
        <Stat label="różnorodność" value={snapshot.diversity.toFixed(3)} />
        <Stat label="narodziny" value={snapshot.totalBirths.toLocaleString('pl-PL')} />
        <Stat label="zgony" value={snapshot.totalDeaths.toLocaleString('pl-PL')} />
        <Stat label="zjedzone" value={snapshot.totalFoodEaten.toLocaleString('pl-PL')} />
        <Stat label="wspólne zbiory" value={snapshot.totalCooperativeHarvests.toLocaleString('pl-PL')} />
        <Stat label="mutacje" value={snapshot.totalMutations.toLocaleString('pl-PL')} />
      </div>

      <h2>Wykresy</h2>
      <LineChart title="Populacja i zasoby" series={series.population} yMin={0} />
      <LineChart title="Wiek i energia" series={series.vital} yMin={0} />
      <LineChart title="Narodziny / zgony" series={series.flow} yMin={0} />
      <LineChart title="Pokolenia i różnorodność" series={series.evolution} yMin={0} />
      <LineChart title="Ewolucja cech" series={series.traits} yMin={0} />

      <div className="perf">
        {snapshot.fps.toFixed(0)} FPS · tick {snapshot.tickMs.toFixed(2)} ms
      </div>
    </div>
  );
}
