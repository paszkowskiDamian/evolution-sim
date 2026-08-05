import assert from 'node:assert/strict';
import { Simulation } from '../src/core/simulation/simulation';
import { SpatialIndexSystem } from '../src/core/systems/SpatialIndexSystem';
import { CooperativeFoodSystem } from '../src/core/systems/CooperativeFoodSystem';
import { FOOD_COOPERATIVE } from '../src/core/world/food';

const sim = new Simulation({
  seed: 91,
  worldSize: 500,
  initialPopulation: 3,
  maxPopulation: 3,
  minPopulation: 0,
  maxFood: 0,
  foodSpawnRate: 0,
  maxCooperativeFood: 2,
  cooperativeFoodSpawnRate: 0,
  cooperativeFoodRequiredAgents: 2,
  cooperativeFoodWorkTicks: 3,
  cooperativeFoodEnergy: 20,
  caveFillProbability: 0,
  caveIterations: 1,
});

const [a, b, bystander] = sim.world.agents;
for (const agent of sim.world.agents) {
  agent.x = 250;
  agent.y = 250;
  agent.energy = 10;
  agent.brain.outputs.fill(-1);
}
a.x = 246;
b.x = 254;
bystander.x = 250;

const foodId = sim.world.food.spawn(250, 250, FOOD_COOPERATIVE);
assert.ok(foodId >= 0);

const spatial = new SpatialIndexSystem();
const cooperative = new CooperativeFoodSystem();
spatial.update(sim.world);

// Samotna próba nigdy nie buduje postępu.
a.brain.outputs[3] = 1;
cooperative.update(sim.world);
assert.equal(sim.world.food.cooperationProgress[foodId], 0);
assert.equal(sim.world.events.cooperativeHarvests, 0);

// Dwóch aktywnych współpracowników musi utrzymać akcję przez pełne trzy ticki.
b.brain.outputs[3] = 1;
cooperative.update(sim.world);
assert.equal(sim.world.food.cooperationProgress[foodId], 1);
b.brain.outputs[3] = -1;
cooperative.update(sim.world);
assert.equal(sim.world.food.cooperationProgress[foodId], 0, 'przerwanie współpracy zeruje postęp');
b.brain.outputs[3] = 1;
cooperative.update(sim.world);
assert.equal(sim.world.food.cooperationProgress[foodId], 1);
cooperative.update(sim.world);
assert.equal(sim.world.food.cooperationProgress[foodId], 2);
cooperative.update(sim.world);

assert.equal(sim.world.food.alive[foodId], 0);
assert.equal(sim.world.events.cooperativeHarvests, 1);
assert.equal(sim.world.events.cooperativeParticipants, 2);
assert.equal(a.energy, 30);
assert.equal(b.energy, 30);
assert.equal(bystander.energy, 10, 'bierny obserwator nie może dostać nagrody');
assert.deepEqual(sim.world.cooperationEvents[0].participantIds, [a.id, b.id]);

console.log('OK: duże jedzenie wymaga dwóch aktywnych agentów, ciągłej pracy i nagradza tylko uczestników.');
