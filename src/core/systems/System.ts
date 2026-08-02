import type { World } from '../world/world';

/**
 * Każda mechanika to osobny system o jednej odpowiedzialności.
 * Systemy nie znają się nawzajem — komunikują się wyłącznie przez stan świata.
 *
 * `update` może zwrócić `Promise<void>` — jedyny legalny powód to system
 * liczący na GPU (patrz `systems/gpu/*`), gdzie odczyt wyniku bufora
 * (`mapAsync`) jest z definicji asynchroniczny w WebGPU, bez odpowiednika
 * synchronicznego. Systemy CPU zawsze zwracają zwykłe `void`.
 *
 * `Simulation.step()`/`run()` (synchroniczne) NIE czekają na taki Promise —
 * użycie systemu async wymaga `Simulation.stepAsync()`/`runAsync()`.
 * Mieszanie jest pilnowane w Simulation, nie tutaj.
 */
export interface System {
  readonly name: string;
  update(world: World): void | Promise<void>;
}
