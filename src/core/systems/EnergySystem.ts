import type { System } from './System';
import type { World } from '../world/world';

/**
 * Metabolizm.
 *
 * Energia to jedyny prawdziwy budżet w tym świecie i jedyne źródło presji
 * selekcyjnej. Każda cecha kosztuje:
 *   - istnienie          -> koszt bazowy
 *   - ruch               -> ~ v² (szybko robi się drogi)
 *   - duże ciało         -> ~ r²
 *   - duży mózg          -> ~ liczba neuronów
 *   - dobry wzrok        -> ~ zasięg widzenia
 *
 * Bez tych kosztów ewolucja zawsze wybrałaby "wszystko na maksa"
 * i nie powstałaby żadna specjalizacja.
 */
export class EnergySystem implements System {
  readonly name = 'EnergySystem';

  update(world: World): void {
    const cfg = world.config;
    const rMax = cfg.agentRadiusMax;
    const brainSize = cfg.hiddenNeurons;

    for (const a of world.agents) {
      if (!a.alive) continue;
      const p = a.phenotype;

      const bodyFactor = (p.radius / rMax) * (p.radius / rMax);
      const visionFactor = p.visionRadius / cfg.visionRadius;

      const cost =
        (cfg.baseMetabolism +
          cfg.moveCost * a.speed * a.speed +
          cfg.sizeCost * bodyFactor +
          cfg.brainCost * (brainSize / 10) * (0.5 + visionFactor)) *
        p.metabolism;

      a.energy -= cost;
      a.age++;
      if (a.reproCooldown > 0) a.reproCooldown--;
    }
  }
}
