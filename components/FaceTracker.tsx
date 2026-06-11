"use client";

import { useEffect, useRef } from "react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const SMOOTH = 0.25;
const NEW_FACE_THRESHOLD = 0.2;

interface Props {
  onFaceMove: (x: number, y: number) => void;
}

function isExpectedCameraError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return ["NotAllowedError", "NotFoundError", "NotReadableError", "SecurityError"].includes(error.name);
}

export default function FaceTracker({ onFaceMove }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onFaceMove);
  const posRef = useRef({ x: 0, y: 0 });
  const prevCentersRef = useRef<{ x: number; y: number }[]>([]);
  const trackedRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    callbackRef.current = onFaceMove;
  }, [onFaceMove]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let detector: FaceDetector | null = null;
    let rafId = 0;
    let cancelled = false;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();

        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;

        detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });
        if (cancelled) return;

        const detect = () => {
          if (cancelled) return;

          if (video.readyState >= 2 && detector) {
            const result = detector.detectForVideo(video, performance.now());
            const faces = result.detections;
            const vw = video.videoWidth || 1;
            const vh = video.videoHeight || 1;

            if (faces.length > 0) {
              const centers = faces.map((f) => ({
                x: (f.boundingBox!.originX + f.boundingBox!.width / 2) / vw,
                y: (f.boundingBox!.originY + f.boundingBox!.height / 2) / vh,
              }));

              const prev = prevCentersRef.current;
              const newFaces =
                prev.length > 0
                  ? centers.filter((c) =>
                      prev.every(
                        (p) =>
                          Math.hypot(c.x - p.x, c.y - p.y) > NEW_FACE_THRESHOLD,
                      ),
                    )
                  : [];

              if (newFaces.length > 0) {
                // 新しく現れた顔に切り替え
                trackedRef.current = newFaces[0];
              } else if (trackedRef.current) {
                // 現在追跡中の顔に最も近い顔を継続追跡
                const tc = trackedRef.current;
                trackedRef.current = centers.reduce((best, c) =>
                  Math.hypot(c.x - tc.x, c.y - tc.y) <
                  Math.hypot(best.x - tc.x, best.y - tc.y)
                    ? c
                    : best,
                );
              } else {
                trackedRef.current = centers[0];
              }

              prevCentersRef.current = centers;

              const t = trackedRef.current!;
              // カメラは鏡像なので X を反転して「人の方を向く」マッピング
              const tx = -(t.x - 0.5) * 2;
              const ty = -(t.y - 0.5) * 2;

              posRef.current.x += SMOOTH * (tx - posRef.current.x);
              posRef.current.y += SMOOTH * (ty - posRef.current.y);
            } else {
              prevCentersRef.current = [];
              trackedRef.current = null;
              // 顔がいなければ正面に戻す
              posRef.current.x += SMOOTH * (0 - posRef.current.x);
              posRef.current.y += SMOOTH * (0 - posRef.current.y);
            }

            callbackRef.current(posRef.current.x, posRef.current.y);
          }

          rafId = requestAnimationFrame(detect);
        };
        rafId = requestAnimationFrame(detect);
      } catch (e) {
        if (!isExpectedCameraError(e)) {
          console.error("[FaceTracker]", e);
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      detector?.close();
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, []);

  return <video ref={videoRef} className="hidden" muted playsInline />;
}
