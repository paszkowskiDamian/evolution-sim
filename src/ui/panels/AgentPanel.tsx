import type { AgentView } from '../../shared/types';
import { SENSOR_LABELS, OUTPUT_LABELS } from '../../core/neural/network';
import { hslToRgb } from '../../core/utils/math';

function hueCss(hue: number): string {
  const rgb = hslToRgb(hue, 0.72, 0.55);
  return '#' + rgb.toString(16).padStart(6, '0');
}

/** Pasek wartości z zakresu -1..1 (aktywacje) albo 0..1 (energia). */
function Bar({ value, signed = true }: { value: number; signed?: boolean }) {
  const v = Math.max(-1, Math.min(1, value));
  const width = signed ? Math.abs(v) * 50 : v * 100;
  const left = signed ? (v < 0 ? 50 - width : 50) : 0;
  return (
    <div className="bar">
      {signed && <div className="bar-mid" />}
      <div
        className="bar-fill"
        style={{
          left: `${left}%`,
          width: `${width}%`,
          background: v < 0 ? '#f87171' : '#4ade80',
        }}
      />
    </div>
  );
}

interface Props {
  agent: AgentView | null;
  onFollow: (id: number | null) => void;
  onClear: () => void;
}

export function AgentPanel({ agent, onFollow, onClear }: Props) {
  if (!agent) {
    return (
      <div className="panel">
        <h2>Agent</h2>
        <p className="muted">Kliknij osobnika na planszy, żeby zajrzeć mu do głowy.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>
        <span className="dot" style={{ background: hueCss(agent.hue) }} />
        Agent #{agent.id}
      </h2>

      <div className="row-buttons">
        <button onClick={() => onFollow(agent.id)}>Śledź</button>
        <button onClick={() => onFollow(null)}>Przestań</button>
        <button onClick={onClear}>Odznacz</button>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">energia</span>
          <span className="stat-value">{agent.energy.toFixed(1)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">zdrowie</span>
          <span className="stat-value">
            {agent.health.toFixed(0)} / {agent.maxHealth.toFixed(0)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">niesie</span>
          <span className="stat-value">{agent.carrying ? 'kamień' : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">płeć</span>
          <span className="stat-value">{agent.gender === 1 ? '♂' : '♀'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">wiek</span>
          <span className="stat-value">{agent.age}</span>
        </div>
        <div className="stat">
          <span className="stat-label">pokolenie</span>
          <span className="stat-value">{agent.generation}</span>
        </div>
        <div className="stat">
          <span className="stat-label">matka</span>
          <span className="stat-value">{agent.motherId > 0 ? `#${agent.motherId}` : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">ojciec</span>
          <span className="stat-value">{agent.fatherId > 0 ? `#${agent.fatherId}` : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">dzieci</span>
          <span className="stat-value">{agent.childrenCount}</span>
        </div>
        <div className="stat">
          <span className="stat-label">zjedzone</span>
          <span className="stat-value">{agent.foodEaten}</span>
        </div>
        <div className="stat">
          <span className="stat-label">fitness</span>
          <span className="stat-value">{agent.fitness.toFixed(1)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">prędkość</span>
          <span className="stat-value">{agent.speed.toFixed(2)}</span>
        </div>
      </div>

      <h3>Fenotyp (z genów)</h3>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">promień</span>
          <span className="stat-value">{agent.radius.toFixed(1)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">v max</span>
          <span className="stat-value">{agent.maxSpeed.toFixed(2)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">wzrok</span>
          <span className="stat-value">{agent.visionRadius.toFixed(0)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">metabolizm</span>
          <span className="stat-value">{agent.metabolism.toFixed(2)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">próg rozrodu</span>
          <span className="stat-value">{(agent.reproThreshold * 100).toFixed(0)}%</span>
        </div>
      </div>

      <h3>Wejścia sieci</h3>
      <div className="neuro">
        {agent.inputs.map((v, i) => (
          <div className="neuro-row" key={i}>
            <span>{SENSOR_LABELS[i]}</span>
            <Bar value={v} />
            <b>{v.toFixed(2)}</b>
          </div>
        ))}
      </div>

      <h3>Warstwa ukryta (ostatnia)</h3>
      <div className="hidden-row">
        {agent.hidden.map((v, i) => (
          <div
            key={i}
            className="hidden-cell"
            title={v.toFixed(3)}
            style={{
              background: v < 0 ? '#f87171' : '#4ade80',
              opacity: 0.15 + Math.abs(v) * 0.85,
            }}
          />
        ))}
      </div>

      <h3>Pamięć (stan ukryty, warstwa 0)</h3>
      <p className="muted small">
        Przenoszony między tickami — to jedyny mechanizm pamięci agenta.
      </p>
      <div className="hidden-row">
        {agent.hiddenState.map((v, i) => (
          <div
            key={i}
            className="hidden-cell"
            title={v.toFixed(3)}
            style={{
              background: v < 0 ? '#f87171' : '#4ade80',
              opacity: 0.15 + Math.abs(v) * 0.85,
            }}
          />
        ))}
      </div>

      <h3>Wyjścia</h3>
      <div className="neuro">
        {agent.outputs.map((v, i) => (
          <div className="neuro-row" key={i}>
            <span>{OUTPUT_LABELS[i]}</span>
            <Bar value={v} />
            <b>{v.toFixed(2)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
