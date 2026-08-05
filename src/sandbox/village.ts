import type { Agent, AgentAction, AgentPerception, Inventory, Structure, VillageProject } from './types';

export const VILLAGE_CENTER = { x: 0, z: 0 } as const;
export const VILLAGE_RADIUS = 6;

const zeroCost = (food: number, wood: number, stone: number) => ({ food, wood, stone });

export function nextVillageProject(structures: Structure[]): VillageProject {
  if (!structures.some((structure) => structure.kind === 'storehouse')) {
    return { kind: 'storehouse', label: 'Shared storehouse', costs: zeroCost(2, 6, 3), site: { x: 4.5, z: 0 } };
  }
  if (!structures.some((structure) => structure.kind === 'workshop')) {
    return { kind: 'workshop', label: 'Village workshop', costs: zeroCost(2, 8, 6), site: { x: -4.5, z: 0 } };
  }
  const shelters = structures.filter((structure) => structure.kind === 'shelter').length;
  if (shelters < 3) {
    const angle = (shelters / 3) * Math.PI * 2 + Math.PI / 2;
    return {
      kind: 'shelter',
      label: `Cottage ${shelters + 1}/3`,
      costs: zeroCost(2, 6, 4),
      site: { x: Math.cos(angle) * 8, z: Math.sin(angle) * 8 },
    };
  }
  const walls = structures.filter((structure) => structure.kind === 'wall').length;
  const angle = (walls % 12) / 12 * Math.PI * 2;
  return {
    kind: 'wall',
    label: `Village wall ${walls + 1}`,
    costs: zeroCost(0, 3, 2),
    site: { x: Math.cos(angle) * 12, z: Math.sin(angle) * 12 },
  };
}

export function canAffordProject(
  stockpile: Pick<Inventory, 'food' | 'wood' | 'stone'>,
  project: VillageProject,
): boolean {
  return stockpile.food >= project.costs.food
    && stockpile.wood >= project.costs.wood
    && stockpile.stone >= project.costs.stone;
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function desiredResource(agent: Agent, perception: AgentPerception): 'berries' | 'wood' | 'rock' {
  if (agent.role === 'forager') return 'berries';
  if (agent.role === 'miner') return 'rock';
  if (agent.role === 'builder') return 'wood';
  const { costs } = perception.village.nextProject;
  const { stockpile } = perception.village;
  if (stockpile.food < costs.food) return 'berries';
  if (stockpile.stone < costs.stone) return 'rock';
  return 'wood';
}

function shouldDeposit(agent: Agent): boolean {
  return agent.inventory.wood >= 3 || agent.inventory.stone >= 3 || agent.inventory.food >= 4;
}

/** The highest-priority action for an agent's persistent village responsibility. */
export function villageGoalAction(perception: AgentPerception): AgentAction {
  const { self, village } = perception;
  if (self.energy < 58 && self.inventory.food > 0) return { type: 'rest', reason: 'Eat now so I can keep helping the village.' };

  const hungryNeighbor = perception.nearbyAgents.find((agent) => agent.energy < 35 && distance(self, agent) <= 2.8);
  if (hungryNeighbor && self.inventory.food > 1) {
    return { type: 'share', targetId: hungryNeighbor.id, item: 'food', amount: 1, reason: `${hungryNeighbor.name} needs food more than I do.` };
  }

  const atVillage = distance(self, village.center) <= VILLAGE_RADIUS;
  if (shouldDeposit(self)) {
    return atVillage
      ? { type: 'deposit', reason: 'Contribute gathered supplies to our shared stockpile.' }
      : { type: 'move', x: village.center.x, z: village.center.z, reason: 'Carry supplies home for everyone.' };
  }

  if (canAffordProject(village.stockpile, village.nextProject)) {
    return atVillage
      ? { type: 'build', structure: village.nextProject.kind, x: village.nextProject.site.x, z: village.nextProject.site.z, reason: `Complete ${village.nextProject.label} from pooled resources.` }
      : { type: 'move', x: village.center.x, z: village.center.z, reason: `Return home to help build ${village.nextProject.label}.` };
  }

  const desired = desiredResource(self, perception);
  const target = [...perception.nearbyResources]
    .filter((resource) => resource.kind === desired)
    .sort((a, b) => distance(self, a) - distance(self, b))[0]
    ?? [...perception.nearbyResources].sort((a, b) => distance(self, a) - distance(self, b))[0];
  if (target) {
    if (distance(self, target) <= 2.8) {
      return target.kind === 'rock'
        ? { type: 'dig', resourceId: target.id, reason: `Mine stone for ${village.nextProject.label}.` }
        : { type: 'pickup', resourceId: target.id, reason: `Gather ${target.kind} for ${village.nextProject.label}.` };
    }
    return { type: 'move', x: target.x, z: target.z, reason: `Find ${desired} for my ${self.role} responsibility.` };
  }

  return { type: 'move', x: village.center.x, z: village.center.z, reason: 'Return to the village and regroup.' };
}

