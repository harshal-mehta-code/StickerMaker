"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { eraseBlobAt } from "@/lib/mask";
import { StickerItem } from "@/lib/types";
import { Button } from "./ui";

type Tool = "blob" | "erase" | "restore";

/** Alpha snapshots only -- the colour channels never change, and on a phone a
 *  stack of full RGBA frames is the difference between working and not. */
const MAX_HISTORY = 12;

export function StickerEditor({
  item,
  cutout,
  loadSource,
  onApply,
  onClose,
}: {
  item: StickerItem;
  cutout: ImageData;
  loadSource: () => Promise<ImageData | null>;
  onApply: (edited: ImageData) => Promise<void> | void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const alphaRef = useRef<Uint8Array>(new Uint8Array(0));
  const rgbRef = useRef<Uint8ClampedArray | null>(null);
  const historyRef = useRef<Uint8Array[]>([]);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const [tool, setTool] = useState<Tool>("blob");
  const [brush, setBrush] = useState(28);
  const [showOriginal, setShowOriginal] = useState(false);
  const [sourceReady, setSourceReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const { width, height } = cutout;

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const frame = ctx.createImageData(width, height);
    const rgb = rgbRef.current;
    const alpha = alphaRef.current;
    for (let i = 0; i < alpha.length; i++) {
      const p = i * 4;
      if (rgb) {
        frame.data[p] = rgb[p];
        frame.data[p + 1] = rgb[p + 1];
        frame.data[p + 2] = rgb[p + 2];
      } else {
        frame.data[p] = cutout.data[p];
        frame.data[p + 1] = cutout.data[p + 1];
        frame.data[p + 2] = cutout.data[p + 2];
      }
      // "Show original" fades the discarded pixels back in, so it is obvious
      // what the model dropped and where to paint.
      frame.data[p + 3] = showOriginal && rgb ? Math.max(alpha[i], 70) : alpha[i];
    }
    ctx.putImageData(frame, 0, 0);
  }, [cutout, width, height, showOriginal]);

  useEffect(() => {
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = cutout.data[i * 4 + 3];
    alphaRef.current = alpha;
    historyRef.current = [];
    setCanUndo(false);
    paint();
    let cancelled = false;
    loadSource().then((source) => {
      if (cancelled || !source) return;
      rgbRef.current = source.data;
      setSourceReady(true);
      paint();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutout]);

  useEffect(() => paint(), [paint]);

  const pushHistory = useCallback(() => {
    historyRef.current.push(new Uint8Array(alphaRef.current));
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    alphaRef.current = previous;
    setCanUndo(historyRef.current.length > 0);
    paint();
  }, [paint]);

  /** Pointer position in image pixels. */
  const toImage = (event: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  };

  const stamp = useCallback(
    (x: number, y: number) => {
      const alpha = alphaRef.current;
      const rgb = rgbRef.current;
      const radius = brush / 2;
      const inner = radius * 0.75;
      const minX = Math.max(0, Math.floor(x - radius));
      const maxX = Math.min(width - 1, Math.ceil(x + radius));
      const minY = Math.max(0, Math.floor(y - radius));
      const maxY = Math.min(height - 1, Math.ceil(y + radius));
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const distance = Math.hypot(px - x, py - y);
          if (distance > radius) continue;
          // Mostly hard-edged, with a little feather so strokes blend.
          const strength = distance <= inner ? 1 : 1 - (distance - inner) / (radius - inner);
          const i = py * width + px;
          if (tool === "erase") {
            alpha[i] = Math.round(alpha[i] * (1 - strength));
          } else if (rgb) {
            alpha[i] = Math.max(alpha[i], Math.round(255 * strength));
          }
        }
      }
    },
    [brush, tool, width, height],
  );

  const onPointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    const { x, y } = toImage(event);
    if (tool === "blob") {
      pushHistory();
      const cleared = eraseBlobAt(alphaRef.current, width, height, x, y);
      if (cleared === 0) {
        historyRef.current.pop();
        setCanUndo(historyRef.current.length > 0);
        setHint("Nothing there — tap directly on the bit you want gone.");
      } else {
        setHint(null);
      }
      paint();
      return;
    }
    if (tool === "restore" && !rgbRef.current) {
      setHint("Still loading the original photo…");
      return;
    }
    pushHistory();
    drawingRef.current = true;
    lastPointRef.current = { x, y };
    (event.target as Element).setPointerCapture(event.pointerId);
    stamp(x, y);
    paint();
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const { x, y } = toImage(event);
    const last = lastPointRef.current;
    // Interpolate, or a quick swipe leaves a dotted line.
    if (last) {
      const steps = Math.ceil(Math.hypot(x - last.x, y - last.y) / (brush / 4));
      for (let i = 1; i <= steps; i++) {
        stamp(last.x + ((x - last.x) * i) / steps, last.y + ((y - last.y) * i) / steps);
      }
    } else {
      stamp(x, y);
    }
    lastPointRef.current = { x, y };
    paint();
  };

  const endStroke = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const apply = async () => {
    setBusy(true);
    try {
      const rgb = rgbRef.current;
      const edited = new ImageData(new Uint8ClampedArray(cutout.data), width, height);
      const alpha = alphaRef.current;
      for (let i = 0; i < alpha.length; i++) {
        const p = i * 4;
        if (rgb) {
          edited.data[p] = rgb[p];
          edited.data[p + 1] = rgb[p + 1];
          edited.data[p + 2] = rgb[p + 2];
        }
        edited.data[p + 3] = alpha[i];
      }
      await onApply(edited);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const tools: { id: Tool; label: string; icon: string; hint: string }[] = [
    { id: "blob", label: "Zap blob", icon: "✨", hint: "Tap any leftover lump to delete the whole thing." },
    { id: "erase", label: "Erase", icon: "🧽", hint: "Brush away anything that shouldn't be there." },
    { id: "restore", label: "Bring back", icon: "🖌️", hint: "Paint back a bit the cut-out missed." },
  ];
  const active = tools.find((entry) => entry.id === tool)!;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[95vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.75rem] border-2 border-line bg-paper sm:rounded-[1.75rem]">
        <div className="flex items-center gap-2 border-b-2 border-line px-4 py-3">
          <h2 className="font-display text-lg font-extrabold text-ink">Polish this sticker</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="ml-auto h-8 w-8 rounded-full bg-cream font-display font-bold text-ink"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="checkerboard mx-auto w-fit overflow-hidden rounded-2xl border-2 border-line">
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              className="block max-h-[46vh] w-auto max-w-full touch-none"
              style={{ cursor: tool === "blob" ? "pointer" : "crosshair" }}
            />
          </div>
          <p className="mt-2 text-center text-[11px] font-semibold text-ink-soft">{hint ?? active.hint}</p>
        </div>

        <div className="space-y-3 border-t-2 border-line px-4 py-3">
          <div className="flex gap-1 rounded-full border-2 border-line bg-cream p-1">
            {tools.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setTool(entry.id);
                  setHint(null);
                }}
                disabled={entry.id === "restore" && !sourceReady}
                className={`flex-1 rounded-full px-2 py-1.5 font-display text-xs font-bold transition-all disabled:opacity-40 ${
                  tool === entry.id ? "bg-paper text-ink shadow-[0_2px_0_var(--color-line)]" : "text-ink-soft"
                }`}
              >
                {entry.icon} {entry.label}
              </button>
            ))}
          </div>

          {tool !== "blob" ? (
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-xs font-bold text-ink-soft">
                Brush size
                <span className="rounded-full bg-cream px-2 py-0.5 font-display text-[11px] text-ink">
                  {brush}px
                </span>
              </span>
              <input
                type="range"
                min={6}
                max={140}
                step={2}
                value={brush}
                onChange={(event) => setBrush(Number(event.target.value))}
              />
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={undo} disabled={!canUndo}>
              ↩ undo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowOriginal((value) => !value)}
              disabled={!sourceReady}
            >
              {showOriginal ? "hide" : "show"} what was cut
            </Button>
            <Button className="ml-auto" onClick={apply} disabled={busy}>
              {busy ? "Saving…" : "Save sticker"}
            </Button>
          </div>
          <p className="text-[10px] font-semibold text-ink-soft">
            {item.fileName} · {width}×{height}
            {sourceReady ? "" : " · loading original…"}
          </p>
        </div>
      </div>
    </div>
  );
}
