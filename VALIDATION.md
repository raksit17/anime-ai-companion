# Phase 3 validation

## Passed in this environment

- Tauri configuration validates against installed CLI JSON schema (AJV with unicodeRegExp=false for schema regex compatibility).
- NestJS TypeScript build and Vue typecheck + production Vite build.
- 14 backend tests (11 originally passing plus 3 persona style checks): existing chat streaming, cancellation, duplicate/invalid input, HTTP DTOs, voice contracts/resource gate; new HTTP + real Socket.IO authentication rejection/acceptance and degraded runtime checks.
- 9 frontend tests: existing voice cancellation/stale results/permission cleanup/chunking/RMS; new bearer auth on JSON and multipart requests without overriding multipart boundaries.
- Phase 2 Python service unchanged; its 6 tests previously passed. Not re-counted as new Phase 3 execution.

- Thai feminine style rule is reinforced at the end of each system prompt; a trailing accidental “ครับ” is normalized before the assistant message is saved and delivered as complete. Existing messages remain unchanged.

## Not validated here

No Rust compiler, Cargo, Windows or native WebView2 in this Linux environment. Rust source/native installer has NOT been compiled or run here. No actual microphone, Live2D licensed asset, TTS/STT weights, GPU or autostart registry test. Build output includes Vite's existing large-chunk advisory.

## Windows acceptance checklist (run before distributing installer)

- Build `npm run desktop:build`, install NSIS and launch with WebView2 present.
- Pair token; REST and socket connect. Incorrect token is rejected. Stop each service: corresponding health changes offline; restore and refresh.
- Load licensed Live2D model before packaging; transparent background, expression and lip sync render in both windows.
- Drag character, quit/restart: position restored. Disconnect monitor and restart: windows remain reachable; Tray Reset recenters.
- Tray show/hide/chat/interactive/click-through/quit work. Ctrl+Alt+Y restores interaction from click-through; M opens chat, H hides character. Test shortcut conflict warning.
- Relaunch executable: only one instance remains. Autostart off initially; opt in/out after installation and test login.
- Microphone only after explicit click; close chat while recording, transcribing, generating and speaking: stops/cancels, no late playback.
- Both windows share emotion/mouth updates without duplicate chat requests, recording or playback.
- Start with services offline, then start them and pair/reconnect successfully.
