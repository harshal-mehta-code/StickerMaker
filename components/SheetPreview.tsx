"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnyCanvas, canvasToBlob } from "@/lib/canvas";
import { exportPdf, exportPng } from "@/lib/export";
import { buildSequence, computeGrid, Placeable, renderPage } from "@/lib/sheet";
import { PAGE_SIZES, SheetConfig, StickerItem } from "@/lib/types";
import { Button } from "./ui";

const PREVIEW_DPI = 132;
const EXPORT_DPI = 300;

async function printSheets(pages: AnyCanvas[], widthIn: number, heightIn: number) {
  const urls = await Promise.all(
    pages.map(async (page) => URL.createObjectURL(await canvasToBlob(page, "image/png"))),
  );
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(`<!doctype html><html><head><style>
    @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
    html, body { margin: 0; padding: 0; }
    img { display: block; width: ${widthIn}in; height: ${heightIn}in; page-break-after: always; }
    img:last-child { page-break-after: auto; }
  </style></head><body>${urls.map((url) => `<img src="${url}">`).join("")}</body></html>`);
  doc.close();

  const images = Array.from(doc.images);
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) resolve();
          else img.onload = img.onerror = () => resolve();
        }),
    ),
  );
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  setTimeout(() => {
    urls.forEach((url) => URL.revokeObjectURL(url));
    frame.remove();
  }, 60_000);
}

export function SheetPreview({
  items,
  sheet,
  busy,
}: {
  items: StickerItem[];
  sheet: SheetConfig;
  busy: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [exporting, setExporting] = useState<null | "png" | "pdf" | "print">(null);

  const grid = useMemo(() => computeGrid(sheet), [sheet]);

  const placeables = useMemo<Placeable[]>(
    () =>
      items
        .filter((item) => item.enabled && item.bitmap)
        .map((item) => ({ id: item.id, bitmap: item.bitmap! })),
    [items],
  );

  const copies = useMemo(() => new Map(items.map((item) => [item.id, item.copies])), [items]);

  const pages = useMemo(
    () => buildSequence(placeables, sheet, copies, grid),
    [placeables, sheet, copies, grid],
  );

  const pageCount = Math.max(1, pages.length);
  const safeIndex = Math.min(pageIndex, pageCount - 1);

  useEffect(() => {
    if (pageIndex > pageCount - 1) setPageIndex(pageCount - 1);
  }, [pageCount, pageIndex]);

  useEffect(() => {
    const target = canvasRef.current;
    if (!target) return;
    const rendered = renderPage(pages[safeIndex] ?? [], sheet, grid, {
      dpi: PREVIEW_DPI,
      opaquePaper: true,
    });
    target.width = rendered.width;
    target.height = rendered.height;
    const ctx = target.getContext("2d");
    ctx?.drawImage(rendered as CanvasImageSource, 0, 0);
  }, [pages, safeIndex, sheet, grid]);

  const renderAll = useCallback(
    () => pages.map((page) => renderPage(page, sheet, grid, { dpi: EXPORT_DPI })),
    [pages, sheet, grid],
  );

  const stamp = new Date().toISOString().slice(0, 10);
  const hasStickers = placeables.length > 0;

  const handlePng = async () => {
    setExporting("png");
    try {
      const canvases = renderAll();
      for (let i = 0; i < canvases.length; i++) {
        const suffix = canvases.length > 1 ? `-page${i + 1}` : "";
        await exportPng(canvases[i], `sticker-sheet-${stamp}${suffix}.png`);
      }
    } finally {
      setExporting(null);
    }
  };

  const handlePdf = async () => {
    setExporting("pdf");
    try {
      await exportPdf(renderAll(), sheet.pageSize, `sticker-sheet-${stamp}.pdf`);
    } finally {
      setExporting(null);
    }
  };

  const handlePrint = async () => {
    setExporting("print");
    try {
      const page = PAGE_SIZES[sheet.pageSize];
      await printSheets(renderAll(), page.widthIn, page.heightIn);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full flex-wrap items-center justify-center gap-2">
        <Button onClick={handlePrint} disabled={!hasStickers || exporting !== null}>
          {exporting === "print" ? "Preparing…" : "🖨️ Print sheet"}
        </Button>
        <Button variant="mint" onClick={handlePdf} disabled={!hasStickers || exporting !== null}>
          {exporting === "pdf" ? "Saving…" : "PDF"}
        </Button>
        <Button variant="ghost" onClick={handlePng} disabled={!hasStickers || exporting !== null}>
          {exporting === "png" ? "Saving…" : "PNG"}
        </Button>
      </div>

      <div className="relative w-full max-w-[560px]">
        <canvas
          ref={canvasRef}
          aria-label="Sticker sheet preview"
          className="w-full rounded-lg border border-line bg-white shadow-[0_18px_40px_-18px_rgba(74,59,51,0.55)]"
        />
        {!hasStickers ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <span className="text-5xl animate-float" aria-hidden>
              🐱
            </span>
            <p className="font-display text-lg font-extrabold text-ink-soft">Your sheet is waiting</p>
            <p className="max-w-[16rem] text-xs font-semibold text-ink-soft">
              Add a few photos and the stickers will start filling this page.
            </p>
          </div>
        ) : null}
        {busy ? (
          <span className="absolute left-3 top-3 rounded-full bg-lilac px-3 py-1 font-display text-[11px] font-bold text-white shadow">
            restyling…
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-3 text-xs font-bold text-ink-soft">
        {pageCount > 1 ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
              disabled={safeIndex === 0}
            >
              ←
            </Button>
            <span className="font-display">
              Page {safeIndex + 1} of {pageCount}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPageIndex((index) => Math.min(pageCount - 1, index + 1))}
              disabled={safeIndex === pageCount - 1}
            >
              →
            </Button>
          </>
        ) : (
          <span className="font-display">
            {PAGE_SIZES[sheet.pageSize].label} · {grid.perPage} stickers at {sheet.stickerSizeIn.toFixed(2)}
            &quot; · 300 dpi
          </span>
        )}
      </div>
    </div>
  );
}
