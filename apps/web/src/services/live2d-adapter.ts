import * as PIXI from "pixi.js";
import type { MotionMap } from "@companion/contracts";
let corePromise: Promise<void> | undefined;
function core() {
  return (corePromise ??= new Promise<void>((resolve, reject) => {
    if ((window as any).Live2DCubismCore) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "/live2d/core/live2dcubismcore.min.js";
    s.onload = () => resolve();
    s.onerror = () => {
      corePromise = undefined;
      reject(
        new Error(
          "ยังไม่มี Cubism Core: เพิ่ม live2dcubismcore.min.js ตาม README",
        ),
      );
    };
    document.head.append(s);
  }));
}
export async function createViewer(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  path: string,
) {
  await core();
  (window as any).PIXI = PIXI;
  const { Live2DModel } = await import("pixi-live2d-display/cubism4");
  Live2DModel.registerTicker(PIXI.Ticker);
  const app = new PIXI.Application({
    view: canvas,
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(devicePixelRatio, 2),
  });
  let model: any;
  try {
    model = await Live2DModel.from(path, { autoInteract: true });
    app.stage.addChild(model);
  } catch (e) {
    app.destroy(false, { children: true });
    throw e;
  }
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
}
