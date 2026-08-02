import type { System } from './System';
import type { World } from '../world/world';
import { referenceBrainComplexity } from '../neural/network';

/**
 * Metabolizm.
 *
 * Energia to jedyny prawdziwy budżet w tym świecie i jedyne źródło presji
 * selekcyjnej. Każda cecha kosztuje:
 *   - istnienie          -> koszt bazowy
 *   - ruch               -> ~ v² (szybko robi się drogi)
 *   - duże ciało         -> ~ r²
 *   - duży mózg          -> ~ liczba faktycznie użytych wag (nie pojemności)
 *   - dobry wzrok        -> ~ zasięg widzenia
 *   - niesienie czegoś   -> narzut ROSNĄCY z liczbą niesionych przedmiotów
 *     (patrz `carryMetabolismMultiplier`)
 *
 * Bez tych kosztów ewolucja zawsze wybrałaby "wszystko na maksa"
 * i nie powstałaby żadna specjalizacja. Bez narzutu za niesienie mechanika
 * kamieni byłaby ewolucyjnie obojętna — nic by nie odróżniało agenta,
 * który sensownie z niej korzysta, od takiego, który ignoruje ją losowo.
 *
 * Schronienie (wnętrze jaskini, patrz `World.isInShelter`) daje bierny
 * bonus: tańszy metabolizm i szybsza regeneracja zdrowia — nagroda za
 * przekopanie się do środka góry, bez żadnej odporności na obrażenia
 * (to wciąż wyłącznie efekt metaboliczny, nie mechanika walki).
 */
export class EnergySystem implements System {
  readonly name = 'EnergySystem';

  update(world: World): void {
    const cfg = world.config;
    const rMax = cfg.agentRadiusMax;
    const refComplexity = referenceBrainComplexity(cfg);

    for (const a of world.agents) {
      if (!a.alive) continue;
      const p = a.phenotype;

      const bodyFactor = (p.radius / rMax) * (p.radius / rMax);
      const visionFactor = p.visionRadius / cfg.visionRadius;
      const complexityRatio = a.brain.complexity / refComplexity;
      const carryFactor = 1 + (cfg.carryMetabolismMultiplier - 1) * a.carriedCount;
      const sheltered = world.isInShelter(a.x, a.y);
      const metabolismFactor = sheltered ? cfg.shelterMetabolismDiscount : 1;

      const cost =
        (cfg.baseMetabolism +
          cfg.moveCost * a.speed * a.speed +
          cfg.sizeCost * bodyFactor +
          cfg.brainCost * complexityRatio * (0.5 + visionFactor)) *
        p.metabolism *
        carryFactor *
        metabolismFactor;

      a.energy -= cost;
      const regenFactor = sheltered ? cfg.shelterHealthRegenMultiplier : 1;
      a.health = Math.min(p.maxHealth, a.health + cfg.healthRegenRate * regenFactor);
      a.age++;
      if (a.reproCooldown > 0) a.reproCooldown--;
    }
  }
}
