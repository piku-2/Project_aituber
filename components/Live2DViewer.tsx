"use client";

import { useEffect, useRef } from "react";

const MODEL_PATH = "/yachiyo/八千代辉夜姬.model3.json";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export default function Live2DViewer() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let app: any = null;

    (async () => {
      try {
        // Cubism Core を確実にロードしてから進む
        await loadScript("/live2dcubismcore.min.js");

        if (cancelled) return;

        const PIXI = await import("pixi.js");
        const { Live2DModel } = await import("pixi-live2d-display/cubism4");

        if (cancelled) return;

        Live2DModel.registerTicker(PIXI.Ticker);

        const w = container.offsetWidth || 800;
        const h = container.offsetHeight || 600;

        app = new PIXI.Application({
          autoStart: true,
          backgroundAlpha: 0,
          width: w,
          height: h,
        });

        container.appendChild(app.view as HTMLCanvasElement);

        if (cancelled) {
          app.destroy(true, { children: true });
          return;
        }

        console.log("Loading model:", MODEL_PATH);
        const model = await Live2DModel.from(MODEL_PATH);
        console.log("Model loaded:", model.width, model.height);

        if (cancelled) return;

        app.stage.addChild(model);

        // スケール変換の影響を受けない元サイズを取得
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const origW: number = (model as any).internalModel?.originalWidth ?? model.width;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const origH: number = (model as any).internalModel?.originalHeight ?? model.height;
        console.log("Original model size:", origW, origH);

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

        (app as any)._resizeObserver = resizeObserver;
      } catch (e) {
        console.error("Live2D init error:", e);
      }
    })();

    return () => {
      cancelled = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any)?._resizeObserver?.disconnect();
      app?.destroy(true, { children: true });
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
