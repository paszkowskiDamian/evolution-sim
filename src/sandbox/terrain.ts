export const WORLD_SIZE = 76;

export function terrainHeight(x: number, z: number): number {
  const broad = Math.sin(x * 0.105) * Math.cos(z * 0.09) * 0.8;
  const detail = Math.sin((x + z) * 0.24) * 0.18;
  const valley = -Math.exp(-(x * x + z * z) / 260) * 0.45;
  return broad + detail + valley;
}

