/**
 * Kontrolowany assay zachowań społecznych.
 *
 * Najpierw pozwala populacji ewoluować z dużym jedzeniem, a następnie te
 * same genomy wpuszcza do identycznych światów: pełnego, głuchego,
 * amnezyjnego i bez zasobów kooperacyjnych. Statystyki są obserwacją —
 * selekcja w biegu ewolucyjnym nadal zachodzi tylko przez energię, śmierć
 * i prawdziwe rozmnażanie.
 *
 *   npm run assay:collaboration -- --evolutionTicks 30000 --assayTicks 6000
 */
import { Simulation } from '../src/core/simulation/simulation';
import type { SimulationConfig } from '../src/config/simulationConfig';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) ? value : fallback;
}

interface Result {
  label: string;
  harvests: number;
  participants: number;
  foodEaten: number;
  births: number;
  survivors: number;
  finalPopulation: number;
}

const seed = arg('seed', 1337);
const evolutionTicks = arg('evolutionTicks', 30000);
const assayTicks = arg('assayTicks', 6000);
const cohortSize = arg('cohort', 40);
const evolutionMinPopulation = arg('evolutionMinPopulation', 0);
const soloSamples = arg('soloSamples', 8);
const assayWorldSize = arg('assayWorldSize', 1500);

console.log(
  `Ewolucja społeczna: seed=${seed}, ticks=${evolutionTicks}, minPopulation=${evolutionMinPopulation}`,
);
const evolution = new Simulation({ seed, minPopulation: evolutionMinPopulation });
const chunk = Math.max(1, Math.floor(evolutionTicks / 10));
for (let elapsed = 0; elapsed < evolutionTicks && evolution.world.agents.length > 0; elapsed += chunk) {
  evolution.run(Math.min(chunk, evolutionTicks - elapsed));
  console.log(
    `  tick ${String(evolution.tick).padStart(7)}  pop ${String(evolution.world.agents.length).padStart(4)}` +
      `  zbiory ${String(evolution.statistics.cumulative.totalCooperativeHarvests).padStart(5)}` +
      `  narodziny ${String(evolution.statistics.cumulative.totalBirths).padStart(5)}` +
      `  dosiew ${String(evolution.statistics.cumulative.totalReseeded).padStart(5)}`,
  );
}

if (evolution.world.agents.length === 0) {
  console.error(
    'Populacja wymarła bez awaryjnego dosiewania. To poprawny wynik eksperymentu; ' +
      'do strojenia mechaniki można jawnie użyć --evolutionMinPopulation 20.',
  );
  process.exit(1);
}

const source = evolution.world.agents;
const n = Math.min(cohortSize, source.length);
const genomes: Float32Array[] = [];
for (let i = 0; i < n; i++) {
  genomes.push(new Float32Array(source[Math.floor((i * source.length) / n)].genome));
}

const assaySeed = seed ^ 0x41c6ce57;
const baseAssay: Partial<SimulationConfig> = {
  seed: assaySeed,
  worldSize: assayWorldSize,
  initialPopulation: 0,
  maxPopulation: Math.max(n, n * 2),
  minPopulation: 0,
  maxAge: 10 ** 9,
  mutationChance: 0,
  swapMutationChance: 0,
  bigMutationChance: 0,
  // Otwarty teren usuwa zmienną zakłócającą: różne grupy nie mogą zmieniać
  // przyszłych miejsc spawnu przez kopanie/budowanie innej mapy.
  caveFillProbability: 0,
  caveIterations: 1,
  maxLooseRocks: 0,
};

function runArm(label: string, overrides: Partial<SimulationConfig>): Result {
  const assay = new Simulation({ ...baseAssay, ...overrides });
  assay.seedPopulation(genomes);
  const initialIds = new Set(assay.world.agents.map((a) => a.id));
  assay.run(assayTicks);
  let survivors = 0;
  for (const id of initialIds) if (assay.world.agentById.has(id)) survivors++;
  const c = assay.statistics.cumulative;
  return {
    label,
    harvests: c.totalCooperativeHarvests,
    participants: c.totalCooperativeParticipants,
    foodEaten: c.totalFoodEaten,
    births: c.totalBirths,
    survivors,
    finalPopulation: assay.world.agents.length,
  };
}

const results: Result[] = [
  runArm('pełny', { signalReceptionEnabled: true, memoryEnabled: true }),
  runArm('głuchy', { signalReceptionEnabled: false, memoryEnabled: true }),
  runArm('bez pamięci', { signalReceptionEnabled: true, memoryEnabled: false }),
  runArm('bez korzyści współpracy', {
    signalReceptionEnabled: true,
    memoryEnabled: true,
    // Zasób nadal istnieje i jest widziany, więc wejścia oraz harmonogram RNG
    // pozostają porównywalne; znika wyłącznie ewolucyjna korzyść energetyczna.
    cooperativeFoodEnergy: 0,
  }),
];

function runSolitary(): Result {
  const limit = Math.min(soloSamples, genomes.length);
  let foodEaten = 0;
  let survivors = 0;
  for (let i = 0; i < limit; i++) {
    const assay = new Simulation({
      ...baseAssay,
      initialPopulation: 0,
      maxPopulation: 1,
      seed: assaySeed,
    });
    assay.seedPopulation([genomes[i]]);
    const id = assay.world.agents[0].id;
    assay.run(assayTicks);
    foodEaten += assay.statistics.cumulative.totalFoodEaten;
    if (assay.world.agentById.has(id)) survivors++;
  }
  return {
    label: `samotny (śr. z ${limit})`,
    harvests: 0,
    participants: 0,
    foodEaten: limit ? foodEaten / limit : 0,
    births: 0,
    survivors,
    finalPopulation: survivors,
  };
}
results.push(runSolitary());

console.log(`\nAssay: ${n} genomów, ${assayTicks} ticków, identyczne środowisko`);
console.log('wariant'.padEnd(24), 'zbiory'.padStart(8), 'uczestn.'.padStart(10), 'jedzenie'.padStart(10), 'narodz.'.padStart(9), 'przeżyło'.padStart(10), 'pop'.padStart(6));
for (const r of results) {
  console.log(
    r.label.padEnd(24),
    String(r.harvests).padStart(8),
    String(r.participants).padStart(10),
    r.foodEaten.toFixed(1).padStart(10),
    String(r.births).padStart(9),
    String(r.survivors).padStart(10),
    String(r.finalPopulation).padStart(6),
  );
}

const full = results[0];
const deaf = results[1];
const amnesiac = results[2];
const noBenefit = results[3];
console.log('\nInterpretacja:');
console.log(`  zależność od sygnału: ${full.harvests - deaf.harvests} zbiorów (pełny − głuchy)`);
console.log(`  zależność od pamięci: ${full.harvests - amnesiac.harvests} zbiorów (pełny − bez pamięci)`);
console.log(
  `  przewaga reprodukcyjna korzyści: ${full.births - noBenefit.births} narodzin, ` +
    `${full.finalPopulation - noBenefit.finalPopulation} końcowej populacji`,
);
console.log(
  full.harvests > 0
    ? '  ZAOBSERWOWANO wspólne działanie; jego społeczny mechanizm oceniają różnice względem ablacji.'
    : '  BRAK DOWODU zachowania: ta populacja nie wykazała jeszcze wspólnych zbiorów.',
);
console.log(
  full.harvests > deaf.harvests || full.harvests > amnesiac.harvests
    ? '  WSTĘPNY DOWÓD: pełny kontroler przewyższa co najmniej jedną ablację społeczną.'
    : '  BRAK DOWODU komunikacji/pamięci: potrzeba dłuższej ewolucji i wielu seedów.',
);
