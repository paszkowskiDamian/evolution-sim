/**
 * Ewoluuje długi bieg i zapisuje najlepszy znaleziony genom jako punkt
 * startowy dla symulacji webowej.
 *
 *   npm run evolve -- --ticks 300000 --seed 1
 *
 * Wynik trafia do src/config/seedGenome.json — stamtąd wczytuje go
 * `useSimulation.ts`, żeby świeżo otwarta aplikacja startowała z populacją
 * "pretrenowaną" (zmutowane kopie jednego sprawdzonego przodka), zamiast
 * od zera z czysto losowych genomów.
 *
 * Wybór "najlepszego" genomu NIE bierze surowego fitnessu z populacji
 * w stanie równowagi — to tylko chwilowe szczęście reprodukcyjne (patrz
 * README, sekcja "wspólny ogród"). Zamiast tego próbka kandydatów z
 * finałowej populacji trafia RAZEM do identycznego, zamrożonego środowiska
 * (bez dosiewania, populacja nie może urosnąć) i wygrywa ten, kto
 * indywidualnie zjadł najwięcej i przeżył cały test.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Simulation } from '../src/core/simulation/simulation';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

function strArg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const ticks = arg('ticks', 300000);
const seed = arg('seed', 1);
const cohortSize = arg('cohort', 30);
const assayTicks = arg('assayTicks', 4000);
// minPopulation domyślnie jest WYŁĄCZONE (0) w symulacji interaktywnej —
// wymarcie jest tam dozwolonym wynikiem eksperymentu (patrz
// simulationConfig.ts). Długi, samotny bieg ewolucyjny to inny przypadek
// użycia: potrzebuje DOŻYĆ do wielu pokoleń, więc dostaje własną,
// jawną podłogę populacji zamiast dziedziczyć domyślne wyłączenie.
const minPopulation = arg('minPopulation', 80);

console.log(`Ewolucja genomu startowego (seed=${seed}, ticks=${ticks}, minPopulation=${minPopulation})\n`);
const sim = new Simulation({ seed, minPopulation });

const chunk = Math.max(1, Math.floor(ticks / 20));
const t0 = performance.now();
for (let i = 0; i < ticks; i += chunk) {
  sim.run(Math.min(chunk, ticks - i));
  const s = sim.statistics.history[sim.statistics.history.length - 1];
  if (s) {
    console.log(
      `tick ${String(s.tick).padStart(8)}  pop ${String(s.population).padStart(4)}  ` +
        `pokolenie ${String(s.maxGeneration).padStart(4)}  różnorodność ${s.diversity.toFixed(3)}  ` +
        `śr.energia ${s.avgEnergy.toFixed(1)}`,
    );
  }
}
console.log(`\nCzas ewolucji: ${((performance.now() - t0) / 1000).toFixed(1)} s`);

if (sim.world.agents.length === 0) {
  console.error('\nPopulacja wymarła — spróbuj innego seeda albo dłuższego biegu.');
  process.exit(1);
}

console.log(`\nOcena ${Math.min(cohortSize, sim.world.agents.length)} kandydatów we wspólnym ogrodzie (${assayTicks} ticków)...`);

const source = sim.world.agents;
const n = Math.min(cohortSize, source.length);
const genomes: Float32Array[] = [];
for (let i = 0; i < n; i++) {
  genomes.push(new Float32Array(source[Math.floor((i * source.length) / n)].genome));
}

const assay = new Simulation({
  seed: seed + 1, // niezależny seed dla samej oceny
  initialPopulation: 0,
  maxPopulation: n,
  minPopulation: 0,
  maxAge: 10 ** 9, // eliminujemy śmierć ze starości z oceny — liczy się kompetencja, nie zegar
});
assay.seedPopulation(genomes);
// Kolejność agentów po seedPopulation odpowiada kolejności `genomes` —
// zapamiętujemy id, żeby po biegu dopasować wynik do ORYGINALNEGO
// (niezmutowanego przez ewentualne potomstwo) genomu kandydata.
const seededIds = assay.world.agents.map((a) => a.id);
assay.run(assayTicks);

let bestIndex = -1;
let bestScore = -Infinity;
for (let i = 0; i < seededIds.length; i++) {
  const survivor = assay.world.agentById.get(seededIds[i]);
  if (!survivor) continue; // nie przeżył testu — odpada
  if (survivor.foodEaten > bestScore) {
    bestScore = survivor.foodEaten;
    bestIndex = i;
  }
}

if (bestIndex < 0) {
  console.error('\nŻaden kandydat nie przeżył oceny — spróbuj dłuższego biegu ewolucji albo innego seeda.');
  process.exit(1);
}

const best = genomes[bestIndex];
console.log(`\nNajlepszy kandydat: zjadł ${bestScore} jednostek jedzenia w ${assayTicks}-tickowej ocenie i przeżył ją całą.`);

const outArg = strArg('out', '');
const defaultOutPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'config', 'seedGenome.json');
const outPath = outArg === '' ? defaultOutPath : path.isAbsolute(outArg) ? outArg : path.join(process.cwd(), outArg);
writeFileSync(
  outPath,
  JSON.stringify({
    meta: {
      seed,
      evolutionTicks: ticks,
      finalGeneration: sim.world.maxGeneration,
      assaySeed: seed + 1,
      assayTicks,
      assayScore: bestScore,
    },
    genome: Array.from(best),
  }),
);
console.log(`Zapisano genom startowy do ${outPath}`);
