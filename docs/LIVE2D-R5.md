# Live2D Cubism SDK for Web R5 / Core 6.0.1

The old PixiJS 6 + pixi-live2d-display 0.4 adapter cannot render Core 6.0.1. The
new adapter uses **PixiJS 8** and [omniwaifu/pixi-live2d5](https://github.com/omniwaifu/pixi-live2d5)
at commit `4e2a921887544bd435c876d47595b00e97dace3b`, which targets Framework
5-r.5 and Core 6.0.1. Both the Chat and Tauri Companion windows reuse
`Live2DViewer.vue`.

**Requirements:** Node.js >=22.12, npm, Git, Bun, WebGL 2 (WebView2 on
Windows), and **Cubism SDK for Web R5** downloaded from
https://www.live2d.com/en/sdk/download/web/ with appropriate acceptance of
its license. The renderer fork is MIT-licensed; Cubism Core / GLSL files are
**not committed to GitHub**.

## First-time installation (Windows PowerShell)

Close Vite and Tauri dev servers. Pull this branch. The dependency graph has
changed: run `npm install` (not `npm ci` until the updated lockfile has been
generated and committed). This creates/updates `package-lock.json`.

```powershell
cd D:\GitPoom\anime-ai-companion
npm install
npm run live2d:setup -- "D:\Live2D-SDK\CubismSdkForWeb-5-r.5"
npm run build -w apps/web
npm run desktop:dev
```

Adjust the SDK folder to where you extracted **CubismSdkForWeb-5-r.5**.
The setup script clones the pinned `pixi-live2d5` source with its Framework
submodule, runs Bun to compile it, and copies the generated renderer into
`vendor/pixi-live2d5/dist`. It also installs:

- `apps/web/public/live2d/core/live2dcubismcore.min.js`
- `apps/web/public/cubism5/shaders/` (13 shader files)

All generated/proprietary files are gitignored. **Never move the full SDK**
into Vite's `public` directory: it contains sample TypeScript files that
can trigger `@framework` import errors.

For later installs, `npm ci` works only after the lockfile is updated; run
`npm run live2d:setup -- "<SDK folder>"` again if you reinstall modules or
remove the generated vendor bundle.

## Models / status

The existing Mao path is `/live2d/Mao/Mao.model3.json`. Keep relative
textures, motions, expressions and physics together. R5 supports compatible
older `.moc3` models on a best-effort basis. The viewer now reports Loading,
Ready, or the actual Core/shader failure instead of showing an empty stage.

Emotion mappings must contain **actual** `FileReferences.Expressions[].Name`
names, e.g. `{"happy":"exp_01"}` for Mao. The default Idle motion is driven by
the renderer; tapping Mao's body plays `TapBody` when present. Lip-sync
uses the model's LipSync group (Mao uses `ParamA`). Models without this group
should add it in the authoring asset to enable lip-sync.

Troubleshooting: check that `/live2d/core/live2dcubismcore.min.js` and
`/cubism5/shaders/vertshadersrc.vert` serve real files rather than HTML,
and that WebGL2 is available. For Tauri, a full restart is recommended after
replacing Core/shaders. The official Core is distributed separately under
Live2D's license.
