// Wilder's RSI (same smoothing as TradingView's ta.rsi)
export function rsi(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;

  const toRsi = (avgGain: number, avgLoss: number) =>
    avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

export type Crossing = { index: number; kind: "overbought" | "oversold" };

// Candles (from `fromIndex` on) where RSI just moved INTO the overbought / oversold zone.
export function findCrossings(
  rsis: number[],
  overbought: number,
  oversold: number,
  fromIndex: number,
): Crossing[] {
  const out: Crossing[] = [];
  for (let i = Math.max(1, fromIndex); i < rsis.length; i++) {
    const prev = rsis[i - 1];
    const cur = rsis[i];
    if (Number.isNaN(prev) || Number.isNaN(cur)) continue;
    if (prev < overbought && cur >= overbought)
      out.push({ index: i, kind: "overbought" });
    else if (prev > oversold && cur <= oversold)
      out.push({ index: i, kind: "oversold" });
  }
  return out;
}
