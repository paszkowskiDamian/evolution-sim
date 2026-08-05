import type { System } from './System';
import type { World } from '../world/world';

/**
 * Uruchamia sieć neuronową każdego agenta.
 *
 * To jedyne miejsce, w którym podejmowana jest "decyzja". System nie
 * interpretuje wyjść — robią to MovementSystem i ReproductionSystem.
 * Nie ma tu backpropagation ani żadnej funkcji straty: jedynym
 * mechanizmem uczenia jest dobór naturalny.
 */
export class BrainSystem implements System {
  readonly name = 'BrainSystem';

  update(world: World): void {
    for (const a of world.agents) {
      if (!a.alive) continue;
      if (!world.config.memoryEnabled) a.hiddenState.fill(0);
      a.brain.forward(a.lastInputs, a.hiddenState);
    }
  }
}
