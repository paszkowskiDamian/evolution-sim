import type { World } from '../world/world';

/**
 * Każda mechanika to osobny system o jednej odpowiedzialności.
 * Systemy nie znają się nawzajem — komunikują się wyłącznie przez stan świata.
 */
export interface System {
  readonly name: string;
  update(world: World): void;
}
