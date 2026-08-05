import type { Inventory, Recipe } from './types';

export const RECIPES: Recipe[] = [
  { name: 'pickaxe', label: 'Stone pickaxe', costs: { wood: 2, stone: 2 }, produces: { pickaxe: 1 } },
  { name: 'sword', label: 'Stone sword', costs: { wood: 1, stone: 3 }, produces: { sword: 1 } },
  { name: 'shelterKit', label: 'Shelter kit', costs: { wood: 5, stone: 2 }, produces: { shelterKit: 1 } },
  { name: 'meal', label: 'Cooked meal', costs: { food: 2, wood: 1 }, produces: { food: 4 } },
];

export function canCraft(inventory: Inventory, recipe: Recipe): boolean {
  return Object.entries(recipe.costs).every(([item, amount]) => inventory[item as keyof Inventory] >= (amount ?? 0));
}

export function applyRecipe(inventory: Inventory, recipe: Recipe): void {
  for (const [item, amount] of Object.entries(recipe.costs)) {
    inventory[item as keyof Inventory] -= amount ?? 0;
  }
  for (const [item, amount] of Object.entries(recipe.produces)) {
    inventory[item as keyof Inventory] += amount ?? 0;
  }
}
