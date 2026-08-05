import { useEffect, useState } from 'react';
import { useSimulation } from './ui/useSimulation';
import { StatsPanel } from './ui/panels/StatsPanel';
import { AgentPanel } from './ui/panels/AgentPanel';
import { Controls } from './ui/controls/Controls';
import './ui/ui.css';

type MobileTab = 'controls' | 'agent' | 'stats';

export default function App() {
  const sim = useSimulation();
  const [mobileTab, setMobileTab] = useState<MobileTab>('controls');

  // Na wąskim ekranie zaznaczenie agenta na płótnie ma od razu pokazać jego
  // statystyki — bez tego trzeba by ręcznie przełączyć zakładkę za każdym
  // razem (patrz pierwotna prośba: "chcę widzieć statystyki zaznaczonego
  // agenta"). Na szerokim ekranie ten stan i tak nic nie zmienia w layoucie.
  useEffect(() => {
    if (sim.selected) setMobileTab('agent');
  }, [sim.selected?.id]);

  const cls = (tab: MobileTab) => `mobile-panel${mobileTab === tab ? ' is-active' : ''}`;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className={cls('controls')}>
          <Controls
            running={sim.running}
            speed={sim.speed}
            config={sim.config}
            gpuStatus={sim.gpuStatus}
            editTool={sim.editTool}
            onRunning={sim.setRunning}
            onSpeed={sim.setSpeed}
            onStep={sim.stepOnce}
            onReset={sim.reset}
            onFit={sim.fitWorld}
            onToggleGpu={sim.toggleGpu}
            onEditTool={sim.setEditTool}
          />
        </div>
        <div className={cls('agent')}>
          <AgentPanel agent={sim.selected} onFollow={sim.follow} onClear={sim.clearSelection} />
        </div>
      </aside>

      <main className="stage" ref={sim.hostRef}>
        <div className="hud">
          tick <b>{sim.snapshot.tick.toLocaleString('pl-PL')}</b> · osobniki{' '}
          <b>{sim.snapshot.population}</b> · pokolenie <b>{sim.snapshot.maxGeneration}</b> ·{' '}
          <b>{sim.snapshot.fps.toFixed(0)}</b> FPS
          {!sim.ready && ' · inicjalizacja…'}
        </div>
        <div className="render-toggle" role="group" aria-label="Rendering style">
          <button
            className={sim.renderMode === 'classic' ? 'active' : ''}
            aria-pressed={sim.renderMode === 'classic'}
            onClick={() => sim.setRenderMode('classic')}
          >
            Classic
          </button>
          <button
            className={sim.renderMode === 'sprites' ? 'active' : ''}
            aria-pressed={sim.renderMode === 'sprites'}
            onClick={() => sim.setRenderMode('sprites')}
          >
            Sprites
          </button>
        </div>
      </main>

      <aside className="sidebar right">
        <div className={cls('stats')}>
          <StatsPanel snapshot={sim.snapshot} />
        </div>
      </aside>

      <nav className="mobile-tabbar">
        <button className={mobileTab === 'controls' ? 'active' : ''} onClick={() => setMobileTab('controls')}>
          Sterowanie
        </button>
        <button className={mobileTab === 'agent' ? 'active' : ''} onClick={() => setMobileTab('agent')}>
          Agent{sim.selected ? ' ●' : ''}
        </button>
        <button className={mobileTab === 'stats' ? 'active' : ''} onClick={() => setMobileTab('stats')}>
          Statystyki
        </button>
      </nav>
    </div>
  );
}
