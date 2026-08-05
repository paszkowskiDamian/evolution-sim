import { Application, Container, Graphics, Rectangle, Sprite, TilingSprite, type Texture } from 'pixi.js';
import type { Simulation } from '../../core/simulation/simulation';
import { Camera } from '../camera/camera';
import {
  loadSpriteTextures,
  createClassicTextures,
  agentScaleFor,
  foodScaleFor,
  rockScaleFor,
  classicAgentScaleFor,
  classicFoodScaleFor,
  classicRockScaleFor,
  AGENT_ANCHOR_X,
  AGENT_ANCHOR_Y,
  type SpriteTextures,
  type ClassicTextures,
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
const MIN_AGENT_PX = 5;
const MIN_FOOD_PX = 2.4;
const MIN_ROCK_PX = 2.8;

const GROUND_MOSAIC_COLS = 8;
const GROUND_MOSAIC_ROWS = 8;
const HALF_PI = Math.PI / 2;
const STONE_TINTS = [0xdce1d9, 0xc9d0c7, 0xb9c2b8, 0xe7e9df] as const;

export type RenderMode = 'classic' | 'sprites';

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

function hashCell(x: number, y: number): number {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0xc2b2ae35, 0x27d4eb2d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

export class PixiRenderer {
  readonly camera = new Camera();
  private app: Application | null = null;
  private textures: SpriteTextures | null = null;
  private classicTextures: ClassicTextures | null = null;
  private groundMosaicTexture: Texture | null = null;
  private renderMode: RenderMode = 'sprites';

  private worldLayer = new Container();
  private spriteGroundBase = new Graphics();
  private ground: TilingSprite | null = null;
  private groundOverlay: TilingSprite | null = null;
  private caveLayer = new Graphics();
  private terrainBacking = new Graphics();
  private terrainLayer = new Container();
  private classicTerrainLayer = new Graphics();
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
  private terrainSignature = -1;
  private groundWorldSize = -1;

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
    this.classicTextures = createClassicTextures(app.renderer);
    host.appendChild(app.canvas);

    this.groundMosaicTexture = this.createGroundMosaic(textures.grass);
    this.ground = new TilingSprite({ texture: this.groundMosaicTexture, width: 1, height: 1 });
    this.groundOverlay = new TilingSprite({ texture: this.groundMosaicTexture, width: 1, height: 1 });
    this.ground.roundPixels = true;
    this.ground.alpha = 0.72;
    this.groundOverlay.roundPixels = true;
    this.groundOverlay.alpha = 0.25;
    this.groundOverlay.tint = 0xc5d69b;
    this.spriteGroundBase.visible = this.renderMode === 'sprites';
    this.ground.visible = this.renderMode === 'sprites';
    this.groundOverlay.visible = this.renderMode === 'sprites';
    this.terrainBacking.visible = this.renderMode === 'sprites';
    this.terrainLayer.visible = this.renderMode === 'sprites';
    this.classicTerrainLayer.visible = this.renderMode === 'classic';

    this.worldLayer.addChild(this.spriteGroundBase);
    this.worldLayer.addChild(this.ground);
    this.worldLayer.addChild(this.groundOverlay);
    this.worldLayer.addChild(this.caveLayer);
    this.worldLayer.addChild(this.terrainBacking);
    this.worldLayer.addChild(this.terrainLayer);
    this.worldLayer.addChild(this.classicTerrainLayer);
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

  setRenderMode(mode: RenderMode): void {
    if (mode === this.renderMode) return;
    this.renderMode = mode;
    this.spriteGroundBase.visible = mode === 'sprites';
    if (this.ground) this.ground.visible = mode === 'sprites';
    if (this.groundOverlay) this.groundOverlay.visible = mode === 'sprites';
    this.terrainBacking.visible = mode === 'sprites';
    this.terrainLayer.visible = mode === 'sprites';
    this.classicTerrainLayer.visible = mode === 'classic';
    this.terrainSignature = -1;
  }

  private createGroundMosaic(source: Texture): Texture {
    const app = this.app!;
    const tileWidth = source.width;
    const tileHeight = source.height;
    const width = tileWidth * GROUND_MOSAIC_COLS;
    const height = tileHeight * GROUND_MOSAIC_ROWS;
    const mosaic = new Container();

    for (let y = 0; y < GROUND_MOSAIC_ROWS; y++) {
      for (let x = 0; x < GROUND_MOSAIC_COLS; x++) {
        const tile = new Sprite(source);
        tile.anchor.set(0.5);
        tile.x = (x + 0.5) * tileWidth;
        tile.y = (y + 0.5) * tileHeight;
        tile.rotation = (hashCell(x, y) & 3) * HALF_PI;
        mosaic.addChild(tile);
      }
    }

    // Broad deterministic colour fields span many source tiles, breaking the
    // obvious single-image cadence without adding random or per-frame work.
    const macro = new Graphics();
    for (let i = 0; i < 18; i++) {
      const hash = hashCell(i * 17 + 3, i * 29 + 11);
      const x = (hash & 0xffff) / 0xffff * width;
      const y = ((hash >>> 16) & 0xffff) / 0xffff * height;
      const radius = tileWidth * (0.8 + ((hash >>> 8) & 7) * 0.18);
      const color = (hash & 1) === 0 ? 0x254d27 : 0x8ba33c;
      // Wrapped copies make the generated macro texture seamless at its own
      // much larger repeat boundary.
      for (let wrapY = -1; wrapY <= 1; wrapY++) {
        for (let wrapX = -1; wrapX <= 1; wrapX++) {
          macro.circle(x + wrapX * width, y + wrapY * height, radius)
            .fill({ color, alpha: 0.11 });
        }
      }
    }
    mosaic.addChild(macro);

    const texture = app.renderer.generateTexture({
      target: mosaic,
      frame: new Rectangle(0, 0, width, height),
      resolution: 1,
    });
    texture.source.scaleMode = 'nearest';
    mosaic.destroy({ children: true });
    return texture;
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
    this.camera.setWorldBounds(sim.config.worldSize);

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
    this.drawTerrainAndShelter(sim);
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
    const overlay = this.groundOverlay;
    if (!ground || !overlay) return;
    const size = sim.config.worldSize;
    if (size !== this.groundWorldSize) {
      this.groundWorldSize = size;
      this.spriteGroundBase.clear().rect(0, 0, size, size).fill(0x526b28);
    }
    ground.width = size;
    ground.height = size;
    overlay.width = size;
    overlay.height = size;
    // One generated grass repeat spans roughly eight terrain cells; this keeps
    // the source detail visible without turning its motifs into a tight grid.
    const tileScale = (sim.world.terrain.cellSize * 8) / this.textures!.grass.width;
    ground.tileScale.set(tileScale);
    // A lower-frequency offset copy masks the source image's own tile cadence;
    // both layers use the same cached deterministic mosaic.
    overlay.tileScale.set(tileScale * 0.71);
    overlay.tilePosition.set(this.textures!.grass.width * 2.37, this.textures!.grass.height * 1.61);
  }

  private drawBorder(sim: Simulation): void {
    const size = sim.config.worldSize;
    this.border.clear();
    this.border
      .rect(0, 0, size, size)
      .stroke({ width: 2 / Math.max(this.camera.zoom, 0.0001), color: 0x2a3446 });
  }

  /**
   * Terrain and shelter visuals are rebuilt only when the live terrain grid
   * changes. Shelter remains truthful because it comes from the same current
   * core classification used by mechanics, never from decorative asset art.
   */
  private drawTerrainAndShelter(sim: Simulation): void {
    const terrain = sim.world.terrain;
    const cellSize = terrain.cellSize;
    const cols = terrain.cols;
    const cells = terrain.cells;
    let signature = Math.imul(cols, 31) ^ Math.imul(cellSize, 131);
    for (let i = 0; i < cells.length; i++) signature = Math.imul(signature ^ cells[i], 16777619);
    if (this.renderMode === 'classic') signature ^= Math.round(this.camera.zoom * 1000);
    if (signature === this.terrainSignature) return;
    this.terrainSignature = signature;

    const shelter = terrain.getShelterCells(
      sim.config.shelterExteriorMinCells,
      sim.config.shelterMinDepth,
      sim.config.shelterHeatLeakRadius,
    );
    const cave = this.caveLayer;
    cave.clear();
    for (let cy = 0; cy < cols; cy++) {
      const rowBase = cy * cols;
      for (let cx = 0; cx < cols; cx++) {
        if (shelter[rowBase + cx] !== 1) continue;
        cave.rect(cx * cellSize, cy * cellSize, cellSize, cellSize);
      }
    }
    cave.fill({ color: 0x17140d, alpha: 0.62 });
    for (let cy = 1; cy < cols - 1; cy++) {
      const rowBase = cy * cols;
      for (let cx = 1; cx < cols - 1; cx++) {
        const i = rowBase + cx;
        if (
          shelter[i] === 1 && shelter[i - 1] === 1 && shelter[i + 1] === 1 &&
          shelter[i - cols] === 1 && shelter[i + cols] === 1
        ) {
          cave.rect(cx * cellSize, cy * cellSize, cellSize, cellSize);
        }
      }
    }
    cave.fill({ color: 0x302515, alpha: 0.24 });

    const classic = this.classicTerrainLayer;
    classic.clear();
    const backing = this.terrainBacking;
    backing.clear();
    let used = 0;

    for (let cy = 0; cy < cols; cy++) {
      const rowBase = cy * cols;
      for (let cx = 0; cx < cols; cx++) {
        if (cells[rowBase + cx] !== TILE_ROCK) continue;
        const x = cx * cellSize;
        const y = cy * cellSize;
        classic.rect(x, y, cellSize, cellSize);

        const north = cy > 0 && cells[rowBase - cols + cx] === TILE_ROCK;
        const east = cx + 1 < cols && cells[rowBase + cx + 1] === TILE_ROCK;
        const south = cy + 1 < cols && cells[rowBase + cols + cx] === TILE_ROCK;
        const west = cx > 0 && cells[rowBase + cx - 1] === TILE_ROCK;
        const neighbors = Number(north) + Number(east) + Number(south) + Number(west);
        const hash = hashCell(cx, cy);

        // A continuous backing guarantees visual/collision solidity. Rounded,
        // neighbor-aware extensions soften the square cellular silhouette.
        backing.roundRect(x - 0.8, y - 0.8, cellSize + 1.6, cellSize + 1.6, cellSize * 0.18);
        if (!north) backing.roundRect(x + cellSize * 0.12, y - 2, cellSize * 0.76, 4, 2);
        if (!east) backing.roundRect(x + cellSize - 2, y + cellSize * 0.12, 4, cellSize * 0.76, 2);
        if (!south) backing.roundRect(x + cellSize * 0.12, y + cellSize - 2, cellSize * 0.76, 4, 2);
        if (!west) backing.roundRect(x - 2, y + cellSize * 0.12, 4, cellSize * 0.76, 2);

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
        sprite.rotation = ((hash >>> 3) & 3) * HALF_PI;
        sprite.tint = STONE_TINTS[(neighbors + (hash & 3)) & 3];
        sprite.alpha = neighbors === 4 ? 0.58 : neighbors === 3 ? 0.82 : 1;
        const overlap = neighbors === 4 ? 1.5 : 3;
        sprite.width = cellSize + overlap;
        sprite.height = cellSize + overlap;
        used++;
      }
    }
    classic.fill({ color: 0x7a7f8c }).stroke({
      width: Math.max(0.5, 1 / Math.max(this.camera.zoom, 0.0001)),
      color: 0x40444e,
      alpha: 0.7,
    });
    backing.fill({ color: 0x454a46 });

    for (let i = used; i < this.terrainPool.length; i++) {
      this.terrainPool[i].visible = false;
    }
  }

  private drawFood(sim: Simulation): void {
    const tex = this.textures!;
    const classic = this.classicTextures!;
    const texture = this.renderMode === 'sprites' ? tex.food : classic.food;
    const food = sim.world.food;
    // Minimalny rozmiar ekranowy: przy oddaleniu obiekty spadłyby poniżej
    // jednego piksela i plansza wyglądałaby na pustą.
    const radius = Math.max(sim.config.foodRadius, MIN_FOOD_PX / this.camera.zoom);
    const scale = this.renderMode === 'sprites' ? foodScaleFor(radius) : classicFoodScaleFor(radius);
    let used = 0;

    for (let i = 0; i < food.capacity; i++) {
      if (food.alive[i] === 0) continue;
      let sprite = this.foodPool[used];
      if (!sprite) {
        sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.roundPixels = true;
        this.foodLayer.addChild(sprite);
        this.foodPool[used] = sprite;
      }
      sprite.visible = true;
      if (sprite.texture !== texture) sprite.texture = texture;
      sprite.tint = this.renderMode === 'sprites' ? 0xffffff : 0x2f7d4f;
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
          sprite = new Sprite(texture);
          sprite.anchor.set(0.5);
          sprite.roundPixels = true;
          this.foodLayer.addChild(sprite);
          this.foodPool[used] = sprite;
        }
        sprite.visible = true;
        if (sprite.texture !== texture) sprite.texture = texture;
        sprite.tint = this.renderMode === 'sprites' ? 0xffffff : 0x2f7d4f;
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
    const classic = this.classicTextures!;
    const texture = this.renderMode === 'sprites' ? tex.rock : classic.rock;
    const items = sim.world.items;
    const radius = Math.max(sim.config.rockRadius, MIN_ROCK_PX / this.camera.zoom);
    const scale = this.renderMode === 'sprites' ? rockScaleFor(radius) : classicRockScaleFor(radius);
    let used = 0;

    const nextSprite = (): Sprite => {
      let sprite = this.rockPool[used];
      if (!sprite) {
        sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.roundPixels = true;
        this.rockLayer.addChild(sprite);
        this.rockPool[used] = sprite;
      }
      sprite.visible = true;
      if (sprite.texture !== texture) sprite.texture = texture;
      sprite.tint = this.renderMode === 'sprites' ? 0xffffff : 0x8a8f9c;
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
    const classic = this.classicTextures!;
    const spritesMode = this.renderMode === 'sprites';
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
      const bodyTexture = spritesMode ? tex.agentBody : classic.agent;
      if (display.body.texture !== bodyTexture) display.body.texture = bodyTexture;
      display.details.visible = spritesMode;
      display.body.anchor.set(spritesMode ? AGENT_ANCHOR_X : 0.4, spritesMode ? AGENT_ANCHOR_Y : 0.5);
      sprite.visible = true;
      sprite.x = a.x;
      sprite.y = a.y;
      sprite.rotation = a.heading;
      const radius = Math.max(a.phenotype.radius, MIN_AGENT_PX / this.camera.zoom);
      sprite.scale.set(spritesMode ? agentScaleFor(radius) : classicAgentScaleFor(radius));
      // Barwa = gen (widać linie rodowe), jasność = energia (widać kondycję).
      const energy = clamp(a.energy / maxEnergy, 0, 1);
      const lightness = 0.4 + 0.28 * energy;
      display.body.tint = hslToRgb(a.phenotype.hue, 0.88, lightness);
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
    let alive = 0;
    for (let i = 0; i < this.combatRings.length; i++) {
      const ring = this.combatRings[i];
      const t = (now - ring.startTime) / COMBAT_RING_DURATION_MS;
      if (t >= 1) continue;
      this.combatRings[alive++] = ring;
      const radius = COMBAT_RING_START_RADIUS + (COMBAT_RING_END_RADIUS - COMBAT_RING_START_RADIUS) * t;
      const alpha = 1 - t;
      const lw = Math.max(1, 2.5 / Math.max(this.camera.zoom, 0.0001));
      g.circle(ring.x, ring.y, radius).stroke({ width: lw, color: 0xff5544, alpha });
    }
    this.combatRings.length = alive;
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
    let alive = 0;
    const color = 0xffcf6b;
    for (let i = 0; i < this.birthSparkles.length; i++) {
      const s = this.birthSparkles[i];
      const t = (now - s.startTime) / BIRTH_SPARKLE_DURATION_MS;
      if (t >= 1) continue;
      this.birthSparkles[alive++] = s;
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
    this.birthSparkles.length = alive;
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
    if (this.classicTextures) {
      this.classicTextures.agent.destroy(true);
      this.classicTextures.food.destroy(true);
      this.classicTextures.rock.destroy(true);
      this.classicTextures = null;
    }
    this.groundMosaicTexture?.destroy(true);
    this.groundMosaicTexture = null;
    this.textures = null;
    this.ground = null;
    this.groundOverlay = null;
  }
}
