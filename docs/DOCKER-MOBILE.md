# Run Anime AI Companion in Docker and open it from an Android/iPhone

This deployment runs **PostgreSQL + NestJS API + Vue Web** in Docker on your
Windows PC. Ollama, MOSS Voice Studio and other local models can keep running
on Windows. The phone is a **browser client**; Tauri's transparent always-on-top
desktop character window and global hotkeys cannot run inside a phone browser.

The **phone must NOT use `127.0.0.1` to reach the PC**. That address on a phone
means the phone itself. Open `http://<PC-LAN-IP>:5175` instead. The browser
makes same-origin `/v1/*` and `/socket.io/*` calls, forwarded by nginx to
NestJS. The NestJS port and database are not exposed to the LAN.

## 1. Prerequisites

- Docker Desktop for Windows, using Linux containers.
- Node.js 22+ for the `npm run setup` and preflight scripts on the host.
- A local checkout of this repository on the **same PC** where the prepared
  Live2D renderer and proprietary Cubism SDK files are available.
- Ollama and/or MOSS Voice Studio running on Windows, depending on the desired
  chat and voice provider.
- PC and phone on the same Wi-Fi/LAN, with no wireless client isolation.

**Live2D assets do not come from GitHub.** The existing
`vendor/pixi-live2d5/dist/`, `vendor/pixi-live2d5/types/`,
`apps/web/public/live2d/core/live2dcubismcore.min.js`, and 13 files
under `apps/web/public/cubism5/shaders/` must already be prepared by
`npm run live2d:setup -- "<CubismSdkForWeb-5-r.5 directory>"`.
See [LIVE2D-R5.md](LIVE2D-R5.md). Do not commit or redistribute the
proprietary Cubism Core/shader files. Custom models in
`apps/web/public/live2d/models/` are copied into the web image during build;
if you update a model, rebuild `web`.

## 2. Prepare the configuration

Open PowerShell in the repository root:

```powershell
npm run setup
npm run docker:check
```

The first command creates `apps/api/.env` if needed and generates a
`LOCAL_API_TOKEN` of at least 32 characters. If `docker:check` reports missing
Live2D files, run `live2d:setup` first, then recheck.

Set the existing provider settings in `apps/api/.env` as appropriate:

```dotenv
AI_PROVIDER=ollama
OLLAMA_MODEL=qwen3.5:4b-q4_K_M
VOICE_TTS_PROVIDER=moss
VOICE_STUDIO_API_KEY=your-existing-moss-key
VOICE_STUDIO_EN_ENGINE=chatterbox-turbo
VOICE_STUDIO_TH_ENGINE=moss
```

Do not put API keys or `LOCAL_API_TOKEN` into `VITE_*` variables.
The Docker setup loads the backend `.env` **at runtime** and explicitly
overrides only container networking settings. The web `.env` is excluded from
the image, so an old `VITE_API_URL=http://localhost:3001` cannot be accidentally
baked into the phone build.

## 3. Start Docker

### Default bridge mode

Use if Ollama/MOSS are reachable from a Docker container on the host gateway
(e.g. bound to an appropriate host interface):

```powershell
npm run docker:up
docker compose ps
docker compose logs -f api web
```

Behind the scenes, Docker uses:
- Web: host port **5175** to nginx port 80 (LAN accessible)
- API: container port **3001**, **not published**
- PostgreSQL: host **127.0.0.1:5433** only, volume persists
- Ollama: `http://host.docker.internal:11434`
- MOSS: `http://host.docker.internal:8001`
- LocalAI: `http://host.docker.internal:8080`

**Important:** `host.docker.internal` does not guarantee reaching processes
which are bound **only** to Windows `127.0.0.1`. If an AI service is only
listening on Windows loopback, use the host-network mode below instead. Do
not blindly expose Ollama or unauthenticated model endpoints to `0.0.0.0`
on a shared network.

### Host-network mode — for 127.0.0.1-only Ollama and MOSS

On Docker Desktop **4.34 or newer**, enable **host networking** in
Settings → Resources → Network → Enable host networking, then apply/restart.
This feature requires supported Linux containers / Docker Desktop networking.

Stop the previous deployment (without deleting DB volumes):

```powershell
docker compose down
npm run docker:host
docker compose -f docker-compose.yml -f docker-compose.host-network.yml ps
```

In this mode:
- The API binds **127.0.0.1:3001** on the PC host network.
- It reaches Windows Ollama via **127.0.0.1:11434** and MOSS via
  **127.0.0.1:8001**, without changing the host model servers.
- nginx listens on **0.0.0.0:5175**, forwards `/v1` and Socket.IO to the
  **local loopback API**, and is the only externally reachable app port.
- PostgreSQL remains mapped to **127.0.0.1:5433**.

Host networking does not support normal port publishing; the override removes
`web.ports` and uses a separate nginx config listening directly on 5175.
The override uses Docker Compose's `!reset` YAML tag. If Docker Desktop
cannot enable host networking on your installation, stay in bridge mode and
configure a **firewall-restricted** host gateway listener for AI services
instead, rather than exposing them publicly.

Both modes use the **same** named database volume when launched from the same
directory/Compose project. Never run `docker compose down -v` unless you
intend to erase the database.

## 4. Connect on the phone

Check the PC's active Wi-Fi/Ethernet IPv4 address with:

```powershell
ipconfig
```

For example, if the PC is `192.168.1.25`, open this on the phone:

```text
http://192.168.1.25:5175
```

The phone and PC must be on the same LAN. Open **การเชื่อมต่อ / Desktop**
and pair by pasting the token from `apps/api/.env` (the line after
`LOCAL_API_TOKEN=`). Token storage is per browser origin; Tauri,
`localhost:5175`, and a LAN IP must each be paired separately.

Allow incoming TCP **5175** only on Windows **Private** firewall networks if
Windows blocks the connection. Never create router port forwarding for 5175
or publish your backend/database/AI model ports to the internet.

## 5. Smoke checks

Run in PowerShell:

```powershell
docker compose ps
docker compose logs --tail 120 api
docker compose logs --tail 120 web
curl.exe -I http://localhost:5175/
```

Check that the `web` container serves the SPA, then verify `/v1/health`
using the token in the browser connection UI. The `runtime/health` endpoint
returns provider reachability (not model inference readiness).

To check whether the API container reaches Ollama in bridge mode:

```powershell
docker compose exec api node -e "fetch(process.env.OLLAMA_URL+'/api/tags').then(r=>console.log(r.status)).catch(console.error)"
```

If this fails with `ECONNREFUSED` even though Ollama works at
`http://127.0.0.1:11434` on Windows, switch to **host-network mode**
instead of replacing the browser's URL with `127.0.0.1`.

## Mobile browser limitations

- **Chat, history, planner, text controls and server-generated TTS playback**
  can work over LAN HTTP. Socket.IO is proxied through the same origin.
- **Microphone/voice recording requires a secure browser context**. On a
  phone, `http://192.168.x.x:5175` is normally **not** a secure context.
  Use trusted HTTPS (for example a properly configured private HTTPS reverse
  proxy or secure Tailscale hostname with HTTPS) for microphone permissions.
  Untrusted self-signed HTTPS is not sufficient.
- **Live2D needs WebGL 2**, valid local Core/shader assets and a capable mobile
  browser. The browser view has no Tauri-only desktop window/hotkeys.
- Planner notifications are in-app polling, not push notifications. Closing
  the browser tab stops client-side notifications.

## Stop / rebuild

```powershell
docker compose down
docker compose up -d --build postgres api web
```

For host mode always use both `-f` options (or `npm run docker:host`).
After changing the API `.env`, use `docker compose up -d --force-recreate api`
with the matching Compose files. Do not commit the `.env`, tokens, database
dumps, private model files or Cubism SDK assets.
