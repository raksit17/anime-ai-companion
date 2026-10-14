# Anime AI Companion — Phase 2

โปรเจกต์ครบทั้ง Phase 1 + Phase 2: Vue 3 / NestJS / PostgreSQL / Ollama / FastAPI

Phase 2 เพิ่มการคุยด้วยไมโครโฟน ถอดเสียง ส่งข้อความเข้า Conversation เดิม สร้างเสียงตอบ และขยับปาก Live2D ตามเสียงที่เล่นจริง

## ทำอะไรได้แล้ว

- กดเริ่มพูด → กดส่งเสียง (บันทึกไม่เกิน 60 วินาที) พร้อมตรวจสิทธิ์ไมค์
- Faster-Whisper `small` บน CPU: ไทย อังกฤษ ญี่ปุ่น และตรวจภาษาอัตโนมัติ
- ใช้ Chat Engine, บุคลิก, อารมณ์ และ Memory จาก Phase 1
- PyThaiTTS Vachana บน CPU เป็นค่าเริ่มต้นสำหรับเสียงไทย
- VoxCPM2 adapter เป็นตัวเลือกสำหรับเสียงไทย/อังกฤษ/ญี่ปุ่น รวม reference WAV และ voice design จากการตั้งค่าฝั่งเซิร์ฟเวอร์
- คำตอบยาวแบ่งเป็นส่วนละไม่เกิน 350 ตัวอักษรตามขอบเขตคำ/grapheme แล้วสร้างและเล่นเรียงกัน ไม่ตัดทิ้งส่วนท้าย
- Web Audio API วัด RMS แล้วส่งค่า 0–1 ให้ Live2D LipSync parameters ก่อน model update
- ปุ่มหยุดใช้ได้ระหว่างบันทึก ถอดเสียง คิด สร้างเสียง และเล่นเสียง
- ผลลัพธ์ที่กลับมาหลังยกเลิกไม่ถูกส่งเข้าแชตหรือเล่นเสียงซ้ำ
- ปุ่มอ่านคำตอบล่าสุดสำหรับอ่านข้อความที่เคยตอบแล้ว และลองเล่นใหม่หาก browser บล็อกเสียง
- API ตรวจ MIME/ขนาดไฟล์ 10 MB/ภาษา/ความยาวข้อความ; เสียงถูก decode ตรวจว่ามี audio stream และจำกัดระยะเวลา

**สถานะการตรวจ:** Build และ automated tests ผ่าน; ยังไม่ได้ทดสอบเสียงโมเดลจริง, microphone browser, Live2D asset และ VRAM บน RTX 4060 ดู `VALIDATION.md`

## เปิดครั้งแรกบน Windows

ต้องมี Node.js 22.12+ (แนะนำ 24 LTS), Docker Desktop, Ollama และ Python 3.11
แตก ZIP แล้วเปิด PowerShell ที่โฟลเดอร์ `anime-ai-companion`

Terminal 1 — เว็บและ API:

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

Ollama ต้องเปิดอยู่ ถ้าไม่ได้เปิดให้รัน `ollama serve` ในอีก terminal
หากมีโมเดลอื่นอยู่แล้ว เปลี่ยน `OLLAMA_MODEL` ใน `apps/api/.env` ให้ตรงกับ `ollama list`

Terminal 2 — บริการเสียงค่าเริ่มต้น (CPU):

```powershell
cd apps/voice
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

ใช้ executable ใน .venv โดยตรงได้ ไม่ต้อง Activate และไม่ต้องแก้ ExecutionPolicy
โมเดลดาวน์โหลดตอนใช้ครั้งแรก ต้องเชื่อมต่ออินเทอร์เน็ตและอาจรอนาน หลัง cache ครบจึงใช้แบบ local ได้

เปิด **http://localhost:5173** → อนุญาตไมค์ → กด **เริ่มพูด** → พูด → กด **ส่งเสียงที่พูด**
เว็บใช้ localhost หรือ HTTPS เพื่อให้ browser อนุญาตไมค์ อย่าเปลี่ยนเป็น IP ผ่าน HTTP แล้วคาดว่าไมค์จะทำงาน

ตรวจบริการ:

- http://localhost:3001/v1/health — API / DB / Ollama
- http://localhost:3001/v1/voice/health — บริการเสียงผ่าน NestJS
- http://localhost:8000/docs — FastAPI API explorer สำหรับทดสอบในเครื่อง

Health หมายถึง service ติดต่อได้และแสดง engine ที่ตั้งไว้ ไม่ได้ยืนยันว่า model weights โหลดสำเร็จแล้ว

## อัปเกรดจาก Phase 1

ZIP นี้เป็นโปรเจกต์เต็ม ไม่ใช่ patch ใช้ไฟล์โค้ดใหม่แทนของเดิมโดยเก็บ `.env`, Live2D assets และฐานข้อมูลเดิมไว้

1. หยุด dev server เดิมก่อน
2. ใช้โฟลเดอร์/Compose project name เดิม เพื่อชี้ไป PostgreSQL volume เดิม
3. `npm ci` → `npm run setup` → `npm run generate` → `npm run db:migrate`
4. เพิ่ม `VOICE_SERVICE_URL=http://127.0.0.1:8000` ใน `apps/api/.env` ถ้ายังไม่มี (มี fallback ค่านี้ในโค้ด)
5. ติดตั้งและเปิด Voice Service ตามขั้นตอนด้านบน แล้ว `npm run dev`

**Phase 2 ไม่เปลี่ยน Prisma schema** ห้องสนทนา ตัวละครและความจำเดิมใช้ต่อได้ ไม่ต้อง reset DB
`npm run setup` ไม่ทับ .env เดิม และ `db:seed` ไม่ทับ Yuna เดิม

## ตั้งค่าเสียง

`apps/voice/.env`:

```dotenv
TTS_ENGINE=pythaitts
STT_MODEL=small
STT_COMPUTE=int8
TTS_SPEAKER=th_f_1
VOICE_JOB_TIMEOUT=300
VOXCPM_PYTHON=
VOXCPM_MODEL=openbmb/VoxCPM2
VOXCPM_DEVICE=cuda
VOXCPM_REFERENCE=
VOXCPM_STYLE=A gentle and playful female voice
```

Whisper ถูกกำหนดให้ใช้ CPU ใน Phase นี้เพื่อไม่แย่ง GPU กับ Ollama/VoxCPM2
เปลี่ยน STT_MODEL เป็น tiny หรือ base หาก CPU ช้า
PyThaiTTS ในเวอร์ชันนี้รองรับเฉพาะภาษาไทย ตัวเลือกเสียงตอบ en/ja จะเปิดเมื่อเซิร์ฟเวอร์เลือก VoxCPM2
การเลือกภาษา TTS ไม่ได้แปลข้อความ เปลี่ยน System Prompt ของตัวละครหากต้องการให้ตอบภาษาอื่น

## VoxCPM2 — โหมดทดลอง GPU

สร้าง environment แยกใน `apps/voice`:

```powershell
py -3.11 -m venv .venv-voxcpm
.\.venv-voxcpm\Scripts\python.exe -m pip install --upgrade pip
.\.venv-voxcpm\Scripts\python.exe -m pip install -r requirements-voxcpm.txt
.\.venv-voxcpm\Scripts\python.exe -c "import torch; print(torch.cuda.is_available())"
```

ต้องได้ True หากตั้ง `VOXCPM_DEVICE=cuda`; ถ้าเป็น False ให้ติดตั้ง PyTorch build ที่รองรับ CUDA ตามสภาพแวดล้อมเครื่องก่อน
แก้ `.env` (ใช้ path จริงของเครื่องคุณ):

```dotenv
TTS_ENGINE=voxcpm2
VOXCPM_PYTHON=D:/GitPoom/anime-ai-companion/apps/voice/.venv-voxcpm/Scripts/python.exe
VOXCPM_MODEL=openbmb/VoxCPM2
VOXCPM_DEVICE=cuda
VOXCPM_REFERENCE=D:/GitPoom/anime-ai-companion/storage/voices/yuna/reference.wav
VOXCPM_STYLE=A gentle and playful female voice
```

ถ้าไม่ใช้ reference ให้เว้น VOXCPM_REFERENCE ว่าง จะใช้ voice design แทนและโทนเสียงอาจต่างกันในแต่ละคำขอ
ใช้ reference ที่คุณมีสิทธิ์ใช้งาน ไม่รับไฟล์ path จาก browser หรือให้ผู้ใช้เว็บอ่านไฟล์อิสระ
ตอนนี้ voice profile เป็นค่าระดับ service ใช้ร่วมทุกตัวละคร ไม่ได้มี UI แยกเสียงรายตัวละคร

Restart Voice Service หลังแก้ .env แล้วกดตรวจบริการเสียงบนหน้าเว็บ

ขั้นตอนคิว:

1. ChatGateway และ TTS ใช้ ResourceGate ร่วมกันใน API instance เดียว
2. รอ Ollama ตอบและประเมิน emotion เสร็จ
3. เมื่อ TTS engine เป็น VoxCPM2 สั่ง Ollama `/api/generate` ด้วย `keep_alive: 0`
4. เริ่ม worker แยก สร้าง WAV แล้วรอ worker exit ก่อนส่งเสียงกลับ
5. กด Stop → abort HTTP → ยืนยัน cancellation กับ Python → ปิด worker → ค่อยคืนคิว

หากยืนยันการปิด worker ไม่ได้ คิวจะหยุดรับ generation ใหม่จน restart Voice Service และ API เพื่อไม่ให้โหลด GPU model ซ้อนโดยไม่รู้สถานะ
รัน NestJS เพียง **1 instance** และ uvicorn **1 worker** และเรียกบริการเสียงผ่าน NestJS เท่านั้นหากใช้ GPU mode
คิวนี้ควบคุมเฉพาะคำขอจากแอปนี้ ไม่ควบคุมโปรแกรมอื่นหรือโมเดล Ollama ตัวอื่นที่คุณเปิดอยู่
**ไม่รับประกันว่า VoxCPM2 จะพอดี VRAM 8 GB** ต้องทดสอบบน GPU จริง; หาก OOM ให้กลับ PyThaiTTS หรือทดลอง VOXCPM_DEVICE=cpu โดยยอมรับความช้า

## การโหลดโมเดลและความเร็ว

เพื่อให้ Stop ฆ่างาน native inference และคืน memory ได้แน่นอน แต่ละคำขอ STT/TTS จะใช้ subprocess ใหม่และปิดเมื่อจบ
ไม่ได้ใช้ model cache ใน RAM ข้ามคำขอ จึงมีเวลาโหลดโมเดลทุกครั้ง โดยเฉพาะ VoxCPM2 และคำตอบหลาย chunk
ไฟล์ weights ยังใช้ disk cache ได้ เป็น trade-off ของต้นแบบนี้ ไม่ใช่ระบบเสียง realtime/streaming TTS แบบ latency ต่ำ

## Live2D และ Lip Sync

ใช้ asset เดิมจาก Phase 1 ตาม `README-PHASE1.md`:

```text
apps/web/public/live2d/core/live2dcubismcore.min.js
apps/web/public/live2d/models/yuna/yuna.model3.json
```

เพิ่ม path ในการตั้งค่าตัวละคร `/live2d/models/yuna/yuna.model3.json`
viewer ใช้ renderer เดิม `pixi-live2d-display@0.4.0` + `pixi.js@6.5.10`

Lip Sync อ่านค่าจาก LipSync group ของโมเดล ถ้าไม่มีกลุ่มจะใช้ `ParamMouthOpenY` โมเดลต้องมี parameter จริง
อัปเดตค่าหลัง motion/physics และก่อน core model update จึงไม่ถูก animation ทับทันที
เมื่อเล่นเสียงจบหรือกด Stop ค่า RMS และค่าปากกลับเป็น 0
นี่คือ volume-driven lip sync ไม่ใช่ phoneme/viseme alignment
ยังต้องใส่ Cubism Core และโมเดลที่คุณมีสิทธิ์ใช้เอง; หากไม่มี asset แชตและเสียงยังทำงานได้ แต่ไม่มีตัวละครแสดง

## Docker แบบ CPU (ทางเลือก)

แทน terminal Python สามารถใช้:

```powershell
docker compose --profile voice up -d --build voice
```

Compose voice ใช้ PyThaiTTS/Whisper CPU และมี named volume สำหรับ model cache; ไม่ใช่ image สำหรับ VoxCPM2/CUDA
อย่าเปิด Python native และ container บนพอร์ต 8000 พร้อมกัน
ไฟล์ `.env` ใน apps/voice ใช้สำหรับ native Python; Docker compose กำหนด environment เองใน docker-compose.yml

## API เพิ่มใน Phase 2

| Endpoint | Input | Output |
|---|---|---|
| GET /v1/voice/health | — | engine, languages, model_state |
| POST /v1/voice/transcribe | multipart `file`, `language=auto/th/ja/en` | text, language, duration |
| POST /v1/voice/synthesize | JSON text ≤350, language=th/ja/en | audio/wav, no-store |

Python internal endpoints `/v1/stt/transcribe`, `/v1/tts/synthesize`, `/v1/jobs/:uuid` (DELETE), `/health`
NestJS สร้าง X-Voice-Job UUID สำหรับการยกเลิกโดยอัตโนมัติ
ไม่จำเป็นต้องเปลี่ยน WebSocket contract ของ Phase 1; sendAndWait จับคู่คำตอบด้วย requestId และ conversationId

ตัวอย่างทดสอบ TTS ผ่าน NestJS (PowerShell):

```powershell
$body = @{text="สวัสดี ฉันชื่อยูนะ ยินดีที่ได้คุยกันนะ"; language="th"} | ConvertTo-Json
Invoke-WebRequest -Uri "http://localhost:3001/v1/voice/synthesize" -Method POST -ContentType "application/json" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -OutFile "yuna-test.wav"
```

## ไฟล์สำคัญ

- `apps/api/src/modules/voice/`: DTO, controller, Python proxy, cancellation
- `apps/api/src/resources.ts`: คิวร่วมระหว่าง LLM และ TTS
- `apps/api/src/chat.gateway.ts`: ใช้คิว GPU และรับ Stop
- `apps/voice/app/jobs.py`: bounded queue, subprocess lifecycle, timeout, cancellation
- `apps/voice/app/worker.py`: เรียก STT/TTS และส่ง result
- `apps/voice/app/services/`: Whisper / PyThaiTTS / VoxCPM2 adapters
- `apps/web/src/stores/voice.ts`: voice state machine และเชื่อมแชต
- `apps/web/src/composables/`: recorder, playback, RMS
- `apps/web/src/services/speech-chunks.ts`: แบ่งข้อความโดยไม่ตัดอักขระไทยกลาง grapheme

## ทดสอบ

```powershell
npm run generate
npm run build
npm test
cd apps/voice
.\.venv\Scripts\python.exe -m pip install -r requirements-test.txt
.\.venv\Scripts\python.exe -m pytest tests -q
```

Automated tests ใช้ mock AI/DB และ fake worker process เพื่อทดสอบ flow ไม่ดาวน์โหลดโมเดล ไม่ใช้ GPU

Acceptance บนเครื่องจริง:

1. พิมพ์แชตเดิมได้ และ refresh แล้วยังมีประวัติ
2. กดเริ่มพูด อนุญาตไมค์ พูดไทย ส่งเสียง → transcript เข้าแชตเพียงครั้งเดียว
3. รอคำตอบ → emotion เปลี่ยน → WAV เล่น → ปากขยับตามเสียง
4. กด Stop ในแต่ละสถานะ แล้วตรวจว่าไมค์/เสียงหยุดและไม่มีคำตอบเก่าถูกเล่นตามมา
5. ทดลองปฏิเสธสิทธิ์ไมค์ เสียงเงียบ Voice Service ปิด และ browser บล็อก autoplay
6. อ่านคำตอบยาวกว่า 350 ตัวอักษร ตรวจว่าครบทุก chunk
7. ถ้าใช้ VoxCPM2 ตรวจ `ollama ps` และ `nvidia-smi` ก่อน/ระหว่าง/หลัง TTS

## ข้อจำกัดที่ยังมี

- ไม่มีการเปิดไมค์ฟังตลอดเวลา, VAD turn-taking, speech streaming หรือ Tauri desktop (Phase 3)
- เก็บ transcript และคำตอบใน DB เดิม; ไม่เก็บ audio ใน history เสียง replay จะสร้างใหม่
- ใช้ temp directory และลบทิ้งหลังจบ/ยกเลิก; หาก process หลักถูก kill แบบฉับพลัน temp ของ OS อาจเหลือได้
- หน้าจอแคบซ่อนแผง Live2D ตาม layout เดิม แต่ยังใช้เสียงได้
- ไม่มี auth/multi-user ให้เปิดเฉพาะ loopback บนเครื่องส่วนตัว
- ตั้งค่าภาษาไม่ใช่คำสั่งแปล คำตอบและสำเนียงขึ้นกับ LLM/TTS ที่เลือก

## แหล่งอ้างอิงที่ใช้ตรวจ API

- https://github.com/SYSTRAN/faster-whisper
- https://pythainlp.org/PyThaiTTS/_modules/pythaitts.html
- https://github.com/OpenBMB/VoxCPM/blob/main/src/voxcpm/core.py
- https://voxcpm.readthedocs.io/en/latest/models/voxcpm2.html
- https://github.com/guansss/pixi-live2d-display
