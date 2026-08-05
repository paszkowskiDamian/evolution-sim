import { canCraft } from './recipes';
import { villageGoalAction } from './village';
import type { AgentAction, AgentPerception, RecipeName, StructureKind } from './types';

interface ChatMessage { role: 'system' | 'user'; content: string }
type Generator = (prompt: string | ChatMessage[], options: Record<string, unknown>) => Promise<unknown>;

const MODEL_ID = 'HuggingFaceTB/SmolLM2-135M-Instruct';
const TRANSFORMERS_BROWSER_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
const ACTIONS = new Set(['move', 'say', 'pickup', 'dig', 'craft', 'build', 'deposit', 'share', 'attack', 'reproduce', 'rest']);
const RECIPES = new Set<RecipeName>(['pickaxe', 'sword', 'shelterKit', 'meal']);

function extractText(result: unknown): string {
  if (!Array.isArray(result) || result.length === 0) return '';
  const generated = (result[0] as { generated_text?: unknown }).generated_text;
  if (typeof generated === 'string') return generated;
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1] as { content?: unknown } | undefined;
    return typeof last?.content === 'string' ? last.content : '';
  }
  return '';
}

function parseAction(text: string): AgentAction | null {
  const candidates = text.match(/\{[^{}]+\}/g)?.reverse() ?? [];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>;
      if (typeof value.type !== 'string' || !ACTIONS.has(value.type)) continue;
      const reason = typeof value.reason === 'string' ? value.reason.slice(0, 100) : undefined;
      switch (value.type) {
        case 'move':
          if (typeof value.x === 'number' && typeof value.z === 'number') return { type: 'move', x: value.x, z: value.z, reason };
          break;
        case 'say':
          if (typeof value.message === 'string') return { type: 'say', message: value.message.slice(0, 90), reason };
          break;
        case 'pickup':
        case 'dig':
          if (typeof value.resourceId === 'string') return { type: value.type, resourceId: value.resourceId, reason };
          break;
        case 'craft':
          if (typeof value.recipe === 'string' && RECIPES.has(value.recipe as RecipeName)) {
            return { type: 'craft', recipe: value.recipe as RecipeName, reason };
          }
          break;
        case 'build':
          if (value.structure === 'shelter' || value.structure === 'wall' || value.structure === 'storehouse' || value.structure === 'workshop') {
            return {
              type: 'build',
              structure: value.structure as StructureKind,
              x: typeof value.x === 'number' ? value.x : undefined,
              z: typeof value.z === 'number' ? value.z : undefined,
              reason,
            };
          }
          break;
        case 'deposit':
          return { type: 'deposit', reason };
        case 'share':
          if (typeof value.targetId === 'string' && value.item === 'food' && typeof value.amount === 'number') {
            return { type: 'share', targetId: value.targetId, item: 'food', amount: value.amount, reason };
          }
          break;
        case 'attack':
        case 'reproduce':
          if (typeof value.targetId === 'string') return { type: value.type, targetId: value.targetId, reason };
          break;
        case 'rest':
          return { type: 'rest', reason };
      }
    } catch {
      // Small models sometimes emit a draft object before valid JSON; try the next object.
    }
  }
  return null;
}

function compactPerception(perception: AgentPerception): string {
  const { self } = perception;
  const agents = perception.nearbyAgents.map((agent) =>
    `${agent.id}:${agent.name}@${agent.x.toFixed(1)},${agent.z.toFixed(1)} hp${agent.health.toFixed(0)} says=${JSON.stringify(agent.speech)}`,
  ).join('; ') || 'none';
  const resources = perception.nearbyResources.map((resource) =>
    `${resource.id}:${resource.kind}@${resource.x.toFixed(1)},${resource.z.toFixed(1)} amount${resource.amount.toFixed(0)}`,
  ).join('; ') || 'none';
  const messages = self.inbox.slice(-3).map((message) => `${message.from}:${message.text}`).join(' | ') || 'none';
  const memory = self.memories.slice(-4).join(' | ') || 'none';
  return [
    `day=${perception.day} you=${self.id}:${self.name} role=${self.role} mission=${self.mission} position=${self.x.toFixed(1)},${self.z.toFixed(1)}`,
    `health=${self.health.toFixed(0)} energy=${self.energy.toFixed(0)} inventory=${JSON.stringify(self.inventory)}`,
    `village_stockpile=${JSON.stringify(perception.village.stockpile)} next_project=${perception.village.nextProject.label} costs=${JSON.stringify(perception.village.nextProject.costs)}`,
    `agents=[${agents}]`,
    `resources=[${resources}]`,
    `heard=[${messages}] memory=[${memory}]`,
  ].join('\n');
}

function actionLabel(action: AgentAction): string {
  switch (action.type) {
    case 'move': return `move to ${action.x.toFixed(1)},${action.z.toFixed(1)} (${action.reason ?? 'explore'})`;
    case 'say': return `say ${JSON.stringify(action.message)}`;
    case 'pickup': return `pick up ${action.resourceId}`;
    case 'dig': return `mine ${action.resourceId}`;
    case 'craft': return `craft ${action.recipe}`;
    case 'build': return `build ${action.structure}`;
    case 'deposit': return 'deposit carried resources in the village stockpile';
    case 'share': return `share ${action.amount} food with ${action.targetId}`;
    case 'attack': return `attack ${action.targetId}`;
    case 'reproduce': return `ask ${action.targetId} to reproduce`;
    case 'rest': return 'eat or rest';
  }
}

function candidateActions(perception: AgentPerception): AgentAction[] {
  const { self } = perception;
  const priority = villageGoalAction(perception);
  const candidates: AgentAction[] = [priority];
  const nearestResources = [...perception.nearbyResources]
    .sort((a, b) => Math.hypot(self.x - a.x, self.z - a.z) - Math.hypot(self.x - b.x, self.z - b.z))
    .slice(0, 3);
  for (const resource of nearestResources) {
    const close = Math.hypot(self.x - resource.x, self.z - resource.z) <= 2.8;
    if (close) {
      const action: AgentAction = resource.kind === 'rock'
        ? { type: 'dig', resourceId: resource.id, reason: 'Mine nearby stone.' }
        : { type: 'pickup', resourceId: resource.id, reason: `Gather nearby ${resource.kind}.` };
      if (JSON.stringify(action) !== JSON.stringify(priority)) candidates.push(action);
    } else {
      candidates.push({ type: 'move', x: resource.x, z: resource.z, reason: `Travel toward ${resource.kind}.` });
    }
  }
  const other = perception.nearbyAgents[0];
  if (other) {
    const resource = nearestResources[0];
    const message = resource
      ? `${other.name}, I see ${resource.kind} near ${resource.x.toFixed(0)},${resource.z.toFixed(0)}. Let us work together.`
      : `${other.name}, let us explore and build together.`;
    candidates.push({ type: 'say', message, reason: 'Coordinate with a neighbor.' });
    if (Math.hypot(self.x - other.x, self.z - other.z) <= 2.8) {
      if (self.energy >= 72 && other.energy >= 72) candidates.push({ type: 'reproduce', targetId: other.id, reason: 'Seek mutual consent to grow the group.' });
    }
  }
  for (const recipe of perception.recipes) {
    if (canCraft(self.inventory, recipe)) candidates.push({ type: 'craft', recipe: recipe.name, reason: `Make ${recipe.label}.` });
  }
  if (self.inventory.shelterKit > 0) candidates.push({ type: 'build', structure: 'shelter', reason: 'Place a safe shared shelter.' });
  if (self.inventory.wood >= 2 && self.inventory.stone >= 1) candidates.push({ type: 'build', structure: 'wall', reason: 'Place a defensive wall.' });
  if (self.energy < 62) candidates.unshift({ type: 'rest', reason: 'Recover energy and eat if hungry.' });
  else candidates.push({ type: 'rest', reason: 'Pause and recover.' });
  return candidates.slice(0, 9);
}

function parseChoice(text: string, count: number): number | null {
  const tagged = text.match(/<choice>\s*(\d+)\s*<\/choice>/i)?.[1];
  const plain = text.trim().match(/^(\d+)/)?.[1];
  const value = Number(tagged ?? plain);
  if (Number.isInteger(value) && value >= 1 && value <= count) return value - 1;
  const normalized = text.toLowerCase();
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];
  const ordinal = ordinals.findIndex((word) => normalized.includes(word));
  return ordinal >= 0 && ordinal < count ? ordinal : null;
}

export class TinyLlmController {
  private generator: Generator | null = null;
  private queue = Promise.resolve();

  get modelId(): string {
    return MODEL_ID;
  }

  async load(onProgress?: (progress: number, label: string) => void): Promise<void> {
    if (this.generator) return;
    // Runtime-only browser import avoids shipping Transformers.js' Node image/ZIP dependencies.
    const module = await import(/* @vite-ignore */ TRANSFORMERS_BROWSER_URL) as {
      pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<unknown>;
    };
    const device = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
    this.generator = await module.pipeline('text-generation', MODEL_ID, {
      device,
      dtype: 'q4',
      progress_callback: (event: { progress?: number; file?: string; status?: string }) => {
        onProgress?.(event.progress ?? 0, event.file ?? event.status ?? 'Preparing model');
      },
    }) as unknown as Generator;
  }

  decide(perception: AgentPerception): Promise<AgentAction> {
    const task = this.queue.then(() => this.generate(perception));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async generate(perception: AgentPerception): Promise<AgentAction> {
    if (!this.generator) throw new Error('Tiny LLM has not loaded');
    const candidates = candidateActions(perception);
    const menu = candidates.map((action, index) => `${index + 1}: ${actionLabel(action)}`).join('\n');
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You control one villager with a persistent job. Cooperate, share supplies, fulfill your mission, and build the village plan. Choose one numbered action. Reply only with its number.',
      },
      {
        role: 'user',
        content: `${compactPerception(perception)}\nOPTIONS\n${menu}\nReply with one number from 1 to ${candidates.length}.`,
      },
    ];
    const result = await this.generator(messages, {
      max_new_tokens: 8,
      do_sample: false,
      repetition_penalty: 1.08,
      return_full_text: false,
    });
    const output = extractText(result);
    const choice = parseChoice(output, candidates.length);
    // At 135M parameters the model occasionally restates the prompt. Candidate zero is
    // intentionally the strongest valid survival action, so it is a graceful default.
    return candidates[choice ?? 0];
  }
}

export { parseAction, parseChoice };
