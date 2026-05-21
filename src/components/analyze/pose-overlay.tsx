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

// MediaPipe Pose landmark indices we care about for metrics. The
// model returns 33 points total; these are the ones a coach uses to
// eyeball stacking and weight transfer.
const LM_NOSE = 0;
const LM_SHOULDER_L = 11;
const LM_SHOULDER_R = 12;
const LM_WRIST_L = 15;
const LM_WRIST_R = 16;
const LM_HIP_L = 23;
const LM_HIP_R = 24;
const LM_ANKLE_L = 27;
const LM_ANKLE_R = 28;
// Confidence floor below which we treat a landmark as missing. Same
// threshold used for the skeleton edges above so a dropped ankle
// doesn't pull the metrics into nonsense.
const VIS_FLOOR = 0.3;
// Time-averaged slot: how many foot-midpoint samples we keep in the
// rolling buffer. 240 samples / 2-per-frame / ~30fps ≈ 4 seconds of
// dance. Long enough for the PCA fit to settle (a whip + anchor is
// ~3s) but short enough that a slot change between songs / between
// pattern-blocks gets picked up rather than averaged away.
const SLOT_BUFFER_MAX = 240;

type Landmark = { x: number; y: number; z?: number; visibility?: number };

type PoseMetrics = {
  // The vertical line a stacked body should fall on, in normalized
  // x-coordinates [0, 1]. Set to the supporting ankle when one foot
  // bears the weight, midpoint of both ankles otherwise.
  plumbX: number;
  // y of the top of the body (head) and the floor (ankle) so the
  // plumb line is drawn through the body and a touch beyond.
  topY: number;
  bottomY: number;
  // Which side is currently bearing weight, or null when even / can't
  // tell. Used to highlight the loaded ankle so a coach scrubbing
  // through an anchor can see weight settle at a glance.
  weightSide: "left" | "right" | null;
};

// Colors for the partnership-level overlays. Distinct from POSE_COLORS
// so connection + slot read as "between the dancers" rather than
// belonging to either skeleton.
const CONNECTION_COLOR = "#fbbf24"; // amber — warm, contrasts with cyan/magenta
const SLOT_COLOR = "#f5f5f4"; // stone — neutral, low-saturation

/** Find the closest wrist pair across the two dancers' poses and
 *  return it when they're plausibly in physical contact. Threshold
 *  is scale-aware (a fraction of shoulder spread) so close-up shots
 *  and wide-shots both work without a manual zoom-knob. */
function findConnection(
  a: Landmark[],
  b: Landmark[]
): { ax: number; ay: number; bx: number; by: number } | null {
  const aWrists = [a[LM_WRIST_L], a[LM_WRIST_R]];
  const bWrists = [b[LM_WRIST_L], b[LM_WRIST_R]];
  const aSL = a[LM_SHOULDER_L];
  const aSR = a[LM_SHOULDER_R];
  if (!aSL || !aSR) return null;
  // Scale: half the lead-dancer's shoulder width. Hands within this
  // distance of each other are almost always in connection in WCS —
  // the dance keeps a one-foot hand connection at minimum, not
  // arm's-length separation.
  const shoulderSpread = Math.hypot(aSL.x - aSR.x, aSL.y - aSR.y);
  const threshold = shoulderSpread * 0.7;
  let best: {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    d: number;
  } | null = null;
  for (const aw of aWrists) {
    if (!aw || (aw.visibility ?? 1) < VIS_FLOOR) continue;
    for (const bw of bWrists) {
      if (!bw || (bw.visibility ?? 1) < VIS_FLOOR) continue;
      const d = Math.hypot(aw.x - bw.x, aw.y - bw.y);
      if (d > threshold) continue;
      if (best && d >= best.d) continue;
      best = { ax: aw.x, ay: aw.y, bx: bw.x, by: bw.y, d };
    }
  }
  return best;
}

/** Foot-midpoints for both dancers in the current frame. Returns
 *  null when either ankle pair isn't visible enough to trust. The
 *  slot fitter buffers these over a rolling window. */
function footMidpoints(
  a: Landmark[],
  b: Landmark[]
): { ax: number; ay: number; bx: number; by: number } | null {
  const aL = a[LM_ANKLE_L];
  const aR = a[LM_ANKLE_R];
  const bL = b[LM_ANKLE_L];
  const bR = b[LM_ANKLE_R];
  if (!aL || !aR || !bL || !bR) return null;
  if (
    (aL.visibility ?? 1) < VIS_FLOOR ||
    (aR.visibility ?? 1) < VIS_FLOOR ||
    (bL.visibility ?? 1) < VIS_FLOOR ||
    (bR.visibility ?? 1) < VIS_FLOOR
  ) {
    return null;
  }
  return {
    ax: (aL.x + aR.x) / 2,
    ay: (aL.y + aR.y) / 2,
    bx: (bL.x + bR.x) / 2,
    by: (bL.y + bR.y) / 2,
  };
}

/** Fit a line to a set of 2D points via PCA. Returns the principal
 *  axis as a point + unit-direction; callers extend through the
 *  point in both directions to draw the slot. Returns null when the
 *  buffer is too sparse or all points are essentially the same
 *  (variance ≈ 0), in which case the per-frame fallback below
 *  handles the render. */
function fitLinePCA(points: Array<{ x: number; y: number }>): {
  cx: number;
  cy: number;
  dx: number;
  dy: number;
} | null {
  if (points.length < 8) return null;
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / points.length;
  const cy = sumY / points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  // 2×2 covariance [[sxx, sxy], [sxy, syy]]. Closed-form
  // eigendecomposition: trace = sxx+syy, det = sxx*syy - sxy^2.
  const trace = sxx + syy;
  if (trace < 1e-6) return null;
  const diff = Math.sqrt(Math.max(0, (sxx - syy) ** 2 + 4 * sxy * sxy));
  const lambdaMax = (trace + diff) / 2;
  // Eigenvector for the largest eigenvalue. Pick the more numerically
  // stable form depending on which diagonal element is larger.
  let vx: number;
  let vy: number;
  if (Math.abs(sxx - syy) > Math.abs(sxy) * 2 || sxy === 0) {
    if (sxx >= syy) {
      vx = lambdaMax - syy;
      vy = sxy;
    } else {
      vx = sxy;
      vy = lambdaMax - sxx;
    }
  } else {
    vx = sxy;
    vy = lambdaMax - sxx;
  }
  const norm = Math.hypot(vx, vy);
  if (norm < 1e-6) return null;
  return { cx, cy, dx: vx / norm, dy: vy / norm };
}

/** Derive coaching metrics from a single pose. Returns null when the
 *  model didn't get enough of a body to compute anything useful — a
 *  cropped clip or a dancer who walked out of frame. */
function computeMetrics(person: Landmark[]): PoseMetrics | null {
  const head = person[LM_NOSE];
  const sL = person[LM_SHOULDER_L];
  const sR = person[LM_SHOULDER_R];
  const hL = person[LM_HIP_L];
  const hR = person[LM_HIP_R];
  const aL = person[LM_ANKLE_L];
  const aR = person[LM_ANKLE_R];
  if (!head || !sL || !sR || !hL || !hR || !aL || !aR) return null;
  // Need both ankles confidently to talk about weight at all. Hips
  // are non-negotiable for the plumb (everything keys off the hip
  // midpoint).
  if ((aL.visibility ?? 1) < VIS_FLOOR || (aR.visibility ?? 1) < VIS_FLOOR) {
    return null;
  }
  if ((hL.visibility ?? 1) < VIS_FLOOR || (hR.visibility ?? 1) < VIS_FLOOR) {
    return null;
  }

  const hipMidX = (hL.x + hR.x) / 2;
  // Weight ratio: 0 = full left, 1 = full right. We project the hip
  // midpoint horizontally and ask how far across the stance it sits.
  // Anything outside [0, 1] means the dancer is leaning past the
  // base of support, which is itself a useful signal — clamp + flag.
  const ankleSpread = aR.x - aL.x;
  // ankleSpread can be negative when the dancer's body is mirrored
  // (filmed from behind) or the model swapped L/R. Take abs + remember
  // which ankle is "near" for the weight call.
  const span = Math.abs(ankleSpread) || 0.0001;
  const leftX = Math.min(aL.x, aR.x);
  const weightRatio = (hipMidX - leftX) / span;
  // 35/65 is a deliberately wide deadband. WCS anchors hover near
  // 50/50 with one foot just slightly more loaded; calling weight
  // sides too eagerly turns the indicator into strobe.
  let weightSide: "left" | "right" | null = null;
  if (weightRatio < 0.35) {
    weightSide = aL.x < aR.x ? "left" : "right";
  } else if (weightRatio > 0.65) {
    weightSide = aL.x < aR.x ? "right" : "left";
  }

  const plumbX =
    weightSide === "left"
      ? aL.x
      : weightSide === "right"
      ? aR.x
      : (aL.x + aR.x) / 2;
  // Extend the plumb a hair above the head + below the lower of the
  // two ankles so the line clearly "passes through" the body.
  const topY = Math.max(0, head.y - 0.04);
  const bottomY = Math.min(1, Math.max(aL.y, aR.y) + 0.04);
  return { plumbX, topY, bottomY, weightSide };
}

export type PoseOverlayHandle = {
  setEnabled: (next: boolean) => void;
  enabled: boolean;
  /** Current overlay canvas, or null when the overlay isn't mounted.
   *  Used by the frame-export button to composite the skeleton on
   *  top of the video frame without piercing the canvas ref. */
  getCanvas: () => HTMLCanvasElement | null;
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
    // Rolling buffer of foot-midpoint samples for the time-averaged
    // slot fit. Each entry is one of the two dancers' foot midpoints
    // — we push both per frame. Capped at SLOT_BUFFER_MAX so the
    // PCA stays O(N) per draw and the line tracks recent movement
    // instead of being anchored to the start of the dance.
    const slotSamplesRef = useRef<Array<{ x: number; y: number }>>([]);

    const setEnabled = (next: boolean) => {
      setEnabledState(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        setEnabled,
        enabled,
        getCanvas: () => canvasRef.current,
      }),
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

          // ─── Coaching metrics layer (PR 3b) ───
          // Plumb line + loaded-foot highlight. The two things a
          // coach reads at a glance: "is the body stacked over the
          // supporting foot" and "which foot has the weight".
          const metrics = computeMetrics(person);
          if (metrics) {
            // Plumb line — translucent, dashed, person's color. A
            // well-stacked dancer has head, shoulders, and hips all
            // intersecting this line; deviation reads visually
            // without needing a numeric badge.
            ctx.save();
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = Math.max(1, Math.min(w, h) / 400);
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(metrics.plumbX * w, metrics.topY * h);
            ctx.lineTo(metrics.plumbX * w, metrics.bottomY * h);
            ctx.stroke();
            ctx.restore();

            // Loaded-foot highlight — only when we're confident
            // enough to call a side. The loaded ankle is whichever
            // one matches plumbX (computeMetrics already set plumbX
            // to the spatially-loaded ankle, which handles cases
            // where MediaPipe swapped L/R labels on a behind-camera
            // shot). A filled ring + brighter inner dot reads as
            // "this foot has weight" without adding text.
            if (metrics.weightSide) {
              const aL = person[LM_ANKLE_L];
              const aR = person[LM_ANKLE_R];
              const loaded =
                Math.abs(aL.x - metrics.plumbX) <
                Math.abs(aR.x - metrics.plumbX)
                  ? aL
                  : aR;
              const ringR = Math.max(6, Math.min(w, h) / 90);
              ctx.save();
              ctx.strokeStyle = color;
              ctx.lineWidth = Math.max(2, Math.min(w, h) / 250);
              ctx.globalAlpha = 0.9;
              ctx.beginPath();
              ctx.arc(loaded.x * w, loaded.y * h, ringR, 0, Math.PI * 2);
              ctx.stroke();
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(loaded.x * w, loaded.y * h, ringR / 2.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }
        });

        // ─── Partnership-level overlays (PR 3c) ───
        // Connection line + slot axis. Only when MediaPipe found two
        // dancers; a solo clip just gets the skeletons + per-person
        // metrics already drawn above.
        if (result.landmarks.length >= 2) {
          const a = result.landmarks[0];
          const b = result.landmarks[1];

          // Slot axis first (under the connection line so a tight
          // overlap reads as "connection on top of slot").
          //
          // Two-phase: collect samples of both dancers' foot
          // midpoints into a rolling buffer, then fit a 2D line
          // through them via PCA. Buffer caps at SLOT_BUFFER_MAX so
          // the fit stays current — when the couple moves to a new
          // slot the line follows after ~4 seconds rather than
          // averaging across both forever.
          //
          // Fallback to the per-frame line-through-foot-midpoints
          // for the first second or so before the buffer has enough
          // samples to fit. PCA needs ~8 points to behave; we get
          // 2 per frame, so the fallback covers the first ~4 frames
          // and the fit kicks in thereafter.
          const mids = footMidpoints(a, b);
          if (mids) {
            const buf = slotSamplesRef.current;
            buf.push({ x: mids.ax, y: mids.ay });
            buf.push({ x: mids.bx, y: mids.by });
            while (buf.length > SLOT_BUFFER_MAX) buf.shift();
          }

          const slotFit = fitLinePCA(slotSamplesRef.current);
          ctx.save();
          ctx.strokeStyle = SLOT_COLOR;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = Math.max(1, Math.min(w, h) / 350);
          ctx.setLineDash([10, 6]);
          if (slotFit) {
            // PCA gives a centerpoint + unit direction. To draw the
            // axis we just extend it generously in both directions —
            // half the frame's diagonal in each direction always
            // exits both edges of the canvas, so the line reads as
            // an axis rather than a segment. The canvas clips
            // anything outside [0, 1].
            const reach = Math.SQRT2; // diagonal of [0,1]×[0,1]
            const x0 = slotFit.cx - slotFit.dx * reach;
            const y0 = slotFit.cy - slotFit.dy * reach;
            const x1 = slotFit.cx + slotFit.dx * reach;
            const y1 = slotFit.cy + slotFit.dy * reach;
            ctx.beginPath();
            ctx.moveTo(x0 * w, y0 * h);
            ctx.lineTo(x1 * w, y1 * h);
            ctx.stroke();
          } else if (mids) {
            // Per-frame fallback — used during the brief warm-up
            // window before the PCA buffer has enough samples.
            const dx = mids.bx - mids.ax;
            const dy = mids.by - mids.ay;
            ctx.beginPath();
            ctx.moveTo((mids.ax - dx * 0.25) * w, (mids.ay - dy * 0.25) * h);
            ctx.lineTo((mids.bx + dx * 0.25) * w, (mids.by + dy * 0.25) * h);
            ctx.stroke();
          }
          ctx.restore();

          // Connection line — drawn solid because connection IS the
          // signal (the slot is geometry; the connection is the
          // dance). Endpoints get small terminal dots so a brief
          // single-frame detection reads as a real connection
          // rather than a stroke artifact.
          const conn = findConnection(a, b);
          if (conn) {
            ctx.save();
            ctx.strokeStyle = CONNECTION_COLOR;
            ctx.lineWidth = Math.max(2, Math.min(w, h) / 200);
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(conn.ax * w, conn.ay * h);
            ctx.lineTo(conn.bx * w, conn.by * h);
            ctx.stroke();
            ctx.fillStyle = CONNECTION_COLOR;
            const tr = Math.max(3, Math.min(w, h) / 200);
            ctx.beginPath();
            ctx.arc(conn.ax * w, conn.ay * h, tr, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(conn.bx * w, conn.by * h, tr, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
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
      slotSamplesRef.current = [];
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }, [enabled]);

    // Reset the slot buffer on seek. A scrub backwards in the dance
    // shouldn't average yesterday's slot into today's frame, and a
    // jump to a different section likely lands on a different slot
    // orientation. The buffer rebuilds in ~half a second of play.
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      const onSeeked = () => {
        slotSamplesRef.current = [];
      };
      v.addEventListener("seeked", onSeeked);
      return () => {
        v.removeEventListener("seeked", onSeeked);
      };
    }, [videoRef]);

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
