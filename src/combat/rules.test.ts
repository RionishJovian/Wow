import { canUse, xpThreshold, GCD } from "./rules.ts";
function assert(value: boolean) {
  if (!value) throw new Error("Combat rule assertion failed");
}
assert(GCD === 1.5);
assert(canUse(false, 0, 20, 20));
assert(!canUse(false, 1, 20, 100));
assert(!canUse(true, 0, 0, 100));
assert(!canUse(false, 0, 21, 20));
assert(xpThreshold(2) > xpThreshold(1));
