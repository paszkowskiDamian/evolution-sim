import assert from 'node:assert/strict';
import { parseAction, parseChoice } from '../src/sandbox/TinyLlmController';
import { WorldEngine } from '../src/sandbox/WorldEngine';

const world = new WorldEngine();
world.setRunning(false);
const human = world.human;
assert(human, 'world should contain a human-controlled character');
assert.equal(world.agents.filter((agent) => agent.controlledBy === 'ai').length, 3, 'world should start with three AI agents');
assert.equal(world.agents.filter((agent) => agent.alive).length, 4, 'minimum starting population should be four');

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

assert.deepEqual(
  parseAction('draft... {"type":"say","message":"Stone here","reason":"coordinate"}'),
  { type: 'say', message: 'Stone here', reason: 'coordinate' },
  'tiny-model JSON should become a validated action',
);
assert.equal(parseAction('{"type":"erase_world"}'), null, 'unknown model actions must be rejected');
assert.equal(parseChoice('<choice>3</choice>', 5), 2, 'model menu choice should resolve to its safe action');
assert.equal(parseChoice('The first one is correct.', 5), 0, 'small-model ordinal answers should be accepted');
assert.equal(parseChoice('99', 5), null, 'out-of-range model choices must be rejected');

console.log('OK: 3 AI + player, gathering, crafting, speech, mutual reproduction, and safe LLM actions');
