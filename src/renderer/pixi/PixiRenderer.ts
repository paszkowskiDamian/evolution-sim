import { Application, Container, Graphics, Sprite } from 'pixi.js';
import type { Simulation } from '../../core/simulation/simulation';
import { Camera } from '../camera/camera';
import {
  createTextures,
  agentScaleFor,
  foodScaleFor,
  rockScaleFor,
  AGENT_ANCHOR_X,
  AGENT_ANCHOR_Y,
  type SpriteTextures,
} from '../sprites/textures';
import { hslToRgb, clamp } from '../../core/utils/math';
import { ROCK_TYPE, FOOD_TYPE } from '../../core/world/items';

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

interface CombatRing {
  x: number;
  y: number;
  startTime: number;
}

export class PixiRenderer {
  readonly camera = new Camera();
  private app: Application | null = null;
  private textures: SpriteTextures | null = null;

  private worldLayer = new Container();
  private foodLayer = new Container();
  private rockLayer = new Container();
  private agentLayer = new Container();
  private combatLayer = new Graphics();
  private overlay = new Graphics();
  private border = new Graphics();

  private foodPool: Sprite[] = [];
  private rockPool: Sprite[] = [];
  private agentPool: Sprite[] = [];
  private combatRings: CombatRing[] = [];

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
    this.app = app;
    host.appendChild(app.canvas);

    this.textures = createTextures(app.renderer);

    this.worldLayer.addChild(this.border);
    this.worldLayer.addChild(this.foodLayer);
    this.worldLayer.addChild(this.rockLayer);
    this.worldLayer.addChild(this.agentLayer);
    this.worldLayer.addChild(this.combatLayer);
    this.worldLayer.addChild(this.overlay);
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

    this.drawBorder(sim);
    this.drawFood(sim);
    this.drawRocks(sim);
    this.drawAgents(sim);
    this.drawCombatRings(sim);
    this.drawOverlay(sim);

    app.renderer.render(app.stage);
  }

  private drawBorder(sim: Simulation): void {
    const size = sim.config.worldSize;
    this.border.clear();
    this.border
      .rect(0, 0, size, size)
      .stroke({ width: 2 / Math.max(this.camera.zoom, 0.0001), color: 0x2a3446 });
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
        // Jedzenie celowo przygaszone — agenci mają być tym, co przyciąga wzrok.
        sprite.tint = 0x2f7d4f;
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
    for (const a of sim.world.agents) {
      if (a.carriedItemType !== FOOD_TYPE) continue;
      let sprite = this.foodPool[used];
      if (!sprite) {
        sprite = new Sprite(tex.food);
        sprite.anchor.set(0.5);
        sprite.tint = 0x2f7d4f;
        this.foodLayer.addChild(sprite);
        this.foodPool[used] = sprite;
      }
      sprite.visible = true;
      sprite.scale.set(scale);
      const behind = a.phenotype.radius + radius * 0.6;
      sprite.x = a.x - Math.cos(a.heading) * behind;
      sprite.y = a.y - Math.sin(a.heading) * behind;
      sprite.alpha = 0.85;
      used++;
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
        sprite.tint = 0x8a8f9c;
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
    // rysujemy je z pozycji agenta, lekko za nim (wzdłuż -heading).
    // Niesione JEDZENIE rysuje drawFood(), nie tutaj.
    for (const a of sim.world.agents) {
      if (a.carriedItemType !== ROCK_TYPE) continue;
      const sprite = nextSprite();
      const behind = a.phenotype.radius + radius * 0.6;
      sprite.x = a.x - Math.cos(a.heading) * behind;
      sprite.y = a.y - Math.sin(a.heading) * behind;
      sprite.alpha = 0.85;
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
      let sprite = this.agentPool[used];
      if (!sprite) {
        sprite = new Sprite(tex.agent);
        sprite.anchor.set(AGENT_ANCHOR_X, AGENT_ANCHOR_Y);
        this.agentLayer.addChild(sprite);
        this.agentPool[used] = sprite;
      }
      sprite.visible = true;
      sprite.x = a.x;
      sprite.y = a.y;
      sprite.rotation = a.heading;
      sprite.scale.set(
        agentScaleFor(Math.max(a.phenotype.radius, MIN_AGENT_PX / this.camera.zoom)),
      );
      // Barwa = gen (widać linie rodowe), jasność = energia (widać kondycję).
      const lightness = 0.28 + 0.42 * clamp(a.energy / maxEnergy, 0, 1);
      sprite.tint = hslToRgb(a.phenotype.hue, 0.72, lightness);
      sprite.alpha = a.id === this.selectedId ? 1 : 0.95;
      used++;
    }

    for (let i = used; i < this.agentPool.length; i++) {
      this.agentPool[i].visible = false;
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
    this.agentPool = [];
    this.combatRings = [];
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }
  }
}
