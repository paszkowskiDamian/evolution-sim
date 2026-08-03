import { Application, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import type { Simulation } from '../../core/simulation/simulation';
import { Camera } from '../camera/camera';
import {
  loadSpriteTextures,
  agentScaleFor,
  foodScaleFor,
  rockScaleFor,
  AGENT_ANCHOR_X,
  AGENT_ANCHOR_Y,
  type SpriteTextures,
} from '../sprites/textures';
import { hslToRgb, clamp } from '../../core/utils/math';
import { ROCK_TYPE, FOOD_TYPE } from '../../core/world/items';
import { TILE_ROCK } from '../../core/world/terrain';

/**
 * Renderer.
 *
 * Jedyna zależność w tę stronę: Renderer -> Simulation (tylko do odczytu).
 * Silnik nie ma pojęcia, że ten plik istnieje. Renderer nie wykonuje
 * ticków symulacji i nigdy nie modyfikuje stanu świata.
 *
 * Wydajność: pule sprite'ów zamiast tworzenia/niszczenia obiektów co klatkę.
 */
/** Minimalny rozmiar obiektu na ekranie w pikselach (przy dużym oddaleniu). */
const MIN_AGENT_PX = 2.6;
const MIN_FOOD_PX = 1.1;
const MIN_ROCK_PX = 1.4;

/** Czas życia pierścienia trafienia (ms) i jego promienie na start/koniec. */
const COMBAT_RING_DURATION_MS = 550;
const COMBAT_RING_START_RADIUS = 6;
const COMBAT_RING_END_RADIUS = 46;

/** Jak wyżej, ale dla narodzin — dłuższy i delikatniejszy niż trafienie. */
const BIRTH_SPARKLE_DURATION_MS = 750;
const BIRTH_RING_START_RADIUS = 2;
const BIRTH_RING_END_RADIUS = 26;
const BIRTH_SPARKLE_COUNT = 6;
const BIRTH_SPARKLE_LENGTH = 16;

interface CombatRing {
  x: number;
  y: number;
  startTime: number;
}

interface BirthSparkle {
  x: number;
  y: number;
  startTime: number;
}

interface AgentDisplay {
  root: Container;
  body: Sprite;
  details: Sprite;
}

export class PixiRenderer {
  readonly camera = new Camera();
  private app: Application | null = null;
  private textures: SpriteTextures | null = null;

  private worldLayer = new Container();
  private ground: TilingSprite | null = null;
  private caveLayer = new Graphics();
  private terrainLayer = new Container();
  private foodLayer = new Container();
  private rockLayer = new Container();
  private agentLayer = new Container();
  private combatLayer = new Graphics();
  private birthLayer = new Graphics();
  private overlay = new Graphics();
  private border = new Graphics();

  private foodPool: Sprite[] = [];
  private rockPool: Sprite[] = [];
  private terrainPool: Sprite[] = [];
  private agentPool: AgentDisplay[] = [];
  private combatRings: CombatRing[] = [];
  private birthSparkles: BirthSparkle[] = [];

  selectedId: number | null = null;
  showVision = true;

  private destroyed = false;

  async init(host: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      background: 0x0b0e13,
      antialias: true,
      resizeTo: host,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl',
    });
    if (this.destroyed) {
      app.destroy(true);
      return;
    }
    const textures = await loadSpriteTextures();
    if (this.destroyed) {
      app.destroy(true);
      return;
    }
    this.app = app;
    this.textures = textures;
    host.appendChild(app.canvas);

    this.ground = new TilingSprite({ texture: textures.grass, width: 1, height: 1 });
    this.ground.roundPixels = true;

    this.worldLayer.addChild(this.ground);
    this.worldLayer.addChild(this.caveLayer);
    this.worldLayer.addChild(this.terrainLayer);
    this.worldLayer.addChild(this.foodLayer);
    this.worldLayer.addChild(this.rockLayer);
    this.worldLayer.addChild(this.agentLayer);
    this.worldLayer.addChild(this.combatLayer);
    this.worldLayer.addChild(this.birthLayer);
    this.worldLayer.addChild(this.overlay);
    this.worldLayer.addChild(this.border);
    app.stage.addChild(this.worldLayer);

    // Renderer sam nie animuje — pętlę prowadzi warstwa aplikacji.
    app.ticker.stop();
  }

  get canvas(): HTMLCanvasElement | null {
    return this.app?.canvas ?? null;
  }

  get viewportSize(): { width: number; height: number } {
    const s = this.app?.renderer.screen;
    return { width: s?.width ?? 1, height: s?.height ?? 1 };
  }

  /** Rysuje bieżący stan świata. Wywoływane raz na klatkę. */
  render(sim: Simulation): void {
    const app = this.app;
    const tex = this.textures;
    if (!app || !tex) return;

    const { width, height } = app.renderer.screen;
    this.camera.setViewport(width, height);

    if (this.camera.followId !== null) {
      const target = sim.world.agentById.get(this.camera.followId);
      if (target) this.camera.followTarget(target.x, target.y);
      else this.camera.followId = null;
    }

    const z = this.camera.zoom;
    this.worldLayer.scale.set(z);
    this.worldLayer.position.set(
      width / 2 - this.camera.x * z,
      height / 2 - this.camera.y * z,
    );

    this.drawGround(sim);
    this.drawBorder(sim);
    this.drawCaves(sim);
    this.drawTerrain(sim);
    this.drawFood(sim);
    this.drawRocks(sim);
    this.drawAgents(sim);
    this.drawCombatRings(sim);
    this.drawBirthSparkles(sim);
    this.drawOverlay(sim);

    app.renderer.render(app.stage);
  }

  private drawGround(sim: Simulation): void {
    const ground = this.ground;
    if (!ground) return;
    const size = sim.config.worldSize;
    ground.width = size;
    ground.height = size;
    // One generated grass repeat spans roughly eight terrain cells; this keeps
    // the source detail visible without turning its motifs into a tight grid.
    const tileScale = (sim.world.terrain.cellSize * 8) / this.textures!.grass.width;
    ground.tileScale.set(tileScale);
  }

  private drawBorder(sim: Simulation): void {
    const size = sim.config.worldSize;
    this.border.clear();
    this.border
      .rect(0, 0, size, size)
      .stroke({ width: 2 / Math.max(this.camera.zoom, 0.0001), color: 0x2a3446 });
  }

  /**
   * Delikatny podkład pod komórkami terenu aktualnie liczącymi się jako
   * schronienie (patrz `World.isInShelter` / `TerrainGrid.getShelterCells`)
   * — czytany NA ŻYWO z siatki terenu, nie z kształtu góry przy starcie
   * świata. To celowe: wcześniejsza wersja rysowała stały okrąg wokół
   * pierwotnego środka góry, więc po całkowitym przekopaniu ściany podkład
   * zostawał widoczny mimo że mechanicznie to miejsce dawno przestało być
   * schronieniem — myląca "duchowa" jaskinia. Czytanie żywej mapy naprawia
   * to z definicji: podkład znika, jak tylko siatka przestaje klasyfikować
   * dane komórki jako otoczone.
   */
  private drawCaves(sim: Simulation): void {
    const g = this.caveLayer;
    g.clear();
    const terrain = sim.world.terrain;
    const shelterCells = terrain.getShelterCells(
      sim.config.shelterExteriorMinCells,
      sim.config.shelterMinDepth,
      sim.config.shelterHeatLeakRadius,
    );
    const cellSize = terrain.cellSize;
    const cols = terrain.cols;

    for (let cy = 0; cy < cols; cy++) {
      const rowBase = cy * cols;
      for (let cx = 0; cx < cols; cx++) {
        if (shelterCells[rowBase + cx] !== 1) continue;
        g.rect(cx * cellSize, cy * cellSize, cellSize, cellSize);
      }
    }
    g.fill({ color: 0x3a3220, alpha: 0.28 });
  }

  /**
   * Teren nadal jest szczelną siatką core; bitmapowe kafle są wyłącznie jej
   * widokiem. Pula zachowuje obiekty Pixi między klatkami i zmianami ścian.
   */
  private drawTerrain(sim: Simulation): void {
    const terrain = sim.world.terrain;
    const cellSize = terrain.cellSize;
    const cols = terrain.cols;
    const cells = terrain.cells;
    let used = 0;

    for (let cy = 0; cy < cols; cy++) {
      const rowBase = cy * cols;
      for (let cx = 0; cx < cols; cx++) {
        if (cells[rowBase + cx] !== TILE_ROCK) continue;
        let sprite = this.terrainPool[used];
        if (!sprite) {
          sprite = new Sprite(this.textures!.stone);
          sprite.anchor.set(0.5);
          sprite.roundPixels = true;
          this.terrainLayer.addChild(sprite);
          this.terrainPool[used] = sprite;
        }
        sprite.visible = true;
        sprite.x = (cx + 0.5) * cellSize;
        sprite.y = (cy + 0.5) * cellSize;
        // Tiny overlap prevents sampling seams while collision remains exactly
        // the core cell grid.
        sprite.width = cellSize + 0.5;
        sprite.height = cellSize + 0.5;
        used++;
      }
    }

    for (let i = used; i < this.terrainPool.length; i++) {
      this.terrainPool[i].visible = false;
    }
  }

  private drawFood(sim: Simulation): void {
    const tex = this.textures!;
    const food = sim.world.food;
    // Minimalny rozmiar ekranowy: przy oddaleniu obiekty spadłyby poniżej
    // jednego piksela i plansza wyglądałaby na pustą.
    const radius = Math.max(sim.config.foodRadius, MIN_FOOD_PX / this.camera.zoom);
    const scale = foodScaleFor(radius);
    let used = 0;

    for (let i = 0; i < food.capacity; i++) {
      if (food.alive[i] === 0) continue;
      let sprite = this.foodPool[used];
      if (!sprite) {
        sprite = new Sprite(tex.food);
        sprite.anchor.set(0.5);
        sprite.roundPixels = true;
        this.foodLayer.addChild(sprite);
        this.foodPool[used] = sprite;
      }
      sprite.visible = true;
      sprite.scale.set(scale);
      sprite.x = food.xs[i];
      sprite.y = food.ys[i];
      sprite.alpha = 1;
      used++;
    }

    // Jedzenie niesione przez agentów — usunięte z FoodField przy
    // podniesieniu, więc rysujemy je z pozycji agenta, lekko za nim.
    // Do 5 przedmiotów naraz — kolejne sloty ustawiają się w rządku
    // coraz dalej za agentem, wzdłuż -heading.
    for (const a of sim.world.agents) {
      for (let i = 0; i < a.carriedCount; i++) {
        if (a.carriedItems[i] !== FOOD_TYPE) continue;
        let sprite = this.foodPool[used];
        if (!sprite) {
          sprite = new Sprite(tex.food);
          sprite.anchor.set(0.5);
          sprite.roundPixels = true;
          this.foodLayer.addChild(sprite);
          this.foodPool[used] = sprite;
        }
        sprite.visible = true;
        sprite.scale.set(scale);
        const behind = a.phenotype.radius + radius * 0.6 + i * radius * 1.3;
        sprite.x = a.x - Math.cos(a.heading) * behind;
        sprite.y = a.y - Math.sin(a.heading) * behind;
        sprite.alpha = 0.85;
        used++;
      }
    }

    for (let i = used; i < this.foodPool.length; i++) {
      this.foodPool[i].visible = false;
    }
  }

  private drawRocks(sim: Simulation): void {
    const tex = this.textures!;
    const items = sim.world.items;
    const radius = Math.max(sim.config.rockRadius, MIN_ROCK_PX / this.camera.zoom);
    const scale = rockScaleFor(radius);
    let used = 0;

    const nextSprite = (): Sprite => {
      let sprite = this.rockPool[used];
      if (!sprite) {
        sprite = new Sprite(tex.rock);
        sprite.anchor.set(0.5);
        sprite.roundPixels = true;
        this.rockLayer.addChild(sprite);
        this.rockPool[used] = sprite;
      }
      sprite.visible = true;
      sprite.scale.set(scale);
      used++;
      return sprite;
    };

    // Wolne kamienie leżące na ziemi.
    for (let i = 0; i < items.capacity; i++) {
      if (items.alive[i] === 0) continue;
      const sprite = nextSprite();
      sprite.x = items.xs[i];
      sprite.y = items.ys[i];
      sprite.alpha = 1;
    }

    // Kamienie niesione przez agentów — usunięte z ItemField, więc
    // rysujemy je z pozycji agenta, lekko za nim (wzdłuż -heading), kolejne
    // sloty coraz dalej. Niesione JEDZENIE rysuje drawFood(), nie tutaj.
    for (const a of sim.world.agents) {
      for (let i = 0; i < a.carriedCount; i++) {
        if (a.carriedItems[i] !== ROCK_TYPE) continue;
        const sprite = nextSprite();
        const behind = a.phenotype.radius + radius * 0.6 + i * radius * 1.3;
        sprite.x = a.x - Math.cos(a.heading) * behind;
        sprite.y = a.y - Math.sin(a.heading) * behind;
        sprite.alpha = 0.85;
      }
    }

    for (let i = used; i < this.rockPool.length; i++) {
      this.rockPool[i].visible = false;
    }
  }

  private drawAgents(sim: Simulation): void {
    const tex = this.textures!;
    const agents = sim.world.agents;
    const maxEnergy = sim.config.maxEnergy;
    let used = 0;

    for (const a of agents) {
      let display = this.agentPool[used];
      if (!display) {
        const root = new Container();
        const body = new Sprite(tex.agentBody);
        const details = new Sprite(tex.agentDetails);
        body.anchor.set(AGENT_ANCHOR_X, AGENT_ANCHOR_Y);
        details.anchor.set(AGENT_ANCHOR_X, AGENT_ANCHOR_Y);
        body.roundPixels = true;
        details.roundPixels = true;
        root.addChild(body, details);
        this.agentLayer.addChild(root);
        display = { root, body, details };
        this.agentPool[used] = display;
      }
      const sprite = display.root;
      sprite.visible = true;
      sprite.x = a.x;
      sprite.y = a.y;
      sprite.rotation = a.heading;
      sprite.scale.set(
        agentScaleFor(Math.max(a.phenotype.radius, MIN_AGENT_PX / this.camera.zoom)),
      );
      // Barwa = gen (widać linie rodowe), jasność = energia (widać kondycję).
      const energy = clamp(a.energy / maxEnergy, 0, 1);
      const lightness = 0.28 + 0.42 * energy;
      display.body.tint = hslToRgb(a.phenotype.hue, 0.72, lightness);
      // Neutral tint dims details with energy but never shifts the white eye,
      // highlight and limb art into the phenotype hue.
      const detailLevel = Math.round((0.65 + 0.35 * energy) * 255);
      display.details.tint = (detailLevel << 16) | (detailLevel << 8) | detailLevel;
      sprite.alpha = a.id === this.selectedId ? 1 : 0.95;
      used++;
    }

    for (let i = used; i < this.agentPool.length; i++) {
      this.agentPool[i].root.visible = false;
    }
  }

  /**
   * Pierścienie trafień: rosnący, gasnący okrąg w miejscu każdego ataku.
   * Zdarzenia trafień żyją w `world.combatEvents` (wypełnia je AttackSystem)
   * — drenujemy je tu do lokalnego stanu renderera (żywy czas animacji
   * liczony `performance.now()`, bez związku z tickiem symulacji, bo
   * jeden render może obejmować wiele ticków przy dużej prędkości).
   */
  private drawCombatRings(sim: Simulation): void {
    const events = sim.world.combatEvents;
    if (events.length > 0) {
      const now = performance.now();
      for (const e of events) {
        this.combatRings.push({ x: e.x, y: e.y, startTime: now });
      }
      events.length = 0;
    }

    const g = this.combatLayer;
    g.clear();
    if (this.combatRings.length === 0) return;

    const now = performance.now();
    const alive: CombatRing[] = [];
    for (const ring of this.combatRings) {
      const t = (now - ring.startTime) / COMBAT_RING_DURATION_MS;
      if (t >= 1) continue;
      alive.push(ring);
      const radius = COMBAT_RING_START_RADIUS + (COMBAT_RING_END_RADIUS - COMBAT_RING_START_RADIUS) * t;
      const alpha = 1 - t;
      const lw = Math.max(1, 2.5 / Math.max(this.camera.zoom, 0.0001));
      g.circle(ring.x, ring.y, radius).stroke({ width: lw, color: 0xff5544, alpha });
    }
    this.combatRings = alive;
  }

  /**
   * Iskierki narodzin: miękki, gasnący pierścień plus kilka promieni "iskier"
   * w miejscu, gdzie właśnie urodził się nowy agent (patrz `MutationSystem`
   * -> `world.recordBirthEvent`). Ta sama technika co `drawCombatRings`
   * (drenowanie kolejki zdarzeń do lokalnego stanu animacji liczonego
   * `performance.now()`), ale cieplejszy kolor i łagodniejszy przebieg —
   * ma czytać się jako coś dobrego, w kontrze do czerwonych pierścieni walki.
   */
  private drawBirthSparkles(sim: Simulation): void {
    const events = sim.world.birthEvents;
    if (events.length > 0) {
      const now = performance.now();
      for (const e of events) {
        this.birthSparkles.push({ x: e.x, y: e.y, startTime: now });
      }
      events.length = 0;
    }

    const g = this.birthLayer;
    g.clear();
    if (this.birthSparkles.length === 0) return;

    const now = performance.now();
    const alive: BirthSparkle[] = [];
    const color = 0xffcf6b;
    for (const s of this.birthSparkles) {
      const t = (now - s.startTime) / BIRTH_SPARKLE_DURATION_MS;
      if (t >= 1) continue;
      alive.push(s);
      const alpha = 1 - t;
      const lw = Math.max(1, 2 / Math.max(this.camera.zoom, 0.0001));

      const radius = BIRTH_RING_START_RADIUS + (BIRTH_RING_END_RADIUS - BIRTH_RING_START_RADIUS) * t;
      g.circle(s.x, s.y, radius).stroke({ width: lw, color, alpha });

      // Promienie iskier: krótkie odcinki wylatujące na zewnątrz, gasnące
      // razem z pierścieniem — daje efekt "rozbłysku", nie tylko okręgu.
      const sparkleReach = radius + BIRTH_SPARKLE_LENGTH * t;
      for (let i = 0; i < BIRTH_SPARKLE_COUNT; i++) {
        const angle = (i / BIRTH_SPARKLE_COUNT) * Math.PI * 2;
        const innerR = radius * 0.6;
        g.moveTo(s.x + Math.cos(angle) * innerR, s.y + Math.sin(angle) * innerR)
          .lineTo(s.x + Math.cos(angle) * sparkleReach, s.y + Math.sin(angle) * sparkleReach)
          .stroke({ width: lw, color, alpha: alpha * 0.8 });
      }
    }
    this.birthSparkles = alive;
  }

  private drawOverlay(sim: Simulation): void {
    const g = this.overlay;
    g.clear();
    if (this.selectedId === null) return;
    const a = sim.world.agentById.get(this.selectedId);
    if (!a) return;

    const lw = 1.5 / Math.max(this.camera.zoom, 0.0001);
    g.circle(a.x, a.y, a.phenotype.radius + 4 + lw * 2).stroke({ width: lw * 2, color: 0xffffff });

    if (this.showVision) {
      g.circle(a.x, a.y, a.phenotype.visionRadius).stroke({
        width: lw,
        color: 0xffffff,
        alpha: 0.18,
      });
      const len = a.phenotype.visionRadius;
      g.moveTo(a.x, a.y)
        .lineTo(a.x + Math.cos(a.heading) * len, a.y + Math.sin(a.heading) * len)
        .stroke({ width: lw, color: 0xffffff, alpha: 0.25 });
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.foodPool = [];
    this.rockPool = [];
    this.terrainPool = [];
    this.agentPool = [];
    this.combatRings = [];
    this.birthSparkles = [];
    if (this.app) {
      // Asset textures are owned by Pixi's global cache and may be reused by
      // a later mount (notably React StrictMode), so destroy display objects
      // without invalidating the shared bitmap sources.
      this.app.destroy(true, { children: true });
      this.app = null;
    }
    this.textures = null;
    this.ground = null;
  }
}
