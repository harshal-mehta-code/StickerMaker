/**
 * Canvas helpers for turning a photo into a die-cut sticker.
 * Everything here runs in the browser, on plain 2D canvases.
 */

import { blurMask, thresholdMask } from "./mask";

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function makeCanvas(width: number, height: number): AnyCanvas {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

export function ctxOf(canvas: AnyCanvas): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("Could not get a 2D drawing context");
  return ctx as CanvasRenderingContext2D;
}

/**
 * Decode a photo through an <img> element. Slower than createImageBitmap, but
 * it goes through the browser's ordinary image pipeline, which on Safari knows
 * formats -- HEIC among them -- that the bitmap decoder can refuse.
 */
async function decodeViaImageElement(blob: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The browser could not decode this image"));
      image.src = url;
    });
    const canvas = makeCanvas(image.naturalWidth, image.naturalHeight);
    ctxOf(canvas).drawImage(image, 0, 0);
    return await createImageBitmap(canvas as CanvasImageSource);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decode a File into a bitmap, capped so huge phone photos stay manageable. */
export async function decodeToBitmap(blob: Blob, maxDim = 1400): Promise<ImageBitmap> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (first) {
    try {
      bitmap = await decodeViaImageElement(blob);
    } catch {
      throw new Error(
        `Couldn't read this image (${blob.type || "unknown type"}). ` +
          `If it's a HEIC photo, re-save it as JPEG and try again. [${(first as Error)?.message ?? first}]`,
      );
    }
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= maxDim) return bitmap;
  const scale = maxDim / longest;
  const resized = await createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
    resizeQuality: "high",
  });
  bitmap.close();
  return resized;
}

export function bitmapToImageData(bitmap: ImageBitmap): ImageData {
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  const ctx = ctxOf(canvas);
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Multiply an image's alpha channel by a single-channel mask, then clean up the
 * fuzzy fringe that matting models leave around fur.
 */
export function applyMask(
  image: ImageData,
  mask: Uint8Array | Uint8ClampedArray,
  edgeTrim: number,
): ImageData {
  const { data, width, height } = image;
  const out = new ImageData(width, height);
  const dst = out.data;
  // Below `low` the pixel is fully cut away, above `high` it is fully kept, and
  // in between alpha ramps smoothly so edges stay soft instead of jagged.
  const low = Math.max(0, Math.min(0.95, edgeTrim)) * 255;
  const high = Math.min(255, low + 40);
  const span = Math.max(1, high - low);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const m = mask[i];
    let a = m <= low ? 0 : m >= high ? 255 : ((m - low) / span) * 255;
    a = (a * data[p + 3]) / 255;
    dst[p] = data[p];
    dst[p + 1] = data[p + 1];
    dst[p + 2] = data[p + 2];
    dst[p + 3] = a;
  }
  return out;
}

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Trimmed {
  canvas: AnyCanvas;
  /** Where the crop sits in the source image, so it can be reproduced later. */
  crop: Crop;
}

/** Crop away fully transparent margins. Returns null when nothing is left. */
export function trimTransparent(image: ImageData, alphaThreshold = 8): Trimmed | null {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const source = makeCanvas(width, height);
  ctxOf(source).putImageData(image, 0, 0);
  const out = makeCanvas(w, h);
  ctxOf(out).drawImage(source as CanvasImageSource, minX, minY, w, h, 0, 0, w, h);
  return { canvas: out, crop: { x: minX, y: minY, width: w, height: h } };
}

export interface OutlineOptions {
  /** Border width as a fraction of the subject's longest side. */
  outline: number;
  outlineColor: string;
  shadow: boolean;
  /** Longest side of the rendered sticker, in pixels. */
  workingSize?: number;
}

/**
 * Give a cut-out subject the classic die-cut look: a thick even border that
 * follows its silhouette, plus an optional soft shadow.
 */
export function addDieCutBorder(subject: AnyCanvas, opts: OutlineOptions): AnyCanvas {
  const workingSize = opts.workingSize ?? 900;
  const longest = Math.max(subject.width, subject.height);
  const scale = workingSize / longest;
  const w = Math.max(1, Math.round(subject.width * scale));
  const h = Math.max(1, Math.round(subject.height * scale));

  const border = Math.round(Math.max(0, opts.outline) * workingSize);
  const shadowBlur = opts.shadow ? Math.round(workingSize * 0.02) : 0;
  const shadowOffset = opts.shadow ? Math.round(workingSize * 0.012) : 0;
  const pad = border + shadowBlur + shadowOffset + 2;

  const scaled = makeCanvas(w, h);
  const sctx = ctxOf(scaled);
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(subject as CanvasImageSource, 0, 0, w, h);

  const out = makeCanvas(w + pad * 2, h + pad * 2);
  const ctx = ctxOf(out);

  if (border > 0) {
    const silhouette = buildSilhouette(scaled, out.width, out.height, pad, border, opts.outlineColor);
    if (opts.shadow) {
      ctx.save();
      ctx.shadowColor = "rgba(60, 40, 30, 0.28)";
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetY = shadowOffset;
      ctx.drawImage(silhouette as CanvasImageSource, 0, 0, out.width, out.height);
      ctx.restore();
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(silhouette as CanvasImageSource, 0, 0, out.width, out.height);
  } else if (opts.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(60, 40, 30, 0.28)";
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetY = shadowOffset;
    ctx.drawImage(scaled as CanvasImageSource, pad, pad);
    ctx.restore();
  }

  ctx.drawImage(scaled as CanvasImageSource, pad, pad);
  return out;
}

/** Longest side of the canvas the border is grown on. */
const SILHOUETTE_SIZE = 448;
/** Largest radius grown in a single pass, in silhouette pixels. */
const MAX_PASS_RADIUS = 12;
/** Tolerated wobble in the grown edge, in silhouette pixels. */
const EDGE_TOLERANCE = 0.3;

/** How many stamps around a ring keep the grown edge smooth to within tolerance. */
function stepsForRadius(radius: number): number {
  // Sampling a circle of radius r at angle t leaves a scallop of r*(1-cos(t/2)).
  return Math.min(48, Math.max(8, Math.ceil(Math.PI * Math.sqrt(radius / EDGE_TOLERANCE))));
}

/**
 * Grow the subject's silhouette outwards by `border` pixels and paint it solid.
 *
 * The shape is stamped around a ring of offsets -- a cheap stand-in for a
 * morphological dilation by a disc -- and wide borders are grown over several
 * passes, each starting from the previous result. Growing in steps is what
 * keeps thin features (a tail, a whisker) solid instead of leaving a hollow
 * band around them.
 *
 * It all happens at reduced resolution and is scaled back up: the result is a
 * flat colour shape, so extra pixels would only buy a marginally sharper edge,
 * and working small keeps a slider drag responsive with a trayful of stickers.
 */
function buildSilhouette(
  scaled: AnyCanvas,
  outWidth: number,
  outHeight: number,
  pad: number,
  border: number,
  color: string,
): AnyCanvas {
  const shrink = Math.min(1, SILHOUETTE_SIZE / Math.max(outWidth, outHeight));
  const width = Math.max(1, Math.round(outWidth * shrink));
  const height = Math.max(1, Math.round(outHeight * shrink));

  // Resample the subject once into a full-size layer, then grow that.
  let current = makeCanvas(width, height);
  const seed = ctxOf(current);
  seed.imageSmoothingEnabled = true;
  seed.imageSmoothingQuality = "high";
  seed.drawImage(
    scaled as CanvasImageSource,
    pad * shrink,
    pad * shrink,
    scaled.width * shrink,
    scaled.height * shrink,
  );

  const radius = border * shrink;
  const passes = Math.min(4, Math.max(1, Math.ceil(radius / MAX_PASS_RADIUS)));
  const passRadius = radius / passes;
  const steps = stepsForRadius(passRadius);

  for (let pass = 0; pass < passes; pass++) {
    const next = makeCanvas(width, height);
    const ctx = ctxOf(next);
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      ctx.drawImage(current as CanvasImageSource, Math.cos(angle) * passRadius, Math.sin(angle) * passRadius);
    }
    ctx.drawImage(current as CanvasImageSource, 0, 0);
    current = next;
  }

  // Flatten the stacked stamps into one solid shape.
  const ctx = ctxOf(current);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  return current;
}

export async function canvasToBlob(canvas: AnyCanvas, type = "image/png", quality?: number): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      type,
      quality,
    );
  });
}

/**
 * Re-shape an existing alpha channel. Matting leaves a halo of half-transparent
 * fur; pushing the cut-off up gives a crisper die-cut edge, pulling it down
 * keeps wispy detail.
 */
export function sharpenAlpha(image: ImageData, edgeTrim: number): ImageData {
  const { width, height, data } = image;
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const dst = out.data;
  const low = Math.max(0, Math.min(0.95, edgeTrim)) * 255;
  const high = Math.min(255, low + 40);
  const span = Math.max(1, high - low);
  for (let p = 3; p < data.length; p += 4) {
    const a = data[p];
    dst[p] = a <= low ? 0 : a >= high ? 255 : Math.round(((a - low) / span) * 255);
  }
  return out;
}

/**
 * Soften an alpha channel's contour without moving it. Runs at render time, so
 * the smoothing slider is live -- unlike the clean-up done once at extraction,
 * which needs the full-resolution mask.
 */
export function smoothAlpha(image: ImageData, radius: number): ImageData {
  if (radius <= 0) return image;
  const { width, height, data } = image;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  const blurred = thresholdMask(blurMask(alpha, width, height, radius));
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  for (let i = 0; i < alpha.length; i++) out.data[i * 4 + 3] = blurred[i];
  return out;
}

export function imageDataToCanvas(image: ImageData): AnyCanvas {
  const canvas = makeCanvas(image.width, image.height);
  ctxOf(canvas).putImageData(image, 0, 0);
  return canvas;
}

export function canvasToImageData(canvas: AnyCanvas): ImageData {
  return ctxOf(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

/** Scale a canvas so its longest side is at most `maxDim`. */
export function limitCanvas(canvas: AnyCanvas, maxDim: number): AnyCanvas {
  const longest = Math.max(canvas.width, canvas.height);
  if (longest <= maxDim) return canvas;
  const scale = maxDim / longest;
  const out = makeCanvas(canvas.width * scale, canvas.height * scale);
  const ctx = ctxOf(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas as CanvasImageSource, 0, 0, out.width, out.height);
  return out;
}
