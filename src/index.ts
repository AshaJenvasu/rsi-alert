// BTC RSI alert -> Telegram
// Runs on GitHub Actions (hourly). Uses only CLOSED candles from OKX public API.
//
// Robust to skipped/delayed cron runs: every run looks back over the last few closed candles
// and alerts on any RSI crossing it has not alerted yet (tracked in state/alerts.json).
//
// Usage:
//   npx tsx src/index.ts            normal run (alert on fresh, not-yet-alerted crossings)
//   npx tsx src/index.ts --status   print current RSI of every timeframe, no alert
//   npx tsx src/index.ts --summary  send an RSI summary of every timeframe to Telegram
//   npx tsx src/index.ts --test     send a test message to Telegram

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { findCrossings, rsi } from "./rsi.js";

// lookback = how many of the latest closed candles are re-checked on every run.
// (1h: 6 candles = survive ~6 hours of skipped runs)
type Timeframe = {
  label: string;
  okxBar: string;
  ms: number;
  lookback: number;
};

// "utc" bars so daily/weekly candles open at 00:00 UTC (same as TradingView on crypto).
const ALL_TIMEFRAMES: Timeframe[] = [
  { label: "1h", okxBar: "1H", ms: 3_600_000, lookback: 6 },
  { label: "4h", okxBar: "4H", ms: 4 * 3_600_000, lookback: 3 },
  { label: "1D", okxBar: "1Dutc", ms: 86_400_000, lookback: 2 },
  { label: "1W", okxBar: "1Wutc", ms: 7 * 86_400_000, lookback: 1 },
];

const SYMBOL = process.env.SYMBOL ?? "BTC-USDT";
const RSI_PERIOD = Number(process.env.RSI_PERIOD ?? 7);
const OVERBOUGHT = Number(process.env.OVERBOUGHT ?? 70);
const OVERSOLD = Number(process.env.OVERSOLD ?? 30);
// On the very first run (no state file yet) only crossings from the last N minutes count,
// so we don't dump old history into Telegram.
const WINDOW_MINUTES = Number(process.env.WINDOW_MINUTES ?? 60);
// Alerts older than this are labelled as "late" (a cron run was skipped).
const LATE_AFTER_MINUTES = Number(process.env.LATE_AFTER_MINUTES ?? 75);
const STATE_FILE = process.env.STATE_FILE ?? "state/alerts.json";
// Choose which timeframes to watch, e.g. TIMEFRAMES="4h,1D,1W"
const WANTED = (process.env.TIMEFRAMES ?? "1h,4h,1D,1W")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

type Candle = { ts: number; close: number };

// since   = only crossings whose candle closed after this time may alert (set on first run)
// alerted = per "<timeframe>:<kind>", close time of the last candle already alerted
type State = { since: number; alerted: Record<string, number> };

function loadState(now: number): { state: State; isNew: boolean } {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
    if (
      typeof s.since === "number" &&
      s.alerted &&
      typeof s.alerted === "object"
    ) {
      return { state: s, isNew: false };
    }
  } catch {
    // missing or unreadable -> start fresh
  }
  return {
    state: { since: now - WINDOW_MINUTES * 60_000, alerted: {} },
    isNew: true,
  };
}

function saveState(state: State): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function fetchClosedCandles(tf: Timeframe): Promise<Candle[]> {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${SYMBOL}&bar=${tf.okxBar}&limit=300`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OKX HTTP ${res.status} for ${tf.label}`);
  const json = (await res.json()) as {
    code: string;
    msg: string;
    data: string[][];
  };
  if (json.code !== "0") throw new Error(`OKX error ${json.code}: ${json.msg}`);

  // OKX returns newest first: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
  return json.data
    .filter((row) => row[8] === "1") // closed candles only
    .map((row) => ({ ts: Number(row[0]), close: Number(row[4]) }))
    .reverse(); // oldest first
}

async function sendTelegram(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  }
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    },
  );
  if (!res.ok) {
    // Don't print the URL (it contains the token)
    throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
  }
}

function fmtBangkok(ms: number): string {
  return new Date(ms).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--test")) {
    await sendTelegram(`✅ ทดสอบแจ้งเตือน RSI(${RSI_PERIOD}) ${SYMBOL} สำเร็จ`);
    console.log("Test message sent.");
    return;
  }

  const statusOnly = args.includes("--status");
  const summaryMode = args.includes("--summary");
  const readOnly = statusOnly || summaryMode;
  const summaryLines: string[] = [];
  let summaryPrice: number | null = null;
  const timeframes = ALL_TIMEFRAMES.filter((tf) =>
    WANTED.includes(tf.label.toLowerCase()),
  );
  if (timeframes.length === 0)
    throw new Error(`No valid timeframes in TIMEFRAMES="${WANTED.join(",")}"`);

  const now = Date.now();
  const { state, isNew: stateIsNew } = loadState(now);
  if (!readOnly && stateIsNew) saveState(state); // remember "since" even if nothing alerts today
  let failed = false;

  for (const tf of timeframes) {
    try {
      const candles = await fetchClosedCandles(tf);
      const rsis = rsi(
        candles.map((c) => c.close),
        RSI_PERIOD,
      );
      const n = candles.length;
      if (n < RSI_PERIOD + 3)
        throw new Error(`Not enough candles for ${tf.label}`);

      const last = candles[n - 1];
      const prevRsi = rsis[n - 2];
      const lastRsi = rsis[n - 1];
      const ageMin = (now - (last.ts + tf.ms)) / 60_000;

      console.log(
        `[${tf.label}] RSI(${RSI_PERIOD}) prev=${prevRsi.toFixed(1)} last=${lastRsi.toFixed(1)} ` +
          `close=${last.close} closed ${ageMin.toFixed(0)} min ago`,
      );

      if (summaryMode) {
        const icon =
          lastRsi >= OVERBOUGHT ? "🔴" : lastRsi <= OVERSOLD ? "🟢" : "⚪";
        const label =
          lastRsi >= OVERBOUGHT
            ? "overbought"
            : lastRsi <= OVERSOLD
              ? "oversold"
              : "ปกติ";
        const arrow = lastRsi > prevRsi ? "↑" : lastRsi < prevRsi ? "↓" : "→";
        summaryLines.push(
          `${icon} ${tf.label.padEnd(2)}  RSI ${lastRsi.toFixed(1)} ${arrow} (ก่อนหน้า ${prevRsi.toFixed(1)}) ${label}`,
        );
        // Use the first (shortest) timeframe in the list as the "latest price" reference.
        if (summaryPrice === null) summaryPrice = last.close;
        continue;
      }
      if (statusOnly) continue;

      // Re-check the last `lookback` closed candles; alert on crossings not alerted before.
      const crossings = findCrossings(
        rsis,
        OVERBOUGHT,
        OVERSOLD,
        n - tf.lookback,
      );
      for (const c of crossings) {
        const candle = candles[c.index];
        const closeTime = candle.ts + tf.ms;
        const key = `${tf.label}:${c.kind}`;
        if (closeTime <= (state.alerted[key] ?? state.since)) continue; // already handled

        const emoji = c.kind === "overbought" ? "🔴" : "🟢";
        const zone =
          c.kind === "overbought" ? `≥ ${OVERBOUGHT}` : `≤ ${OVERSOLD}`;
        const lateMin = (now - closeTime) / 60_000;
        const lateNote =
          lateMin > LATE_AFTER_MINUTES
            ? `\n⏱ แจ้งล่าช้า (แท่งปิดไปแล้ว ${Math.round(lateMin / 60)} ชม. — รอบเช็กก่อนหน้าถูกข้าม)`
            : "";
        const msg =
          `${emoji} ${SYMBOL} ${tf.label} — RSI(${RSI_PERIOD}) ${c.kind.toUpperCase()}\n` +
          `RSI ${rsis[c.index].toFixed(1)} (โซน ${zone}, แท่งก่อนหน้า ${rsis[c.index - 1].toFixed(1)})\n` +
          `ราคาปิดแท่ง: ${candle.close.toLocaleString("en-US")} USDT\n` +
          `ปิดแท่งเมื่อ: ${fmtBangkok(closeTime)} (เวลาไทย)` +
          lateNote;
        await sendTelegram(msg); // if this throws, state is NOT updated -> retried next run
        state.alerted[key] = closeTime;
        saveState(state);
        console.log(
          `  -> alert sent (${c.kind}, candle closed ${fmtBangkok(closeTime)})`,
        );
      }
    } catch (err) {
      failed = true;
      console.error(`[${tf.label}] ${(err as Error).message}`);
      if (summaryMode)
        summaryLines.push(`⚠️ ${tf.label.padEnd(2)}  ดึงข้อมูลไม่สำเร็จ`);
    }
  }

  if (summaryMode && summaryLines.length > 0) {
    const msg =
      `📊 สรุป RSI(${RSI_PERIOD}) ${SYMBOL} — ${fmtBangkok(now)}\n` +
      (summaryPrice !== null
        ? `ราคาล่าสุด: ${summaryPrice.toLocaleString("en-US")} USDT\n`
        : "") +
      `\n${summaryLines.join("\n")}\n\n` +
      `เกณฑ์: overbought ≥ ${OVERBOUGHT} | oversold ≤ ${OVERSOLD} (ใช้แท่งที่ปิดแล้ว)`;
    await sendTelegram(msg);
    console.log("Summary sent.");
  }

  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
