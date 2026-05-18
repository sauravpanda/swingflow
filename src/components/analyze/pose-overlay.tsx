"use client";

// Body-skeleton overlay drawn on top of the video element. The
// big new differentiator from a phone video player (#168-pivot) —
// coaches can see body stacking, foot placement, and connection
// shape while reviewing technique.
//
// V1 scope: two people (couples), skeleton-only, no metrics.
// Stacking score / weight-transfer arrow / connection-line are
// follow-ups.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

// Hosted CDN endpoints so we don't have to vendor the 9MB model or
// run our own asset server. jsDelivr CDN serves the WASM bundle; the
// model file is on Google's official mediapipe-models bucket.
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

// Subset of POSE_CONNECTIONS we actually want to draw. The full
// MediaPipe topology includes face landmarks which add visual
// noise without telling a coach anything about technique.
const SKELETON_EDGES: Array<[number, number]> = [
  // Torso
  [11, 12], // shoulders
  [11, 23], // left side
  [12, 24], // right side
  [23, 24], // hips
  // Left arm
  [11, 13],
  [13, 15],
  // Right arm
  [12, 14],
  [14, 16],
  // Left leg
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  // Right leg
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];

// Per-person stroke palette. Couples WCS usually has two dancers;
// MediaPipe doesn't tell us which is lead vs follow, so we just
// alternate. Coaches can read "the cyan one" and "the magenta one".
const POSE_COLORS = ["#5eead4", "#f0abfc"];

export type PoseOverlayHandle = {
  setEnabled: (next: boolean) => void;
  enabled: boolean;
};

type PoseOverlayProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  playing: boolean;
};

// Loading state surfaced to the parent so the toggle button can
// reflect "loading model" vs "ready" without the user wondering
// why pressing the icon did nothing for 3 seconds.
type Status = "off" | "loading" | "active" | "error";

const STORAGE_KEY = "swingflow:pose-overlay-enabled";

export const PoseOverlay = forwardRef<PoseOverlayHandle, PoseOverlayProps>(
  function PoseOverlay({ videoRef, playing }, ref) {
    const [enabled, setEnabledState] = useState<boolean>(() => {
      if (typeof window === "undefined") return false;
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    });
    const [status, setStatus] = useState<Status>("off");
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const landmarkerRef = useRef<PoseLandmarker | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastVideoTimeRef = useRef<number>(-1);

    const setEnabled = (next: boolean) => {
      setEnabledState(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      }
    };

    useImperativeHandle(
      ref,
      () => ({ setEnabled, enabled }),
      [enabled]
    );

    // Load the model on first enable. Lazy import keeps the
    // MediaPipe bundle (~3MB JS + ~9MB WASM/model fetched from CDN)
    // out of the initial page load.
    useEffect(() => {
      if (!enabled) return;
      if (landmarkerRef.current) {
        setStatus("active");
        return;
      }
      let cancelled = false;
      setStatus("loading");
      (async () => {
        try {
          const { FilesetResolver, PoseLandmarker } = await import(
            "@mediapipe/tasks-vision"
          );
          const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
          if (cancelled) return;
          const landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: POSE_MODEL_URL,
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            // Couples = up to 2 dancers in frame. Multi-couple
            // competition clips will only render the two most
            // prominent — that matches the AI's subject_description
            // policy and keeps the visualization legible.
            numPoses: 2,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          if (cancelled) {
            landmarker.close();
            return;
          }
          landmarkerRef.current = landmarker;
          setStatus("active");
        } catch (err) {
          if (!cancelled) {
            // Surface to console for debugging — most likely fail
            // modes are network (CDN blocked, e.g. corporate proxy)
            // or unsupported browser (older Safari without GPU).
            console.error("pose-overlay: failed to load MediaPipe", err);
            setStatus("error");
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [enabled]);

    // Draw loop. Runs while enabled regardless of `playing` so a
    // paused frame still shows skeletons (which is when coaches do
    // most of the analysis). `detectForVideo` is a no-op when the
    // video time hasn't advanced, so we don't burn cycles on a
    // truly-stopped frame.
    useEffect(() => {
      if (!enabled || status !== "active") return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const draw = (result: PoseLandmarkerResult) => {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        result.landmarks.forEach((person, personIdx) => {
          const color = POSE_COLORS[personIdx % POSE_COLORS.length];
          // Edges first so the joint dots draw on top and read as
          // clean punctuation rather than getting overdrawn.
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(2, Math.min(w, h) / 200);
          ctx.lineCap = "round";
          for (const [a, b] of SKELETON_EDGES) {
            const pa = person[a];
            const pb = person[b];
            if (!pa || !pb) continue;
            // visibility is the model's confidence for that joint —
            // skip lines that hinge on a low-confidence point so we
            // don't draw a leg flying off into the corner when an
            // ankle is occluded by another dancer.
            if (
              (pa.visibility ?? 1) < 0.3 ||
              (pb.visibility ?? 1) < 0.3
            )
              continue;
            ctx.beginPath();
            ctx.moveTo(pa.x * w, pa.y * h);
            ctx.lineTo(pb.x * w, pb.y * h);
            ctx.stroke();
          }
          // Joint dots
          ctx.fillStyle = color;
          const r = Math.max(2, Math.min(w, h) / 250);
          for (const p of person) {
            if ((p.visibility ?? 1) < 0.3) continue;
            ctx.beginPath();
            ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      };

      const tick = () => {
        const landmarker = landmarkerRef.current;
        if (!landmarker) return;
        // Match canvas pixel dims to the video's intrinsic dims so
        // landmarks (which are normalized to source frame) map to
        // sharp pixels rather than being upscaled by CSS.
        if (
          video.videoWidth > 0 &&
          (canvas.width !== video.videoWidth ||
            canvas.height !== video.videoHeight)
        ) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        if (
          video.readyState >= 2 &&
          video.currentTime !== lastVideoTimeRef.current
        ) {
          lastVideoTimeRef.current = video.currentTime;
          const ts = performance.now();
          try {
            const result = landmarker.detectForVideo(video, ts);
            draw(result);
          } catch (err) {
            // Detection can throw briefly during a src change; one
            // logged warning is enough, suppress the rest of the
            // animation frame.
            console.warn("pose-overlay: detect frame failed", err);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
      // playing dependency forces a fresh raf cycle when the user
      // hits play/pause — strictly speaking the loop runs either way,
      // but re-binding clears any pending frame so we don't double-
      // schedule when React strict-mode re-runs effects.
    }, [enabled, status, videoRef, playing]);

    // Clean up the landmarker on unmount or when explicitly disabled,
    // so the WebGL context is released.
    useEffect(() => {
      if (enabled) return;
      const lm = landmarkerRef.current;
      if (lm) {
        lm.close();
        landmarkerRef.current = null;
      }
      setStatus("off");
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }, [enabled]);

    useEffect(() => {
      return () => {
        landmarkerRef.current?.close();
        landmarkerRef.current = null;
      };
    }, []);

    if (!enabled) return null;
    return (
      <>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none object-contain"
          aria-hidden
        />
        {status === "loading" && (
          <div className="absolute top-2 left-2 px-2 py-1 rounded bg-black/60 text-white text-[10px] font-mono">
            Loading pose model…
          </div>
        )}
        {status === "error" && (
          <div className="absolute top-2 left-2 px-2 py-1 rounded bg-rose-900/80 text-white text-[10px] font-mono">
            Pose model failed to load
          </div>
        )}
      </>
    );
  }
);
