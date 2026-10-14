# Anime AI Companion — Phase 1

โปรเจกต์ local-first: Vue 3 + NestJS + Prisma 7 / PostgreSQL + Ollama พร้อม FastAPI skeleton สำหรับ Phase 2

## สิ่งที่ทำได้

- แชตข้อความแบบ Socket.IO streaming และกด Stop
- สร้าง / แก้ไข / ลบตัวละคร บุคลิก และ system prompt
- หลายห้องสนทนา เก็บข้อความลง PostgreSQL และโหลดประวัติหลังเปิดเว็บใหม่
- เพิ่ม / แก้ไข / ลบความทรงจำด้วยตนเอง ระดับความสำคัญ 1–5
- ใช้ประวัติล่าสุด 16 ข้อความ และ memory สำคัญสูงสุด 8 รายการประกอบ prompt
- ประเมินอารมณ์ด้วย structured JSON จาก Ollama หลังตอบเสร็จ; fallback เป็น neutral
- Live2D Cubism 4 viewer พร้อม idle/blink ที่ runtime และโมเดลรองรับ และ expression mapping
- กรณีหยุด/หลุด/เกิดข้อผิดพลาด: เก็บข้อความบางส่วนเป็น interrupted และไม่ใช้เป็นบริบทคำตอบถัดไป
- ตรวจสถานะ Backend, PostgreSQL และการเชื่อมต่อ Ollama จากหน้าเว็บ

**ยังไม่รวม:** STT/TTS, lip sync จากเสียง, Tauri/desktop overlay, automatic memory extraction, authentication/multi-user, โมเดล Live2D และ Cubism Core ที่มีลิขสิทธิ์

หน้าเว็บจะบอกว่าต้องเพิ่ม asset หากยังไม่มีโมเดล ไม่แสดงภาพประกอบแทน Live2D จริง โดยแชตยังใช้งานได้

## Quick start — Windows PowerShell

ติดตั้ง Node.js 22.12+ (แนะนำ Node 24 LTS), Docker Desktop และ Ollama ให้เรียบร้อยก่อน
แตก ZIP แล้วเปิด PowerShell ในโฟลเดอร์ที่มี `package.json`

```powershell
npm ci
npm run setup
docker compose up -d postgres
npm run generate
npm run db:migrate
npm run db:seed
ollama pull qwen3.5:4b-q4_K_M
npm run dev
```

เปิด **http://localhost:5173** ใช้ `localhost` ให้ตรงกับ WEB_ORIGIN ที่ตั้งไว้

Ollama desktop ต้องเปิดอยู่ ถ้าไม่ได้ทำงานให้เปิดอีก terminal แล้วใช้ `ollama serve`
โมเดลเลือกตามสเปกที่แนบมา เปลี่ยน `OLLAMA_MODEL` ใน `apps/api/.env` เป็นชื่อโมเดลที่ pull ไว้ได้
ตรวจด้วย `ollama list` และ `ollama ps` ไม่รับประกันการใช้ VRAM หรือความเร็วในทุกเครื่อง

`npm run setup` สร้าง .env เฉพาะเมื่อยังไม่มี ไม่ทับค่าที่คุณตั้งไว้
`npm run db:seed` เพิ่ม Yuna ครั้งแรกและไม่แก้ทับตัวละครเดิม

## การตั้งค่า

`apps/api/.env`:

```dotenv
PORT=3001
HOST=127.0.0.1
WEB_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://anime:anime_dev_password@localhost:5433/anime_companion
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b-q4_K_M
```

`apps/web/.env`:

```dotenv
VITE_API_URL=http://localhost:3001
```

Compose รันเฉพาะ PostgreSQL โดยปริยาย API และเว็บรันบน Windows เพื่อเรียก Ollama บน host ได้ตรง ๆ
หากเปลี่ยนพอร์ตเว็บ ให้เปลี่ยน `WEB_ORIGIN` ตามด้วย และ restart API
ฐานข้อมูลมี named volume `pgdata`; `docker compose down` ไม่ลบประวัติ แต่ `docker compose down -v` ลบฐานข้อมูลทั้งหมด
นี่เป็นแอปส่วนตัวบนเครื่องเดียว ไม่มีการล็อกอิน ห้ามเปิดพอร์ตให้เครือข่ายภายนอกโดยยังไม่ได้เพิ่ม auth

## เพิ่ม Live2D จริง

เพื่อให้ส่งมอบโปรเจกต์ที่ build ได้โดยไม่คัดลอก SDK/asset ที่ไม่ได้รับสิทธิ์ ตัว viewer ใช้ `pixi-live2d-display@0.4.0` และ `pixi.js@6.5.10` ที่ล็อกเวอร์ชันเข้าคู่กัน
**เป็นการปรับจากสเปกที่เสนอ official SDK โดยตรง** โดยแยก adapter ไว้เพื่อเปลี่ยน renderer ได้ในภายหลัง ไม่อัปเกรด Pixi เป็น v7/v8 โดยไม่เปลี่ยน adapter

1. ดาวน์โหลด Cubism SDK for Web จาก https://www.live2d.com/en/sdk/download/web/ และตรวจเงื่อนไขของ SDK/โมเดล
2. คัดลอก `Core/live2dcubismcore.min.js` ไปที่ `apps/web/public/live2d/core/live2dcubismcore.min.js`
3. คัดลอกโฟลเดอร์ runtime ของโมเดล Cubism 3/4 ทั้งชุดไปที่ `apps/web/public/live2d/models/yuna/` ต้องมี `.model3.json`, `.moc3`, textures และไฟล์ที่ JSON อ้างอิงครบ คง relative paths เดิม
4. หน้าเว็บ → ตั้งค่าตัวละคร → Live2D model path:

```text
/live2d/models/yuna/yuna.model3.json
```

5. Expression mapping ใช้ชื่อจาก `FileReferences.Expressions[].Name` ภายใน model3.json **ไม่ใช่ชื่อสมมติที่ใช้ได้กับทุกโมเดล** ตัวอย่างต่อไปนี้ต้องเปลี่ยนให้ตรง asset:

```json
{"neutral":"default","happy":"smile","angry":"angry","shy":"blush","sad":"sad","surprised":"surprise"}
```

ไม่ใส่ mapping ที่โมเดลไม่มี; อารมณ์ที่ไม่ได้ map จะคง expression เดิม ถ้าต้องการ reset ให้สร้าง neutral expression ใน asset
Idle ใช้ motion group `Idle` ของโมเดล; blink ต้องมี eye-blink parameters/groups ตามโมเดลนั้น
ไม่มีการดาวน์โหลด Core หรือโมเดลจาก CDN อัตโนมัติ เมื่อเพิ่มไฟล์แล้วให้ reload หน้าเว็บ
ควรทดสอบ Live2D ด้วย browser ที่รองรับ WebGL บนหน้าจอกว้าง (ตัวละครซ่อนใน layout แชตจอแคบ)

## โครงสร้าง

```text
apps/api/src/
  main.ts                 NestJS bootstrap + validation + error handling
  api.controller.ts       REST character / conversation / memory
  dto.ts                  validation contracts
  database.ts             PrismaPg runtime adapter
  chat.gateway.ts         streaming orchestration, stop, disconnect, dedup
  ai/ollama.service.ts    Ollama streaming + emotion
  ai/ndjson.ts            chunk-safe UTF-8 parser
  ai/prompt-builder.ts    persona + memory + history
apps/api/prisma/           schema, initial SQL migration, seed
apps/api/test/             parser / prompt / streaming orchestration tests
apps/web/src/
  App.vue                 chat, history, memory and character settings
  stores/chat.ts          Pinia state + Socket.IO events
  services/live2d-adapter.ts
  components/Live2DViewer.vue
apps/voice/               FastAPI health, STT/TTS 501 placeholders
packages/contracts/      shared frontend contract types
```

Backend แยก AI/parser/prompt/database แต่ Phase 1 ยังรวม REST และ chat orchestration ไว้ไฟล์ละส่วน สามารถแยก feature modules เพิ่มได้เมื่อขยายระบบ

## API

| Method | Endpoint | หน้าที่ |
|---|---|---|
| GET | /v1/health | DB + Ollama reachability (ไม่ได้รับรองว่าโมเดลถูก pull แล้ว) |
| GET / POST | /v1/characters | รายการ / สร้าง |
| PATCH / DELETE | /v1/characters/:id | แก้ข้อมูล / ลบพร้อมประวัติและ memory |
| GET | /v1/conversations?characterId=... | 100 ห้องล่าสุด |
| POST | /v1/conversations | body `{ "characterId": "yuna" }` |
| GET | /v1/conversations/:id/messages | ประวัติ |
| GET / POST | /v1/characters/:id/memories | อ่าน / เพิ่ม |
| PATCH / DELETE | /v1/memories/:id | แก้ไข / ลบ |

PATCH character รับฟิลด์ `name`, `personality`, `systemPrompt` ครบชุด (หน้าเว็บส่งให้ครบ) ส่วน modelPath/expressionMap ไม่บังคับ
PATCH memory รับ content และ importance ครบชุด

Socket.IO namespace `/chat`:

- ส่ง `chat:send`: `{requestId: crypto.randomUUID(), conversationId, content}`
- รับ `chat:start`, `chat:delta` (`delta`), `chat:emotion` (`emotion`), `chat:complete` (`message`), `chat:error` (`error`)
- ทุก event มี requestId และ conversationId เพื่อไม่ปะปนกับห้องอื่น
- ส่ง `chat:stop`: `{requestId}` หยุดได้เฉพาะ socket ที่เริ่ม request
- จำกัด 1 generation ต่อห้องใน process นี้; ห้ามรัน API หลาย instance โดยไม่เปลี่ยน lock เป็น distributed lock
- ไม่ retry ข้อความอัตโนมัติหลัง disconnect; reload ประวัติก่อนส่งใหม่
- ตัด generation ที่ 180 วินาที และ emotion inference ที่ 15 วินาที

## FastAPI (optional)

```powershell
docker compose --profile voice up -d --build voice
```

ดู http://localhost:8000/health และ http://localhost:8000/docs
STT/TTS คืน HTTP 501 จนกว่าจะทำ Phase 2 ไม่มีการโหลดโมเดลเสียงหรือใช้ GPU

## Build / test

```powershell
npm run generate
npm run build
npm test
```

Production API: `npm run start -w apps/api`; web static output อยู่ `apps/web/dist`

## Acceptance checklist บนเครื่องจริง

1. ตรวจ `/v1/health` ได้ database online, Ollama online และ `ollama list` มีชื่อโมเดลตรง .env
2. พิมพ์ข้อความไทย → เห็นคำตอบทยอยเข้ามา → มีอารมณ์เมื่อเสร็จ
3. เพิ่ม memory เช่น “ผู้ใช้ชื่อภูมิ” → เปิดห้องใหม่ → ถามชื่อ ตรวจว่าอ้างอิง memory ได้ (ความแม่นยำขึ้นกับโมเดล)
4. Refresh / ปิดเปิด browser → ห้องเดิมและประวัติเดิมกลับมา
5. ระหว่างตอบกด Stop → กดส่งใหม่ได้ และข้อความเก่ามีสถานะ interrupted
6. ปิด Ollama แล้วส่ง → แจ้ง error และกลับมากดส่งใหม่ได้เมื่อเปิด Ollama
7. เพิ่ม Cubism Core + โมเดล → เห็นโมเดลจริง idle/blink; ตรวจ expression map ทีละอารมณ์
8. ปิดเว็บระหว่างตอบ → เปิดใหม่แล้วโหลดประวัติ; อาจต้องรอ request เดิมถูก cancel ก่อนส่ง

ดู `VALIDATION.md` สำหรับผลตรวจที่ทำได้ในสภาพแวดล้อมผู้สร้าง

## ข้อจำกัด Phase 1

- ยังคงต้องทดสอบโมเดล AI/GPU/Live2D จริงในเครื่องของคุณ ไฟล์นี้ไม่รวม asset และ weights
- การเลือก context เป็นจำนวนข้อความ ไม่ใช่ token-aware truncation ข้อความยาวอาจโดน Ollama truncate ตาม num_ctx
- ไม่มี pagination ประวัติข้อความ; ห้องใหญ่มากควรเพิ่ม cursor pagination
- หาก process ถูก kill หลังบันทึกผู้ใช้ก่อนบันทึก assistant จะเหลือข้อความผู้ใช้โดยไม่มีคำตอบ; ส่งคำถามอีกครั้งได้
- ข้อความ render เป็น plain text ไม่ใช่ HTML/Markdown จากโมเดล
- Local memory ใช้ความสำคัญ ไม่ใช่ vector search และไม่ auto-extract

## เอกสารอ้างอิง

- Prisma 7 generator: https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators
- Prisma PostgreSQL adapter: https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql
- Ollama API: https://docs.ollama.com/api/chat
- Live2D adapter: https://github.com/guansss/pixi-live2d-display
- Cubism SDK: https://www.live2d.com/en/sdk/download/web/
