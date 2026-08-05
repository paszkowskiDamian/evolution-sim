import assert from 'node:assert/strict';
import { parseAction, parseChoice } from '../src/sandbox/TinyLlmController';
import { villageGoalAction } from '../src/sandbox/village';
import { WorldEngine } from '../src/sandbox/WorldEngine';

const world = new WorldEngine();
world.setRunning(false);
const human = world.human;
assert(human, 'world should contain a human-controlled character');
assert.equal(world.agents.filter((agent) => agent.controlledBy === 'ai').length, 3, 'world should start with three AI agents');
assert.equal(world.agents.filter((agent) => agent.alive).length, 4, 'minimum starting population should be four');
assert.deepEqual(
  world.agents.filter((agent) => agent.controlledBy === 'ai').map((agent) => agent.role),
  ['forager', 'builder', 'miner'],
  'AI villagers should start with complementary responsibilities',
);

const berries = world.resources.find((resource) => resource.kind === 'berries');
assert(berries);
berries.x = human.x;
berries.z = human.z;
const foodBefore = human.inventory.food;
assert(world.humanInteract(), 'player should interact with nearby food');
assert.equal(human.inventory.food, foodBefore + 1, 'pickup should add food');

human.inventory.wood = 3;
human.inventory.stone = 3;
assert(world.performAction(human.id, { type: 'craft', recipe: 'pickaxe' }), 'valid recipe should craft');
assert.equal(human.inventory.pickaxe, 1);
assert.equal(human.inventory.wood, 1);
assert.equal(human.inventory.stone, 1);

const partner = world.agents.find((agent) => agent.controlledBy === 'ai');
assert(partner);
partner.x = human.x + 1;
partner.z = human.z;
human.energy = 100;
partner.energy = 100;
world.humanSpeak('Let us build a home together.');
assert.equal(partner.inbox.at(-1)?.text, 'Let us build a home together.', 'nearby agents should hear player speech');

const populationBefore = world.agents.filter((agent) => agent.alive).length;
assert(world.performAction(human.id, { type: 'reproduce', targetId: partner.id }));
assert.equal(world.agents.filter((agent) => agent.alive).length, populationBefore, 'one-sided request must not produce a child');
assert(world.performAction(partner.id, { type: 'reproduce', targetId: human.id }));
assert.equal(world.agents.filter((agent) => agent.alive).length, populationBefore + 1, 'mutual nearby requests should produce a child');

const villageWorld = new WorldEngine();
villageWorld.setRunning(false);
const contributor = villageWorld.agents.find((agent) => agent.role === 'builder');
const receiver = villageWorld.agents.find((agent) => agent.role === 'forager');
assert(contributor && receiver);
contributor.x = 0;
contributor.z = 0;
contributor.inventory.food = 3;
contributor.inventory.wood = 6;
contributor.inventory.stone = 3;
assert(villageWorld.performAction(contributor.id, { type: 'deposit' }), 'villager should deposit supplies at home');
assert.deepEqual(villageWorld.village.stockpile, { food: 2, wood: 6, stone: 3 }, 'deposit should preserve one personal meal and pool building resources');
assert.equal(villageWorld.village.contributions, 11);

contributor.inventory.food = 2;
receiver.x = contributor.x + 1;
receiver.z = contributor.z;
receiver.energy = 20;
assert(villageWorld.performAction(contributor.id, { type: 'share', targetId: receiver.id, item: 'food', amount: 1 }), 'nearby villager should share food');
assert.equal(receiver.inventory.food, 2);

const project = villageWorld.village.nextProject;
assert.equal(project.kind, 'storehouse');
assert(villageWorld.performAction(contributor.id, { type: 'build', structure: project.kind, x: project.site.x, z: project.site.z }), 'pooled supplies should complete the village project');
assert(villageWorld.structures.some((structure) => structure.kind === 'storehouse'));
assert.equal(villageWorld.village.level, 1);
assert.equal(villageWorld.village.nextProject.kind, 'workshop');

contributor.x = 15;
contributor.inventory.wood = 3;
const responsibility = villageGoalAction(villageWorld.getPerception(contributor));
assert.equal(responsibility.type, 'move', 'loaded worker away from home should return to the village');
if (responsibility.type === 'move') assert.deepEqual({ x: responsibility.x, z: responsibility.z }, { x: 0, z: 0 });

receiver.x = contributor.x + 1;
receiver.z = contributor.z;
assert.equal(villageWorld.performAction(contributor.id, { type: 'attack', targetId: receiver.id }), false, 'AI villagers must not attack teammates');

assert.deepEqual(
  parseAction('draft... {"type":"say","message":"Stone here","reason":"coordinate"}'),
  { type: 'say', message: 'Stone here', reason: 'coordinate' },
  'tiny-model JSON should become a validated action',
);
assert.equal(parseAction('{"type":"erase_world"}'), null, 'unknown model actions must be rejected');
assert.equal(parseChoice('<choice>3</choice>', 5), 2, 'model menu choice should resolve to its safe action');
assert.equal(parseChoice('The first one is correct.', 5), 0, 'small-model ordinal answers should be accepted');
assert.equal(parseChoice('99', 5), null, 'out-of-range model choices must be rejected');

const autonomousWorld = new WorldEngine();
for (let tick = 0; tick < 3_000; tick += 1) {
  autonomousWorld.update(0.1);
  if (tick % 10 === 0) await Promise.resolve();
}
assert(autonomousWorld.village.contributions > 0, 'goal policy should autonomously contribute resources');
assert(autonomousWorld.structures.some((structure) => structure.kind === 'storehouse'), 'goal policy should autonomously build the first village project');
assert(autonomousWorld.structures.some((structure) => structure.kind === 'workshop'), 'goal policy should autonomously advance to the workshop');

console.log('OK: roles, shared stockpile, food sharing, village construction, player actions, reproduction, and safe LLM control');
