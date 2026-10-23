import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const shaderNames = [
  "fragshadersrcalphablend.frag",
  "fragshadersrccolorblend.frag",
  "fragshadersrccopy.frag",
  "fragshadersrcmaskinvertedpremultipliedalpha.frag",
  "fragshadersrcmaskpremultipliedalpha.frag",
  "fragshadersrcpremultipliedalpha.frag",
  "fragshadersrcpremultipliedalphablend.frag",
  "fragshadersrcsetupmask.frag",
  "vertshadersrc.vert",
  "vertshadersrcblend.vert",
  "vertshadersrccopy.vert",
  "vertshadersrcmasked.vert",
  "vertshadersrcsetupmask.vert",
];
const required = [
  "apps/api/.env",
  "vendor/pixi-live2d5/dist/index.es.js",
  "vendor/pixi-live2d5/types/index.d.ts",
  "apps/web/public/live2d/core/live2dcubismcore.min.js",
  ...shaderNames.map((name) => "apps/web/public/cubism5/shaders/" + name),
];
const missing = required.filter((path) => !existsSync(resolve(root, path)));
if (missing.length) {
  console.error("Docker prerequisites are missing:\n" + missing.map((x) => "  - " + x).join("\n"));
  console.error("\nRun npm run setup, then npm run live2d:setup -- \"<your Cubism SDK for Web R5 folder>\".");
  console.error("The Live2D SDK Core/shaders are proprietary and are intentionally not stored on GitHub.");
  process.exit(1);
}
const env = readFileSync(resolve(root, "apps/api/.env"), "utf8");
const token = env.match(/^LOCAL_API_TOKEN=(.*)$/m)?.[1]?.trim() ?? "";
if (token.length < 32) {
  console.error("LOCAL_API_TOKEN missing/short: run npm run setup first.");
  process.exit(1);
}
console.log("Docker prerequisites ready. Run docker compose up -d --build postgres api web.");
