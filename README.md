# Anime AI Companion — Phase 3 + optional Phase 4 LocalAI

โปรเจกต์เต็ม Phase 1 + 2 + 3: Windows Desktop Companion ด้วย Tauri 2

**ใหม่: [คู่มือ LocalAI Multimodal — Chat + Vision + Voice](docs/LOCALAI-MULTIMODAL.md)** — ใช้ LocalAI แทน Ollama/FastAPI ได้แบบเลือกเปิด โดยยังคง Live2D, ความจำ และฐานข้อมูลเดิม

## สิ่งที่เพิ่ม

- หน้าต่างตัวละคร 360×580 โปร่งใส ไม่มีกรอบ อยู่เหนือหน้าต่างอื่น ลากจากแถบชื่อได้
- หน้าต่างแชตแยก ใช้แชต ความจำ เสียง และ Live2D เดิม; ส่งอารมณ์และค่าขยับปากไปตัวละครผ่าน native event
- System Tray: Show / Hide / Open chat / Interactive / Click-through / Reset position / Quit
- Ctrl+Alt+Y แสดงและคืนการคลิก, Ctrl+Alt+M เปิดแชต, Ctrl+Alt+H ซ่อนตัวละคร
- จดจำตำแหน่ง/ขนาดหน้าต่าง; ตรวจจอที่ถอดออกและมีปุ่มคืนตำแหน่ง; เปิดใหม่กลับมาโต้ตอบได้เสมอ
- Single instance; เปิดซ้ำเรียกหน้าต่างเดิม
- Autostart แบบเลือกเปิดเอง ปิดเป็นค่าเริ่มต้น ไม่เปิดไมค์อัตโนมัติ
- Runtime health ตรวจ NestJS / PostgreSQL / Ollama / FastAPI แยกสถานะ แม้บางบริการออฟไลน์
- Local API bearer token สำหรับ REST / เสียง และ Socket.IO handshake

นี่คือ **Development Desktop**: ต้องเปิด backend และ AI services แยกกัน ยังไม่ bundle Python, PostgreSQL, Ollama หรือโมเดลลง installer

## Live2D Cubism Core 6.0.1

สำหรับโปรเจกต์ที่ใช้ Cubism SDK for Web R5 / Core 6.0.1 ให้ติดตั้ง Renderer
PixiJS 8 และ shader ตามคู่มือ [Live2D R5](docs/LIVE2D-R5.md) ก่อนเปิด
หน้า Chat หรือ Tauri Companion (ต้องใช้ Git + Bun + SDK R5 ที่ดาวน์โหลดเอง)

**หลังอัปเกรด dependencies:** รัน `npm install` เพื่อสร้าง lockfile ใหม่;
`npm ci` กับ lockfile เดิมจะใช้ไม่ได้จนกว่าจะอัปเดต lockfile

## เริ่มต้นบน Windows

ต้องมี Node.js 24 LTS, Python 3.11, Docker Desktop, Ollama, Rust stable 1.90+ แบบ MSVC, Microsoft C++ Build Tools (Desktop development with C++) และ WebView2 Runtime
ดู prerequisites: https://v2.tauri.app/start/prerequisites/

แตก ZIP แล้วเปิด PowerShell ในโฟลเดอร์ `anime-ai-companion`:

```powershell
npm ci
npm run setup
docker compose up -d postgres
npm run generate
npm run db:migrate
npm run db:seed
ollama pull qwen3.5:4b-q4_K_M
```

ถ้ามีโมเดลอื่น ให้เปลี่ยน `OLLAMA_MODEL` ใน `apps/api/.env`; Ollama ต้องเปิดอยู่ (`ollama serve` หากยังไม่เปิด)

Terminal 1 — NestJS:

```powershell
npm run dev -w apps/api
```

Terminal 2 — FastAPI เสียง CPU สำหรับไมโครโฟน (พอร์ต 8000):

```powershell
cd apps/voice
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Terminal 3 — Desktop (เริ่ม Vite ให้เอง):

```powershell
npm run desktop:dev
```

อย่าเปิด `npm run dev` ของ root ซ้ำพร้อม Desktop เพราะจะใช้พอร์ต Vite 5173 ชนกัน

ในหน้าต่างแชต เปิด **การเชื่อมต่อ / Desktop** แล้วคัดลอกค่า `LOCAL_API_TOKEN` จาก `apps/api/.env` ไปวาง กดบันทึกและเชื่อมต่อ จากนั้นตรวจสถานะบริการ
Token สุ่มโดย `npm run setup`; อย่าใส่ใน VITE variables หรือ commit `.env` ส่วนหน้าเก็บ token ใน localStorage ของ origin นั้น ไม่ได้เข้ารหัส
Web browser และ Desktop production ใช้คนละ origin จึงต้อง pair แยกกัน

## ใช้งาน

เลือกตัวละคร/ห้อง แล้วส่งข้อความหรือกดเริ่มพูดในหน้าต่างแชต อนุญาตไมค์เมื่อระบบถาม
หน้าต่างตัวละครสะท้อนอารมณ์และปาก แต่ไม่เปิด socket หรือ audio pipeline ซ้ำ

ตั้งค่า Emotion → Expression และ Emotion/state → Motion ในหน้าตั้งค่าตัวละคร โดยใช้ชื่อ expression และ motion group/index ที่มีอยู่จริงในไฟล์ Live2D ของคุณ ตัวละครจะเปลี่ยนสีหน้าและ motion ตามอารมณ์หรือสถานะการสนทนา ระหว่างตอบเป็นข้อความจะขยับปากแบบจำลองตามจังหวะการสตรีม ส่วนเสียงที่เล่นใช้ระดับเสียงจริงสำหรับ lip-sync
กด **อ่านคำตอบนี้** ใต้คำตอบของตัวละครเพื่อฟังเป็นรายข้อความ หรือเปิดตัวเลือกอ่านออกเสียงอัตโนมัติในแผงเสียง

- ลากแถบชื่อด้านบนเพื่อย้ายตัวละคร
- คลิกทะลุทำให้ **ทั้งหน้าต่าง** กดไม่ได้ กด Ctrl+Alt+Y หรือ Tray → Interactive เพื่อคืนการควบคุม
- กด X ของแชตจะซ่อนหน้าต่าง พร้อมยกเลิกเสียง/ไมค์/คำตอบปัจจุบัน; Tray → Quit ออกจากแอป
- ซ่อนตัวละครไม่หยุดเสียงในหน้าต่างแชต
- เปิด Autostart จากการตั้งค่าหลังติดตั้ง release แล้ว; ใช้ได้เฉพาะ desktop และไม่ได้เปิดบริการ backend ให้
- หากคีย์ลัดถูกแอปอื่นใช้ จะมีคำเตือนใน Settings และยังใช้ Tray ได้

## สร้าง Windows installer

เปิด services แยกไว้สำหรับใช้งานจริง แต่ไม่จำเป็นต่อการ build:

```powershell
npm run desktop:build
```

ผลลัพธ์อยู่ `apps/web/src-tauri/target/release/bundle/nsis/` (installer แบบ current user)
ZIP นี้มี **source code** ยังไม่มี `.exe` ที่ compile/ลงนามหรือทดสอบบน Windows
Rust dependencies ใช้ major version 2; Cargo จะสร้าง Cargo.lock เมื่อ build ครั้งแรก ควรเก็บ lockfile ที่ตรวจแล้วใน repository ของคุณ

ถ้าเพิ่ม Live2D asset ให้ใส่ใน `apps/web/public/live2d` **ก่อน build** และใช้ model path แบบ `/live2d/models/.../model.model3.json` รายละเอียดและสิทธิ์ Cubism Core/โมเดลดู README-PHASE1.md
ไม่รวม proprietary assets หรือ model weights; ไม่มี asset จะแสดง placeholder โดยแชตยังใช้ได้

## อัปเกรดจาก Phase 2

1. หยุดโปรเซสเดิม เก็บ `.env`, Live2D assets และข้อมูล PostgreSQL ไว้
2. ใช้โฟลเดอร์/Compose project name เดิมเพื่อเชื่อม volume เดิม
3. แทนไฟล์โค้ดด้วยชุดนี้ แล้ว `npm ci`, `npm run setup`, `npm run generate`, `npm run db:migrate`
4. `setup` เพิ่ม token ถ้าขาดหรือสั้นเกินไป โดยไม่ทับการตั้งค่าอื่น
5. เปิด API/เสียง/Desktop แล้ว pair token

พูดคำตอบด้วย MOSS Voice Studio ได้โดยตั้ง `VOICE_STUDIO_URL`, `VOICE_STUDIO_API_KEY` และ (เลือกได้) `VOICE_STUDIO_VOICE_ID` ใน `apps/api/.env` แล้วเปิด **พูดคำตอบอัตโนมัติทันที** ในแผงเสียง ตัวเลือกนี้บันทึกแยกในเครื่อง; MOSS สร้าง WAV ผ่าน job API แล้ว Companion เล่นตามลำดับพร้อม Live2D lip sync\n\nเริ่ม MOSS Voice Studio จาก `moss-voice-studio-starter` ให้ฟังที่พอร์ต 8001 แล้วตั้ง `VOICE_STUDIO_API_KEY` ให้ตรงกับ `API_KEY` ในไฟล์ backend `.env` ของ MOSS (ค่าเริ่มต้น `local-dev-key`) ส่วน `VOICE_STUDIO_VOICE_ID` เลือกได้และต้องเป็น ID ของ voice ที่บันทึกไว้ใน MOSS; เว้นว่างไว้เพื่อใช้เสียงเริ่มต้น

ไม่เปลี่ยน Prisma schema และไม่ต้อง reset DB เอกสาร Phase 1/2 เป็นรายละเอียดของรุ่นก่อน; ขั้นตอนเปิดแอปและ authentication ให้ใช้ README นี้

## API และขอบเขต

API bind `127.0.0.1` เป็นค่าเริ่มต้น; คง loopback สำหรับทุกบริการ ไม่เปิดพอร์ตนี้สู่ LAN
ทุก Nest REST รวม health ต้องใช้ `Authorization: Bearer <LOCAL_API_TOKEN>`; Socket.IO ใช้ `auth: { token }`
CORS อนุญาต localhost development และ Tauri origins โดยระบุชัดเจน
`GET /v1/runtime/health` แสดงการเข้าถึง service เท่านั้น ไม่ยืนยันว่า model weights พร้อมหรือ inference ผ่าน
FastAPI เป็น internal loopback service; token นี้ป้องกัน Nest API ไม่ใช่ security boundary ต่อโปรแกรมอื่นที่มีสิทธิ์อ่านไฟล์บนเครื่อง
หาก API offline หรือ token ผิด UI จะแสดง error และสถานะ unknown ไม่ใช้ผลเก่าว่า ready

## ตรวจสอบ

```powershell
npm run build
npm test
```

รายละเอียด tests และ Windows smoke checklist อยู่ `VALIDATION.md`
การตั้งค่า PyThaiTTS / VoxCPM2 / GPU queue และ voice assets ดู README-PHASE2.md

## AI Daily Life Planner

Open **แผนชีวิต** in the main window. Run migrations before starting the upgraded API:

```sh
npm install
npm run generate
npm run db:migrate
npm run dev
# or npm run desktop:dev
```

The planner uses the existing `DATABASE_URL`, local API authentication, and
`OLLAMA_URL` / `OLLAMA_MODEL` (or the configured LocalAI chat provider). No new
cloud account or Redis service is required.

- Add/edit goals with selected weekdays, duration, preferred time, priority,
  flexibility, reminder lead time, and rest days between sessions.
- Set the waking window, breaks, and daily goal-minute budget. This first version
  explicitly uses **Asia/Bangkok (UTC+7)** and a same-day waking window.
- Add locked appointments (including meals) before generating a plan. Conflicting
  appointments are rejected; move a flexible session or skip it first.
- Preview seven days and confirm to save. The deterministic scheduler respects
  existing sessions, rest days, breaks, sleep, priority, and daily capacity.
  Unscheduled work is reported, never silently piled onto tomorrow.
- Low energy shortens **new** sessions to at most 20 minutes. Existing sessions
  remain intact. Move an existing flexible session through a separate preview.
- Mark sessions done/skipped and record notes (exercise sets/reps/weight, English
  topics, coding progress). Cumulative completed minutes and counts are shown.
- Ask the local AI for advice using the actual goals, schedule, and progress.
  Advice is read-only: it cannot claim to commit changes or bypass constraints.
  AI requests share the existing GPU resource gate and have a bounded timeout;
  deterministic scheduling remains usable when the model is offline.
- In-app reminders poll every 30 seconds. Browser notifications require an
  explicit permission click and platform support. **Keep the API and main app
  window running**; this is not an OS background alarm or push service. Pending
  reminders are recovered while their session is still ongoing; acknowledgement
  is saved in PostgreSQL.

Planner data is single-user and shared across companion characters, protected by
existing local API auth. A PostgreSQL transaction/advisory lock serializes writes.
Proposals expire after 15 minutes and become invalid after any state mutation;
confirmation is single-use. Goal edits affect future generation, not historical
sessions; deleting a goal removes its pending sessions but retains progress.

API prefix: `/v1/planner` — state (`GET`), goals (`POST`, `PATCH/:id`, `DELETE/:id`),
settings (`PATCH`), proposals (`POST`, `POST/:id/confirm`), events (`POST`),
sessions (`PATCH/:id`, `POST/:id/move`), reminders (`GET`, `POST/:id/ack`),
and advice (`POST`). DTO validation rejects unknown fields and out-of-range values.

Current boundaries: no Google Calendar sync, BullMQ/background daemon, automatic
weekly goal changes, exercise prescription, or dedicated English/coding lesson
engine. The existing companion chat remains available for practice. Tests cover
scheduling constraints and proposal/commit/status behavior (`npm test`).
