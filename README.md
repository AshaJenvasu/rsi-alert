# BTC RSI Alert → Telegram

แจ้งเตือนเมื่อ RSI(7) ของ BTC-USDT เข้าโซน overbought (≥70) / oversold (≤30) ที่ไทม์เฟรม 1h, 4h, 1D, 1W
ใช้แท่งเทียนที่ **ปิดแล้ว** เท่านั้น ข้อมูลจาก OKX (ไม่ต้องใช้ API key) รันฟรีบน GitHub Actions

เตือนเฉพาะตอน RSI **ตัดเข้าโซน** (แท่งก่อนหน้ายังไม่อยู่ในโซน แท่งที่เพิ่งปิดอยู่ในโซน) ถ้าค้างในโซนต่อหลายแท่งจะไม่เตือนซ้ำ

## ตั้งค่า (ทำครั้งเดียว)

### 1) สร้าง Telegram bot
1. เปิด Telegram ค้นหา **@BotFather** → พิมพ์ `/newbot` → ตั้งชื่อ → จะได้ **token** (หน้าตาแบบ `123456:ABC...`)
2. เปิดแชทกับบอทที่เพิ่งสร้าง แล้วกด **Start** (ต้องทักบอทก่อน บอทถึงจะส่งหาเราได้)
3. หา **chat id**: เปิดลิงก์นี้ในเบราว์เซอร์ (แทน `<TOKEN>` ด้วยของตัวเอง)
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   แล้วดูค่า `"chat":{"id": 123456789 ...}` ตัวเลขนั้นคือ chat id
   (ถ้าขึ้นว่าง `[]` ให้ลองพิมพ์อะไรหาบอทอีกครั้งแล้วรีเฟรช)

> token = รหัสผ่านของบอท อย่าโพสต์ในแชท/โค้ด/รูปภาพ ถ้าหลุดให้ไป BotFather พิมพ์ `/revoke`

### 2) อัปโหลดขึ้น GitHub
สร้าง repo ใหม่ (แนะนำ **public** เพื่อให้ Actions ฟรีไม่จำกัดนาที — โค้ดนี้ไม่มีความลับอยู่ในไฟล์ ความลับเก็บใน Secrets) แล้ว push โฟลเดอร์นี้ขึ้นไป

```bash
git init && git add . && git commit -m "init rsi alert"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

### 3) ใส่ Secrets
Repo → **Settings → Secrets and variables → Actions → Secrets → New repository secret**
- `TELEGRAM_BOT_TOKEN` = token จาก BotFather
- `TELEGRAM_CHAT_ID` = chat id

### 4) ทดสอบ
Repo → **Actions → BTC RSI alert → Run workflow**
- mode = `test` → ควรได้ข้อความทดสอบใน Telegram
- mode = `status` → ดูค่า RSI ปัจจุบันของทุกไทม์เฟรมใน log (ไม่ส่งแจ้งเตือน)

จากนั้นระบบจะรันเองทุกชั่วโมง (นาทีที่ 5 UTC)

## เลือกไทม์เฟรม / ปรับค่า

| อยากทำอะไร | ทำยังไง |
|---|---|
| เปลี่ยนไทม์เฟรมถาวร | Settings → Secrets and variables → Actions → **Variables** → เพิ่ม `TIMEFRAMES` = `4h,1D,1W` |
| เปลี่ยนแค่รอบนี้ | Actions → Run workflow → ช่อง `timeframes` |
| เปลี่ยน RSI / โซน / เหรียญ | Variables: `RSI_PERIOD`, `OVERBOUGHT`, `OVERSOLD`, `SYMBOL` (เช่น `ETH-USDT`) |

ไทม์เฟรมที่รองรับ: `1h`, `4h`, `1D`, `1W` (แท่ง 1D/1W ตัดตามเวลา UTC 00:00 = 07:00 เวลาไทย)

ยังไม่รองรับ "ตั้งเวลาตามไทม์เฟรมแยกกัน" เพราะไม่จำเป็น: สคริปต์เช็กทุกชั่วโมง แต่จะแจ้งเตือนเฉพาะไทม์เฟรมที่เพิ่งปิดแท่งภายใน 60 นาทีที่ผ่านมา (1D/1W จึงเตือนได้แค่ตอนแท่งปิดจริงๆ)

## ข้อควรรู้
- cron ของ GitHub ไม่เป๊ะ อาจดีเลย์ได้ และบางครั้งข้ามรอบ ถ้าดีเลย์เกิน ~55 นาทีจะพลาดสัญญาณของรอบนั้น (ไม่น่าเกิดบ่อย แต่เป็นไปได้)
- repo ที่ไม่มี commit ใหม่เกิน 60 วัน GitHub จะหยุด schedule อัตโนมัติ → เข้า Actions กดเปิดใหม่ หรือ push อะไรเล็กๆ
- RSI(7) แกว่งแรง ในเทรนด์แรงอาจค้างในโซน overbought/oversold นาน ใช้เป็นตัวเตือนให้เปิดกราฟดู ไม่ใช่สัญญาณซื้อขายโดยตรง

## รันในเครื่อง (ถ้าอยากลอง)
```bash
npm install
npm run status                       # ดูค่า RSI ตอนนี้
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm run test-telegram
```
