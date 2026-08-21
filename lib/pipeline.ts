import {
  addDieCutBorder,
  applyMask,
  bitmapToImageData,
  canvasToBlob,
  canvasToImageData,
  Crop,
  decodeToBitmap,
  imageDataToCanvas,
  limitCanvas,
  makeCanvas,
  ctxOf,
  sharpenAlpha,
  smoothAlpha,
  trimTransparent,
} from "./canvas";
import { cutoutLimit, decodeLimit, deviceProfile } from "./device";
import { cleanupMask } from "./mask";
import { Segmenter } from "./segmenter";
import { StickerStyle } from "./types";

export class NoSubjectFoundError extends Error {
  constructor() {
    super("Couldn't find a subject in this photo");
    this.name = "NoSubjectFoundError";
  }
}

export interface Extracted {
  /** The subject, cropped, with a soft alpha channel. */
  cutout: ImageData;
  /** Where the cut-out sits in the decoded photo, for re-deriving the source. */
  crop: Crop;
}

/**
 * Photo in, subject out: run the matting model, clean up its mask and crop to
 * the subject. The result keeps a soft alpha channel so the edge can be
 * re-tuned later without re-running the model.
 */
export async function extractSubject(file: Blob, segmenter: Segmenter): Promise<Extracted> {
  const profile = deviceProfile();
  const bitmap = await decodeToBitmap(file, decodeLimit(profile));
  try {
    const source = bitmapToImageData(bitmap);
    const raw = await segmenter.segment(source);
    // Clean the mask while it is still at the photo's full resolution --
    // speckle is far easier to identify here than after cropping and scaling.
    const mask = cleanupMask(raw, source.width, source.height);
    const masked = applyMask(source, mask, 0.04);
    const trimmed = trimTransparent(masked);
    if (!trimmed) throw new NoSubjectFoundError();
    return {
      cutout: canvasToImageData(limitCanvas(trimmed.canvas, cutoutLimit(profile))),
      crop: trimmed.crop,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Re-derive the original photo pixels behind a cut-out, aligned to it.
 *
 * The cut-out itself cannot supply them: once alpha hits zero the colour is
 * gone through the first canvas round trip. Decoding the file again costs a
 * moment when the editor opens and nothing at all in between, which is the
 * right trade on a device that is already tight on memory.
 */
export async function sourceBehindCutout(file: Blob, cutout: ImageData, crop: Crop): Promise<ImageData> {
  const bitmap = await decodeToBitmap(file, decodeLimit(deviceProfile()));
  try {
    const canvas = makeCanvas(cutout.width, cutout.height);
    const ctx = ctxOf(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      bitmap as CanvasImageSource,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      cutout.width,
      cutout.height,
    );
    return ctx.getImageData(0, 0, cutout.width, cutout.height);
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
  const smoothed = smoothAlpha(cutout, style.smooth);
  const sharpened = sharpenAlpha(smoothed, style.edgeTrim);
  const trimmed = trimTransparent(sharpened);
  const subject = trimmed ? trimmed.canvas : imageDataToCanvas(sharpened);
  const withBorder = addDieCutBorder(subject, {
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
