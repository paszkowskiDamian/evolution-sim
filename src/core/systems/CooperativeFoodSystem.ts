import type { System } from './System';
import type { World } from '../world/world';
import { FOOD_COOPERATIVE } from '../world/food';
import { consumeFoodEnergy } from './FoodSystem';

/**
 * Duże zasoby wymagające równoczesnej pracy kilku agentów.
 *
 * Ta mechanika nie przyznaje abstrakcyjnego fitnessu. Agent musi być blisko,
 * mieć dostępną akcję chwytu i aktywować jej wyjście. Dopiero ciągła praca
 * wymaganej liczby najbliższych uczestników daje każdemu zwykłą energię,
 * która może przełożyć się na przeżycie i prawdziwe potomstwo.
 */
export class CooperativeFoodSystem implements System {
  readonly name = 'CooperativeFoodSystem';

  private participantIds = new Int32Array(0);
  private participantDist2 = new Float64Array(0);
  private bufferCapacity = 0;
  private bufferRequired = 0;

  update(world: World): void {
    const cfg = world.config;
    const food = world.food;
    const required = Math.max(1, Math.floor(cfg.cooperativeFoodRequiredAgents));
    this.ensureBuffers(food.capacity, required);
    this.participantIds.fill(-1);
    this.participantDist2.fill(Infinity);

    for (const a of world.agents) a.cooperatingFoodId = -1;

    for (const a of world.agents) {
      if (!a.alive || a.carryCooldown > 0 || a.brain.outputs[3] <= 0) continue;
      const reach = a.phenotype.radius + cfg.cooperativeFoodRadius;
      world.foodGrid.forEachInRadius(a.x, a.y, reach, (foodId, _dx, _dy, d2) => {
        if (food.alive[foodId] === 0 || food.kind[foodId] !== FOOD_COOPERATIVE) return;
        this.insertParticipant(foodId, a.id, d2, required);
      });
    }

    for (let foodId = 0; foodId < food.capacity; foodId++) {
      if (food.alive[foodId] === 0 || food.kind[foodId] !== FOOD_COOPERATIVE) continue;
      const base = foodId * required;
      let count = 0;
      while (count < required && this.participantIds[base + count] >= 0) count++;

      if (count < required) {
        food.cooperationProgress[foodId] = 0;
        continue;
      }

      for (let i = 0; i < required; i++) {
        const participant = world.agentById.get(this.participantIds[base + i]);
        if (participant) participant.cooperatingFoodId = foodId;
      }

      const progress = food.cooperationProgress[foodId] + 1;
      food.cooperationProgress[foodId] = progress;
      if (progress < cfg.cooperativeFoodWorkTicks) continue;

      const x = food.xs[foodId];
      const y = food.ys[foodId];
      const participantIds: number[] = [];
      for (let i = 0; i < required; i++) {
        const id = this.participantIds[base + i];
        const participant = world.agentById.get(id);
        if (!participant || !participant.alive) continue;
        consumeFoodEnergy(participant, cfg.cooperativeFoodEnergy, cfg, world);
        participantIds.push(id);
      }
      food.remove(foodId);
      world.events.cooperativeHarvests++;
      world.events.cooperativeParticipants += participantIds.length;
      world.recordCooperationEvent({
        tick: world.tick,
        foodId,
        x,
        y,
        participantIds,
        energyPerParticipant: cfg.cooperativeFoodEnergy,
      });
    }
  }

  private ensureBuffers(capacity: number, required: number): void {
    if (capacity === this.bufferCapacity && required === this.bufferRequired) return;
    this.bufferCapacity = capacity;
    this.bufferRequired = required;
    this.participantIds = new Int32Array(capacity * required);
    this.participantDist2 = new Float64Array(capacity * required);
  }

  /** Wstawia agenta do uporządkowanej listy K najbliższych uczestników zasobu. */
  private insertParticipant(foodId: number, agentId: number, d2: number, required: number): void {
    const base = foodId * required;
    for (let i = 0; i < required; i++) {
      if (d2 >= this.participantDist2[base + i]) continue;
      for (let j = required - 1; j > i; j--) {
        this.participantDist2[base + j] = this.participantDist2[base + j - 1];
        this.participantIds[base + j] = this.participantIds[base + j - 1];
      }
      this.participantDist2[base + i] = d2;
      this.participantIds[base + i] = agentId;
      return;
    }
  }
}
