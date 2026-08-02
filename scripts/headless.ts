/**
 * Bieg headless — dowód, że silnik nie zależy od przeglądarki.
 *
 *   npm run headless -- --ticks 40000 --seed 7
 *
 * Wypisuje przebieg symulacji i prosty test presji selekcyjnej:
 * porównuje skuteczność zdobywania jedzenia w pierwszych i ostatnich
 * pokoleniach. Jeśli ewolucja działa, ta liczba rośnie.
 */
import { Simulation } from '../src/core/simulation/simulation';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const ticks = arg('ticks', 30000);
const seed = arg('seed', 1337);

const sim = new Simulation({ seed });

console.log(`Evolution Simulation — bieg headless (seed=${seed}, ticks=${ticks})\n`);
console.log(
  ['tick', 'pop', 'jedz.', 'pokol.', 'śr.wiek', 'śr.energia', 'różnorod.', 'v', 'wzrok']
    .map((s) => s.padStart(10))
    .join(''),
);

const report = (): void => {
  const s = sim.statistics.history[sim.statistics.history.length - 1];
  if (!s) return;
  console.log(
    [
      s.tick,
      s.population,
      s.foodCount,
      s.maxGeneration,
      s.avgAge.toFixed(0),
      s.avgEnergy.toFixed(1),
      s.diversity.toFixed(3),
      s.avgSpeedGene.toFixed(2),
      s.avgVisionGene.toFixed(0),
    ]
      .map((v) => String(v).padStart(10))
      .join(''),
  );
};

const chunk = Math.max(1, Math.floor(ticks / 20));
const t0 = performance.now();
for (let i = 0; i < ticks; i += chunk) {
  sim.run(Math.min(chunk, ticks - i));
  report();
}
const elapsed = performance.now() - t0;

console.log('\n--- podsumowanie ---');
console.log(`czas:                 ${(elapsed / 1000).toFixed(2)} s  (${(ticks / (elapsed / 1000)).toFixed(0)} ticków/s)`);
console.log(`populacja końcowa:    ${sim.world.agents.length}`);
console.log(`maks. pokolenie:      ${sim.world.maxGeneration}`);
console.log(`narodziny / zgony:    ${sim.statistics.cumulative.totalBirths} / ${sim.statistics.cumulative.totalDeaths}`);
console.log(`zjedzone jednostki:   ${sim.statistics.cumulative.totalFoodEaten}`);
console.log(`mutacje:              ${sim.statistics.cumulative.totalMutations}`);

// ---------------------------------------------------------------------------
// Eksperyment we wspólnym ogrodzie (common garden)
// ---------------------------------------------------------------------------
// W stanie równowagi liczba narodzin zawsze zrównuje się z liczbą zgonów,
// więc surowy "sukces rozrodczy" NIE mierzy adaptacji — mierzy zagęszczenie.
// Żeby zobaczyć realną poprawę, trzeba wpuścić obie populacje do IDENTYCZNEGO
// świata: ta sama mapa jedzenia, ta sama liczba osobników, bez rozmnażania.
// Osobny strumień RNG dla środowiska gwarantuje, że oba biegi widzą ten sam świat.

const COHORT = 60;
const ASSAY_TICKS = 4000;

function takeGenomes(source: Simulation, n: number): Float32Array[] {
  const out: Float32Array[] = [];
  const agents = source.world.agents;
  for (let i = 0; i < n && i < agents.length; i++) {
    out.push(new Float32Array(agents[Math.floor((i * agents.length) / n)].genome));
  }
  return out;
}

function assay(genomes: Float32Array[], label: string): number {
  const test = new Simulation({
    seed: 555,
    initialPopulation: 0,
    maxPopulation: genomes.length, // blokuje rozmnażanie
    minPopulation: 0, // wyłącza dosiewanie
    maxAge: 10 ** 9, // bez śmierci ze starości
  });
  test.seedPopulation(genomes);
  test.run(ASSAY_TICKS);
  const eaten = test.statistics.cumulative.totalFoodEaten;
  const survivors = test.world.agents.length;
  const { totalPickups, totalDrops, totalTilesDug, totalTilesBuilt, totalAttacks } = test.statistics.cumulative;
  console.log(
    `  ${label.padEnd(22)} zjedzone: ${String(eaten).padStart(6)}   przeżyło: ${survivors}/${genomes.length}` +
      `   kamienie: ${totalPickups}↑/${totalDrops}↓   teren: ${totalTilesDug} wykop./${totalTilesBuilt} zbud.   ataki: ${totalAttacks}`,
  );
  return eaten;
}

// Populacja startowa: świeży świat z tym samym seedem = te same losowe genomy.
const baseline = new Simulation({ seed });
const naive = takeGenomes(baseline, COHORT);
const evolved = takeGenomes(sim, COHORT);

console.log(`\nwspólny ogród — ${COHORT} osobników, ${ASSAY_TICKS} ticków, identyczny świat:`);
const naiveScore = assay(naive, 'pokolenie 0 (losowe)');
const evolvedScore = assay(evolved, `po ${ticks} tickach`);

const gain = naiveScore > 0 ? (evolvedScore / naiveScore - 1) * 100 : Infinity;
console.log(
  evolvedScore > naiveScore
    ? `  → wyewoluowana populacja zdobywa o ${gain.toFixed(0)}% więcej jedzenia. Ewolucja działa.`
    : '  → brak przewagi w tym biegu — spróbuj dłuższego biegu lub innego seeda',
);
