"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const MODEL_PATH = "/model/26年度文化祭用psd.model3.json";
const CUBISM_CORE_PATH = "/live2dcubismcore.min.js";
const MOUTH_PARAM = "ParamMouthOpenY";
const MOUTH_FORM_PARAM = "ParamMouthForm";
const OPEN_MOUTH_PART = "PartOpenMouth";

function mouthCavityFade(openY: number): number {
  const v = Math.max(0, Math.min(1, openY));
  if (v <= 0.08) return 0;
  return Math.min(1, (v - 0.08) / 0.35);
}

/** Apply lip-sync every frame so pixi-live2d-display's save/loadParameters cannot wipe it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attachMouthDriver(model: any, getMouthValue: () => number) {
  const internal = model.internalModel;
  const core = internal.coreModel;
  const partIndex = core.getPartIndex(OPEN_MOUTH_PART);
  const orders: { i: number; order: number }[] = [];
  const renderOrders = core.getDrawableRenderOrders();
  for (let i = 0; i < core.getDrawableCount(); i++) {
    if (core.getDrawableParentPartIndex(i) === partIndex) {
      orders.push({ i, order: renderOrders[i] });
    }
  }
  orders.sort((a, b) => a.order - b.order);
  const innerIndex = orders[0]?.i ?? -1;

  const origUpdate = internal.update.bind(internal);
  internal.update = (dt: number, now: number) => {
    const v = Math.max(0, Math.min(1, getMouthValue()));
    core.setParameterValueById(MOUTH_PARAM, v);
    core.setParameterValueById(MOUTH_FORM_PARAM, v * 0.55);
    origUpdate(dt, now);
    core.setParameterValueById(MOUTH_PARAM, v);
    core.setParameterValueById(MOUTH_FORM_PARAM, v * 0.55);
    if (innerIndex >= 0) {
      core._model.drawables.opacities[innerIndex] *= mouthCavityFade(v);
    }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getVisualBounds(model: any) {
  const internal = model.internalModel;
  const core = internal.coreModel;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < core.getDrawableCount(); i++) {
    const id = String(core.getDrawableId(i));
    if (id.startsWith("Hit")) continue;
    if (!core.getDrawableDynamicFlagIsVisible(i)) continue;
    const verts = core.getDrawableVertices(i);
    for (let j = 0; j < verts.length; j += 2) {
      const x = verts[j] * internal.pixelsPerUnit + internal.originalWidth / 2;
      const y = -verts[j + 1] * internal.pixelsPerUnit + internal.originalHeight / 2;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export interface Live2DViewerHandle {
  setMouthValue: (value: number) => void;
  setEyePosition: (x: number, y: number) => void;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

const Live2DViewer = forwardRef<Live2DViewerHandle>(function Live2DViewer(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelRef = useRef<any>(null);
  const mouthValueRef = useRef(0);

  useImperativeHandle(ref, () => ({
    setMouthValue: (value: number) => {
      const v = Math.max(0, Math.min(1, value));
      mouthValueRef.current = v;
      try {
        const core = modelRef.current?.internalModel.coreModel;
        if (!core) return;
        core.setParameterValueById(MOUTH_PARAM, v);
        core.setParameterValueById(MOUTH_FORM_PARAM, v * 0.55);
      } catch { /* ignore */ }
    },
    setEyePosition: (x: number, y: number) => {
      try {
        const core = modelRef.current?.internalModel.coreModel;
        if (!core) return;
        core.setParameterValueById("ParamEyeBallX", x);
        core.setParameterValueById("ParamEyeBallY", y);
        core.setParameterValueById("ParamAngleX", x * 30);
        core.setParameterValueById("ParamAngleY", y * 25);
        core.setParameterValueById("ParamBodyAngleX", x * 10);
      } catch { /* ignore */ }
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let app: any = null;

    (async () => {
      try {
        await loadScript(CUBISM_CORE_PATH);
        if (cancelled) return;
        setLoadError(null);

        const PIXI = await import("pixi.js");
        const { Live2DModel } = await import("pixi-live2d-display/cubism4");
        if (cancelled) return;

        Live2DModel.registerTicker(PIXI.Ticker);

        const w = container.offsetWidth || 800;
        const h = container.offsetHeight || 600;

        app = new PIXI.Application({ autoStart: true, backgroundAlpha: 0, width: w, height: h });
        container.appendChild(app.view as HTMLCanvasElement);

        if (cancelled) { app.destroy(true, { children: true }); return; }

        const model = await Live2DModel.from(MODEL_PATH, { autoHitTest: false, autoFocus: false });
        if (cancelled) return;

        modelRef.current = model;
        app.stage.addChild(model);
        attachMouthDriver(model, () => mouthValueRef.current);

        const bounds = getVisualBounds(model);

        const fit = () => {
          const sw: number = app.screen.width;
          const sh: number = app.screen.height;
          const scale = Math.min(sw / bounds.w, sh / bounds.h) * 0.92;
          model.scale.set(scale);
          const cx = (bounds.minX + bounds.maxX) / 2;
          model.x = sw / 2 - cx * scale;
          model.y = sh * 0.97 - bounds.maxY * scale;
        };

        fit();

        const resizeObserver = new ResizeObserver(() => {
          app.renderer.resize(container.offsetWidth, container.offsetHeight);
          fit();
        });
        resizeObserver.observe(container);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (app as any)._resizeObserver = resizeObserver;
      } catch (e) {
        const message =
          e instanceof Error && e.message.includes(CUBISM_CORE_PATH)
            ? `${CUBISM_CORE_PATH} が見つかりません`
            : "Live2D の初期化に失敗しました";
        if (!cancelled) setLoadError(message);
        console.error("Live2D init error:", e);
      }
    })();

    return () => {
      cancelled = true;
      modelRef.current = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any)?._resizeObserver?.disconnect();
      app?.destroy(true, { children: true });
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <p className="max-w-[28rem] rounded bg-black/60 px-4 py-2 text-sm text-white">
            {loadError}
          </p>
        </div>
      )}
    </div>
  );
});

export default Live2DViewer;
