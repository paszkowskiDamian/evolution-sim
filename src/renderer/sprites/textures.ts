import { Assets, Graphics, type Renderer, type Texture } from 'pixi.js';

/**
 * Renderer-owned bitmap assets. Static `new URL(..., import.meta.url)` calls
 * let Vite fingerprint and emit the PNG files without exposing them to core.
 */
export const spriteAssetUrls = {
  agentBody: new URL('./assets/agent-body.png', import.meta.url).href,
  agentDetails: new URL('./assets/agent-details.png', import.meta.url).href,
  food: new URL('./assets/food.png', import.meta.url).href,
  looseRock: new URL('./assets/loose-rock.png', import.meta.url).href,
  solidStone: new URL('./assets/solid-stone.png', import.meta.url).href,
  grass: new URL('./assets/grass.png', import.meta.url).href,

  // Bundled for mechanics that do not exist on origin/main yet. Keeping the
  // URLs here makes the renderer ready to opt in without inventing core state.
  plantSeedling: new URL('./assets/plant-seedling.png', import.meta.url).href,
  plantGrowing: new URL('./assets/plant-growing.png', import.meta.url).href,
  plantMature: new URL('./assets/plant-mature.png', import.meta.url).href,
  storageCrate: new URL('./assets/storage-crate.png', import.meta.url).href,
  path: new URL('./assets/path.png', import.meta.url).href,
  snow: new URL('./assets/snow.png', import.meta.url).href,
  water: new URL('./assets/water.png', import.meta.url).href,
} as const;

export interface SpriteTextures {
  agentBody: Texture;
  agentDetails: Texture;
  food: Texture;
  rock: Texture;
  stone: Texture;
  grass: Texture;
}

export interface ClassicTextures {
  agent: Texture;
  food: Texture;
  rock: Texture;
}

async function loadTexture(url: string): Promise<Texture> {
  const texture = await Assets.load<Texture>(url);
  texture.source.scaleMode = 'nearest';
  return texture;
}

/** Load only assets represented by current core state. */
export async function loadSpriteTextures(): Promise<SpriteTextures> {
  const [agentBody, agentDetails, food, rock, stone, grass] = await Promise.all([
    loadTexture(spriteAssetUrls.agentBody),
    loadTexture(spriteAssetUrls.agentDetails),
    loadTexture(spriteAssetUrls.food),
    loadTexture(spriteAssetUrls.looseRock),
    loadTexture(spriteAssetUrls.solidStone),
    loadTexture(spriteAssetUrls.grass),
  ]);

  return { agentBody, agentDetails, food, rock, stone, grass };
}

/**
 * The original renderer artwork, kept intact for the live Classic mode.
 * White procedural textures share batches and receive their colours via tint.
 */
export function createClassicTextures(renderer: Renderer): ClassicTextures {
  const agentGfx = new Graphics();
  agentGfx
    .moveTo(32, 32 - 32 * 0.55)
    .lineTo(80, 32)
    .lineTo(32, 32 + 32 * 0.55)
    .fill(0xffffff);
  agentGfx.circle(32, 32, 32).fill(0xffffff);

  const foodGfx = new Graphics();
  foodGfx.circle(16, 16, 16).fill(0xffffff);

  const rockGfx = new Graphics();
  rockGfx
    .moveTo(14 * 0.2, 14 * 1.7)
    .lineTo(14 * 0.9, 14 * 0.2)
    .lineTo(14 * 1.7, 14 * 0.5)
    .lineTo(14 * 1.8, 14 * 1.5)
    .lineTo(14 * 1.1, 14 * 1.9)
    .closePath()
    .fill(0xffffff);

  const agent = renderer.generateTexture({ target: agentGfx, resolution: 2 });
  const food = renderer.generateTexture({ target: foodGfx, resolution: 2 });
  const rock = renderer.generateTexture({ target: rockGfx, resolution: 2 });

  agentGfx.destroy();
  foodGfx.destroy();
  rockGfx.destroy();
  return { agent, food, rock };
}

// Pixel measurements of the extracted art. Scale helpers keep the previous
// world-space semantics: configured radii still describe collision bodies.
const AGENT_BODY_RADIUS_PX = 55;
const FOOD_RADIUS_PX = 54;
const ROCK_RADIUS_PX = 72;

/** Rotation pivot is the centre of the round body, not the sprite bounds. */
export const AGENT_ANCHOR_X = 0.44;
export const AGENT_ANCHOR_Y = 0.48;

export function agentScaleFor(radius: number): number {
  return radius / AGENT_BODY_RADIUS_PX;
}

export function foodScaleFor(radius: number): number {
  return radius / FOOD_RADIUS_PX;
}

export function rockScaleFor(radius: number): number {
  return radius / ROCK_RADIUS_PX;
}

export function classicAgentScaleFor(radius: number): number {
  return radius / 32;
}

export function classicFoodScaleFor(radius: number): number {
  return radius / 16;
}

export function classicRockScaleFor(radius: number): number {
  return radius / 14;
}
