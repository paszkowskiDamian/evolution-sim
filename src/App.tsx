import { useSimulation } from './ui/useSimulation';
import { StatsPanel } from './ui/panels/StatsPanel';
import { AgentPanel } from './ui/panels/AgentPanel';
import { Controls } from './ui/controls/Controls';
import './ui/ui.css';

export default function App() {
  const sim = useSimulation();

  return (
    <div className="app">
      <aside className="sidebar">
        <Controls
          running={sim.running}
          speed={sim.speed}
          config={sim.config}
          onRunning={sim.setRunning}
          onSpeed={sim.setSpeed}
          onStep={sim.stepOnce}
          onReset={sim.reset}
          onFit={sim.fitWorld}
        />
        <AgentPanel agent={sim.selected} onFollow={sim.follow} onClear={sim.clearSelection} />
      </aside>

      <main className="stage" ref={sim.hostRef}>
        <div className="hud">
          tick <b>{sim.snapshot.tick.toLocaleString('pl-PL')}</b> · osobniki{' '}
          <b>{sim.snapshot.population}</b> · pokolenie <b>{sim.snapshot.maxGeneration}</b> ·{' '}
          <b>{sim.snapshot.fps.toFixed(0)}</b> FPS
          {!sim.ready && ' · inicjalizacja…'}
        </div>
      </main>

      <aside className="sidebar right">
        <StatsPanel snapshot={sim.snapshot} />
      </aside>
    </div>
  );
}
