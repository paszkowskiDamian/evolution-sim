import { Assets, type Texture } from 'pixi.js';

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
