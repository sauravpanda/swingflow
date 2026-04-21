"use client";

// Shareable result card (#111) — renders a 1080x1080 card to a
// canvas so the user can download / copy to clipboard / share a
// branded "I scored 7.4 on SwingFlow" image for IG, Discord, X.
//
// Intentionally client-side. The repo deploys as a Next static
// export (output: "export"), so a @vercel/og runtime route — which
// the issue originally suggested — isn't an option. Canvas rendering
// in the browser covers the same ground for this deployment model.

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Copy, Share2, Loader2, Check } from "lucide-react";
import type { VideoScoreResult } from "@/lib/wcs-api";

type ShareCardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: VideoScoreResult;
  role: string | null;
  competitionLevel: string | null;
  shareUrl: string | null;
};

const CARD_SIZE = 1080;

// Map a grade letter to a tint so A+ reads differently from a C.
function gradeTint(grade: string | undefined): string {
  if (!grade) return "#60a5fa"; // blue-400
  const letter = grade.trim().toUpperCase()[0];
  switch (letter) {
    case "A":
      return "#34d399"; // emerald-400
    case "B":
      return "#60a5fa"; // blue-400
    case "C":
      return "#fbbf24"; // amber-400
    case "D":
      return "#fb7185"; // rose-400
    case "F":
      return "#ef4444"; // red-500
    default:
      return "#60a5fa";
  }
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  opts: {
    score: number | null;
    grade: string | null;
    role: string | null;
    level: string | null;
    bpm: number | null;
    style: string | null;
    url: string | null;
  }
) {
  const W = CARD_SIZE;
  const H = CARD_SIZE;

  // ─── Background: subtle vertical gradient, brand-adjacent ───
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b0e14");
  bg.addColorStop(1, "#131829");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Inner border for a clean card edge when previewed on a white
  // background (IG feed, Discord light mode).
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, W - 40, H - 40);

  const tint = gradeTint(opts.grade ?? undefined);

  // ─── Wordmark (top-left) ───
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 42px 'Inter', system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("SwingFlow", 80, 90);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "400 24px 'Inter', system-ui, -apple-system, sans-serif";
  ctx.fillText("WSDC-style scoring", 80, 142);

  // ─── Centered score (the hero) ───
  const centerY = 540;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  if (opts.score != null) {
    ctx.fillStyle = tint;
    ctx.font = "700 320px 'Inter', system-ui, -apple-system, sans-serif";
    ctx.fillText(opts.score.toFixed(1), W / 2, centerY);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "700 220px 'Inter', system-ui, -apple-system, sans-serif";
    ctx.fillText("—", W / 2, centerY);
  }

  // "out of 10" label above the score
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "500 28px 'Inter', system-ui, -apple-system, sans-serif";
  ctx.fillText("OUT OF 10", W / 2, centerY - 320);

  // Grade pill below the score
  if (opts.grade) {
    const pillY = centerY + 70;
    const text = opts.grade.toUpperCase();
    ctx.font = "700 60px 'Inter', system-ui, -apple-system, sans-serif";
    const metrics = ctx.measureText(text);
    const padX = 40;
    const pillW = metrics.width + padX * 2;
    const pillH = 100;
    const pillX = W / 2 - pillW / 2;

    // Rounded rect. 2d context doesn't have roundRect everywhere
    // reliably yet; draw manually.
    const r = 50;
    ctx.beginPath();
    ctx.moveTo(pillX + r, pillY);
    ctx.lineTo(pillX + pillW - r, pillY);
    ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r);
    ctx.lineTo(pillX + pillW, pillY + pillH - r);
    ctx.quadraticCurveTo(
      pillX + pillW,
      pillY + pillH,
      pillX + pillW - r,
      pillY + pillH
    );
    ctx.lineTo(pillX + r, pillY + pillH);
    ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r);
    ctx.lineTo(pillX, pillY + r);
    ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
    ctx.closePath();
    ctx.fillStyle = `${tint}22`;
    ctx.fill();
    ctx.strokeStyle = `${tint}aa`;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = tint;
    ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, pillY + pillH / 2 + 2);
  }

  // ─── Metadata row (role · level · BPM · style) ───
  const tags: string[] = [];
  if (opts.role) tags.push(opts.role);
  if (opts.level) tags.push(opts.level);
  if (opts.bpm) tags.push(`${Math.round(opts.bpm)} BPM`);
  if (opts.style) tags.push(opts.style);

  if (tags.length > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "500 32px 'Inter', system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const joined = tags.join("  ·  ");
    ctx.fillText(joined, W / 2, 800);
  }

  // ─── Footer (URL / share link) ───
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "400 26px 'Inter', system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const footer = opts.url ?? "swingflow.app";
  // Truncate if the share URL is too long to fit a single line.
  let footerText = footer;
  while (ctx.measureText(footerText).width > W - 160) {
    footerText = footerText.slice(0, -4) + "…";
    if (footerText.length <= 10) break;
  }
  ctx.fillText(footerText, W / 2, H - 90);
}

async function writeBlobToClipboard(blob: Blob): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error(
      "Clipboard image write not supported in this browser — use Download instead."
    );
  }
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ]);
}

export function ShareCardDialog({
  open,
  onOpenChange,
  result,
  role,
  competitionLevel,
  shareUrl,
}: ShareCardDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState<null | "download" | "copy" | "share">(
    null
  );
  const [message, setMessage] = useState<string | null>(null);

  const observedLevel =
    (result as { observed_level?: string }).observed_level ?? null;
  const bpm = result.beat_grid?.bpm ?? result.estimated_bpm ?? null;
  const songStyle =
    (result as { song_style?: string }).song_style ?? null;

  // Radix Dialog mounts DialogContent inside a portal + runs an
  // enter animation. If we draw in a plain useEffect the canvas ref
  // has landed in the DOM but the portal mount + layout cycle isn't
  // guaranteed to be finished on this tick — drawing races and leaves
  // a blank buffer in some browsers. useLayoutEffect + rAF gives us a
  // frame after the browser has committed the mount, when getContext
  // is reliable. Also wait for document.fonts.ready (when available)
  // so text is drawn with the declared Inter-family stack rather than
  // whatever glyph state the browser happens to have on first paint.
  useLayoutEffect(() => {
    if (!open) return;
    let cancelled = false;

    const paint = () => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        console.error("share-card: 2d context unavailable");
        return;
      }
      canvas.width = CARD_SIZE;
      canvas.height = CARD_SIZE;
      try {
        drawCard(ctx, {
          score: result.overall?.score ?? null,
          grade: result.overall?.grade ?? null,
          role,
          level: observedLevel ?? competitionLevel,
          bpm,
          style: songStyle,
          url: shareUrl,
        });
      } catch (err) {
        // Surface, don't swallow — a blank card is worse than a logged
        // error because there's no way to diagnose it after the fact.
        console.error("share-card: drawCard failed", err);
      }
    };

    const rafId = requestAnimationFrame(() => {
      const fonts = (
        document as Document & { fonts?: { ready?: Promise<unknown> } }
      ).fonts;
      if (fonts?.ready) {
        fonts.ready.then(() => {
          if (!cancelled) paint();
        });
      } else {
        paint();
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [
    open,
    result,
    role,
    competitionLevel,
    observedLevel,
    bpm,
    songStyle,
    shareUrl,
  ]);

  const flashMessage = useCallback((msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 2500);
  }, []);

  const toBlob = useCallback(async (): Promise<Blob> => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("Canvas not mounted");
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Canvas export failed")),
        "image/png"
      );
    });
  }, []);

  const handleDownload = async () => {
    setBusy("download");
    try {
      const blob = await toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `swingflow-${(result.overall?.score ?? 0).toFixed(1)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      flashMessage("Downloaded");
    } catch (err) {
      flashMessage(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    setBusy("copy");
    try {
      const blob = await toBlob();
      await writeBlobToClipboard(blob);
      flashMessage("Copied to clipboard");
    } catch (err) {
      flashMessage(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    setBusy("share");
    try {
      const blob = await toBlob();
      const file = new File([blob], "swingflow-score.png", {
        type: "image/png",
      });
      const nav = navigator as Navigator & {
        canShare?: (d: ShareData) => boolean;
      };
      const shareData: ShareData = {
        files: [file],
        title: "SwingFlow score",
        text: `I scored ${(result.overall?.score ?? 0).toFixed(1)} on SwingFlow${shareUrl ? ` — ${shareUrl}` : ""}`,
      };
      if (nav.canShare && nav.canShare(shareData) && navigator.share) {
        await navigator.share(shareData);
        flashMessage("Shared");
      } else {
        flashMessage("Share not supported — use Download or Copy");
      }
    } catch (err) {
      // AbortError fires when the user cancels the share sheet.
      if (err instanceof Error && err.name === "AbortError") {
        // no-op
      } else {
        flashMessage(err instanceof Error ? err.message : "Share failed");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Share your score</DialogTitle>
          <DialogDescription>
            1080×1080 Instagram-ready card. Download, copy, or share
            directly on mobile.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg overflow-hidden border border-border bg-black">
          {/* Preview is scaled via CSS; the canvas buffer stays at
              1080x1080 for full quality on export. */}
          <canvas
            ref={canvasRef}
            className="w-full h-auto block"
            aria-label="SwingFlow score card preview"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={busy !== null}
          >
            {busy === "download" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-2" />
            )}
            Download
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            disabled={busy !== null}
          >
            {busy === "copy" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
            ) : (
              <Copy className="h-3.5 w-3.5 mr-2" />
            )}
            Copy
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleShare}
            disabled={busy !== null}
          >
            {busy === "share" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
            ) : (
              <Share2 className="h-3.5 w-3.5 mr-2" />
            )}
            Share
          </Button>
          {message && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1 ml-auto">
              <Check className="h-3 w-3 text-emerald-500" />
              {message}
            </span>
          )}
        </div>
        {!shareUrl && (
          <p className="text-[11px] text-muted-foreground">
            Tip: enable sharing on this analysis first so the card
            includes your public link instead of just
            &ldquo;swingflow.app&rdquo;.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
