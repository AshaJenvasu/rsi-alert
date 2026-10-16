// BTC RSI alert -> Telegram
// Runs on GitHub Actions (hourly). Uses only CLOSED candles from OKX public API.
// Usage:
//   npx tsx src/index.ts            normal run (alert only on fresh crossings)
//   npx tsx src/index.ts --status   print current RSI of every timeframe, no alert
//   npx tsx src/index.ts --summary  send a daily RSI summary of every timeframe to Telegram
//   npx tsx src/index.ts --test     send a test message to Telegram

import { rsi } from "./rsi.js";

type Timeframe = { label: string; okxBar: string; ms: number };

// "utc" bars so daily/weekly candles open at 00:00 UTC (same as TradingView on crypto).
const ALL_TIMEFRAMES: Timeframe[] = [
  { label: "1h", okxBar: "1H", ms: 3_600_000 },
  { label: "4h", okxBar: "4H", ms: 4 * 3_600_000 },
  { label: "1D", okxBar: "1Dutc", ms: 86_400_000 },
  { label: "1W", okxBar: "1Wutc", ms: 7 * 86_400_000 },
];

const SYMBOL = process.env.SYMBOL ?? "BTC-USDT";
const RSI_PERIOD = Number(process.env.RSI_PERIOD ?? 7);
const OVERBOUGHT = Number(process.env.OVERBOUGHT ?? 70);
const OVERSOLD = Number(process.env.OVERSOLD ?? 30);
// A candle counts as "fresh" if it closed within this many minutes (keep = cron interval).
const WINDOW_MINUTES = Number(process.env.WINDOW_MINUTES ?? 60);
// Choose which timeframes to watch, e.g. TIMEFRAMES="4h,1D,1W"
const WANTED = (process.env.TIMEFRAMES ?? "1h,4h,1D,1W")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

type Candle = { ts: number; close: number };

async function fetchClosedCandles(tf: Timeframe): Promise<Candle[]> {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${SYMBOL}&bar=${tf.okxBar}&limit=300`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OKX HTTP ${res.status} for ${tf.label}`);
  const json = (await res.json()) as { code: string; msg: string; data: string[][] };
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
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
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
  const summaryLines: string[] = [];
  let summaryPrice: number | null = null;
  const timeframes = ALL_TIMEFRAMES.filter((tf) => WANTED.includes(tf.label.toLowerCase()));
  if (timeframes.length === 0) throw new Error(`No valid timeframes in TIMEFRAMES="${WANTED.join(",")}"`);

  const now = Date.now();
  let failed = false;

  for (const tf of timeframes) {
    try {
      const candles = await fetchClosedCandles(tf);
      const rsis = rsi(candles.map((c) => c.close), RSI_PERIOD);
      const n = candles.length;
      if (n < RSI_PERIOD + 3) throw new Error(`Not enough candles for ${tf.label}`);

      const last = candles[n - 1];
      const prevRsi = rsis[n - 2];
      const lastRsi = rsis[n - 1];
      const closeTime = last.ts + tf.ms;
      const ageMin = (now - closeTime) / 60_000;

      console.log(
        `[${tf.label}] RSI(${RSI_PERIOD}) prev=${prevRsi.toFixed(1)} last=${lastRsi.toFixed(1)} ` +
          `close=${last.close} closed ${ageMin.toFixed(0)} min ago`
      );
      if (summaryMode) {
        const icon = lastRsi >= OVERBOUGHT ? "🔴" : lastRsi <= OVERSOLD ? "🟢" : "⚪";
        const label =
          lastRsi >= OVERBOUGHT ? "overbought" : lastRsi <= OVERSOLD ? "oversold" : "ปกติ";
        const arrow = lastRsi > prevRsi ? "↑" : lastRsi < prevRsi ? "↓" : "→";
        summaryLines.push(
          `${icon} ${tf.label.padEnd(2)}  RSI ${lastRsi.toFixed(1)} ${arrow} (ก่อนหน้า ${prevRsi.toFixed(1)}) ${label}`
        );
        // Use the shortest timeframe in the list as the "latest price" reference.
        if (summaryPrice === null) summaryPrice = last.close;
        continue;
      }
      if (statusOnly) continue;

      // Only react to a candle that closed recently, otherwise 4h/1D/1W would repeat every hour.
      if (ageMin > WINDOW_MINUTES) continue;

      let kind: "overbought" | "oversold" | null = null;
      if (prevRsi < OVERBOUGHT && lastRsi >= OVERBOUGHT) kind = "overbought";
      else if (prevRsi > OVERSOLD && lastRsi <= OVERSOLD) kind = "oversold";
      if (!kind) continue;

      const emoji = kind === "overbought" ? "🔴" : "🟢";
      const zone = kind === "overbought" ? `≥ ${OVERBOUGHT}` : `≤ ${OVERSOLD}`;
      const msg =
        `${emoji} ${SYMBOL} ${tf.label} — RSI(${RSI_PERIOD}) ${kind.toUpperCase()}\n` +
        `RSI ${lastRsi.toFixed(1)} (โซน ${zone}, แท่งก่อนหน้า ${prevRsi.toFixed(1)})\n` +
        `ราคาปิดแท่ง: ${last.close.toLocaleString("en-US")} USDT\n` +
        `ปิดแท่งเมื่อ: ${fmtBangkok(closeTime)} (เวลาไทย)`;
      await sendTelegram(msg);
      console.log(`  -> alert sent (${kind})`);
    } catch (err) {
      failed = true;
      console.error(`[${tf.label}] ${(err as Error).message}`);
      if (summaryMode) summaryLines.push(`⚠️ ${tf.label.padEnd(2)}  ดึงข้อมูลไม่สำเร็จ`);
    }
  }

  if (summaryMode && summaryLines.length > 0) {
    const msg =
      `📊 สรุป RSI(${RSI_PERIOD}) ${SYMBOL} — ${fmtBangkok(now)}\n` +
      (summaryPrice !== null ? `ราคาล่าสุด: ${summaryPrice.toLocaleString("en-US")} USDT\n` : "") +
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
