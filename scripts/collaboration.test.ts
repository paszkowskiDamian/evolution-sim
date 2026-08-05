import assert from 'node:assert/strict';
import { Simulation } from '../src/core/simulation/simulation';
import { SpatialIndexSystem } from '../src/core/systems/SpatialIndexSystem';
import { CooperativeFoodSystem } from '../src/core/systems/CooperativeFoodSystem';
import { FOOD_COOPERATIVE } from '../src/core/world/food';
import { AttackSystem } from '../src/core/systems/AttackSystem';
import { ReproductionSystem } from '../src/core/systems/ReproductionSystem';
import {
  MEMORY_READ_ADDRESS_OUTPUT,
  MEMORY_WRITE_ADDRESS_OUTPUT,
  MEMORY_WRITE_VALUE_OUTPUT,
  MEMORY_WRITE_GATE_OUTPUT,
} from '../src/core/neural/network';

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

// Członkowie tej samej aktywnej drużyny nie są celami, a atak na outsidera
// korzysta z mnożnika siły współpracy.
const combat = new Simulation({
  seed: 92,
  worldSize: 500,
  initialPopulation: 3,
  maxPopulation: 3,
  minPopulation: 0,
  maxFood: 0,
  maxCooperativeFood: 0,
  caveFillProbability: 0,
  caveIterations: 1,
  attackRange: 30,
  attackDamageBase: 10,
  cooperativeCombatMultiplier: 2,
  combatMaturationTicks: 0,
});
const [attacker, teammate, outsider] = combat.world.agents;
for (const agent of combat.world.agents) {
  agent.x = 250;
  agent.y = 250;
  agent.age = 1000;
  agent.brain.outputs.fill(-1);
}
teammate.x = 252;
outsider.x = 256;
attacker.cooperatingFoodId = 7;
teammate.cooperatingFoodId = 7;
attacker.brain.outputs[4] = 1;
new SpatialIndexSystem().update(combat.world);
const teammateHealth = teammate.health;
const outsiderHealth = outsider.health;
new AttackSystem().update(combat.world);
assert.equal(teammate.health, teammateHealth, 'współpracownik nie może zostać zaatakowany');
const expectedDamage = 10 * (0.4 + attacker.phenotype.aggression) * 2;
assert.ok(Math.abs(outsider.health - (outsiderHealth - expectedDamage)) < 1e-6);

// Płeć nie ogranicza pary, ale dodatnią decyzję nadal muszą wydać oboje.
function reproductionAttempt(secondWants: boolean): number {
  const reproduction = new Simulation({
    seed: 93,
    worldSize: 500,
    initialPopulation: 2,
    maxPopulation: 3,
    minPopulation: 0,
    maxFood: 0,
    maxCooperativeFood: 0,
    caveFillProbability: 0,
    caveIterations: 1,
  });
  const [first, second] = reproduction.world.agents;
  first.phenotype.gender = 0;
  second.phenotype.gender = 0;
  for (const agent of reproduction.world.agents) {
    agent.x = 250;
    agent.y = 250;
    agent.age = reproduction.config.maturityAge;
    agent.energy = reproduction.config.maxEnergy;
    agent.brain.outputs.fill(-1);
  }
  first.brain.outputs[2] = 1;
  second.brain.outputs[2] = secondWants ? 1 : -1;
  new SpatialIndexSystem().update(reproduction.world);
  new ReproductionSystem().update(reproduction.world);
  return reproduction.world.pendingBirths.length;
}
assert.equal(reproductionAttempt(true), 1, 'dwa osobniki tej samej płci mogą się rozmnożyć');
assert.equal(reproductionAttempt(false), 0, 'jednostronna decyzja nie wystarcza');

// Jawny bank pamięci zapisuje i odczytuje dane wyłącznie przez wyjścia sieci.
assert.ok(attacker.externalMemory.length > attacker.lastInputs.length);
attacker.brain.outputs[MEMORY_WRITE_ADDRESS_OUTPUT] = -1;
attacker.brain.outputs[MEMORY_WRITE_VALUE_OUTPUT] = 0.75;
attacker.brain.outputs[MEMORY_WRITE_GATE_OUTPUT] = 1;
attacker.brain.outputs[MEMORY_READ_ADDRESS_OUTPUT] = -1;
attacker.applyExternalMemoryControls(true);
assert.equal(attacker.externalMemory[0], 0.75);
assert.equal(attacker.memoryReadValue, 0.75);
attacker.applyExternalMemoryControls(false);
assert.equal(attacker.memoryReadValue, 0);
assert.equal(attacker.externalMemory[0], 0);

console.log('OK: drużyny są bezpieczne wewnętrznie, silniejsze w walce, rozmnażają się za zgodą i mają pamięć adresowalną.');
