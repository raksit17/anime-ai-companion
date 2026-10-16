# ใช้เสียง MOSS Voice Studio ใน Anime AI Companion

โปรเจกต์เสียงอยู่ที่ [moss-voice-studio-starter](https://github.com/raksit17/moss-voice-studio-starter) แยกจาก
[anime-ai-companion](https://github.com/raksit17/anime-ai-companion) โดยไม่ต้องคัดลอกไฟล์โมเดลหรือ reference WAV ข้าม Repository

## ขั้นตอนบน Windows

1. เปิด `moss-voice-studio-starter/backend` และตั้งค่า `.env` จาก `.env.example` เลือก `API_KEY` ที่ต้องการ
   ติดตั้ง dependencies และ MOSS model ตาม README ของ Voice Studio (แนะนำ Python 3.12 และ GPU ที่มี VRAM เพียงพอ)
2. เปิด MOSS Voice Studio Backend ด้วย `python -m uvicorn app.main:app --host 127.0.0.1 --port 8001`.
   จะมี API `http://127.0.0.1:8001/v1/voices`; ทุกคำขอส่ง `X-API-Key`.
3. ใช้เว็บ MOSS Voice Studio อัปโหลดไฟล์ WAV ตัวอย่างเสียงที่ได้รับอนุญาต (เสียงพูด 3–20 วินาทีแนะนำ)
   เลือกภาษาและบันทึกเป็น Voice Profile; จะได้ `voice_id` (ไม่ใช่โมเดลใหม่ที่เทรนแล้ว)
4. ใน `anime-ai-companion/apps/api/.env` เพิ่ม/ปรับค่า:

```dotenv
VOICE_TTS_PROVIDER=moss
VOICE_STUDIO_URL=http://127.0.0.1:8001
VOICE_STUDIO_API_KEY=<ค่า API_KEY จาก moss-voice-studio-starter/backend/.env>
VOICE_STUDIO_VOICE_ID=
VOICE_SERVICE_URL=http://127.0.0.1:8000
```

5. เปิด Voice Service ตัวเดิม `apps/voice` พอร์ต 8000 ต่อไป *หากต้องการใช้ไมโครโฟน* เพื่อให้ Faster-Whisper ถอดเสียง
   (ตั้งค่า `TTS_ENGINE` ตัวเดิมได้ เพราะ MOSS รับหน้าที่สร้างเสียงพูดแทน)
6. Restart NestJS: `npm run dev -w apps/api`; เปิดหน้าแชต หรือ `npm run desktop:dev` และจับคู่ LOCAL_API_TOKEN ตามปกติ
7. ในเมนู **สนทนาด้วยเสียง** กด **ตรวจบริการเสียง** ควรเห็น `moss`; เลือก **เสียงตัวละครจาก MOSS Voice Studio**
   ตัวเลือกนี้บันทึกแยกตาม Character ID ในเครื่องที่เปิดหน้าแชต ไม่ต้องแก้ฐานข้อมูล
8. กด **▶ อ่านคำตอบล่าสุด** เพื่อทดสอบ หรือเลือก **อ่านคำตอบอัตโนมัติหลังส่งข้อความแชต**
   เพื่อให้ AI อ่านคำตอบหลังจาก Ollama ตอบเสร็จ ตัวเล่น WAV เดิมจะปรับค่า RMS ให้ Live2D Lip Sync (`ParamA` สำหรับ Mao)

ถ้าไม่มีโปรไฟล์เสียง ให้ปล่อยช่องเลือกเสียงเป็น **เสียง MOSS มาตรฐาน** (หรือกำหนด `VOICE_STUDIO_VOICE_ID` เป็นค่าเริ่มต้นที่ฝั่งเซิร์ฟเวอร์)
การเลือกเสียงไม่ได้คัดลอกหรือติดตั้งน้ำหนักโมเดลไว้ใน Anime AI Companion

## ลำดับการทำงาน

```text
Chat (Vue / Tauri) → Ollama ตอบ → NestJS POST /v1/voice/synthesize
  → MOSS POST /v1/jobs (Thai/English + voice_id)
  → MOSS GET /v1/jobs/{id} (รอ queued → running → completed)
  → MOSS GET /v1/jobs/{id}/audio (WAV)
  → NestJS ส่ง WAV → Web Audio Playback → Live2D RMS Lip Sync

Microphone → NestJS POST /v1/voice/transcribe → FastAPI :8000 / Faster-Whisper (เหมือนเดิม)
```

## ตรวจปัญหาและข้อจำกัด

- ดู `http://127.0.0.1:3001/v1/voice/health` ผ่าน Local API token (NestJS): `tts_engine` ต้องเป็น `moss`.
  `GET /v1/voice/voices` จะคืน `items` จาก MOSS Studio โดยไม่เผย `VOICE_STUDIO_API_KEY` ให้เว็บ
- ถ้าเจอ `Invalid API key` ให้เทียบ `VOICE_STUDIO_API_KEY` กับ `API_KEY` ของ Studio; ค่า `.env` สอง Repository แยกกัน
- ถ้าติดต่อไม่ได้ ตรวจ Studio รันที่ 8001 และ NestJS ตั้ง URL ถูก; ถ้า STT ใช้ไม่ได้ ตรวจ FastAPI เดิมพอร์ต 8000
- MOSS รองรับ Thai/English ในโหมดนี้; Japanese TTS ยังใช้ MOSS ไม่ได้ (STT ญี่ปุ่นยังใช้ได้)
- MOSS อาจโหลดโมเดลครั้งแรกช้า/กิน GPU มาก และรันไม่ได้หากไม่มี weights, dependency หรือ VRAM เพียงพอ
- กดหยุดใน Companion จะหยุดการรอและหยุดเล่นเสียง แต่ **ไม่ยกเลิก job ที่กำลัง inference ใน MOSS Studio**
  เพราะ Studio ยังไม่มี API ยกเลิกงานสร้างเสียง; งานนั้นจะเสร็จหรือ fail ที่ Studio
- ถ้าเปิด Ollama กับ MOSS บน GPU เดียวกัน VRAM อาจไม่พอ ต้องจัดการหน่วยความจำ/ย้ายโมเดลเป็นการตั้งค่าเพิ่มเติม
- โหมดนี้ใช้ **WAV job** ยังไม่ใช่ PCM stream ของ SGLang; ระบบจับอารมณ์ Live2D เดิมยังคงทำงาน
- ตัวเลือก Auto Speak ถูกปิดเป็นค่าเริ่มต้นเพราะเบราว์เซอร์อาจบล็อก autoplay; กดอ่านคำตอบด้วยตนเองได้เสมอ
- เปลี่ยนกลับเป็น `VOICE_TTS_PROVIDER=legacy` เพื่อใช้ PyThaiTTS/VoxCPM2 เดิม; เลือกเสียง MOSS จะถูกซ่อน
- อย่าใส่ API Key ลงใน `VITE_*`, push `.env` หรือเปิด MOSS backend สู่ Public Internet โดยไม่มีระบบ auth ที่เหมาะสม

## ตรวจสอบ

```powershell
npm ci
npm run build
npm test
```

ยังต้องทดลอง **model inference จริงบนเครื่องที่ติดตั้ง GPU / MOSS weights** เพื่อยืนยันความเร็ว เสียง และการขยับปาก
