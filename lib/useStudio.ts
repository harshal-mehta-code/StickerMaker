"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractSubject, RenderedSticker, renderSticker } from "./pipeline";
import { getSegmenter, isMockMode, SegmenterState } from "./segmenter";
import { DEFAULT_SHEET, DEFAULT_STYLE, SheetConfig, StickerItem, StickerStyle } from "./types";

let idCounter = 0;
const nextId = () => `sticker-${Date.now().toString(36)}-${++idCounter}`;

export function useStudio() {
  const [items, setItems] = useState<StickerItem[]>([]);
  const [style, setStyle] = useState<StickerStyle>(DEFAULT_STYLE);
  const [sheet, setSheet] = useState<SheetConfig>(DEFAULT_SHEET);
  const [segState, setSegState] = useState<SegmenterState>({ phase: "idle" });
  const [restyling, setRestyling] = useState(false);
  // Read on the client only, so the server and first client render agree.
  const [mockMode, setMockMode] = useState(false);

  const files = useRef(new Map<string, Blob>());
  const cutouts = useRef(new Map<string, ImageData>());
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const styleRef = useRef(style);
  const generation = useRef(0);

  const segmenter = useMemo(() => getSegmenter(), []);

  useEffect(() => {
    setMockMode(isMockMode());
    const unsubscribe = segmenter.subscribe(setSegState);
    return unsubscribe;
  }, [segmenter]);

  const patch = useCallback((id: string, changes: Partial<StickerItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length > 0) {
        const id = queue.current.shift()!;
        const file = files.current.get(id);
        if (!file) continue;
        patch(id, { status: "working", error: undefined });
        try {
          const cutout = await extractSubject(file, segmenter);
          cutouts.current.set(id, cutout);
          const rendered = await renderSticker(cutout, styleRef.current);
          patch(id, { status: "ready", error: undefined, stickerUrl: rendered.url, bitmap: rendered.bitmap });
        } catch (err) {
          patch(id, {
            status: "error",
            error: (err as Error)?.message ?? "Something went wrong",
          });
        }
      }
    } finally {
      running.current = false;
    }
  }, [patch, segmenter]);

  const addFiles = useCallback(
    (incoming: File[]) => {
      const images = incoming.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return;
      const created = images.map((file) => {
        const id = nextId();
        files.current.set(id, file);
        return {
          id,
          fileName: file.name,
          status: "queued" as const,
          sourceUrl: URL.createObjectURL(file),
          enabled: true,
          copies: 1,
        };
      });
      setItems((prev) => [...prev, ...created]);
      queue.current.push(...created.map((item) => item.id));
      void pump();
    },
    [pump],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.sourceUrl);
        if (target.stickerUrl) URL.revokeObjectURL(target.stickerUrl);
        target.bitmap?.close();
      }
      return prev.filter((item) => item.id !== id);
    });
    files.current.delete(id);
    cutouts.current.delete(id);
    queue.current = queue.current.filter((queued) => queued !== id);
  }, []);

  const clearAll = useCallback(() => {
    setItems((prev) => {
      prev.forEach((item) => {
        URL.revokeObjectURL(item.sourceUrl);
        if (item.stickerUrl) URL.revokeObjectURL(item.stickerUrl);
        item.bitmap?.close();
      });
      return [];
    });
    files.current.clear();
    cutouts.current.clear();
    queue.current = [];
  }, []);

  const retry = useCallback(
    (id: string) => {
      if (!files.current.has(id)) return;
      patch(id, { status: "queued", error: undefined });
      queue.current.push(id);
      void pump();
    },
    [patch, pump],
  );

  const toggleItem = useCallback((id: string, enabled: boolean) => patch(id, { enabled }), [patch]);
  const setCopies = useCallback(
    (id: string, copies: number) => patch(id, { copies: Math.max(1, Math.min(60, copies)) }),
    [patch],
  );

  // Restyling (border width, shadow, edge crispness) re-renders from the stored
  // cut-outs, so the model never has to run again. Results are swapped in as one
  // batch: updating per sticker would redraw the whole sheet preview each time.
  useEffect(() => {
    styleRef.current = style;
    if (cutouts.current.size === 0) return;
    const token = ++generation.current;
    const timer = setTimeout(async () => {
      setRestyling(true);
      const rendered = new Map<string, RenderedSticker>();
      const discard = () =>
        rendered.forEach((result) => {
          URL.revokeObjectURL(result.url);
          result.bitmap.close();
        });
      try {
        for (const [id, cutout] of cutouts.current) {
          if (token !== generation.current) return discard();
          rendered.set(id, await renderSticker(cutout, style));
        }
        if (token !== generation.current) return discard();
        setItems((prev) =>
          prev.map((item) => {
            const result = rendered.get(item.id);
            if (!result) return item;
            if (item.stickerUrl) URL.revokeObjectURL(item.stickerUrl);
            item.bitmap?.close();
            return { ...item, status: "ready", stickerUrl: result.url, bitmap: result.bitmap };
          }),
        );
      } finally {
        if (token === generation.current) setRestyling(false);
      }
    }, 260);
    return () => clearTimeout(timer);
  }, [style]);

  return {
    items,
    style,
    sheet,
    segState,
    restyling,
    mockMode,
    setStyle,
    setSheet,
    addFiles,
    removeItem,
    clearAll,
    retry,
    toggleItem,
    setCopies,
  };
}

export type Studio = ReturnType<typeof useStudio>;
