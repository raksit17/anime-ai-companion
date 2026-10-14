import { spawnSync } from "node:child_process";
import {
  copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Tested target: Cubism SDK for Web R5 / Core 6.0.1.
// Pin the renderer source to keep the local build reproducible.
const PINNED_COMMIT = "4e2a921887544bd435c876d47595b00e97dace3b";
const ORIGIN = "https://github.com/omniwaifu/pixi-live2d5.git";
const shaders = [
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

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sdkInput = process.argv[2] ?? process.env.CUBISM_SDK_DIR;
if (!sdkInput) {
  console.error('Usage: npm run live2d:setup -- "D:\\path\\CubismSdkForWeb-5-r.5"');
  process.exit(1);
}
const sdk = resolve(sdkInput);
const source = join(root, "vendor", ".source", "pixi-live2d5");
const vendor = join(root, "vendor", "pixi-live2d5");
const publicRoot = join(root, "apps", "web", "public");

const sdkCore = join(sdk, "Core");
const sdkShaders = join(sdk, "Framework", "Shaders", "WebGL");
const coreFiles = [
  "live2dcubismcore.js",
  "live2dcubismcore.min.js",
  "live2dcubismcore.d.ts",
];
function need(file) {
  if (!existsSync(file)) throw new Error("Missing SDK R5 asset: " + file);
}
function run(binary, args, cwd = root) {
  console.log("> " + binary + " " + args.join(" "));
  const result = spawnSync(binary, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw new Error(binary + ": " + result.error.message);
  if (result.status !== 0) throw new Error(binary + " exited with " + result.status);
}
try {
  coreFiles.forEach((file) => need(join(sdkCore, file)));
  shaders.forEach((file) => need(join(sdkShaders, file)));

  mkdirSync(join(root, "vendor", ".source"), { recursive: true });
  if (!existsSync(join(source, ".git"))) {
    run("git", ["clone", "--recursive", ORIGIN, source]);
  }
  run("git", ["checkout", "--detach", PINNED_COMMIT], source);
  run("git", ["submodule", "update", "--init", "--recursive"], source);
  run("bun", ["install", "--ignore-scripts"], source);

  mkdirSync(join(source, "core"), { recursive: true });
  mkdirSync(join(source, "public", "cubism5", "shaders"), { recursive: true });
  for (const file of coreFiles) {
    copyFileSync(join(sdkCore, file), join(source, "core", file));
  }
  for (const file of shaders) {
    copyFileSync(join(sdkShaders, file), join(source, "public", "cubism5", "shaders", file));
  }

  run("bun", ["run", "prepare"], source);
  need(join(source, "dist", "index.es.js"));
  need(join(source, "types", "index.d.ts"));

  // Keep the MIT renderer bundle in a locally built, ignored directory.
  // Never commit SDK Core or the SDK-provided GLSL assets.
  rmSync(join(vendor, "dist"), { recursive: true, force: true });
  rmSync(join(vendor, "types"), { recursive: true, force: true });
  cpSync(join(source, "dist"), join(vendor, "dist"), { recursive: true });
  cpSync(join(source, "types"), join(vendor, "types"), { recursive: true });

  const webCore = join(publicRoot, "live2d", "core");
  const webShaders = join(publicRoot, "cubism5", "shaders");
  mkdirSync(webCore, { recursive: true });
  mkdirSync(webShaders, { recursive: true });
  copyFileSync(
    join(sdkCore, "live2dcubismcore.min.js"),
    join(webCore, "live2dcubismcore.min.js"),
  );
  for (const file of shaders) {
    copyFileSync(join(sdkShaders, file), join(webShaders, file));
  }
  if (readdirSync(webShaders).filter((file) => shaders.includes(file)).length !== 13) {
    throw new Error("Expected exactly 13 Cubism 5 R5 shader files");
  }
  console.log("Live2D R5 is ready: Core 6.0.1, renderer, types and 13 shaders installed locally.");
  console.log("Next: npm run build -w apps/web ; npm run desktop:dev");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
