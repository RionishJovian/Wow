export const GCD = 1.5;
export function canUse(
  dead: boolean,
  gcd: number,
  cost: number,
  resource: number,
) {
  return !dead && gcd <= 0 && resource >= cost;
}
export function xpThreshold(level: number) {
  return level * 100;
}
