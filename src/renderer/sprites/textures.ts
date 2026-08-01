import { Graphics, type Renderer, type Texture } from 'pixi.js';

/**
 * Tekstury generowane raz przy starcie.
 *
 * Wszystkie kształty są białe — kolor nadajemy przez `tint`, dzięki czemu
 * tysiące sprite'ów dzieli jedną teksturę i renderuje się w jednym batchu.
 *
 * Kształty rysujemy tak, żeby ich bounding box był przewidywalny —
 * `generateTexture` przycina teksturę do bounds, więc anchor musi być
 * policzony z tych samych liczb, a nie zgadnięty.
 */

const R = 32; // promień koła agenta w pikselach tekstury
const NOSE = 2.5 * R; // zasięg dzioba w osi X
const FOOD_R = 16;

export const AGENT_ANCHOR_X = R / NOSE; // 0.4
export const AGENT_ANCHOR_Y = 0.5;

export interface SpriteTextures {
  agent: Texture;
  food: Texture;
}

export function createTextures(renderer: Renderer): SpriteTextures {
  // Agent: koło (0..2R) + dziób wskazujący kierunek (oś +X = heading 0).
  const agentGfx = new Graphics();
  agentGfx
    .moveTo(R, R - R * 0.55)
    .lineTo(NOSE, R)
    .lineTo(R, R + R * 0.55)
    .fill(0xffffff);
  agentGfx.circle(R, R, R).fill(0xffffff);

  const foodGfx = new Graphics();
  foodGfx.circle(FOOD_R, FOOD_R, FOOD_R).fill(0xffffff);

  const agent = renderer.generateTexture({ target: agentGfx, resolution: 2 });
  const food = renderer.generateTexture({ target: foodGfx, resolution: 2 });

  agentGfx.destroy();
  foodGfx.destroy();

  return { agent, food };
}

/** Skala sprite'a agenta tak, by koło odpowiadało promieniowi świata. */
export function agentScaleFor(radius: number): number {
  return radius / R;
}

export function foodScaleFor(radius: number): number {
  return radius / FOOD_R;
}
