import { AnyCanvas, ctxOf, makeCanvas } from "./canvas";
import { PAGE_SIZES, SHEET_BACKGROUNDS, SheetConfig } from "./types";

/** Small deterministic PRNG so the preview and the exported file always match. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Grid {
  pageWidthIn: number;
  pageHeightIn: number;
  cols: number;
  rows: number;
  perPage: number;
  cellIn: number;
  offsetXIn: number;
  offsetYIn: number;
}

export function computeGrid(sheet: SheetConfig): Grid {
  const page = PAGE_SIZES[sheet.pageSize];
  const cell = Math.max(0.25, sheet.stickerSizeIn);
  const gap = Math.max(0, sheet.gapIn);
  const margin = Math.max(0, sheet.marginIn);

  const usableW = Math.max(0, page.widthIn - margin * 2);
  const usableH = Math.max(0, page.heightIn - margin * 2);
  const cols = Math.max(1, Math.floor((usableW + gap) / (cell + gap)));
  const rows = Math.max(1, Math.floor((usableH + gap) / (cell + gap)));

  const gridW = cols * cell + (cols - 1) * gap;
  const gridH = rows * cell + (rows - 1) * gap;

  return {
    pageWidthIn: page.widthIn,
    pageHeightIn: page.heightIn,
    cols,
    rows,
    perPage: cols * rows,
    cellIn: cell,
    offsetXIn: (page.widthIn - gridW) / 2,
    offsetYIn: (page.heightIn - gridH) / 2,
  };
}

export interface Placeable {
  id: string;
  bitmap: ImageBitmap;
}

/** Expand the chosen stickers (honouring copies, shuffle and fill) into slots. */
export function buildSequence(items: Placeable[], sheet: SheetConfig, copies: Map<string, number>, grid: Grid): Placeable[][] {
  const flat: Placeable[] = [];
  for (const item of items) {
    const n = Math.max(1, copies.get(item.id) ?? 1);
    for (let i = 0; i < n; i++) flat.push(item);
  }
  if (flat.length === 0) return [];

  let ordered = flat;
  if (sheet.shuffle) {
    const rand = mulberry32(flat.length * 7919 + 13);
    ordered = [...flat];
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }

  if (sheet.fillPage) {
    const filled: Placeable[] = [];
    for (let i = 0; i < grid.perPage; i++) filled.push(ordered[i % ordered.length]);
    return [filled];
  }

  const pages: Placeable[][] = [];
  for (let i = 0; i < ordered.length; i += grid.perPage) {
    pages.push(ordered.slice(i, i + grid.perPage));
  }
  return pages;
}

export interface RenderOptions {
  dpi: number;
  /** Draw the paper white even when the sheet background is transparent. */
  opaquePaper?: boolean;
}

export function renderPage(page: Placeable[], sheet: SheetConfig, grid: Grid, opts: RenderOptions): AnyCanvas {
  const { dpi } = opts;
  const widthPx = Math.round(grid.pageWidthIn * dpi);
  const heightPx = Math.round(grid.pageHeightIn * dpi);
  const canvas = makeCanvas(widthPx, heightPx);
  const ctx = ctxOf(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const bg = SHEET_BACKGROUNDS[sheet.background];
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, widthPx, heightPx);
  } else if (opts.opaquePaper) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, widthPx, heightPx);
  }

  const cell = grid.cellIn * dpi;
  const gap = sheet.gapIn * dpi;
  const rand = mulberry32(1337);

  for (let index = 0; index < grid.perPage; index++) {
    const col = index % grid.cols;
    const row = Math.floor(index / grid.cols);
    const x = grid.offsetXIn * dpi + col * (cell + gap);
    const y = grid.offsetYIn * dpi + row * (cell + gap);
    // Always advance the PRNG so a sticker's tilt does not change when the
    // sheet is only partly filled.
    const tilt = ((rand() * 2 - 1) * sheet.jitter * Math.PI) / 180;

    if (sheet.cutGuides) {
      ctx.save();
      ctx.strokeStyle = "rgba(120, 120, 120, 0.35)";
      ctx.setLineDash([Math.max(2, dpi * 0.02), Math.max(2, dpi * 0.02)]);
      ctx.lineWidth = Math.max(1, dpi * 0.003);
      ctx.strokeRect(x, y, cell, cell);
      ctx.restore();
    }

    const item = page[index];
    if (!item) continue;

    const bmp = item.bitmap;
    const cos = Math.abs(Math.cos(tilt));
    const sin = Math.abs(Math.sin(tilt));
    // Shrink just enough that the tilted sticker still fits its cell.
    const rotatedW = bmp.width * cos + bmp.height * sin;
    const rotatedH = bmp.width * sin + bmp.height * cos;
    const scale = Math.min(cell / rotatedW, cell / rotatedH);
    const drawW = bmp.width * scale;
    const drawH = bmp.height * scale;

    ctx.save();
    ctx.translate(x + cell / 2, y + cell / 2);
    ctx.rotate(tilt);
    ctx.drawImage(bmp as CanvasImageSource, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }

  return canvas;
}
