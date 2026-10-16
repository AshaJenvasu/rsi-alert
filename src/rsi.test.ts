import { rsi } from "./rsi.js";

// Classic Wilder/StockCharts RSI(14) worked example
const closes = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
  46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
];
const out = rsi(closes, 14);
const expected: Record<number, number> = { 14: 70.53, 15: 66.32, 16: 66.55, 17: 69.41, 18: 66.36, 19: 57.97 };
let ok = true;
for (const [i, exp] of Object.entries(expected)) {
  const got = out[Number(i)];
  const pass = Math.abs(got - exp) < 0.1;
  if (!pass) ok = false;
  console.log(`idx ${i}: got ${got.toFixed(2)} expected ~${exp} ${pass ? "OK" : "FAIL"}`);
}
// edge cases
console.log("all gains ->", rsi([1, 2, 3, 4, 5, 6, 7, 8], 7)[7], "(expect 100)");
console.log("too short ->", rsi([1, 2, 3], 7).every(Number.isNaN), "(expect true)");
process.exit(ok ? 0 : 1);
