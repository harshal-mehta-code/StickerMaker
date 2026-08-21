/**
 * Single-channel mask cleanup.
 *
 * A matting model's raw output is speckled: stray pixels of carpet keep a bit
 * of alpha, fur gradients leave pinholes, and the contour is jagged at the
 * pixel level. Printed at sticker size all of that reads as dirt around the
 * edge, so the mask gets smoothed and its islands pruned before it is ever
 * applied to the photo.
 *
 * Everything here works on a Uint8Array of width * height, one byte per pixel.
 */

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

/** Separable box blur. Two O(n) passes with a sliding window sum. */
export function blurMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const window = radius * 2 + 1;
  const horizontal = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += mask[row + clamp(x, 0, width - 1)];
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / window;
      sum -= mask[row + clamp(x - radius, 0, width - 1)];
      sum += mask[row + clamp(x + radius + 1, 0, width - 1)];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += horizontal[clamp(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / window;
      sum -= horizontal[clamp(y - radius, 0, height - 1) * width + x];
      sum += horizontal[clamp(y + radius + 1, 0, height - 1) * width + x];
    }
  }
  return out;
}

/** Separable min (erode) or max (dilate) filter. Radii here are small. */
function morph(mask: Uint8Array, width: number, height: number, radius: number, dilate: boolean): Uint8Array {
  if (radius <= 0) return mask;
  const pick = dilate ? Math.max : Math.min;
  const horizontal = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let best = mask[row + x];
      for (let k = -radius; k <= radius; k++) best = pick(best, mask[row + clamp(x + k, 0, width - 1)]);
      horizontal[row + x] = best;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = horizontal[y * width + x];
      for (let k = -radius; k <= radius; k++) {
        best = pick(best, horizontal[clamp(y + k, 0, height - 1) * width + x]);
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

export const erodeMask = (mask: Uint8Array, w: number, h: number, r: number) => morph(mask, w, h, r, false);
export const dilateMask = (mask: Uint8Array, w: number, h: number, r: number) => morph(mask, w, h, r, true);

/** Push values away from the middle, so a blurred mask becomes decisive again. */
export function thresholdMask(mask: Uint8Array, midpoint = 128, ramp = 48): Uint8Array {
  const out = new Uint8Array(mask.length);
  const low = midpoint - ramp / 2;
  for (let i = 0; i < mask.length; i++) {
    const v = (mask[i] - low) / ramp;
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return out;
}

/**
 * Drop islands that are too small to be part of the subject.
 *
 * Blobs are kept when they are a decent fraction of the biggest one, so a tail
 * or an ear tip survives being pinched off the body, while a scrap of floor in
 * the corner does not. The absolute floor catches the case where the model
 * found nothing but noise and the "biggest" blob is itself a speck.
 */
export function removeSpecks(
  mask: Uint8Array,
  width: number,
  height: number,
  minRatio = 0.08,
  alphaThreshold = 24,
): Uint8Array {
  const total = width * height;
  const labels = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const sizes: number[] = [];

  for (let start = 0; start < total; start++) {
    if (labels[start] !== -1 || mask[start] < alphaThreshold) continue;
    const label = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    let size = 0;
    while (head < tail) {
      const idx = queue[head++];
      size++;
      const x = idx % width;
      const y = (idx - x) / width;
      let n = idx - 1;
      if (x > 0 && labels[n] === -1 && mask[n] >= alphaThreshold) {
        labels[n] = label;
        queue[tail++] = n;
      }
      n = idx + 1;
      if (x < width - 1 && labels[n] === -1 && mask[n] >= alphaThreshold) {
        labels[n] = label;
        queue[tail++] = n;
      }
      n = idx - width;
      if (y > 0 && labels[n] === -1 && mask[n] >= alphaThreshold) {
        labels[n] = label;
        queue[tail++] = n;
      }
      n = idx + width;
      if (y < height - 1 && labels[n] === -1 && mask[n] >= alphaThreshold) {
        labels[n] = label;
        queue[tail++] = n;
      }
    }
    sizes.push(size);
  }

  if (sizes.length === 0) return mask;
  const biggest = Math.max(...sizes);
  // Ignore anything under a thousandth of the frame outright.
  const cutoff = Math.max(biggest * minRatio, total * 0.001);
  const out = new Uint8Array(mask);
  for (let i = 0; i < total; i++) {
    const label = labels[i];
    if (label === -1 || sizes[label] < cutoff) out[i] = 0;
  }
  return out;
}

/**
 * The full clean-up: smooth away speckle, open to drop what is left of it,
 * close the pinholes, prune the islands, then soften the contour just enough
 * that the die-cut border does not trace a staircase.
 */
export function cleanupMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const radius = Math.max(1, Math.round(Math.min(width, height) / 400));
  let out = thresholdMask(blurMask(mask, width, height, radius));
  out = dilateMask(erodeMask(out, width, height, radius), width, height, radius);
  out = erodeMask(dilateMask(out, width, height, radius), width, height, radius);
  out = removeSpecks(out, width, height);
  return blurMask(out, width, height, 1);
}

/**
 * Clear the connected blob under a point. This is the one-tap answer to "the
 * model kept a scrap of the sofa": no brushing, just hit the offending lump.
 *
 * @returns how many pixels were cleared, so a miss can be reported as a miss.
 */
export function eraseBlobAt(
  alpha: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  alphaThreshold = 24,
): number {
  const x = clamp(Math.round(startX), 0, width - 1);
  const y = clamp(Math.round(startY), 0, height - 1);
  const start = y * width + x;
  if (alpha[start] < alphaThreshold) return 0;

  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  alpha[start] = 0;
  let cleared = 0;
  while (head < tail) {
    const idx = queue[head++];
    cleared++;
    const px = idx % width;
    const py = (idx - px) / width;
    let n = idx - 1;
    if (px > 0 && alpha[n] >= alphaThreshold) {
      alpha[n] = 0;
      queue[tail++] = n;
    }
    n = idx + 1;
    if (px < width - 1 && alpha[n] >= alphaThreshold) {
      alpha[n] = 0;
      queue[tail++] = n;
    }
    n = idx - width;
    if (py > 0 && alpha[n] >= alphaThreshold) {
      alpha[n] = 0;
      queue[tail++] = n;
    }
    n = idx + width;
    if (py < height - 1 && alpha[n] >= alphaThreshold) {
      alpha[n] = 0;
      queue[tail++] = n;
    }
  }
  return cleared;
}
