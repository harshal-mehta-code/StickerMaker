import {
  addDieCutBorder,
  applyMask,
  bitmapToImageData,
  canvasToBlob,
  canvasToImageData,
  decodeToBitmap,
  imageDataToCanvas,
  limitCanvas,
  removeSpecks,
  sharpenAlpha,
  trimTransparent,
} from "./canvas";
import { cutoutLimit, decodeLimit, deviceProfile } from "./device";
import { Segmenter } from "./segmenter";
import { StickerStyle } from "./types";

export class NoSubjectFoundError extends Error {
  constructor() {
    super("Couldn't find a subject in this photo");
    this.name = "NoSubjectFoundError";
  }
}

/**
 * Photo in, subject out: run the matting model, drop stray specks and crop to
 * the subject. The result keeps a soft alpha channel so the edge can be
 * re-tuned later without re-running the model.
 */
export async function extractSubject(file: Blob, segmenter: Segmenter): Promise<ImageData> {
  const profile = deviceProfile();
  const bitmap = await decodeToBitmap(file, decodeLimit(profile));
  try {
    const source = bitmapToImageData(bitmap);
    const mask = await segmenter.segment(source);
    const masked = applyMask(source, mask, 0.04);
    const despeckled = removeSpecks(masked);
    const trimmed = trimTransparent(despeckled);
    if (!trimmed) throw new NoSubjectFoundError();
    return canvasToImageData(limitCanvas(trimmed, cutoutLimit(profile)));
  } finally {
    bitmap.close();
  }
}

export interface RenderedSticker {
  /** Full-quality sticker used when the sheet is drawn. */
  bitmap: ImageBitmap;
  /** Small PNG for the thumbnail tray. */
  url: string;
}

/** Longest side of the tray thumbnail. */
const THUMBNAIL_MAX = 320;

/** Turn a stored cut-out into a finished sticker with its die-cut border. */
export async function renderSticker(cutout: ImageData, style: StickerStyle): Promise<RenderedSticker> {
  const sharpened = sharpenAlpha(cutout, style.edgeTrim);
  const trimmed = trimTransparent(sharpened) ?? imageDataToCanvas(sharpened);
  const withBorder = addDieCutBorder(trimmed, {
    outline: style.outline,
    outlineColor: style.outlineColor,
    shadow: style.shadow,
  });
  // Take the bitmap straight off the canvas -- encoding a full-size PNG just to
  // decode it again is the slowest step in a restyle. Only the thumbnail, which
  // needs a URL for an <img>, gets encoded, and only at thumbnail size.
  const bitmap = await createImageBitmap(withBorder as CanvasImageSource);
  const blob = await canvasToBlob(limitCanvas(withBorder, THUMBNAIL_MAX));
  return { bitmap, url: URL.createObjectURL(blob) };
}
