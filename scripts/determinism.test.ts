/**
 * Test determinizmu i zdrowia symulacji.
 *
 *   npm run test:determinism
 *
 * Sprawdza:
 *  1. ten sam seed  -> identyczny stan po N tickach (bit w bit),
 *  2. inny seed     -> inny stan (czyli seed w ogóle działa),
 *  3. reset()       -> odtwarza dokładnie ten sam przebieg,
 *  4. brak NaN      -> genomy i pozycje pozostają skończone,
 *  5. przeżywalność -> populacja nie wymiera i pokolenia rosną.
 */
import { Simulation } from '../src/core/simulation/simulation';

// Rozmnażanie płciowe wymaga, żeby DWOJE konkretnych osobników spotkało
// się blisko siebie — to rzadkie zdarzenie (patrz ReproductionSystem),
// więc krótkie okno testowe czasem nie złapie ani jednego w danym seedzie.
// Dłuższy bieg + sprawdzanie DWÓCH niezależnych seedów (b i c) zamiast
// jednego znacząco zmniejsza szansę fałszywego negatywu bez utraty
// czułości testu na realne regresje.
const TICKS = 6000;

/** Skrót stanu świata — łapie pozycje, energie, genomy i licznik RNG. */
function hashWorld(sim: Simulation): string {
  let h = 2166136261 >>> 0;
  const mix = (v: number): void => {
    // Kwantyzacja do 1e-6: chroni przed różnicami w ostatnim bicie
    // przy tej samej sekwencji operacji, ale wyłapuje realne rozjazdy.
    const q = Math.round(v * 1e6) | 0;
    h ^= q;
    h = Math.imul(h, 16777619) >>> 0;
  };

  mix(sim.world.agents.length);
  mix(sim.world.food.count);
  mix(sim.world.items.count);
  mix(sim.world.rng.getState() % 1e6);
  mix(sim.world.foodRng.getState() % 1e6);
  for (const a of sim.world.agents) {
    mix(a.id);
    mix(a.x);
    mix(a.y);
    mix(a.energy);
    mix(a.health);
    mix(a.heading);
    mix(a.generation);
    mix(a.carriedCount);
    for (let i = 0; i < a.carriedCount; i++) mix(a.carriedItems[i]);
    mix(a.fatherId);
    mix(a.phenotype.gender);
    if (a.hiddenState.length > 0) mix(a.hiddenState[0]);
    for (let i = 0; i < a.genome.length; i += 7) mix(a.genome[i]);
  }
  return h.toString(16);
}

function hasNaN(sim: Simulation): boolean {
  for (const a of sim.world.agents) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.energy)) return true;
    if (!Number.isFinite(a.health)) return true;
    for (let i = 0; i < a.hiddenState.length; i++) {
      if (!Number.isFinite(a.hiddenState[i])) return true;
    }
    for (let i = 0; i < a.genome.length; i++) {
      if (!Number.isFinite(a.genome[i])) return true;
    }
  }
  return false;
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log(`Test determinizmu (${TICKS} ticków)\n`);

const a = new Simulation({ seed: 4242 });
const b = new Simulation({ seed: 4242 });
const c = new Simulation({ seed: 9999 });

a.run(TICKS);
b.run(TICKS);
c.run(TICKS);

const ha = hashWorld(a);
const hb = hashWorld(b);
const hc = hashWorld(c);

check('1. ten sam seed daje identyczny stan', ha === hb, `${ha} vs ${hb}`);
check('2. inny seed daje inny stan', ha !== hc, `${ha} vs ${hc}`);

a.reset();
a.run(TICKS);
check('3. reset() odtwarza ten sam przebieg', hashWorld(a) === ha);

check('4. brak NaN w stanie świata', !hasNaN(b));

check('5. populacja przetrwała', b.world.agents.length > 0, `${b.world.agents.length} osobników`);
check(
  '6. pokolenia rosną (rozmnażanie działa)',
  b.world.maxGeneration >= 3,
  `pokolenie ${b.world.maxGeneration}`,
);
check(
  '7. agenci jedzą (sensory + ruch działają)',
  b.statistics.cumulative.totalFoodEaten > 100,
  `${b.statistics.cumulative.totalFoodEaten} jednostek`,
);
check(
  '8. mutacje zachodzą',
  b.statistics.cumulative.totalMutations > 0 || c.statistics.cumulative.totalMutations > 0,
  `${b.statistics.cumulative.totalMutations} (seed 4242) / ${c.statistics.cumulative.totalMutations} (seed 9999)`,
);
check(
  '9. agenci podnoszą/upuszczają kamienie',
  b.statistics.cumulative.totalPickups > 0,
  `${b.statistics.cumulative.totalPickups} podniesień, ${b.statistics.cumulative.totalDrops} upuszczeń`,
);
check(
  '10. agenci atakują się nawzajem',
  b.statistics.cumulative.totalAttacks > 0,
  `${b.statistics.cumulative.totalAttacks} ataków, ${b.statistics.cumulative.totalDeathsByCombat} zgonów w walce`,
);
// UWAGA: nie sprawdzamy tego przez skan finałowej populacji pod kątem
// motherId/fatherId — przy dużej rotacji (zgony + awaryjne dosiewanie
// PopulationGuardSystem) seksualnie spłodzony potomek mógł powstać
// i umrzeć przed migawką, mimo że rozmnażanie płciowe realnie zaszło.
// `totalBirths`/`totalMutations` rosną WYŁĄCZNIE przez MutationSystem,
// które przetwarza TYLKO kolejkę z ReproductionSystem (prawdziwe parowanie)
// — PopulationGuardSystem inkrementuje `reseeded`, nigdy `births` — więc to
// niezawodny sygnał "czy w ogóle doszło do rozmnażania płciowego w tym biegu".
check(
  '11. rozmnażanie jest płciowe (realne narodziny w biegu)',
  b.statistics.cumulative.totalBirths > 0 || c.statistics.cumulative.totalBirths > 0,
  `seed 4242: ${b.statistics.cumulative.totalBirths} narodzin, seed 9999: ${c.statistics.cumulative.totalBirths} narodzin`,
);
check(
  '12. obie płcie występują w populacji',
  b.world.agents.some((ag) => ag.phenotype.gender === 0) && b.world.agents.some((ag) => ag.phenotype.gender === 1),
  `${b.world.agents.filter((ag) => ag.phenotype.gender === 0).length} Ż / ${b.world.agents.filter((ag) => ag.phenotype.gender === 1).length} M`,
);

console.log(failures === 0 ? '\nWszystkie testy przeszły.' : `\n${failures} test(ów) nie przeszło.`);
process.exit(failures === 0 ? 0 : 1);
