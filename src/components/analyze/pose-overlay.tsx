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
// A per-frame jump of either foot-midpoint bigger than this (in
// normalized coords) is a camera cut or hard pan, not dancing —
// flush the slot buffer instead of PCA-fitting two different
// framings together into a meaningless axis.
const SLOT_JUMP_FLUSH = 0.15;
// Only draw the PCA slot when the point cloud is meaningfully
// elongated (std-dev along the axis ≥ 2.5× the lateral std-dev). A
// couple rotating in place produces a near-isotropic blob whose
// principal axis is noise; drawing that as "the slot" is misleading.
const SLOT_MIN_ELONGATION = 2.5;
// ...and when there's real travel at all — a stationary cluster has
// a meaningless axis no matter how elongated the jitter is. 0.02 of
// the frame in std-dev terms ≈ the couple actually moved.
const SLOT_MIN_SPREAD_SQ = 0.0004;
// Landmark smoothing: speed-adaptive EMA. The lite model's raw
// output jitters a couple of pixels even on a still body, and the
// plumb/loaded-foot metrics amplify that into strobing. Slow motion
// gets heavy smoothing; fast motion ramps alpha toward 1 so real
// moves aren't smeared.
const SMOOTH_ALPHA_MIN = 0.3;
const SMOOTH_ALPHA_SPEED = 40;
// Frames a new weight-side call must persist before the displayed
// loaded-foot ring flips. ~100ms at 30fps — invisible as latency,
// but stops the ring strobing at the anchor where the weight ratio
// hovers right at the threshold.
const WEIGHT_DEBOUNCE_FRAMES = 3;
// Minimum ankle x-span, as a fraction of the vertical hip-to-ankle
// drop, before we call a weight side at all. Feet-together collapses
// the span toward zero and the hip-vs-ankle ratio then explodes on
// sub-pixel jitter — exactly at the anchor, where coaches look.
const MIN_STANCE_RATIO = 0.12;

type Landmark = { x: number; y: number; z?: number; visibility?: number };

type PoseMetrics = {
  // Instantaneous weight-side call for THIS frame, already gated on
  // a minimum stance width. Refers to the labeled ankle landmark
  // (LM_ANKLE_L / LM_ANKLE_R), which stays correct when the clip is
  // filmed from behind. The component debounces this across frames
  // before showing it so a single-frame flicker never hits the
  // screen.
  rawWeightSide: "left" | "right" | null;
  // Ankle x-positions so the caller can anchor the plumb line to
  // the (debounced) loaded ankle, or their midpoint when no side is
  // confidently loaded.
  ankleLX: number;
  ankleRX: number;
  // y of the top of the body (head) and the floor (ankle) so the
  // plumb line is drawn through the body and a touch beyond.
  topY: number;
  bottomY: number;
};

// Colors for the partnership-level overlays. Distinct from POSE_COLORS
// so connection + slot read as "between the dancers" rather than
// belonging to either skeleton.
const CONNECTION_COLOR = "#fbbf24"; // amber — warm, contrasts with cyan/magenta
const SLOT_COLOR = "#f5f5f4"; // stone — neutral, low-saturation

function isVisible(p: Landmark | undefined): p is Landmark {
  return !!p && (p.visibility ?? 1) >= VIS_FLOOR;
}

/** Find wrist pairs across the two dancers' poses that are plausibly
 *  in physical contact — up to two, so a closed / two-hand hold
 *  renders as two connection lines instead of misleadingly one.
 *  Threshold is scale-aware (a fraction of shoulder spread) so
 *  close-up and wide shots both work without a zoom knob. Scale uses
 *  the WIDER of the two dancers' spreads: a rotated (foreshortened)
 *  dancer's spread collapses, and using one dancer alone shrinks the
 *  threshold until real connections get dropped mid-turn.
 *  `stickyFactor` > 1 widens the threshold while a connection is
 *  already showing (hysteresis), so the line doesn't flicker right
 *  at the boundary during extension. */
function findConnections(
  a: Landmark[],
  b: Landmark[],
  stickyFactor: number
): Array<{ ax: number; ay: number; bx: number; by: number }> {
  const spread = (p: Landmark[]): number => {
    const sL = p[LM_SHOULDER_L];
    const sR = p[LM_SHOULDER_R];
    if (!isVisible(sL) || !isVisible(sR)) return 0;
    return Math.hypot(sL.x - sR.x, sL.y - sR.y);
  };
  const scale = Math.max(spread(a), spread(b));
  if (scale <= 0) return [];
  const threshold = scale * 0.7 * stickyFactor;
  type Pair = {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    d: number;
    ai: number;
    bi: number;
  };
  const pairs: Pair[] = [];
  const aWrists = [a[LM_WRIST_L], a[LM_WRIST_R]];
  const bWrists = [b[LM_WRIST_L], b[LM_WRIST_R]];
  aWrists.forEach((aw, ai) => {
    if (!isVisible(aw)) return;
    bWrists.forEach((bw, bi) => {
      if (!isVisible(bw)) return;
      const d = Math.hypot(aw.x - bw.x, aw.y - bw.y);
      if (d <= threshold) {
        pairs.push({ ax: aw.x, ay: aw.y, bx: bw.x, by: bw.y, d, ai, bi });
      }
    });
  });
  // Greedy matching: closest pair first, then the best pair from the
  // remaining unused wrists. Each wrist connects at most once.
  pairs.sort((p, q) => p.d - q.d);
  const out: Pair[] = [];
  for (const p of pairs) {
    if (out.some((o) => o.ai === p.ai || o.bi === p.bi)) continue;
    out.push(p);
    if (out.length === 2) break;
  }
  return out;
}

/** Centroid of a pose's confidently-visible landmarks — the anchor
 *  for frame-to-frame identity matching. Falls back to all landmarks
 *  when visibility is uniformly poor. */
function centroidOf(person: Landmark[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of person) {
    if (!isVisible(p)) continue;
    sx += p.x;
    sy += p.y;
    n++;
  }
  if (n === 0) {
    for (const p of person) {
      sx += p.x;
      sy += p.y;
      n++;
    }
  }
  return n > 0 ? { x: sx / n, y: sy / n } : { x: 0.5, y: 0.5 };
}

/** Match this frame's poses to persistent display slots so each
 *  dancer keeps a stable color/identity across frames. MediaPipe's
 *  result order is NOT stable with numPoses: 2 — the two poses can
 *  swap array index frame-to-frame (visibly: cyan and magenta
 *  flickering between the dancers during a whip). We assign by
 *  minimum total centroid travel vs the previous frame and mutate
 *  `slots` in place with the new centroids. */
function assignToSlots(
  poses: Landmark[][],
  slots: Array<{ x: number; y: number } | null>
): Array<Landmark[] | null> {
  const out: Array<Landmark[] | null> = [null, null];
  if (poses.length === 0) return out;
  const cents = poses.slice(0, 2).map(centroidOf);
  if (poses.length === 1) {
    // Solo frame: keep the dancer in whichever slot they're nearest
    // to (their partner may be briefly occluded), defaulting to
    // slot 0 when we've never seen anyone.
    const d = (s: { x: number; y: number } | null) =>
      s
        ? Math.hypot(cents[0].x - s.x, cents[0].y - s.y)
        : Number.POSITIVE_INFINITY;
    const idx = slots[0] == null && slots[1] == null
      ? 0
      : d(slots[1]) < d(slots[0])
      ? 1
      : 0;
    out[idx] = poses[0];
    slots[idx] = cents[0];
    return out;
  }
  // Two poses: straight vs swapped assignment, whichever moves the
  // centroids less. An empty slot costs 0 so first-frame assignment
  // keeps the model's order.
  const cost = (i: number, s: number) => {
    const slot = slots[s];
    return slot ? Math.hypot(cents[i].x - slot.x, cents[i].y - slot.y) : 0;
  };
  const straight = cost(0, 0) + cost(1, 1);
  const swapped = cost(0, 1) + cost(1, 0);
  const slotForPose = swapped < straight ? [1, 0] : [0, 1];
  out[slotForPose[0]] = poses[0];
  out[slotForPose[1]] = poses[1];
  slots[slotForPose[0]] = cents[0];
  slots[slotForPose[1]] = cents[1];
  return out;
}

/** Speed-adaptive EMA over the 33 landmarks. Small frame-to-frame
 *  deltas (jitter) get smoothed hard; large deltas (a real move)
 *  ramp alpha toward 1 so the skeleton tracks the dance instead of
 *  smearing behind it. */
function smoothLandmarks(
  prev: Landmark[] | null,
  next: Landmark[]
): Landmark[] {
  if (!prev || prev.length !== next.length) {
    return next.map((p) => ({ ...p }));
  }
  return next.map((p, i) => {
    const q = prev[i];
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    const alpha = Math.min(1, SMOOTH_ALPHA_MIN + dist * SMOOTH_ALPHA_SPEED);
    return {
      x: q.x + (p.x - q.x) * alpha,
      y: q.y + (p.y - q.y) * alpha,
      z: p.z,
      visibility: p.visibility,
    };
  });
}

type WeightState = {
  side: "left" | "right" | null;
  candidate: "left" | "right" | null;
  count: number;
};

/** Debounce the instantaneous weight-side call: a new side must
 *  persist WEIGHT_DEBOUNCE_FRAMES consecutive frames before the
 *  display flips. Mutates `state`, returns the side to display. */
function debounceWeightSide(
  state: WeightState,
  raw: "left" | "right" | null
): "left" | "right" | null {
  if (raw === state.side) {
    state.candidate = null;
    state.count = 0;
    return state.side;
  }
  if (raw === state.candidate) {
    state.count += 1;
    if (state.count >= WEIGHT_DEBOUNCE_FRAMES) {
      state.side = raw;
      state.candidate = null;
      state.count = 0;
    }
  } else {
    state.candidate = raw;
    state.count = 1;
  }
  return state.side;
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
  const lambdaMin = Math.max(0, trace - lambdaMax);
  // Confidence gates (both in variance terms, hence the squares):
  // the cloud must show real travel along the axis, and be clearly
  // elongated rather than an isotropic blob — otherwise the "axis"
  // is just the noise direction and we'd rather draw nothing.
  if (lambdaMax / points.length < SLOT_MIN_SPREAD_SQ) return null;
  if (lambdaMax < SLOT_MIN_ELONGATION * SLOT_MIN_ELONGATION * lambdaMin) {
    return null;
  }
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
  const hipMidY = (hL.y + hR.y) / 2;
  // Weight ratio: 0 = full left, 1 = full right. We project the hip
  // midpoint horizontally and ask how far across the stance it sits.
  // The x-span can run either direction when the dancer is filmed
  // from behind (mirrored), so work off abs + the leftmost ankle.
  const span = Math.abs(aR.x - aL.x);
  // Stance-width gate: dividing by a near-zero span (feet together,
  // as at the anchor) turns sub-pixel hip jitter into full-scale
  // ratio swings. Scale the floor to the dancer's vertical
  // hip-to-ankle drop — robust to camera distance since dancers are
  // upright — with a small absolute floor for degenerate poses.
  const legDrop = Math.abs((aL.y + aR.y) / 2 - hipMidY);
  let rawWeightSide: "left" | "right" | null = null;
  if (span > Math.max(0.015, legDrop * MIN_STANCE_RATIO)) {
    const leftX = Math.min(aL.x, aR.x);
    const weightRatio = (hipMidX - leftX) / span;
    // 35/65 is a deliberately wide deadband. WCS anchors hover near
    // 50/50 with one foot just slightly more loaded; calling weight
    // sides too eagerly turns the indicator into strobe.
    if (weightRatio < 0.35) {
      rawWeightSide = aL.x < aR.x ? "left" : "right";
    } else if (weightRatio > 0.65) {
      rawWeightSide = aL.x < aR.x ? "right" : "left";
    }
  }

  // Extend the plumb a hair above the head + below the lower of the
  // two ankles so the line clearly "passes through" the body.
  const topY = Math.max(0, head.y - 0.04);
  const bottomY = Math.min(1, Math.max(aL.y, aR.y) + 0.04);
  return { rawWeightSide, ankleLX: aL.x, ankleRX: aR.x, topY, bottomY };
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
    // Identity tracking + temporal state, indexed by display slot
    // (slot = color). See assignToSlots for why the raw result
    // order can't be trusted.
    const slotCentroidsRef = useRef<Array<{ x: number; y: number } | null>>([
      null,
      null,
    ]);
    const smoothedRef = useRef<Array<Landmark[] | null>>([null, null]);
    const weightStateRef = useRef<WeightState[]>([
      { side: null, candidate: null, count: 0 },
      { side: null, candidate: null, count: 0 },
    ]);
    // EMA'd plumb-line x per slot so the line glides between anchor
    // points instead of snapping a foot-width sideways the moment
    // the debounced weight side flips.
    const plumbXRef = useRef<Array<number | null>>([null, null]);
    // Previous frame's foot midpoints — camera-cut detector for the
    // slot buffer.
    const prevMidsRef = useRef<{
      ax: number;
      ay: number;
      bx: number;
      by: number;
    } | null>(null);
    // Whether a connection line rendered last frame (hysteresis).
    const connectedRef = useRef(false);

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
        // Stable identity: match this frame's poses to display slots
        // by centroid proximity, then smooth each slot's landmarks.
        // Everything below draws from `people` (indexed by slot).
        const ordered = assignToSlots(
          result.landmarks,
          slotCentroidsRef.current
        );
        const people: Array<Landmark[] | null> = [null, null];
        ordered.forEach((rawPerson, slotIdx) => {
          if (!rawPerson) return;
          const person = smoothLandmarks(
            smoothedRef.current[slotIdx],
            rawPerson
          );
          smoothedRef.current[slotIdx] = person;
          people[slotIdx] = person;
        });
        people.forEach((person, slotIdx) => {
          if (!person) return;
          const color = POSE_COLORS[slotIdx % POSE_COLORS.length];
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
            // Debounce the side call across frames, then glide the
            // plumb anchor toward its target instead of snapping —
            // the line is a stacking *reference*, and a reference
            // that jumps a foot-width sideways reads as body motion.
            const side = debounceWeightSide(
              weightStateRef.current[slotIdx],
              metrics.rawWeightSide
            );
            const targetPlumbX =
              side === "left"
                ? metrics.ankleLX
                : side === "right"
                ? metrics.ankleRX
                : (metrics.ankleLX + metrics.ankleRX) / 2;
            const prevPlumb = plumbXRef.current[slotIdx];
            const plumbX =
              prevPlumb == null
                ? targetPlumbX
                : prevPlumb + (targetPlumbX - prevPlumb) * 0.35;
            plumbXRef.current[slotIdx] = plumbX;

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
            ctx.moveTo(plumbX * w, metrics.topY * h);
            ctx.lineTo(plumbX * w, metrics.bottomY * h);
            ctx.stroke();
            ctx.restore();

            // Loaded-foot highlight — only when the debounced side
            // is confident. `side` names the labeled ankle landmark
            // (computeMetrics already resolved mirroring for
            // behind-camera shots). A filled ring + brighter inner
            // dot reads as "this foot has weight" without text.
            if (side) {
              const loaded =
                side === "left" ? person[LM_ANKLE_L] : person[LM_ANKLE_R];
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
          } else {
            plumbXRef.current[slotIdx] = null;
          }
        });

        // ─── Partnership-level overlays (PR 3c) ───
        // Connection line + slot axis. Only when both display slots
        // have a dancer this frame; a solo clip just gets the
        // skeletons + per-person metrics already drawn above.
        const pA = people[0];
        const pB = people[1];
        if (pA && pB) {
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
          // No per-frame fallback while the buffer warms up: the
          // line through the two dancers' CURRENT foot midpoints is
          // the inter-dancer axis, which during a whip (side by
          // side) sits roughly perpendicular to the actual slot.
          // Drawing nothing for a few frames beats drawing a
          // confidently wrong axis.
          const mids = footMidpoints(pA, pB);
          if (mids) {
            // Camera-cut detector: if either midpoint teleported
            // since last frame, the framing changed — flush the
            // buffer rather than fitting two framings together.
            const prev = prevMidsRef.current;
            if (prev) {
              const jump = Math.max(
                Math.hypot(mids.ax - prev.ax, mids.ay - prev.ay),
                Math.hypot(mids.bx - prev.bx, mids.by - prev.by)
              );
              if (jump > SLOT_JUMP_FLUSH) slotSamplesRef.current = [];
            }
            prevMidsRef.current = mids;
            const buf = slotSamplesRef.current;
            buf.push({ x: mids.ax, y: mids.ay });
            buf.push({ x: mids.bx, y: mids.by });
            while (buf.length > SLOT_BUFFER_MAX) buf.shift();
          }

          const slotFit = fitLinePCA(slotSamplesRef.current);
          if (slotFit) {
            ctx.save();
            ctx.strokeStyle = SLOT_COLOR;
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = Math.max(1, Math.min(w, h) / 350);
            ctx.setLineDash([10, 6]);
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
            ctx.restore();
          }

          // Connection lines — drawn solid because connection IS the
          // signal (the slot is geometry; the connection is the
          // dance). Up to two lines so closed / two-hand holds read
          // as what they are. Hysteresis: once connected, the
          // distance threshold widens 40% so the line doesn't
          // flicker right at the boundary during extension.
          const conns = findConnections(
            pA,
            pB,
            connectedRef.current ? 1.4 : 1
          );
          connectedRef.current = conns.length > 0;
          for (const conn of conns) {
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
        } else {
          connectedRef.current = false;
          prevMidsRef.current = null;
        }
      };

      // All temporal state (smoothed pose, weight debounce, plumb
      // EMA, camera-cut tracker) belongs to a contiguous stretch of
      // the dance — a seek invalidates it wholesale.
      const resetTransient = () => {
        slotCentroidsRef.current = [null, null];
        smoothedRef.current = [null, null];
        weightStateRef.current = [
          { side: null, candidate: null, count: 0 },
          { side: null, candidate: null, count: 0 },
        ];
        plumbXRef.current = [null, null];
        prevMidsRef.current = null;
        connectedRef.current = false;
      };

      const processFrame = (mediaTime: number) => {
        const landmarker = landmarkerRef.current;
        if (!landmarker || video.readyState < 2) return;
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
        if (mediaTime === lastVideoTimeRef.current) return;
        if (Math.abs(mediaTime - lastVideoTimeRef.current) > 0.4) {
          resetTransient();
        }
        lastVideoTimeRef.current = mediaTime;
        // MediaPipe VIDEO mode requires monotonically increasing
        // timestamps — performance.now(), not mediaTime, which runs
        // backwards on a rewind.
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
      };

      // Drive detection off requestVideoFrameCallback where the
      // browser supports it: it fires when a new frame is actually
      // *presented* — including the repaint after a paused seek — so
      // the skeleton always belongs to the pixels on screen. The
      // old rAF gate compared video.currentTime, which updates
      // synchronously on seek while the new frame decodes async, so
      // detection ran on the PRE-seek pixels and then marked the
      // frame as done: every scrub left a stale skeleton.
      type VideoWithRVFC = HTMLVideoElement & {
        requestVideoFrameCallback?: (
          cb: (now: number, meta: { mediaTime: number }) => void
        ) => number;
        cancelVideoFrameCallback?: (id: number) => void;
      };
      const v = video as VideoWithRVFC;
      let vfcId: number | null = null;
      let cancelled = false;

      if (typeof v.requestVideoFrameCallback === "function") {
        const onFrame = (_now: number, meta: { mediaTime: number }) => {
          if (cancelled) return;
          processFrame(meta.mediaTime);
          vfcId = v.requestVideoFrameCallback!(onFrame);
        };
        vfcId = v.requestVideoFrameCallback(onFrame);
        // rVFC only fires on NEW frames — enabling the overlay on an
        // already-paused frame would draw nothing until the next
        // play/seek. Detect the current frame once to cover that.
        processFrame(video.currentTime);
      } else {
        // rAF fallback (pre-rVFC Firefox). Skipping while
        // video.seeking is the stale-frame fix here: currentTime
        // moves the instant a seek starts, but the frame isn't
        // decoded until `seeked` — detecting in between reads the
        // old pixels.
        const tick = () => {
          if (cancelled) return;
          if (!video.seeking) processFrame(video.currentTime);
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }
      return () => {
        cancelled = true;
        if (vfcId != null) v.cancelVideoFrameCallback?.(vfcId);
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
      // playing dependency forces a fresh cycle when the user hits
      // play/pause — re-binding clears any pending frame so we don't
      // double-schedule when React strict-mode re-runs effects.
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
      slotCentroidsRef.current = [null, null];
      smoothedRef.current = [null, null];
      weightStateRef.current = [
        { side: null, candidate: null, count: 0 },
        { side: null, candidate: null, count: 0 },
      ];
      plumbXRef.current = [null, null];
      prevMidsRef.current = null;
      connectedRef.current = false;
      // Force a fresh detect on re-enable even if the video hasn't
      // moved — the canvas was cleared, so the last frame's dedupe
      // marker no longer reflects what's on screen.
      lastVideoTimeRef.current = -1;
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
