"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { eraseBlobAt } from "@/lib/mask";
import { StickerItem } from "@/lib/types";
import { Button } from "./ui";

type Tool = "blob" | "erase" | "restore";

/** Alpha snapshots only -- the colour channels never change, and on a phone a
 *  stack of full RGBA frames is the difference between working and not. */
const MAX_HISTORY = 12;

/** Visual size of one checkerboard square, held constant as you zoom. */
const CHECKER_PX = 14;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 24;

interface View {
  scale: number;
  tx: number;
  ty: number;
}

/** Keep the image from being dragged off into empty space. */
function clampView(view: View, vw: number, vh: number, iw: number, ih: number): View {
  const w = iw * view.scale;
  const h = ih * view.scale;
  // Smaller than the viewport? Centre it. Larger? Don't let an edge come inside.
  const tx = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, view.tx));
  const ty = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, view.ty));
  return { scale: view.scale, tx, ty };
}

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
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const alphaRef = useRef<Uint8Array>(new Uint8Array(0));
  const rgbRef = useRef<Uint8ClampedArray | null>(null);
  const frameRef = useRef<ImageData | null>(null);
  const historyRef = useRef<Uint8Array[]>([]);
  const strokingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{ distance: number; view: View; imageMid: { x: number; y: number } } | null>(
    null,
  );
  const panRef = useRef<{ x: number; y: number } | null>(null);
  /** A blob tap waiting to be confirmed on pointerup rather than fired on contact. */
  const pendingTapRef = useRef<{
    image: { x: number; y: number };
    viewport: { x: number; y: number };
  } | null>(null);
  const viewRef = useRef<View>({ scale: 1, tx: 0, ty: 0 });

  const [tool, setTool] = useState<Tool>("blob");
  const [brush, setBrush] = useState(28);
  const [panMode, setPanMode] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [sourceReady, setSourceReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const { width, height } = cutout;
  viewRef.current = view;

  const applyView = useCallback(
    (next: View) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      setView(clampView(next, viewport.clientWidth, viewport.clientHeight, width, height));
    },
    [width, height],
  );

  const fitView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (vw === 0 || vh === 0) return;
    // A little breathing room so the edge of the sticker isn't flush to the frame.
    const scale = Math.min(vw / width, vh / height) * 0.92;
    setView(clampView({ scale, tx: 0, ty: 0 }, vw, vh, width, height));
  }, [width, height]);

  /** Zoom about a point in viewport coordinates, so it stays put on screen. */
  const zoomAt = useCallback(
    (viewportX: number, viewportY: number, factor: number) => {
      const current = viewRef.current;
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale * factor));
      const imageX = (viewportX - current.tx) / current.scale;
      const imageY = (viewportY - current.ty) / current.scale;
      applyView({ scale, tx: viewportX - imageX * scale, ty: viewportY - imageY * scale });
    },
    [applyView],
  );

  const zoomCentre = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor);
    },
    [zoomAt],
  );

  /** Rebuild the whole visible frame from rgb + alpha. */
  const composeAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!frameRef.current) frameRef.current = ctx.createImageData(width, height);
    const frame = frameRef.current;
    const rgb = rgbRef.current;
    const alpha = alphaRef.current;
    for (let i = 0; i < alpha.length; i++) {
      const p = i * 4;
      const src = rgb ?? cutout.data;
      frame.data[p] = src[p];
      frame.data[p + 1] = src[p + 1];
      frame.data[p + 2] = src[p + 2];
      // "Show what was cut" fades the discarded pixels back in, so it is
      // obvious what the model dropped and where to paint.
      frame.data[p + 3] = showOriginal && rgb ? Math.max(alpha[i], 70) : alpha[i];
    }
    ctx.putImageData(frame, 0, 0);
  }, [cutout, width, height, showOriginal]);

  /**
   * Repaint just the rectangle a brush stamp touched. Recomposing the whole
   * image on every pointermove is what makes a big sticker feel sticky.
   */
  const composeRegion = useCallback(
    (minX: number, minY: number, maxX: number, maxY: number) => {
      const canvas = canvasRef.current;
      const frame = frameRef.current;
      if (!canvas || !frame) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const x0 = Math.max(0, Math.floor(minX));
      const y0 = Math.max(0, Math.floor(minY));
      const x1 = Math.min(width - 1, Math.ceil(maxX));
      const y1 = Math.min(height - 1, Math.ceil(maxY));
      if (x1 < x0 || y1 < y0) return;
      const rgb = rgbRef.current;
      const alpha = alphaRef.current;
      const src = rgb ?? cutout.data;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * width + x;
          const p = i * 4;
          frame.data[p] = src[p];
          frame.data[p + 1] = src[p + 1];
          frame.data[p + 2] = src[p + 2];
          frame.data[p + 3] = showOriginal && rgb ? Math.max(alpha[i], 70) : alpha[i];
        }
      }
      ctx.putImageData(frame, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    },
    [cutout, width, height, showOriginal],
  );

  useEffect(() => {
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = cutout.data[i * 4 + 3];
    alphaRef.current = alpha;
    frameRef.current = null;
    historyRef.current = [];
    setCanUndo(false);
    composeAll();
    let cancelled = false;
    loadSource().then((source) => {
      if (cancelled || !source) return;
      rgbRef.current = source.data;
      setSourceReady(true);
      composeAll();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutout]);

  useEffect(() => composeAll(), [composeAll]);
  useLayoutEffect(() => fitView(), [fitView]);

  // Keep the view sane when the surface changes size (rotation, split view).
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => applyView(viewRef.current));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [applyView]);

  // Wheel must be non-passive to stop the page scrolling behind the editor.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const pushHistory = useCallback(() => {
    historyRef.current.push(new Uint8Array(alphaRef.current));
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    setCanUndo(true);
  }, []);

  /** Undo the in-progress stroke, without it counting as an undo step. */
  const rollbackStroke = useCallback(() => {
    const snapshot = historyRef.current.pop();
    if (!snapshot) return;
    alphaRef.current = snapshot;
    setCanUndo(historyRef.current.length > 0);
    composeAll();
  }, [composeAll]);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    alphaRef.current = previous;
    setCanUndo(historyRef.current.length > 0);
    composeAll();
  }, [composeAll]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
      if (event.key === "+" || event.key === "=") zoomCentre(1.25);
      if (event.key === "-") zoomCentre(0.8);
      if (event.key === "0") fitView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, undo, zoomCentre, fitView]);

  const toViewport = (event: React.PointerEvent) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const toImage = (event: React.PointerEvent) => {
    const { x, y } = toViewport(event);
    const current = viewRef.current;
    return { x: (x - current.tx) / current.scale, y: (y - current.ty) / current.scale };
  };

  /** Paint one brush dab; returns the rectangle it touched. */
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
      return { minX, minY, maxX, maxY };
    },
    [brush, tool, width, height],
  );

  const endGesture = () => {
    strokingRef.current = false;
    lastPointRef.current = null;
    panRef.current = null;
    gestureRef.current = null;
    pendingTapRef.current = null;
  };

  const onPointerDown = (event: React.PointerEvent) => {
    (event.target as Element).setPointerCapture(event.pointerId);
    const viewportPoint = toViewport(event);
    pointersRef.current.set(event.pointerId, viewportPoint);

    if (pointersRef.current.size === 2) {
      // A second finger means this was always a pinch, so undo whatever the
      // first finger started: a stroke gets rolled back, and a pending blob tap
      // is dropped. Beginning a zoom must never cost you the sticker.
      if (strokingRef.current) rollbackStroke();
      strokingRef.current = false;
      lastPointRef.current = null;
      panRef.current = null;
      pendingTapRef.current = null;
      const [a, b] = [...pointersRef.current.values()];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const current = viewRef.current;
      gestureRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        view: current,
        imageMid: { x: (midX - current.tx) / current.scale, y: (midY - current.ty) / current.scale },
      };
      return;
    }
    if (pointersRef.current.size > 2) return;

    if (panMode) {
      panRef.current = viewportPoint;
      return;
    }

    const { x, y } = toImage(event);
    if (tool === "blob") {
      // Hold the tap until release: on contact we cannot yet tell a tap from
      // the first half of a pinch, or from a drag meant to pan.
      pendingTapRef.current = { image: { x, y }, viewport: viewportPoint };
      panRef.current = viewportPoint;
      return;
    }
    if (tool === "restore" && !rgbRef.current) {
      setHint("Still loading the original photo…");
      return;
    }
    pushHistory();
    strokingRef.current = true;
    lastPointRef.current = { x, y };
    const region = stamp(x, y);
    composeRegion(region.minX, region.minY, region.maxX, region.maxY);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const viewportPoint = toViewport(event);
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, viewportPoint);
    setCursor(viewportPoint);

    const gesture = gestureRef.current;
    if (gesture && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const scale = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, gesture.view.scale * (distance / gesture.distance)),
      );
      applyView({ scale, tx: midX - gesture.imageMid.x * scale, ty: midY - gesture.imageMid.y * scale });
      return;
    }

    const pending = pendingTapRef.current;
    if (
      pending &&
      Math.hypot(viewportPoint.x - pending.viewport.x, viewportPoint.y - pending.viewport.y) > 6
    ) {
      pendingTapRef.current = null;
    }

    if (panRef.current) {
      const current = viewRef.current;
      applyView({
        scale: current.scale,
        tx: current.tx + (viewportPoint.x - panRef.current.x),
        ty: current.ty + (viewportPoint.y - panRef.current.y),
      });
      panRef.current = viewportPoint;
      return;
    }

    if (!strokingRef.current) return;
    const { x, y } = toImage(event);
    const last = lastPointRef.current;
    let minX = x;
    let minY = y;
    let maxX = x;
    let maxY = y;
    // Interpolate, or a quick swipe leaves a dotted line.
    if (last) {
      const steps = Math.max(1, Math.ceil(Math.hypot(x - last.x, y - last.y) / (brush / 4)));
      for (let i = 1; i <= steps; i++) {
        const region = stamp(last.x + ((x - last.x) * i) / steps, last.y + ((y - last.y) * i) / steps);
        minX = Math.min(minX, region.minX);
        minY = Math.min(minY, region.minY);
        maxX = Math.max(maxX, region.maxX);
        maxY = Math.max(maxY, region.maxY);
      }
    } else {
      const region = stamp(x, y);
      minX = region.minX;
      minY = region.minY;
      maxX = region.maxX;
      maxY = region.maxY;
    }
    lastPointRef.current = { x, y };
    composeRegion(minX, minY, maxX, maxY);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const wasSingleTouch = pointersRef.current.size === 1;
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;

    const pending = pendingTapRef.current;
    if (pending && wasSingleTouch) {
      pushHistory();
      const cleared = eraseBlobAt(alphaRef.current, width, height, pending.image.x, pending.image.y);
      if (cleared === 0) {
        historyRef.current.pop();
        setCanUndo(historyRef.current.length > 0);
        setHint("Nothing there — tap directly on the bit you want gone.");
      } else {
        setHint(null);
      }
      composeAll();
    }
    pendingTapRef.current = null;

    if (pointersRef.current.size === 0) endGesture();
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
    { id: "blob", label: "Zap blob", icon: "✨", hint: "Tap a leftover lump to delete it. Drag to pan." },
    { id: "erase", label: "Erase", icon: "🧽", hint: "Brush away anything that shouldn't be there." },
    { id: "restore", label: "Bring back", icon: "🖌️", hint: "Paint back a bit the cut-out missed." },
  ];
  const active = tools.find((entry) => entry.id === tool)!;
  const showBrushRing = !panMode && tool !== "blob" && cursor !== null;

  return (
    <div className="fixed inset-0 z-50 flex bg-ink/60 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-paper sm:h-[92vh] sm:max-w-5xl sm:rounded-[1.75rem] sm:border-2 sm:border-line">
        <div className="flex shrink-0 items-center gap-2 border-b-2 border-line px-4 py-2.5">
          <h2 className="font-display text-base font-extrabold text-ink sm:text-lg">Polish this sticker</h2>
          <span className="hidden truncate text-[11px] font-semibold text-ink-soft sm:block">
            {item.fileName}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="ml-auto h-8 w-8 shrink-0 rounded-full bg-cream font-display font-bold text-ink"
          >
            ×
          </button>
        </div>

        <div
          ref={viewportRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          className="relative min-h-0 flex-1 touch-none overflow-hidden bg-cream-deep"
          style={{ cursor: panMode ? "grab" : tool === "blob" ? "pointer" : "none" }}
        >
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="absolute left-0 top-0 origin-top-left shadow-[0_0_0_1px_rgba(74,59,51,0.25)]"
            style={{
              width,
              height,
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              imageRendering: view.scale >= 3 ? "pixelated" : "auto",
              // The checkerboard rides along with the canvas but is drawn at a
              // size that cancels the zoom, so squares look the same throughout.
              backgroundImage: "repeating-conic-gradient(#e8dccd 0% 25%, #ffffff 0% 50%)",
              backgroundSize: `${(CHECKER_PX * 2) / view.scale}px ${(CHECKER_PX * 2) / view.scale}px`,
            }}
          />

          {showBrushRing ? (
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-full border-2 border-ink/70 mix-blend-difference"
              style={{
                width: brush * view.scale,
                height: brush * view.scale,
                left: cursor!.x - (brush * view.scale) / 2,
                top: cursor!.y - (brush * view.scale) / 2,
              }}
            />
          ) : null}

          {/* These float over the editing surface, so their pointer events must
              not reach it -- otherwise tapping "zoom in" also edits whatever
              happens to be underneath the button. */}
          <div
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            className="absolute right-2 top-2 flex items-center gap-1 rounded-full border-2 border-line bg-paper/90 px-1 py-1 shadow backdrop-blur"
          >
            <button
              type="button"
              onClick={() => setPanMode((value) => !value)}
              aria-pressed={panMode}
              aria-label="Pan"
              title="Pan (or drag with two fingers)"
              className={`h-7 w-7 rounded-full font-display text-xs font-bold ${
                panMode ? "bg-mint text-[#0f4d38]" : "text-ink-soft"
              }`}
            >
              ✋
            </button>
            <button
              type="button"
              onClick={() => zoomCentre(0.8)}
              aria-label="Zoom out"
              className="h-7 w-7 rounded-full font-display text-sm font-bold text-ink"
            >
              −
            </button>
            <span className="min-w-10 text-center font-display text-[11px] font-bold text-ink-soft">
              {Math.round(view.scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomCentre(1.25)}
              aria-label="Zoom in"
              className="h-7 w-7 rounded-full font-display text-sm font-bold text-ink"
            >
              +
            </button>
            <button
              type="button"
              onClick={fitView}
              aria-label="Fit to screen"
              className="rounded-full px-2 font-display text-[11px] font-bold text-ink-soft"
            >
              fit
            </button>
          </div>

          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] font-semibold text-ink-soft">
            {hint ?? active.hint}
          </p>
        </div>

        <div className="shrink-0 space-y-2 border-t-2 border-line px-4 py-3">
          <div className="flex gap-1 rounded-full border-2 border-line bg-cream p-1">
            {tools.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setTool(entry.id);
                  setPanMode(false);
                  setHint(null);
                }}
                disabled={entry.id === "restore" && !sourceReady}
                className={`flex-1 rounded-full px-2 py-1.5 font-display text-xs font-bold transition-all disabled:opacity-40 ${
                  tool === entry.id && !panMode
                    ? "bg-paper text-ink shadow-[0_2px_0_var(--color-line)]"
                    : "text-ink-soft"
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
                min={4}
                max={200}
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
        </div>
      </div>
    </div>
  );
}
