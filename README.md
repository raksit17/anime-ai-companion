# Anime AI Companion — Phase 3 + optional Phase 4 LocalAI

## MCP Gateway + Dockerized MOSS (optional)

เมื่อใช้ MOSS Backend ผ่าน Docker (แทน Windows host), ให้เริ่ม `moss-voice-studio-starter/docker-compose.yml` ก่อน แล้วเปิด Companion ด้วย Compose 3 ไฟล์: `docker-compose.yml`, `docker-compose.mcp.yml`, `docker-compose.moss.yml` ตามลำดับ พร้อม `--env-file ../moss-voice-studio-starter/integration/companion-mcp/.env`. Gateway จะเรียก `http://moss-backend:8001` ผ่าน network `moss-voice-shared` โดยไม่ต้องเปิด MOSS API ให้ LAN; English TTS engine ยังคงอ่าน `apps/api/.env` (เช่น `chatterbox-turbo`), Thai ใช้ `moss`. [คู่มือ](docs/MCP-REDIS-DOCKER.md)

## MCP + Redis + Docker integration

คู่มือติดตั้งและเชื่อมสอง repo: [MCP / Redis / Docker (ภาษาไทย)](docs/MCP-REDIS-DOCKER.md). Companion ใช้ REST gateway เดิม พร้อม MCP tools และ Redis/SSE event interfaces เพิ่มเติม; MOSS inference เลือกได้ทั้ง Windows host และ Docker standalone ผ่าน `moss-voice-studio-starter/docker-compose.yml`.


## Docker + โทรศัพท์ (LAN / Windows)

เรียกใช้ NestJS API, PostgreSQL และ Vue Web ผ่าน Docker ได้ พร้อมเปิดจากมือถือ
ใน Wi-Fi เดียวกันที่ `http://<PC-IP>:5175` โดย API/WebSocket จะวิ่งผ่าน
nginx origin เดียวกัน โทรศัพท์จึงไม่ต้องใช้ `127.0.0.1:3001` โดยตรง

```powershell
npm run setup
npm run docker:check
npm run docker:up
```

**ถ้า Ollama/MOSS บน Windows ฟังเฉพาะ `127.0.0.1`:** เปิด Docker Desktop
host networking ก่อนแล้วใช้ `npm run docker:host` (โหมดแทนกัน ไม่รันคู่กับ
`docker:up`) ไม่ต้องเปิด AI server สู่ LAN

**สำคัญ:** ต้องเตรียม Live2D Core/shaders/renderer จาก SDK บนเครื่องก่อน Build
ตาม [คู่มือ Live2D](docs/LIVE2D-R5.md) เพราะไฟล์เหล่านั้นไม่อยู่บน GitHub
และการใช้ไมโครโฟนผ่านมือถือจะต้องมี HTTPS ที่เชื่อถือได้

**ดูขั้นตอนและวิธีแก้ปัญหา:** [Docker + Mobile LAN](docs/DOCKER-MOBILE.md)


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
- Add locked appointments (including meals) through a combined appointment and
  replanning preview. Conflicts with flexible future work are resolved where
  possible; collisions with fixed/started activities are rejected.
- Preview seven days and confirm to save. The deterministic scheduler respects
  existing sessions, rest days, breaks, sleep, priority, and daily capacity.
  Unscheduled work is reported, never silently piled onto tomorrow.
- In the initial seven-day generator, low energy shortens **new** sessions to
  at most 20 minutes. The Adaptive button also adjusts existing flexible sessions.
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

Current boundaries: no Google Calendar sync, BullMQ/OS notification daemon,
exercise prescription, or dedicated English/coding lesson engine. Adaptive
weekly review and confirmed replanning are described below. The existing companion chat remains available for practice. Tests cover
scheduling constraints and proposal/commit/status behavior (`npm test`).


### Version 2 — Adaptive Life Planner

- The weekly card summarizes the **last completed Monday–Sunday week in Bangkok**.
  It separates completed, skipped, unlogged past, and deferred sessions. Fixed
  appointments without a goal are excluded from habit completion statistics.
- When the API is running, it checks for a missing weekly AI report, beginning
  about one minute after startup, then at most hourly. Reports are stored in the
  existing planner row and generated once per week, only when past goal sessions
  exist. Concurrent requests within the process share one inference. Failures
  retry the next hour; `PLANNER_AUTO_REVIEW=false` disables automatic inference.
  The report button can request the missing report immediately. Reports are
  snapshots with generation timestamps; later check-ins update the statistics,
  not the already generated prose. AI never commits schedule changes.
- **ปรับตารางเดิมตามความคืบหน้า** previews the selected seven-day window. A goal
  with at least three sessions last week and less than 60% completion receives a
  proposed 25% duration reduction (minimum ten minutes). Low energy caps existing
  flexible work at twenty minutes. These are transparent scheduling heuristics,
  not medical judgments. Goal definitions and past records remain unchanged.
- Adding an appointment now proposes both the appointment and reflow of future
  flexible sessions. Started/completed activities and fixed events are retained.
  Reflow tries the original time/date first, then free quarter-hour slots and
  later allowed goal weekdays within the selected seven-day window. Higher
  priority goals are placed first, with existing daily budgets and recovery days.
- Adaptive placement reserves at least 15 minutes between activities (or the
  user's larger configured break), without silently changing global settings.
  Old fixed activities are not rearranged. No work is carried forward from past
  missed sessions. Work that cannot fit remains visible with `deferred` status,
  separate from skipped, and can be reconsidered by another adaptive preview
  before its original start time. No session is silently deleted.
- The preview includes before/after times, reduced durations, reasons and work
  left unplaced. Confirming commits the appointment and all changes atomically;
  stale or expired proposals cannot overwrite newer progress. Cancel leaves the
  saved schedule intact. Repeated adaptations do not compound duration reductions.

New API routes: `POST /v1/planner/adaptive` (`date`, `energy`),
`POST /v1/planner/events/proposal` (same fields as events), and
`POST /v1/planner/weekly-review`. No additional migration is required beyond the
initial `PlannerStore` migration. The API/model must be running for automated
analysis; it catches up after restart rather than waking a powered-off computer.

### Conversational daily planner and calendar

The main **แผนชีวิต** tab now shows a day timeline, week strip and month picker
alongside a persistent conversation with the selected companion. The large forms
and weekly report remain under **ตั้งค่าเพิ่มเติม**. The planner takes the wider
workspace while open instead of squeezing the schedule into the old chat column.

Examples:

- `วันนี้ฝึกอังกฤษ 30 นาที Coding 2 ชั่วโมง มีนัด 14:00 หนึ่งชั่วโมง`
- `วันนี้เหนื่อย ช่วยลดภาระให้หน่อย`
- `เลื่อน Coding ไปพรุ่งนี้ 10:00`
- `วันนี้เหลืออะไรต้องทำบ้าง`

The selected character's actual name, personality, system prompt, top memories,
and recent planner conversation are included in the model context. Planner chat
uses a concise Thai reply and renders the full schedule separately. It keeps up
to 80 messages per character in PlannerStore; regular companion chat is separate.

**จัดตารางทันทีเมื่อฉันสั่ง** is enabled by default. Explicit scheduling commands
are validated and applied atomically; questions create no changes. Disable it for
preview/confirmation mode. Ambiguous requests should trigger a clarification.
The application rejects invalid dates, unknown session IDs, collisions, missing
appointment times, capacity violations and incomplete model JSON. Failed batches
write neither sessions nor conversation. Request IDs prevent duplicate mutations
on retries while the matching history remains retained. Concurrent schedule
changes cause a conflict instead of overwriting the current calendar.

Single-day tasks require no recurring goal setup. Tired/adaptive chat commands
adjust only the selected day, preserve fixed and started work, and leave
unschedulable work visibly deferred. A new fixed appointment or an explicitly moved task can reflow that day's
other flexible tasks. Fixed appointments and started activities stay protected. Time ranges use a 24-hour clock in Asia/Bangkok. Chat scheduling
keeps at least 15-minute breaks and uses the saved wake/sleep/daily-capacity limits;
change these in advanced settings when needed. It does not infer energy or
external appointments without a user message.

`GET /v1/planner/chat?characterId=...` loads history;
`POST /v1/planner/chat` takes `characterId`, `requestId`, `date`, `message`,
`autoApply`. Ollama uses structured JSON output, a 16K context and a 3000-token
response budget; LocalAI uses JSON-object completion with a 3000-token budget.
Truncated/malformed replies are errors rather than partially applied schedules.
The GPU gate and 120-second server deadline are shared with the existing AI path.
Existing database migration is sufficient; no new migration or cloud dependency.


## Optional external integrations via MCP

The companion now has a **MCP Tools** tab. NestJS acts as a Streamable HTTP MCP client
and the browser continues using its authenticated local `/v1` API. This is not
an interchangeable replacement for Ollama's chat streaming or MOSS/FastAPI's WAV
transport: those existing inference/voice integrations remain intact. MCP is
for external tool providers that **actually expose an MCP endpoint**, not arbitrary
REST endpoints. Only Streamable HTTP MCP versions `2025-03-26`, `2025-06-18`,
and `2025-11-25` are supported by this initial adapter; stdio,
HTTP+SSE (2024), and 2026-07-28's new metadata-based transport are not yet supported.

1. Start a **trusted Streamable HTTP MCP server** separately. Its HTTP endpoint
   normally ends in `/mcp`. Do not point this setting directly at Ollama, LocalAI,
   MOSS, or another REST service unless you have an MCP adapter in front of it.
2. Set `MCP_SERVERS_JSON` in `apps/api/.env`. For example (one line):

   ```dotenv
   MCP_SERVERS_JSON=[{"id":"tools","url":"http://127.0.0.1:3009/mcp","allowedTools":["read_status"],"tokenEnv":"MY_MCP_TOKEN"}]
   MY_MCP_TOKEN=replace-with-real-secret
   ```

3. Restart NestJS, open **MCP Tools**, choose a server and tool, inspect its input
   schema, enter JSON arguments, and confirm the action. An empty server list
   disables MCP. Tools must be present in BOTH the server's `tools/list` and the
   explicit `allowedTools` array. Use the optional **นำผลลัพธ์ไปถามในแชต** button
   to paste a bounded excerpt into the composer; it does not automatically
   transmit external data or execute additional tools.

Environment variables named by `tokenEnv` are read **only by NestJS**; they are
never returned through the MCP discovery API. The MCP backend disallows HTTP to
non-loopback hosts unless `MCP_ALLOW_INSECURE_HTTP=true` is intentionally set;
prefer HTTPS and authentication for remotely hosted MCP servers. Docker users
must use a reachable backend-side hostname rather than `127.0.0.1` to refer to
an MCP service on the Windows host (for example `host.docker.internal`), and
explicitly opt in if using insecure HTTP. Do not expose tokens to the browser.

The following local-token-protected endpoints are added:

- `GET /v1/mcp/servers` — configured server IDs and allowlists (no secrets).
- `GET /v1/mcp/servers/:id/tools` — filtered tool catalog.
- `POST /v1/mcp/servers/:id/tools/:tool/call` — body `{"arguments":{}}`.

**Security boundaries:** no model-driven tool execution; tools run only after an
explicit button click and browser confirmation. Treat all MCP tool output as
untrusted external content. Remote tools may be destructive; only grant allowlist
access to services and operations you trust. HTTP redirects are rejected and
response sizes, deadlines, and tool-catalog pagination are bounded. Because a
remote tool can produce side effects, the client does not blindly retry normal
failed calls. The MCP response is displayed as escaped text in the browser.

Run `npm run test -w apps/api` for handshake, allowlist, and SSE coverage.
