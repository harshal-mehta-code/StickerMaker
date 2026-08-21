/**
 * What this device can reasonably be asked to do. Used on both the main thread
 * and inside the worker, so it must not touch `document`.
 *
 * iOS Safari kills a tab that grows past a few hundred megabytes, and it is the
 * platform least likely to tell us how much memory it has -- `deviceMemory` is
 * Chromium-only -- so the user-agent check carries the weight here.
 */
export interface DeviceProfile {
  iOS: boolean;
  mobile: boolean;
  /** Keep peak memory small: smaller model, smaller inference, smaller images. */
  constrained: boolean;
  memoryGb?: number;
}

export function deviceProfile(): DeviceProfile {
  const nav: (Navigator & { deviceMemory?: number }) | undefined =
    typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const ua = nav?.userAgent ?? "";
  // iPads have reported a desktop UA since iPadOS 13; the touch-point count is
  // what gives them away.
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
  const mobile = iOS || /Android/i.test(ua);
  const memoryGb = typeof nav?.deviceMemory === "number" ? nav.deviceMemory : undefined;
  return {
    iOS,
    mobile,
    constrained: mobile || (memoryGb !== undefined && memoryGb <= 4),
    memoryGb,
  };
}

/**
 * Longest side a photo is decoded to before anything else touches it. The model
 * resamples to 1024 square regardless, so going below that on a small device
 * only costs detail -- match it rather than upscaling into the model.
 */
export function decodeLimit(profile: DeviceProfile): number {
  return profile.constrained ? 1024 : 1400;
}

/** Longest side of the cut-out kept in memory for restyling. */
export function cutoutLimit(profile: DeviceProfile): number {
  return profile.constrained ? 700 : 1000;
}
