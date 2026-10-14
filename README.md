# Anime AI Companion — Phase 3

โปรเจกต์เต็ม Phase 1 + 2 + 3: Windows Desktop Companion ด้วย Tauri 2

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

Terminal 2 — FastAPI เสียง CPU:

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
