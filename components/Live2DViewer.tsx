"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const MODEL_PATH = "/yachiyo/八千代辉夜姬.model3.json";
const MOUTH_PARAM = "ParamMouthOpenY";

export interface Live2DViewerHandle {
  setMouthValue: (value: number) => void;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    setMouthValue: (value: number) => {
      try {
        modelRef.current?.internalModel.coreModel.setParameterValueById(MOUTH_PARAM, value);
      } catch {
        // パラメータが見つからない場合は無視
      }
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
        await loadScript("/live2dcubismcore.min.js");
        if (cancelled) return;

        const PIXI = await import("pixi.js");
        const { Live2DModel } = await import("pixi-live2d-display/cubism4");
        if (cancelled) return;

        Live2DModel.registerTicker(PIXI.Ticker);

        const w = container.offsetWidth || 800;
        const h = container.offsetHeight || 600;

        app = new PIXI.Application({ autoStart: true, backgroundAlpha: 0, width: w, height: h });
        container.appendChild(app.view as HTMLCanvasElement);

        if (cancelled) { app.destroy(true, { children: true }); return; }

        const model = await Live2DModel.from(MODEL_PATH);
        if (cancelled) return;

        modelRef.current = model;
        app.stage.addChild(model);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const origW: number = (model as any).internalModel?.originalWidth ?? model.width;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const origH: number = (model as any).internalModel?.originalHeight ?? model.height;

        const fit = () => {
          const sw: number = app.screen.width;
          const sh: number = app.screen.height;
          const scale = Math.min(sw / origW, sh / origH) * 0.9;
          model.scale.set(scale);
          model.x = (sw - origW * scale) / 2;
          model.y = (sh - origH * scale) / 2;
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

  return <div ref={containerRef} className="w-full h-full" />;
});

export default Live2DViewer;
