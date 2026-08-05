export type ResourceKind = 'berries' | 'wood' | 'rock';
export type ItemKind = 'food' | 'wood' | 'stone' | 'pickaxe' | 'sword' | 'shelterKit';
export type StructureKind = 'shelter' | 'wall';

export interface Point {
  x: number;
  z: number;
}

export interface Inventory {
  food: number;
  wood: number;
  stone: number;
  pickaxe: number;
  sword: number;
  shelterKit: number;
}

export interface WorldResource extends Point {
  id: string;
  kind: ResourceKind;
  amount: number;
  capacity: number;
}

export interface Structure extends Point {
  id: string;
  kind: StructureKind;
  ownerId: string;
  rotation: number;
}

export interface Message {
  from: string;
  text: string;
  tick: number;
}

export interface Agent extends Point {
  id: string;
  name: string;
  color: string;
  controlledBy: 'ai' | 'human';
  health: number;
  energy: number;
  age: number;
  generation: number;
  inventory: Inventory;
  goal: string;
  thought: string;
  speech: string;
  speechUntil: number;
  target: Point | null;
  inbox: Message[];
  memories: string[];
  alive: boolean;
  pendingMateId: string | null;
  decisionAt: number;
  busyUntil: number;
}

export type AgentAction =
  | { type: 'move'; x: number; z: number; reason?: string }
  | { type: 'say'; message: string; reason?: string }
  | { type: 'pickup'; resourceId: string; reason?: string }
  | { type: 'dig'; resourceId: string; reason?: string }
  | { type: 'craft'; recipe: RecipeName; reason?: string }
  | { type: 'build'; structure: StructureKind; x?: number; z?: number; reason?: string }
  | { type: 'attack'; targetId: string; reason?: string }
  | { type: 'reproduce'; targetId: string; reason?: string }
  | { type: 'rest'; reason?: string };

export type RecipeName = 'pickaxe' | 'sword' | 'shelterKit' | 'meal';

export interface Recipe {
  name: RecipeName;
  label: string;
  costs: Partial<Inventory>;
  produces: Partial<Inventory>;
}

export interface WorldEvent {
  id: number;
  tick: number;
  text: string;
  tone: 'neutral' | 'good' | 'danger';
}

export interface WorldSnapshot {
  tick: number;
  day: number;
  running: boolean;
  modelStatus: ModelStatus;
  selectedAgentId: string | null;
  agents: Agent[];
  resources: WorldResource[];
  structures: Structure[];
  events: WorldEvent[];
}

export type ModelStatus = 'heuristic' | 'loading' | 'ready' | 'error';

export interface AgentPerception {
  self: Agent;
  nearbyAgents: Array<Pick<Agent, 'id' | 'name' | 'x' | 'z' | 'health' | 'energy' | 'speech'>>;
  nearbyResources: WorldResource[];
  nearbyStructures: Structure[];
  recipes: Recipe[];
  day: number;
}
