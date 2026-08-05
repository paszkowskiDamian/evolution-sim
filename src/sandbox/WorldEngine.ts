import { applyRecipe, canCraft, RECIPES } from './recipes';
import type {
  Agent,
  AgentAction,
  AgentPerception,
  Inventory,
  ModelStatus,
  Point,
  Structure,
  WorldEvent,
  WorldResource,
  WorldSnapshot,
} from './types';

const WORLD_RADIUS = 34;
const INTERACTION_RANGE = 2.8;
const MAX_POPULATION = 6;
const NAMES = ['Luma', 'Orin', 'Sable', 'Tavi', 'Mira', 'Kito'];
const COLORS = ['#ffca6c', '#69d6c5', '#ff7c94', '#97a7ff', '#d5f47a', '#d99cff'];

type Planner = (perception: AgentPerception) => Promise<AgentAction>;

function emptyInventory(): Inventory {
  return { food: 1, wood: 0, stone: 0, pickaxe: 0, sword: 0, shelterKit: 0 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clampWorld(value: number): number {
  return Math.max(-WORLD_RADIUS, Math.min(WORLD_RADIUS, value));
}

function copyAgent(agent: Agent): Agent {
  return {
    ...agent,
    inventory: { ...agent.inventory },
    target: agent.target ? { ...agent.target } : null,
    inbox: agent.inbox.map((message) => ({ ...message })),
    memories: [...agent.memories],
  };
}

/** A tiny, deterministic sandbox. Language models may propose actions, but this class owns all rules. */
export class WorldEngine {
  readonly agents: Agent[] = [];
  readonly resources: WorldResource[] = [];
  readonly structures: Structure[] = [];
  readonly events: WorldEvent[] = [];

  running = true;
  tick = 0;
  selectedAgentId: string | null = null;
  modelStatus: ModelStatus = 'heuristic';

  private planner: Planner | null = null;
  private listeners = new Set<() => void>();
  private eventId = 0;
  private entityId = 0;
  private elapsed = 0;
  private emitElapsed = 0;
  private decisionPending = new Set<string>();
  private randomState = 0x9e3779b9;
  private humanMove = { x: 0, z: 0 };
  private snapshotCache!: WorldSnapshot;

  constructor() {
    this.reset();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot = (): WorldSnapshot => this.snapshotCache;

  setPlanner(planner: Planner | null, status: ModelStatus): void {
    this.planner = planner;
    this.modelStatus = status;
    this.addEvent(status === 'ready' ? 'Tiny LLM is now making agent decisions.' : 'Agents are using local survival instincts.', 'neutral');
    this.emit();
  }

  setModelStatus(status: ModelStatus): void {
    this.modelStatus = status;
    this.emit();
  }

  setRunning(running: boolean): void {
    this.running = running;
    this.emit();
  }

  selectAgent(id: string | null): void {
    this.selectedAgentId = id;
    this.emit();
  }

  reset(): void {
    this.agents.length = 0;
    this.resources.length = 0;
    this.structures.length = 0;
    this.events.length = 0;
    this.tick = 0;
    this.elapsed = 0;
    this.emitElapsed = 0;
    this.eventId = 0;
    this.entityId = 0;
    this.randomState = 0x9e3779b9;
    this.decisionPending.clear();
    this.selectedAgentId = null;

    const starts = [{ x: -4, z: -3 }, { x: 4, z: -3 }, { x: -3, z: 4 }];
    starts.forEach((point, index) => this.spawnAgent(point.x, point.z, 0, index));
    const human = this.spawnAgent(3, 4, 0, 5, 'human');
    human.name = 'You';
    human.goal = 'Explore the valley';
    human.thought = 'WASD to move · E to interact';

    for (let i = 0; i < 18; i += 1) this.spawnResource('berries', 5);
    for (let i = 0; i < 14; i += 1) this.spawnResource('wood', 4);
    for (let i = 0; i < 16; i += 1) this.spawnResource('rock', 7);
    this.addEvent('You and three small minds wake in an untouched valley.', 'good');
    this.emit();
  }

  update(deltaSeconds: number): void {
    if (!this.running) return;
    const dt = Math.min(deltaSeconds, 0.1);
    this.elapsed += dt;
    this.emitElapsed += dt;
    this.tick += 1;

    for (const agent of this.agents) {
      if (!agent.alive) continue;
      agent.age += dt;
      agent.energy = Math.max(0, agent.energy - dt * 0.075);
      if (agent.energy <= 0) agent.health -= dt * 2;
      if (agent.health <= 0) this.kill(agent, `${agent.name} did not survive.`);
      if (agent.controlledBy === 'human') this.moveHuman(agent, dt);
      else this.moveAgent(agent, dt);

      if (agent.pendingMateId && agent.busyUntil < this.elapsed) agent.pendingMateId = null;
      if (agent.controlledBy === 'ai' && agent.decisionAt <= this.elapsed && !this.decisionPending.has(agent.id)) {
        agent.decisionAt = this.elapsed + (this.planner ? 5.5 : 2.2) + this.random() * 0.8;
        void this.requestDecision(agent);
      }
    }

    for (const resource of this.resources) {
      if (resource.kind === 'berries' && resource.amount < resource.capacity) {
        resource.amount = Math.min(resource.capacity, resource.amount + dt * 0.018);
      }
    }

    if (this.emitElapsed >= 0.2) {
      this.emitElapsed = 0;
      this.emit();
    }
  }

  get human(): Agent | undefined {
    return this.agents.find((agent) => agent.controlledBy === 'human' && agent.alive);
  }

  get time(): number {
    return this.elapsed;
  }

  setHumanMove(x: number, z: number): void {
    const length = Math.hypot(x, z);
    this.humanMove = length > 1 ? { x: x / length, z: z / length } : { x, z };
  }

  humanInteract(): boolean {
    const human = this.human;
    if (!human) return false;
    const resource = this.resources
      .filter((candidate) => candidate.amount > 0 && distance(human, candidate) <= INTERACTION_RANGE)
      .sort((a, b) => distance(human, a) - distance(human, b))[0];
    if (resource) {
      return this.performAction(human.id, resource.kind === 'rock'
        ? { type: 'dig', resourceId: resource.id, reason: 'You mine the rock.' }
        : { type: 'pickup', resourceId: resource.id, reason: 'You gather supplies.' });
    }
    const agent = this.agents
      .filter((candidate) => candidate.alive && candidate.id !== human.id && distance(human, candidate) <= INTERACTION_RANGE)
      .sort((a, b) => distance(human, a) - distance(human, b))[0];
    if (agent) return this.performAction(human.id, { type: 'say', message: `Hello ${agent.name}. Want to work together?` });
    return false;
  }

  humanSpeak(message: string): boolean {
    const human = this.human;
    return human ? this.performAction(human.id, { type: 'say', message }) : false;
  }

  getPerception(agent: Agent): AgentPerception {
    const range = 18;
    return {
      self: copyAgent(agent),
      nearbyAgents: this.agents
        .filter((other) => other.alive && other.id !== agent.id && distance(agent, other) <= range)
        .map(({ id, name, x, z, health, energy, speech }) => ({ id, name, x, z, health, energy, speech })),
      nearbyResources: this.resources.filter((resource) => resource.amount > 0.2 && distance(agent, resource) <= range).map((r) => ({ ...r })),
      nearbyStructures: this.structures.filter((structure) => distance(agent, structure) <= range).map((s) => ({ ...s })),
      recipes: RECIPES,
      day: 1 + Math.floor(this.elapsed / 90),
    };
  }

  performAction(agentId: string, action: AgentAction): boolean {
    const agent = this.agents.find((candidate) => candidate.id === agentId && candidate.alive);
    if (!agent) return false;
    agent.thought = (action.reason ?? action.type).slice(0, 100);

    switch (action.type) {
      case 'move':
        agent.target = { x: clampWorld(Number(action.x) || 0), z: clampWorld(Number(action.z) || 0) };
        agent.goal = 'Exploring';
        return true;
      case 'say':
        return this.speak(agent, action.message);
      case 'pickup':
        return this.pickup(agent, action.resourceId);
      case 'dig':
        return this.dig(agent, action.resourceId);
      case 'craft':
        return this.craft(agent, action.recipe);
      case 'build':
        return this.build(agent, action.structure, action.x, action.z);
      case 'attack':
        return this.attack(agent, action.targetId);
      case 'reproduce':
        return this.reproduce(agent, action.targetId);
      case 'rest':
        agent.target = null;
        agent.goal = 'Resting';
        if (agent.inventory.food > 0 && agent.energy < 70) {
          agent.inventory.food -= 1;
          agent.energy = Math.min(100, agent.energy + 34);
          agent.health = Math.min(100, agent.health + 4);
        } else {
          agent.energy = Math.min(100, agent.energy + 0.8);
        }
        return true;
    }
  }

  heuristicAction(perception: AgentPerception): AgentAction {
    const { self } = perception;
    if (self.energy < 62 && self.inventory.food > 0) return { type: 'rest', reason: 'I should eat before working.' };

    const closeResource = perception.nearbyResources
      .filter((resource) => distance(self, resource) <= INTERACTION_RANGE)
      .sort((a, b) => distance(self, a) - distance(self, b))[0];
    if (closeResource) {
      return closeResource.kind === 'rock'
        ? { type: 'dig', resourceId: closeResource.id, reason: 'Stone enables tools and shelter.' }
        : { type: 'pickup', resourceId: closeResource.id, reason: 'Gathering nearby supplies.' };
    }

    const craftable = RECIPES.find((recipe) => canCraft(self.inventory, recipe) && (
      (recipe.name === 'pickaxe' && self.inventory.pickaxe === 0)
      || (recipe.name === 'shelterKit' && self.inventory.shelterKit === 0)
      || recipe.name === 'meal'
    ));
    if (craftable) return { type: 'craft', recipe: craftable.name, reason: `I can make ${craftable.label}.` };
    if (self.inventory.shelterKit > 0) return { type: 'build', structure: 'shelter', reason: 'A shared home will anchor us.' };

    const desired = self.inventory.food < 3 ? 'berries' : self.inventory.wood < 5 ? 'wood' : 'rock';
    const target = perception.nearbyResources
      .filter((resource) => resource.kind === desired)
      .sort((a, b) => distance(self, a) - distance(self, b))[0]
      ?? perception.nearbyResources.sort((a, b) => distance(self, a) - distance(self, b))[0];
    if (target) return { type: 'move', x: target.x, z: target.z, reason: `Looking for ${desired}.` };

    return {
      type: 'move',
      x: self.x + (this.random() - 0.5) * 14,
      z: self.z + (this.random() - 0.5) * 14,
      reason: 'Exploring beyond the known area.',
    };
  }

  private async requestDecision(agent: Agent): Promise<void> {
    this.decisionPending.add(agent.id);
    try {
      const perception = this.getPerception(agent);
      const action = this.planner ? await this.planner(perception) : this.heuristicAction(perception);
      if (agent.alive && !this.performAction(agent.id, action)) {
        this.performAction(agent.id, this.heuristicAction(this.getPerception(agent)));
      }
    } catch (error) {
      agent.thought = 'The model hesitated; instinct took over.';
      this.performAction(agent.id, this.heuristicAction(this.getPerception(agent)));
      console.warn('Agent decision failed', error);
    } finally {
      this.decisionPending.delete(agent.id);
    }
  }

  private moveAgent(agent: Agent, dt: number): void {
    if (!agent.target) return;
    const dx = agent.target.x - agent.x;
    const dz = agent.target.z - agent.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.25) {
      agent.target = null;
      return;
    }
    const speed = 2.25;
    agent.x += (dx / length) * speed * dt;
    agent.z += (dz / length) * speed * dt;
    agent.energy = Math.max(0, agent.energy - dt * 0.05);
  }

  private moveHuman(agent: Agent, dt: number): void {
    if (this.humanMove.x === 0 && this.humanMove.z === 0) return;
    agent.target = null;
    agent.x = clampWorld(agent.x + this.humanMove.x * 4.8 * dt);
    agent.z = clampWorld(agent.z + this.humanMove.z * 4.8 * dt);
    agent.energy = Math.max(0, agent.energy - dt * 0.08);
  }

  private speak(agent: Agent, rawMessage: string): boolean {
    const message = String(rawMessage ?? '').trim().slice(0, 90);
    if (!message) return false;
    agent.speech = message;
    agent.speechUntil = this.elapsed + 6;
    agent.goal = 'Talking';
    for (const other of this.agents) {
      if (!other.alive || other.id === agent.id || distance(agent, other) > 16) continue;
      other.inbox.push({ from: agent.name, text: message, tick: this.tick });
      other.inbox = other.inbox.slice(-5);
      other.memories.push(`${agent.name}: ${message}`);
      other.memories = other.memories.slice(-8);
    }
    this.addEvent(`${agent.name}: “${message}”`, 'neutral');
    return true;
  }

  private pickup(agent: Agent, resourceId: string): boolean {
    const resource = this.resources.find((candidate) => candidate.id === resourceId && candidate.amount >= 1);
    if (!resource || resource.kind === 'rock' || distance(agent, resource) > INTERACTION_RANGE) return false;
    resource.amount -= 1;
    if (resource.kind === 'berries') agent.inventory.food += 1;
    else agent.inventory.wood += 1;
    agent.goal = resource.kind === 'berries' ? 'Gathering food' : 'Collecting wood';
    return true;
  }

  private dig(agent: Agent, resourceId: string): boolean {
    const rock = this.resources.find((candidate) => candidate.id === resourceId && candidate.kind === 'rock' && candidate.amount > 0);
    if (!rock || distance(agent, rock) > INTERACTION_RANGE) return false;
    const mined = agent.inventory.pickaxe > 0 ? 2 : 1;
    rock.amount = Math.max(0, rock.amount - mined);
    agent.inventory.stone += mined;
    agent.energy = Math.max(0, agent.energy - (agent.inventory.pickaxe ? 1.2 : 3));
    agent.goal = 'Mining stone';
    return true;
  }

  private craft(agent: Agent, recipeName: string): boolean {
    const recipe = RECIPES.find((candidate) => candidate.name === recipeName);
    if (!recipe || !canCraft(agent.inventory, recipe)) return false;
    applyRecipe(agent.inventory, recipe);
    agent.goal = `Crafted ${recipe.label}`;
    this.addEvent(`${agent.name} crafted ${recipe.label}.`, 'good');
    return true;
  }

  private build(agent: Agent, kind: 'shelter' | 'wall', rawX?: number, rawZ?: number): boolean {
    if (kind === 'shelter' && agent.inventory.shelterKit < 1) return false;
    if (kind === 'wall' && (agent.inventory.wood < 2 || agent.inventory.stone < 1)) return false;
    if (kind === 'shelter') agent.inventory.shelterKit -= 1;
    else {
      agent.inventory.wood -= 2;
      agent.inventory.stone -= 1;
    }
    const x = clampWorld(Number.isFinite(rawX) ? Number(rawX) : agent.x + 2);
    const z = clampWorld(Number.isFinite(rawZ) ? Number(rawZ) : agent.z + 2);
    this.structures.push({ id: this.id('structure'), kind, ownerId: agent.id, x, z, rotation: this.random() * Math.PI * 2 });
    agent.goal = `Building a ${kind}`;
    this.addEvent(`${agent.name} built a ${kind}.`, 'good');
    return true;
  }

  private attack(agent: Agent, targetId: string): boolean {
    const target = this.agents.find((candidate) => candidate.id === targetId && candidate.alive);
    if (!target || target.id === agent.id || distance(agent, target) > INTERACTION_RANGE) return false;
    const damage = 9 + agent.inventory.sword * 8;
    target.health -= damage;
    agent.energy = Math.max(0, agent.energy - 4);
    agent.goal = `Fighting ${target.name}`;
    this.addEvent(`${agent.name} attacked ${target.name}.`, 'danger');
    if (target.health <= 0) this.kill(target, `${target.name} was killed by ${agent.name}.`);
    return true;
  }

  private reproduce(agent: Agent, targetId: string): boolean {
    const partner = this.agents.find((candidate) => candidate.id === targetId && candidate.alive);
    if (!partner || partner.id === agent.id || distance(agent, partner) > INTERACTION_RANGE || this.agents.filter((a) => a.alive).length >= MAX_POPULATION) return false;
    if (agent.energy < 72 || partner.energy < 72) return false;
    agent.pendingMateId = partner.id;
    agent.busyUntil = this.elapsed + 12;
    agent.goal = `Asking ${partner.name} to reproduce`;
    if (partner.pendingMateId !== agent.id || partner.busyUntil < this.elapsed) return true;

    agent.pendingMateId = null;
    partner.pendingMateId = null;
    agent.energy -= 25;
    partner.energy -= 25;
    const child = this.spawnAgent((agent.x + partner.x) / 2, (agent.z + partner.z) / 2, Math.max(agent.generation, partner.generation) + 1);
    child.memories.push(`My parents are ${agent.name} and ${partner.name}.`);
    this.addEvent(`${agent.name} and ${partner.name} welcomed ${child.name}.`, 'good');
    return true;
  }

  private spawnAgent(
    x: number,
    z: number,
    generation: number,
    paletteIndex = this.agents.length,
    controlledBy: Agent['controlledBy'] = 'ai',
  ): Agent {
    const index = this.agents.length;
    const agent: Agent = {
      id: this.id('agent'),
      name: NAMES[index % NAMES.length],
      color: COLORS[paletteIndex % COLORS.length],
      controlledBy,
      x,
      z,
      health: 100,
      energy: 88,
      age: 0,
      generation,
      inventory: emptyInventory(),
      goal: 'Waking up',
      thought: 'Where am I?',
      speech: '',
      speechUntil: 0,
      target: null,
      inbox: [],
      memories: [],
      alive: true,
      pendingMateId: null,
      decisionAt: this.elapsed + 0.5 + index * 0.45,
      busyUntil: 0,
    };
    this.agents.push(agent);
    return agent;
  }

  private spawnResource(kind: WorldResource['kind'], capacity: number): void {
    const angle = this.random() * Math.PI * 2;
    const radius = 8 + Math.sqrt(this.random()) * (WORLD_RADIUS - 10);
    this.resources.push({
      id: this.id(kind),
      kind,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      amount: capacity,
      capacity,
    });
  }

  private kill(agent: Agent, message: string): void {
    if (!agent.alive) return;
    agent.alive = false;
    agent.target = null;
    this.addEvent(message, 'danger');
    if (this.selectedAgentId === agent.id) this.selectedAgentId = null;
  }

  private addEvent(text: string, tone: WorldEvent['tone']): void {
    this.events.unshift({ id: ++this.eventId, tick: this.tick, text, tone });
    this.events.splice(18);
  }

  private emit(): void {
    this.snapshotCache = {
      tick: this.tick,
      day: 1 + Math.floor(this.elapsed / 90),
      running: this.running,
      modelStatus: this.modelStatus,
      selectedAgentId: this.selectedAgentId,
      agents: this.agents.filter((agent) => agent.alive).map(copyAgent),
      resources: this.resources.map((resource) => ({ ...resource })),
      structures: this.structures.map((structure) => ({ ...structure })),
      events: this.events.map((event) => ({ ...event })),
    };
    for (const listener of this.listeners) listener();
  }

  private id(prefix: string): string {
    return `${prefix}-${++this.entityId}`;
  }

  private random(): number {
    let x = this.randomState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = x >>> 0;
    return this.randomState / 0x1_0000_0000;
  }
}
