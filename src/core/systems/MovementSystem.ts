import type { System } from './System';
import type { World } from '../world/world';
import { ageRamp, clamp, wrap } from '../utils/math';

/**
 * Zamienia wyjścia sieci na ruch fizyczny.
 *
 * out[0] — obrót   (-1 .. 1) -> skręt w lewo/prawo
 * out[1] — ruch    (-1 .. 1) -> mapowane na ciąg 0 .. 1
 *
 * System nie zawiera żadnej heurystyki "idź do jedzenia" — po prostu
 * wykonuje to, co sieć każe. Jedyny wyjątek fizjologiczny: młode osobniki
 * są wolniejsze — prędkość maksymalna narasta liniowo od
 * `juvenileSpeedFactor` do 100% w ciągu `speedMaturationTicks`.
 */
export class MovementSystem implements System {
  readonly name = 'MovementSystem';

  update(world: World): void {
    const cfg = world.config;
    const size = cfg.worldSize;

    for (const a of world.agents) {
      if (!a.alive) continue;
      const out = a.brain.outputs;

      a.heading += clamp(out[0], -1, 1) * cfg.maxTurnRate;
      if (a.heading > Math.PI) a.heading -= Math.PI * 2;
      else if (a.heading < -Math.PI) a.heading += Math.PI * 2;

      const thrust = (clamp(out[1], -1, 1) + 1) * 0.5; // 0..1
      const maturity = ageRamp(a.age, cfg.speedMaturationTicks, cfg.juvenileSpeedFactor);
      const target = thrust * a.phenotype.maxSpeed * maturity;
      a.speed += (target - a.speed) * cfg.drag;
      if (a.speed < 0) a.speed = 0;

      a.vx = Math.cos(a.heading) * a.speed;
      a.vy = Math.sin(a.heading) * a.speed;

      a.x += a.vx;
      a.y += a.vy;
      a.distanceTravelled += a.speed;

      if (cfg.wrapEdges) {
        a.x = wrap(a.x, size);
        a.y = wrap(a.y, size);
      } else {
        // Ściany są nieelastyczne — uderzenie kosztuje prędkość,
        // ale nie zabija. Nic tu nie jest "karą" ustawianą ręcznie.
        if (a.x < 0) {
          a.x = 0;
          a.speed *= 0.5;
        } else if (a.x > size) {
          a.x = size;
          a.speed *= 0.5;
        }
        if (a.y < 0) {
          a.y = 0;
          a.speed *= 0.5;
        } else if (a.y > size) {
          a.y = size;
          a.speed *= 0.5;
        }
      }
    }
  }
}
