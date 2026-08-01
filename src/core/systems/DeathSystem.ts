import type { System } from './System';
import type { World } from '../world/world';

/**
 * Śmierć — jedyny "sędzia" w symulacji.
 *
 * Nie ma tu żadnej oceny zachowania. Agent ginie, gdy skończy mu się
 * energia, gdy dopadnie go starość, albo gdy przegra walkę. Wszystko,
 * co przetrwa, przetrwało bo działało — nie dlatego, że dostało wysoką notę.
 */
export class DeathSystem implements System {
  readonly name = 'DeathSystem';

  update(world: World): void {
    const cfg = world.config;
    let anyDead = false;

    for (const a of world.agents) {
      if (!a.alive) continue;

      if (a.energy <= 0) {
        a.alive = false;
        world.events.deaths++;
        world.events.deathsByStarvation++;
        world.recordLineage(a, world.tick);
        anyDead = true;
        continue;
      }

      if (a.health <= 0) {
        a.alive = false;
        world.events.deaths++;
        world.events.deathsByCombat++;
        world.recordLineage(a, world.tick);
        anyDead = true;
        continue;
      }

      if (a.age >= cfg.maxAge) {
        a.alive = false;
        world.events.deaths++;
        world.events.deathsByAge++;
        world.recordLineage(a, world.tick);
        anyDead = true;
        continue;
      }

      // Starzenie się: po `senescenceStart` rośnie ryzyko śmierci.
      // Krzywa kwadratowa, więc długowieczność ma malejącą wartość.
      if (a.age > cfg.senescenceStart) {
        const t = (a.age - cfg.senescenceStart) / Math.max(1, cfg.maxAge - cfg.senescenceStart);
        if (world.rng.chance(t * t * 0.01)) {
          a.alive = false;
          world.events.deaths++;
          world.events.deathsByAge++;
          world.recordLineage(a, world.tick);
          anyDead = true;
        }
      }
    }

    if (anyDead) {
      // Kompaktowanie z zachowaniem kolejności — kolejność iteracji agentów
      // musi być deterministyczna, więc nie używamy swap-remove.
      const next: typeof world.agents = [];
      for (const a of world.agents) {
        if (a.alive) next.push(a);
        else world.agentById.delete(a.id);
      }
      world.agents = next;
    }
  }
}
