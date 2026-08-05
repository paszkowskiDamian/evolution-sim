# Evolution Simulation

Symulacja ewolucji sztucznego życia. Każdy osobnik ma **własny genom** i **własną sieć
neuronową**. Nie ma jednej globalnej AI, nie ma funkcji celu, nie ma backpropagation.
Jedynym mechanizmem uczenia jest **dobór naturalny**.

Zaimplementowane: **Milestone 1 + 2 + 3** (świat, energia, śmierć, sensory, sieci neuronowe,
rozmnażanie, mutacje, dziedziczenie) oraz część **Milestone 4** (statystyki, wykresy, podgląd
agenta wraz z aktywacjami jego sieci).

---

## Uruchomienie

```bash
npm install
npm run dev          # aplikacja w przeglądarce
```

Pozostałe komendy:

```bash
npm run build             # typecheck + build produkcyjny
npm run typecheck
npm run headless          # bieg symulacji w Node, bez przeglądarki
npm run headless -- --ticks 50000 --seed 7
npm run test:determinism  # testy determinizmu i zdrowia symulacji
npm run test:collaboration # deterministyczny test mechaniki wspólnego zasobu
npm run assay:collaboration -- --evolutionTicks 30000 --assayTicks 6000
```

`npm run headless` istnieje po to, żeby **udowodnić separację warstw** — jeśli kiedykolwiek
przestanie działać, to znaczy, że do `core/` wciekła zależność od przeglądarki.

---

## Architektura

```
Application
    │
    ├── Simulation Engine (core)  ── nie wie nic o rendererze
    └── Renderer (Pixi)           ── tylko czyta stan świata
```

```
src/
  config/simulationConfig.ts   jeden plik z wszystkimi parametrami
  core/
    world/       World, FoodField          — stan świata
    agents/      Agent                     — stan osobnika (zero logiki)
    genetics/    genome, mutation          — genom i mutacje
    neural/      network                   — MLP bez uczenia gradientowego
    systems/     jeden system = jedna mechanika
    simulation/  Simulation                — kolejność ticka
    utils/       rng, math, spatialHash
  renderer/
    pixi/        PixiRenderer              — pule sprite'ów, batching
    camera/      Camera                    — czysta matematyka, bez DOM
    sprites/     textures                  — tekstury generowane raz
  ui/            panele, wykresy, kontrolki
  shared/        typy współdzielone
```

Zależności idą **tylko w jedną stronę**: `ui → renderer → core`. W `core/` nie ma
`import`u z `pixi.js`, `react` ani odwołania do `window`/`document`.

---

## Tick symulacji

Kolejność systemów jest kontraktem — jej zmiana zmienia przebieg symulacji przy tym
samym seedzie.

| # | System | Odpowiedzialność |
|---|--------|------------------|
| 0 | `SpatialIndexSystem` | przebudowa siatek przestrzennych (spójny obraz świata na cały tick) |
| 1 | `SensorSystem` | wejścia sieci — wyłącznie lokalne i względne |
| 2 | `BrainSystem` | forward pass sieci każdego agenta |
| 3 | `MovementSystem` | wyjścia sieci → ruch |
| 4 | `CollisionSystem` | miękkie rozpychanie ciał |
| 5 | `FoodSystem` | konsumpcja + odnawianie zasobu |
| 6 | `EnergySystem` | metabolizm i starzenie |
| 7 | `DeathSystem` | głód i starość |
| 8 | `ReproductionSystem` | **kto** się rozmnaża |
| 9 | `MutationSystem` | **jaki genom** dostanie potomek |
| – | `PopulationGuardSystem` | bezpiecznik przed wymarciem (`minPopulation = 0` wyłącza) |
| 10 | `StatisticsSystem` | pomiar, zero wpływu na świat |

---

## Genom

Genom to jedna płaska `Float32Array`:

```
[ wagi i biasy sieci neuronowej ][ geny biologiczne ]
```

Geny biologiczne (`size`, `speed`, `metabolism`, `reproThreshold`, `vision`, `hue`,
`aggression`) leżą w **tej samej tablicy** co wagi. Mutacja nie musi wiedzieć, co mutuje —
ewolucja zmienia ciało i mózg tym samym mechanizmem, a nową cechę dodaje się przez
rozszerzenie tablicy i dopisanie jednej linijki w `decodePhenotype`.

Cztery mechanizmy mutacji, zgodnie ze specyfikacją: drobna zmiana wagi, szum gaussowski,
zamiana dwóch genów miejscami, duża mutacja przepisująca fragment genomu.

---

## Sieć neuronowa

MLP: `12 wejść → warstwa ukryta (tanh) → 3 wyjścia (tanh)`. Wagi pochodzą wprost z genomu —
sieć **nie kopiuje** wag, operuje na widoku tej samej tablicy.

**Wejścia:** bias, energia, wiek, prędkość, sin/cos kąta do najbliższego jedzenia, bliskość
jedzenia, sin/cos kąta do najbliższego agenta, bliskość agenta, zagęszczenie lokalne, szum.

**Wyjścia:** obrót, ruch, chęć rozmnażania.

Wszystkie sensory są **lokalne i względne** — agent nie zna swojej pozycji globalnej ani
stanu świata. Bez tego zachowania nie byłyby emergentne, tylko odczytane z gotowej mapy.

---

## Fitness

`fitness` w kodzie jest **tylko miarą opisową** dla wykresów. Nic jej nie optymalizuje,
żaden system jej nie czyta. Selekcja odbywa się wyłącznie przez to, kto zdąży się rozmnożyć
przed śmiercią.

## Współpraca i test społeczny

Złote, duże jednostki jedzenia są widoczne jako osobny rodzaj zasobu, ale nie da się ich
zjeść ani podnieść samotnie. Co najmniej dwóch agentów musi stać w zasięgu i utrzymać
wyjście `chwyć/upuść` przez kilka kolejnych ticków. Energię dostają wyłącznie faktyczni
uczestnicy — bierny agent stojący obok nic nie zyskuje. To bezpośredni mutualizm: silnik
nie przyznaje punktów za „bycie społecznym”, tylko zwykłą energię, która może przełożyć
się na przeżycie i potomstwo.

`npm run assay:collaboration` ewoluuje populację, a potem porównuje te same genomy w
identycznym środowisku w wariantach: pełnym, bez odbioru sygnału, z pamięcią zerowaną co
tick, bez dużego jedzenia oraz samotnie. Sam fakt wspólnego zbioru dowodzi działania
mechaniki; przewaga pełnego wariantu nad ablacjami jest dopiero dowodem, że wyewoluowana
strategia rzeczywiście korzysta z komunikacji lub pamięci.

---

## Determinizm

Cała symulacja korzysta z własnego PRNG (mulberry32). W `core/` nie ma ani jednego
`Math.random()`. Ten sam seed + ta sama konfiguracja = przebieg identyczny co do bitu.

Świat ma **dwa niezależne strumienie losowości**:

* `world.rng` — agenci (sensory, mutacje, starzenie),
* `world.foodRng` — środowisko (rozsiew i dryf jedzenia).

To nie jest kosmetyka: dzięki rozdzieleniu przebieg środowiska nie zależy od tego, ile razy
agenci sięgnęli po losowość, więc **da się porównać dwie różne populacje w dokładnie tym
samym świecie**. Bez tego nie odróżnisz adaptacji od zmiany warunków.

---

## Czy to faktycznie ewoluuje?

Prosty pomiar "narodziny na osobnika" **nic nie mówi** — w stanie równowagi liczba narodzin
zawsze zrównuje się z liczbą zgonów niezależnie od tego, jak dobre są agenty. Poprawa jest
natychmiast pożerana przez wzrost zagęszczenia.

Dlatego `npm run headless` kończy się **eksperymentem we wspólnym ogrodzie**: 60 losowych
genomów z pokolenia 0 i 60 genomów z końca biegu wpuszczane są do *identycznego* świata,
bez rozmnażania, na 4000 ticków. Przykładowy wynik po 20 000 ticków (seed 1337):

```
wspólny ogród — 60 osobników, 4000 ticków, identyczny świat:
  pokolenie 0 (losowe)   zjedzone:   1196   przeżyło: 1/60
  po 20000 tickach       zjedzone:   4316   przeżyło: 60/60
```

Pokolenie 0 wymiera niemal całkowicie. Populacja po 52 pokoleniach przeżywa w komplecie
i zdobywa 3,6× więcej pokarmu — w tym samym świecie, z tą samą mapą jedzenia.

W panelu "Ewolucja cech" widać kierunkową selekcję cech biologicznych: przy domyślnych
parametrach rośnie gen wzroku i prędkości, a różnorodność genetyczna spada w miarę
dominacji udanych linii.

---

## Równowaga ekologiczna (co warto wiedzieć przy strojeniu)

Dwa parametry decydują o tym, czy w ogóle istnieje presja selekcyjna:

* **`foodSpawnRate`** — wyznacza pojemność środowiska. Jeśli jedzenia jest tyle, że licznik
  `maxFood` stoi na maksimum, świat jest bufetem i selekcja przestaje działać. Zdrowy objaw:
  liczba jedzenia utrzymuje się nisko, a populacja sama się reguluje.
* **`baseMetabolism`** — koszt samego istnienia. Gdy jest zbyt niski, ewolucja znajduje
  strategię "stój w miejscu i czekaj, aż jedzenie samo na mnie spadnie". Działa, ale zabija
  wszystkie ciekawsze zachowania.

Jeśli symulacja uderza w `maxPopulation`, to znaczy że limit — a nie środowisko — reguluje
populację. Wtedy zmniejsz `foodSpawnRate`, nie podnoś limitu.

---

## Wydajność

* siatka przestrzenna na typed arrays (listy jednokierunkowe, zero alokacji w ticku),
* sensory sąsiadów liczone **jednym** przejściem po siatce zamiast dwoma,
* pule sprite'ów w rendererze, jedna tekstura + `tint` → jeden batch,
* React **nie renderuje się co tick** — migawka stanu trafia do UI co ~150 ms.

Pomiar (Node, 1 rdzeń, ~800 agentów, ~1500 jednostek jedzenia): **~380 ticków/s**.

---

## Sterowanie

* przeciąganie — przesuwanie kamery
* kółko myszy — zoom w punkcie kursora
* kliknięcie agenta — podgląd jego stanu, genów i aktywacji sieci
* `Śledź` — kamera podąża za osobnikiem
* suwaki bez gwiazdki działają na żywo, oznaczone `*` wymagają restartu świata

---

## Co dalej (Milestone 5–6)

Punkty zaczepienia są już w kodzie:

* **rozmnażanie płciowe** — `crossover()` w `genetics/mutation.ts` jest gotowe, `Agent` ma
  pole `fatherId`,
* **drapieżnictwo i rywalizacja** — gen `aggression` istnieje i jest dziedziczony, brakuje
  systemu, który go czyta,
* **nowe sensory i wyjścia** — dopisz etykietę do `SENSOR_LABELS` / `OUTPUT_LABELS`;
  długość genomu policzy się sama,
* **feromony, przeszkody, biomy** — nowy system + nowa siatka przestrzenna, reszta bez zmian,
* **NEAT** — `NeuralNetwork` jest izolowany za forward passem; topologia zmienna wymaga
  wymiany tej jednej klasy i sposobu dekodowania genomu.

---

## Znane ograniczenia

* Świat jest torusem (`wrapEdges`), ale renderer rysuje tylko jedną kopię — obiekt tuż przy
  krawędzi nie jest widoczny po drugiej stronie, choć sensory poprawnie go widzą.
* Rejestr linii rodowych trzyma ostatnie 4000 rekordów (`LINEAGE_CAPACITY`); pełne drzewo
  genealogiczne z całego biegu wymagałoby zapisu na dysk.
* Rozmnażanie jest bezpłciowe — zgodnie z zakresem Milestone 3.
