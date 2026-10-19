import * as PIXI from "pixi.js";
import { inspectCapabilities } from "../animation/motion-capabilities";

export type Live2DViewerHandle = {
  setMouthOpen(value: number): void;
  playMotion(group:string,index:number):Promise<void>;
  inspectMotions():Record<string,number>;
  emotion(name: string, map: Record<string, string>): Promise<void>;
  action(expression?: string, motion?: string): Promise<void>;
  destroy(): void;
};

type CubismR5Module = typeof import("pixi-live2d5");
=======
import type { MotionMap } from "@companion/contracts";
>>>>>>> origin/feature/emotional-live2d-chat
let corePromise: Promise<void> | undefined;
let rendererPromise: Promise<CubismR5Module> | undefined;

function checkCore() {
  const core = (window as Window & { Live2DCubismCore?: {
    Version?: { csmGetVersion?: () => number };
  } }).Live2DCubismCore;
  if (!core) throw new Error("Cubism Core ไม่พร้อมใช้งาน");
  const version = core.Version?.csmGetVersion?.();
  if (typeof version !== "number" || (version >>> 24) !== 6) {
    throw new Error("ต้องใช้ Cubism SDK for Web R5 (Core 6.0.1) ไม่ใช่ Core รุ่นเก่า");
  }
}

function loadCore(): Promise<void> {
  return (corePromise ??= new Promise<void>((resolve, reject) => {
    if ((window as any).Live2DCubismCore) {
      try { checkCore(); resolve(); } catch (error) { reject(error); }
      return;
    }
    const script = document.createElement("script");
    script.src = "/live2d/core/live2dcubismcore.min.js";
    script.async = true;
    script.onload = () => {
      try { checkCore(); resolve(); }
      catch (error) { corePromise = undefined; reject(error); }
    };
    script.onerror = () => {
      corePromise = undefined;
      script.remove();
      reject(new Error("ไม่พบ Cubism Core 6.0.1: รัน npm run live2d:setup"));
    };
    document.head.appendChild(script);
  }));
}

async function loadRenderer() {
  await loadCore();
  return (rendererPromise ??= import("pixi-live2d5").then((library) => {
    library.config.cubism5ShaderPath = "/cubism5/shaders/";
    library.Live2DModel.registerTicker(PIXI.Ticker);
    (window as any).PIXI = PIXI;
    return library;
  }).catch((cause) => {
    rendererPromise = undefined;
    throw cause;
  }));
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Live2D load cancelled", "AbortError");
}

function waitForShaderReady(
  internal: object,
  signal?: AbortSignal,
): Promise<void> {
  // The renderer exposes InternalModel in its public type declarations,
  // while Cubism5InternalModel has these R5-specific fields at runtime.
  const shader = internal as { shaderState?: string; shaderError?: Error };
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let frame = 0;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => finish(new DOMException("Live2D load cancelled", "AbortError"));
    const poll = () => {
      if (signal?.aborted) return cancel();
      if (shader.shaderState === "ready") return finish();
      if (shader.shaderState === "error") {
        return finish(shader.shaderError ?? new Error("Cubism R5 shader failed"));
      }
      if (performance.now() - started > 35_000) {
        return finish(new Error("รอ Cubism R5 shaders นานเกิน 35 วินาที: ตรวจ /cubism5/shaders/"));
      }
      frame = requestAnimationFrame(poll);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    poll();
  });
}

export async function createViewer(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  path: string,
  signal?: AbortSignal,
  onRuntimeError?: (error: Error) => void,
): Promise<Live2DViewerHandle> {
  aborted(signal);
  const { Live2DModel } = await loadRenderer();
  aborted(signal);

  const app = new PIXI.Application();
  let initialized = false;
  let model: Awaited<ReturnType<typeof Live2DModel.from>> | undefined;
  let observer: ResizeObserver | undefined;
  let onMouth: (() => void) | undefined;
  let onShaderError: ((error: Error) => void) | undefined;

  const dispose = () => {
    observer?.disconnect();
    const internal = model?.internalModel;
    if (onMouth) internal?.off("beforeModelUpdate", onMouth);
    if (onShaderError) internal?.off("shaderLoadError", onShaderError);
    if (initialized) app.destroy(true, { children: true, texture: true, textureSource: true });
  };

  try {
    await app.init({
      canvas,
      resizeTo: host,
      preference: "webgl",
      preferWebGLVersion: 2,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    initialized = true;
    aborted(signal);
    if (!(app.renderer as any).gl || !((app.renderer as any).gl instanceof WebGL2RenderingContext)) {
      throw new Error("Cubism R5 ต้องใช้ WebGL 2: ตรวจการรองรับ GPU ของ WebView2/Browser");
    }

    model = await Live2DModel.from(path, { autoInteract: true });
    aborted(signal);

    const loadedModel = model;
    const internal = loadedModel.internalModel;
    const fit = () => {
      loadedModel.scale.set(1);
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (![width, height, loadedModel.width, loadedModel.height].every(
        (v) => Number.isFinite(v) && v > 0
      )) return;
      const scale = Math.min(width / loadedModel.width, height / loadedModel.height) * 0.9;
      loadedModel.anchor.set(0.5, 0.5);
      loadedModel.scale.set(scale);
      loadedModel.position.set(width / 2, height / 2);
    };
    fit();
    observer = new ResizeObserver(fit);
    observer.observe(host);

    let mouth = 0;
    // R5 stores CubismIdHandle objects in the motion manager, not plain string IDs.
    const lipIds = (internal.motionManager as { lipSyncIds?: unknown[] }).lipSyncIds ?? [];
    console.info("[Live2D] LipSync parameter count:", lipIds.length);
    const coreModel = internal.coreModel as {
      setParameterValueById(id: unknown, value: number): void;
    };
    onMouth = () => {
      for (const id of lipIds) coreModel.setParameterValueById(id, mouth);
    };
    internal.on("beforeModelUpdate", onMouth);

    onShaderError = (cause: Error) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      onRuntimeError?.(error);
    };
    internal.on("shaderLoadError", onShaderError);

    const hasTapMotion = !!(internal.settings as { motions?: Record<string, unknown[]> }).motions?.TapBody?.length;
    if (hasTapMotion) {
      loadedModel.on("hit", (hitAreas: string[]) => {
        if (hitAreas.some((area) => area.toLowerCase() === "body")) {
          void Promise.resolve(loadedModel.motion("TapBody")).catch((error) =>
            onRuntimeError?.(error instanceof Error ? error : new Error(String(error))),
          );
        }
      });
    }

    app.stage.addChild(loadedModel);
    await waitForShaderReady(internal, signal);
    aborted(signal);

    return {
      setMouthOpen(value) {
        mouth = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      },
      async emotion(name, map) {
        const expression = map[name];
        if (expression) await loadedModel.expression(expression);
      },
      async playMotion(group,index) {
        const settings = internal.settings as {motions?:Record<string,unknown[]>};
        // Only explicitly approved motion mappings may run; model groups by themselves have no known semantics.
        if (!Number.isInteger(index) || index < 0 || index >= (settings.motions?.[group]?.length ?? 0)) {
          throw new Error(`Unknown motion: ${group}[${index}]`);
        }
        await Promise.resolve(loadedModel.motion(group,index));
      },
      inspectMotions() {
        return inspectCapabilities(internal.settings as {motions?:Record<string,unknown[]>}).motions;
      },
      async action(expression, motion) {
        const settings = internal.settings as {
          expressions?: Record<string, unknown>;
          motions?: Record<string, unknown[]>;
        };
        if (expression && settings.expressions?.[expression])
          await loadedModel.expression(expression);
        if (motion && settings.motions?.[motion]?.length)
          await loadedModel.motion(motion);
      },
      destroy: dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
<<<<<<< HEAD
=======
  const fit = () => {
    model.scale.set(1);
    const scale =
      Math.min(
        host.clientWidth / model.width,
        host.clientHeight / model.height,
      ) * 0.94;
    model.scale.set(scale);
    model.anchor.set(0.5, 1);
    model.position.set(host.clientWidth / 2, host.clientHeight);
  };
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(host);
  let mouth = 0;
  const lipIds: string[] =
    model.internalModel.settings.getLipSyncParameters?.() ?? [];
  const ids = lipIds.length ? lipIds : ["ParamMouthOpenY"];
  const applyMouth = () => {
    for (const id of ids)
      model.internalModel.coreModel.setParameterValueById(id, mouth);
  };
  model.internalModel.on("beforeModelUpdate", applyMouth);

  let animationRevision = 0;
  let animationQueue = Promise.resolve();
  function enqueueAnimation(action: (revision: number) => Promise<void>) {
    const revision = ++animationRevision;
    const task = animationQueue.then(async () => {
      if (revision === animationRevision) await action(revision);
    });
    animationQueue = task.catch(() => {});
    return task;
  }
  async function runMotion(mapping: MotionMap[string] | undefined) {
    if (!mapping?.group?.trim()) return;
    const played = await model.motion(mapping.group, mapping.index);
    if (!played)
      console.warn(
        `Live2D motion not found: ${mapping.group}[${mapping.index ?? "random"}]`,
      );
  }
  function playMotion(mapping: MotionMap[string] | undefined) {
    return enqueueAnimation(() => runMotion(mapping));
  }
  return {
    setMouthOpen(value: number) {
      mouth = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    },
    setEmotion(
      name: string,
      expressions: Record<string, string>,
      motions: MotionMap,
    ) {
      const expression = expressions[name] ?? expressions.neutral;
      return enqueueAnimation(async (revision) => {
        if (expression) {
          const applied = await model.expression(expression);
          if (!applied)
            throw new Error(`Live2D expression not found: ${expression}`);
        }
        if (revision === animationRevision) await runMotion(motions[name]);
      });
    },
    destroy() {
      animationRevision++;
      model.internalModel.off("beforeModelUpdate", applyMouth);
      observer.disconnect();
      app.destroy(false, { children: true, texture: true, baseTexture: true });
    },
  };
>>>>>>> origin/feature/emotional-live2d-chat
}
