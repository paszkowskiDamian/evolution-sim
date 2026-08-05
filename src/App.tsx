import { FormEvent, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { RECIPES } from './sandbox/recipes';
import { TinyLlmController } from './sandbox/TinyLlmController';
import type { Agent, AgentAction } from './sandbox/types';
import { WorldEngine } from './sandbox/WorldEngine';
import { WorldView } from './sandbox/WorldView';
import './ui/ui.css';

function Bar({ value, tone }: { value: number; tone: 'energy' | 'health' }) {
  return <div className={`meter ${tone}`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
function InventoryView({ agent }: { agent: Agent }) {
  const items = [
    ['🥕', 'food', agent.inventory.food],
    ['🪵', 'wood', agent.inventory.wood],
    ['🪨', 'stone', agent.inventory.stone],
    ['⛏️', 'pickaxe', agent.inventory.pickaxe],
    ['🗡️', 'sword', agent.inventory.sword],
    ['🏕️', 'kit', agent.inventory.shelterKit],
  ] as const;
  return <div className="inventory">{items.map(([icon, label, amount]) => (
    <div className="inventory-item" key={label}><span>{icon}</span><b>{Math.floor(amount)}</b><small>{label}</small></div>
  ))}</div>;
}

export default function App() {
  const engine = useMemo(() => new WorldEngine(), []);
  const controller = useMemo(() => new TinyLlmController(), []);
  const snapshot = useSyncExternalStore(engine.subscribe.bind(engine), engine.getSnapshot, engine.getSnapshot);
  const [modelProgress, setModelProgress] = useState({ value: 0, label: 'Waiting' });
  const [speech, setSpeech] = useState('');
  const human = snapshot.agents.find((agent) => agent.controlledBy === 'human');
  const selected = snapshot.agents.find((agent) => agent.id === snapshot.selectedAgentId) ?? human;

  const loadModel = useCallback(async () => {
    if (engine.modelStatus === 'loading' || engine.modelStatus === 'ready') return;
    engine.setModelStatus('loading');
    try {
      await controller.load((value, label) => setModelProgress({ value, label }));
      engine.setPlanner((perception) => controller.decide(perception), 'ready');
    } catch (error) {
      console.error(error);
      engine.setModelStatus('error');
    }
  }, [controller, engine]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadModel(), 900);
    return () => window.clearTimeout(timer);
  }, [loadModel]);

  const humanAction = (action: Omit<AgentAction, 'targetId'> | AgentAction) => {
    if (human) engine.performAction(human.id, action as AgentAction);
  };

  const submitSpeech = (event: FormEvent) => {
    event.preventDefault();
    if (speech.trim()) engine.humanSpeak(speech);
    setSpeech('');
  };

  const targetIsAi = selected && selected.controlledBy === 'ai';

  return (
    <div className="new-app">
      <WorldView engine={engine} />

      <header className="topbar glass">
        <div className="brand">
          <span className="brand-mark">◇</span>
          <div><b>COMMON GROUND</b><small>tiny minds · open world</small></div>
        </div>
        <div className="world-stats">
          <span>DAY <b>{snapshot.day}</b></span>
          <span>POPULATION <b>{snapshot.agents.length}/6</b></span>
          <span>VILLAGE <b>LV {snapshot.village.level}</b></span>
        </div>
        <button className={`model-pill ${snapshot.modelStatus}`} onClick={() => void loadModel()}>
          <i />
          {snapshot.modelStatus === 'ready' && 'SmolLM2 · local'}
          {snapshot.modelStatus === 'loading' && `Loading tiny mind · ${Math.round(modelProgress.value)}%`}
          {snapshot.modelStatus === 'heuristic' && 'Wake tiny minds'}
          {snapshot.modelStatus === 'error' && 'Model failed · retry'}
        </button>
      </header>

      <aside className="agent-card glass">
        {selected ? <>
          <div className="agent-heading">
            <span className="portrait" style={{ background: selected.color }}>{selected.controlledBy === 'human' ? 'YOU' : selected.name[0]}</span>
            <div><small>{selected.controlledBy === 'human' ? 'YOUR CHARACTER' : `${selected.role.toUpperCase()} · GEN ${selected.generation}`}</small><h2>{selected.name}</h2></div>
            {selected.id !== human?.id && <button className="close" onClick={() => engine.selectAgent(human?.id ?? null)}>×</button>}
          </div>
          <div className="vital"><label><span>Health</span><b>{selected.health.toFixed(0)}</b></label><Bar value={selected.health} tone="health" /></div>
          <div className="vital"><label><span>Energy</span><b>{selected.energy.toFixed(0)}</b></label><Bar value={selected.energy} tone="energy" /></div>
          <InventoryView agent={selected} />
          <div className="mind">
            <small>LONG-TERM GOAL</small>
            <p className="mission">{selected.mission}</p>
            <small>CURRENT INTENTION</small>
            <p>{selected.goal}</p>
            <blockquote>{selected.thought}</blockquote>
          </div>
          {targetIsAi && <div className="social-actions">
            <button onClick={() => human && engine.performAction(human.id, { type: 'say', message: `${selected.name}, come help me build.` })}>Talk</button>
            <button onClick={() => human && engine.performAction(human.id, { type: 'reproduce', targetId: selected.id, reason: 'You ask for mutual reproduction.' })}>Propose</button>
            <button className="danger" onClick={() => human && engine.performAction(human.id, { type: 'attack', targetId: selected.id, reason: 'You choose to fight.' })}>Fight</button>
          </div>}
        </> : <p>Your character is no longer alive. Reset the valley to begin again.</p>}
      </aside>

      <aside className="event-card glass">
        <div className="village-plan">
          <div className="section-title"><span>VILLAGE PLAN · LV {snapshot.village.level}</span><i>{snapshot.village.contributions} GIVEN</i></div>
          <h3>{snapshot.village.nextProject.label}</h3>
          <div className="stockpile">
            <span>🥕 <b>{snapshot.village.stockpile.food}</b>/{snapshot.village.nextProject.costs.food}</span>
            <span>🪵 <b>{snapshot.village.stockpile.wood}</b>/{snapshot.village.nextProject.costs.wood}</span>
            <span>🪨 <b>{snapshot.village.stockpile.stone}</b>/{snapshot.village.nextProject.costs.stone}</span>
          </div>
        </div>
        <div className="section-title"><span>WORLD LOG</span><i>LIVE</i></div>
        <div className="events">{snapshot.events.slice(0, 7).map((event) => (
          <div className={`event ${event.tone}`} key={event.id}><time>{event.tick}</time><p>{event.text}</p></div>
        ))}</div>
      </aside>

      <section className="action-dock glass">
        <div className="movement-help"><kbd>W</kbd><div><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div><small>MOVE</small></div>
        <button className="primary-action" onClick={() => engine.humanInteract()}><span>E</span><b>Interact</b><small>gather · mine · greet</small></button>
        <button onClick={() => humanAction({ type: 'deposit', reason: 'You contribute your resources.' })}><span>📦</span><b>Contribute</b></button>
        <button onClick={() => humanAction({ type: 'rest', reason: 'You stop to eat and recover.' })}><span>🍲</span><b>Eat / rest</b></button>
        {RECIPES.slice(0, 3).map((recipe) => <button key={recipe.name} onClick={() => humanAction({ type: 'craft', recipe: recipe.name, reason: `You craft ${recipe.label}.` })}>
          <span>{recipe.name === 'pickaxe' ? '⛏️' : recipe.name === 'sword' ? '🗡️' : '🏕️'}</span><b>{recipe.label}</b>
        </button>)}
        <button onClick={() => humanAction({ type: 'build', structure: snapshot.village.nextProject.kind, x: snapshot.village.nextProject.site.x, z: snapshot.village.nextProject.site.z, reason: `You help complete ${snapshot.village.nextProject.label}.` })}><span>🔨</span><b>Build plan</b></button>
      </section>

      <form className="speech-box glass" onSubmit={submitSpeech}>
        <span>💬</span>
        <input value={speech} onChange={(event) => setSpeech(event.target.value)} placeholder="Say something to nearby minds…" maxLength={90} />
        <button type="submit">SEND</button>
      </form>

      <div className="world-controls glass">
        <button onClick={() => engine.setRunning(!snapshot.running)}>{snapshot.running ? 'Ⅱ' : '▶'}</button>
        <button onClick={() => engine.reset()}>↻</button>
      </div>

      {snapshot.modelStatus === 'loading' && <div className="model-progress glass">
        <b>Downloading a shared 4-bit SmolLM2-135M model</b>
        <span>{modelProgress.label}</span>
        <div><i style={{ width: `${modelProgress.value}%` }} /></div>
        <small>It runs locally after download. Agents use simple survival instincts while it loads.</small>
      </div>}
    </div>
  );
}
