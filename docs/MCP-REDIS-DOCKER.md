# Companion + MOSS: MCP / Redis / Docker บน Windows

ชุดเชื่อมต่อสำหรับ raksit17/anime-ai-companion และ raksit17/moss-voice-studio-starter ตรวจจาก main วันที่ 29 ตุลาคม 2026 เป็น gateway เพิ่มเติมที่อยู่ใน repo MOSS และ Compose override ที่อยู่ใน repo Companion

## สถาปัตยกรรมที่ได้

```text
Browser / Tauri → Companion NestJS → gateway REST → MOSS FastAPI → GPU
MCP client → gateway /mcp → MOSS REST
MOSS jobs → gateway reconciler → Redis Pub/Sub → gateway /events → subscriber
WAV / PCM ← binary HTTP streaming ← MOSS
```

MCP เปิด tools voice_health, list_voices, synthesize_speech, get_speech_job ผ่าน SDK จริง ส่วน Companion ใช้ REST compatibility เดิมโดยเปลี่ยน URL ใน Compose ยังไม่ได้เปลี่ยน NestJS ให้เป็น MCP client ทุกคำขอ เส้นทางเสียงต้องใช้ HTTP เพื่อส่ง WAV/PCM ไม่ส่งเสียง binary ผ่าน Redis หรือข้อความ MCP

Redis channel `companion.voice.events.v1` ใช้แจ้งสถานะงาน ไม่ใช้ส่งคำสั่งสร้างเสียง เพราะ Pub/Sub ส่งแบบ at-most-once และไม่มี replay งานจริงยังอยู่ใน SQLite/คิวเดิมของ MOSS คิวนี้ไม่ทนต่อการ restart; MOSS จะ mark งานที่ค้างเป็น failed ถ้าต้องการ durable queue ให้เพิ่ม Streams/consumer groups พร้อม outbox และ idempotency ใน MOSS ก่อนขยาย worker

Gateway ตรวจ 100 งานล่าสุดทุกวินาทีและประกาศเมื่อสถานะเปลี่ยน ดังนั้นอาจข้ามสถานะ running ที่สั้นมาก และเมื่อ restart จะประกาศ snapshot ซ้ำได้ ผู้รับต้องยึด job_id/status และอ่าน GET /v1/jobs/{id} เพื่อยืนยัน ไม่ถือ event เป็นหลักฐานการทำงานสำเร็จ เสียงและข้อความผู้ใช้ไม่อยู่ใน event

## 1. จัดโฟลเดอร์

วางสอง repo ไว้ระดับเดียวกัน:

```text
workspace/
  anime-ai-companion/
  moss-voice-studio-starter/
    integration/companion-mcp/   ← gateway และตัวอย่าง secrets อยู่ใน MOSS
```

ถ้ายังไม่มี source:

```powershell
git clone https://github.com/raksit17/anime-ai-companion.git
git clone https://github.com/raksit17/moss-voice-studio-starter.git
```

ต้องมี Docker Desktop ใช้ Linux containers และ WSL2, Node ตาม engines ของ repo, Python 3.12 สำหรับ MOSS และ NVIDIA driver ที่ตรงกับ runtime โมเดล ต้องเตรียม Live2D Core/shaders ตาม docs/LIVE2D-R5.md ของ Companion ก่อน build web ไม่มีโมเดลและ proprietary assets ในชุดนี้

## 2. เตรียม MOSS บนเครื่อง

รุ่นนี้ให้ GPU inference รันบน Windows เดิม ส่วน web/API/Postgres/gateway/Redis รัน Docker เพื่อลดปัญหา CUDA และหลาย Python environments ของ MOSS/F5/Chatterbox

```powershell
cd moss-voice-studio-starter/backend
py -3.12 -m venv .venv
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

ติดตั้ง torch/torchaudio/torchcodec ให้เข้ากับ CUDA และติดตั้ง MOSS ตาม README ของ repo ก่อนสร้างเสียงจริง ตั้ง API_KEY ใน .env เป็นค่าสุ่มของคุณ ตั้ง DATA_DIR และ model paths เป็นตำแหน่งที่สำรองได้ เริ่มแบบ worker เดียว:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1
```

การ bind 0.0.0.0 ทำให้ container ติดต่อ host ได้ ต้องใช้ Windows Firewall จำกัดพอร์ต 8001 ให้ Docker/เครื่องที่เชื่อถือได้ ไม่เปิดสู่อินเทอร์เน็ต ถ้า bind เฉพาะ 127.0.0.1 จะเข้าไม่ได้ผ่าน host.docker.internal ใน bridge mode นี้

health ok ไม่ได้แปลว่า weights พร้อม ครั้งแรกต้องดาวน์โหลดทั้ง MOSS และ tokenizer และอาจโหลดนาน ตรวจการสร้าง WAV จริงก่อนใช้งานประจำ รุ่นนี้เลือก English engine=moss เพื่อไม่ต้องตั้ง Chatterbox environment เพิ่ม

## 3. เตรียม Companion และ secrets

```powershell
cd ../../anime-ai-companion
npm ci
npm run setup
npm run live2d:setup
npm run docker:check
Copy-Item ../moss-voice-studio-starter/integration/companion-mcp/.env.example ../moss-voice-studio-starter/integration/companion-mcp/.env
```

ทำ Live2D setup ตามคู่มือเดิมหาก script ต้องถามตำแหน่ง SDK ค่า LOCAL_API_TOKEN อยู่ apps/api/.env ใช้ pair หน้าเว็บ ส่วน GATEWAY_API_KEY เป็น secret คนละตัว สร้างด้วย:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes)
```

นำผลไปใส่ GATEWAY_API_KEY ใน companion-mcp/.env และใส่ MOSS_API_KEY ให้ตรง API_KEY ของ MOSS ห้ามใส่ secret ใน VITE variables หรือ Git

## 4. Build และเปิด Docker

รันจาก anime-ai-companion ใช้ลำดับไฟล์นี้เสมอเพื่อ resolve paths ถูกต้อง:

```powershell
docker compose --env-file ../moss-voice-studio-starter/integration/companion-mcp/.env -f docker-compose.yml -f docker-compose.mcp.yml config --quiet
docker compose --env-file ../moss-voice-studio-starter/integration/companion-mcp/.env -f docker-compose.yml -f docker-compose.mcp.yml up -d --build postgres redis voice-gateway api web
docker compose --env-file ../moss-voice-studio-starter/integration/companion-mcp/.env -f docker-compose.yml -f docker-compose.mcp.yml ps
```

API image เดิมรัน migrations/seed ตอนเริ่ม เปิด http://localhost:5175 และ pair LOCAL_API_TOKEN จาก apps/api/.env เลือกเสียงและเปิดอ่านคำตอบอัตโนมัติ ทดสอบภาษาไทยและอังกฤษ หลีกเลี่ยงเปิด compose host-network override คู่กับชุดนี้

Ollama ยังอยู่บน host ตาม compose เดิม ต้องยอมรับการเชื่อมจาก Docker ถ้าใช้ไมโครโฟน STT ให้เปิด voice profile/service ตามคู่มือ Companion แยกจาก MOSS TTS

## 5. ตรวจ REST, Pub/Sub และ MCP

```powershell
# ใส่ gateway secret ในตัวแปรของ terminal นี้
$headers = @{ 'X-API-Key' = 'YOUR_GATEWAY_SECRET' }
Invoke-RestMethod http://localhost:8088/v1/health -Headers $headers
Invoke-RestMethod http://localhost:8088/v1/voices -Headers $headers
$body = @{text='สวัสดีค่ะ'; language='Thai'; engine='moss'} | ConvertTo-Json
$job = Invoke-RestMethod http://localhost:8088/v1/jobs -Method Post -Headers $headers -ContentType application/json -Body ([Text.Encoding]::UTF8.GetBytes($body))
Invoke-RestMethod "http://localhost:8088/v1/jobs/$($job.id)" -Headers $headers
# เมื่อ completed เท่านั้น
Invoke-WebRequest "http://localhost:8088/v1/jobs/$($job.id)/audio" -Headers $headers -OutFile test.wav
```

ดู events จาก Redis ในอีก terminal ก่อนสร้างงาน:

```powershell
docker compose --env-file ../moss-voice-studio-starter/integration/companion-mcp/.env -f docker-compose.yml -f docker-compose.mcp.yml exec redis redis-cli SUBSCRIBE companion.voice.events.v1
```

MCP client ใช้ Streamable HTTP URL `http://localhost:8088/mcp` พร้อม header `Authorization: Bearer YOUR_GATEWAY_SECRET` จาก container ใน compose เดียวกันใช้ `http://voice-gateway:8088/mcp` เรียก tools/list ก่อน แล้ว voice_health/list_voices/synthesize_speech/get_speech_job ตามลำดับ ไม่มี auto-retry POST ที่อาจสร้างเสียงซ้ำ เมื่อ request timeout ให้ตรวจรายการงานก่อนส่งใหม่

GET /events เป็น SSE ที่ต้องส่ง authentication header ใช้ fetch streaming หรือ SSE client ที่รองรับ header; browser EventSource ปกติส่ง header นี้ไม่ได้ ผู้รับควร reconnect และอ่านสถานะจริงใหม่ทุกครั้ง REST ของ Companion ยัง polling ตามเดิม ผู้รับ event แบบทันทีต้องต่อ /events เพิ่มเอง

## 6. ดูแลและแก้ปัญหา

ใช้ compose arguments เดิมกับ `logs --tail 100 voice-gateway api` หาก 401 ตรวจ secret ของแต่ละชั้น ถ้า 503 ตรวจ MOSS ว่ารันและ host.docker.internal ติดต่อได้ ถ้า Redis ล่ม REST ยังใช้ได้แต่ event หาย หากงาน failed ดู error ใน MOSS และทดสอบ GPU/model dependencies หาก 429 คิว MOSS เต็ม อย่า retry รัว หากเสียงเงียบตรวจว่า response เป็น WAV หรือ PCM และ sample rate จาก header

สำรอง PostgreSQL volume กับ MOSS data directory และ voice profiles ก่อนอัปเกรด หยุดด้วย compose arguments เดิมตามด้วย `down` ห้ามใช้ `down -v` หากต้องเก็บข้อมูล Redis ชุดนี้ไม่เก็บข้อมูลถาวรเพราะมีหน้าที่แจ้งเหตุการณ์เท่านั้น

Compose ของ Companion ชุดนี้ไม่รวม GPU inference image โดยตรง แต่ MOSS repo มี Docker Compose แยกสำหรับ GPU Backend + Vue Studio พร้อม Chatterbox worker แยก Python environment (ไม่ติดตั้ง F5/SGLang) ดูรายละเอียด `moss-voice-studio-starter/docs/DOCKER-COMPOSE.md` การรองรับ GPU/VRAM และการสร้างเสียงจริงยังต้องทดสอบบนเครื่องผู้ใช้

## แหล่งอ้างอิง

- https://github.com/raksit17/anime-ai-companion
- https://github.com/raksit17/moss-voice-studio-starter
- https://github.com/modelcontextprotocol/python-sdk/tree/v1.x
- https://redis.io/docs/latest/develop/pubsub/

## ตรวจสอบ gateway ก่อนใช้งาน

จาก moss-voice-studio-starter/integration/companion-mcp สร้าง virtual environment, ติดตั้ง `pip install -r gateway/requirements.txt` และรัน `python -m unittest discover -s gateway -v` ทดสอบ 7 รายการผ่านด้วย mocked upstream รวม MCP tools/list ไม่มีการทดสอบ GPU inference หรือ Docker runtime ในสภาพแวดล้อมผู้จัดทำ


## 7. เชื่อม MOSS Backend ที่รันบน Docker (ทางเลือกใหม่)

หากต้องการให้ MOSS รัน Docker แทน Windows: เริ่มที่ root repo `moss-voice-studio-starter` ก่อนด้วย `docker compose up -d --build`. Compose ของ MOSS จะสร้าง network `moss-voice-shared` และ service DNS `moss-backend`. ตั้ง `MOSS_API_KEY` ใน `integration/companion-mcp/.env` ให้เท่ากับ `API_KEY` ของ `backend/.env` และตั้ง `GATEWAY_API_KEY` แยกต่างหาก

จาก root ของ `anime-ai-companion` ใช้ override ตัวที่สามสำหรับการเชื่อม Docker-to-Docker:

```powershell
docker compose --env-file ../moss-voice-studio-starter/integration/companion-mcp/.env -f docker-compose.yml -f docker-compose.mcp.yml -f docker-compose.moss.yml config --quiet
docker compose --env-file ../moss-voice-studio-starter/integration/companion-mcp/.env -f docker-compose.yml -f docker-compose.mcp.yml -f docker-compose.moss.yml up -d --build postgres redis voice-gateway api web
```

`docker-compose.mcp.yml` ไม่บังคับ English engine อีกต่อไป: ค่า `VOICE_STUDIO_EN_ENGINE=chatterbox-turbo` และ `VOICE_STUDIO_EN_VOICE_ID` ใน Companion API `.env` จะยังคงใช้งานได้หาก voice profile นั้นมีอยู่ใน MOSS Backend แบบ Docker จริง ส่วนภาษาไทยยังใช้ `moss`. งานเสียงเดินทางผ่าน REST Gateway (ส่งต่อ `engine` ตาม request) ส่วน MCP tool `synthesize_speech` ปัจจุบันยัง hardcode `moss`.

ข้อมูล `backend/data` และ `backend/models` ถูก bind mount ใน MOSS Compose แต่ SQLite/voice profile ที่เคยบันทึก path แบบ Windows อาจต้องย้าย/ลงทะเบียนใหม่ก่อนสั่งสร้างเสียง ห้ามถือว่า health 200 ยืนยันว่า inference ใช้งานได้
