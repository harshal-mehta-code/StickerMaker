/// <reference lib="webworker" />
/**
 * Runs the background-removal model off the main thread so the UI keeps
 * bouncing while a photo is being cut out. Everything happens in the browser --
 * no photo ever leaves the device.
 *
 * Pre- and post-processing are done by hand rather than through AutoProcessor:
 * it keeps the only network fetch the model weights themselves, and it means
 * the exact resize/normalise RMBG-1.4 expects is spelled out here.
 */
import { AutoModel, Tensor, env } from "@huggingface/transformers";

env.allowLocalModels = false;

const MODEL_ID = "briaai/RMBG-1.4";
/** RMBG-1.4 is trained at 1024 x 1024, aspect ratio ignored. */
const INPUT_SIZE = 1024;
const IMAGE_MEAN = 0.5;
const IMAGE_STD = 1.0;

// The architecture is not one transformers.js knows by name, so hand it a
// config directly -- that also saves a round trip for config.json.
const MODEL_CONFIG = { model_type: "custom" };

/** Fastest first; each entry is retried in order if the one before it fails. */
type Attempt = { device: "webgpu" | "wasm"; dtype: "fp32" | "q8" };

function attempts(): Attempt[] {
  const list: Attempt[] = [];
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    list.push({ device: "webgpu", dtype: "fp32" });
  }
  // Quantised weights are a quarter of the download; if the repo has no
  // quantised export the fetch 404s and we fall back to full precision.
  list.push({ device: "wasm", dtype: "q8" });
  list.push({ device: "wasm", dtype: "fp32" });
  return list;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let loading: Promise<any> | null = null;

function load(): Promise<any> {
  if (loading) return loading;
  const started = (async () => {
    const tried: string[] = [];
    for (const attempt of attempts()) {
      try {
        post({ type: "loading", backend: attempt.device, progress: 0 });
        const model = await AutoModel.from_pretrained(MODEL_ID, {
          config: MODEL_CONFIG as any,
          device: attempt.device,
          dtype: attempt.dtype,
          progress_callback: (p: any) => {
            if (p?.status === "progress" && typeof p.progress === "number") {
              post({ type: "loading", backend: attempt.device, progress: p.progress / 100 });
            }
          },
        } as any);
        post({ type: "loaded", backend: attempt.device });
        return model;
      } catch (err) {
        tried.push(`${attempt.device}/${attempt.dtype}: ${(err as Error)?.message ?? err}`);
      }
    }
    console.error("Cut-out model failed to load:", tried);
    throw new Error(
      "Couldn't download the cut-out model. Check your connection and try again — the details are in the browser console."
    );
  })();
  loading = started.catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

function post(message: unknown, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(message, transfer);
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser would not give us a canvas to work on");
  return ctx;
}

/** RGBA pixels -> normalised NCHW float tensor at the model's input size. */
function preprocess(rgba: ArrayBuffer, width: number, height: number): Tensor {
  const source = new OffscreenCanvas(width, height);
  const sourceCtx = context(source);
  const frame = sourceCtx.createImageData(width, height);
  frame.data.set(new Uint8Array(rgba));
  sourceCtx.putImageData(frame, 0, 0);

  const square = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = context(square);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height, 0, 0, INPUT_SIZE, INPUT_SIZE);

  const pixels = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const plane = INPUT_SIZE * INPUT_SIZE;
  const data = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    data[i] = (pixels[p] / 255 - IMAGE_MEAN) / IMAGE_STD;
    data[plane + i] = (pixels[p + 1] / 255 - IMAGE_MEAN) / IMAGE_STD;
    data[plane * 2 + i] = (pixels[p + 2] / 255 - IMAGE_MEAN) / IMAGE_STD;
  }
  return new Tensor("float32", data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
}

/**
 * Model output -> an 8-bit alpha mask at the photo's own size. The ONNX export
 * usually emits probabilities already, but the reference implementation
 * min-max normalises, so do that whenever the range says it is needed.
 */
function postprocess(raw: Float32Array, maskW: number, maskH: number, width: number, height: number): Uint8Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] < min) min = raw[i];
    if (raw[i] > max) max = raw[i];
  }
  const needsNormalising = min < -0.01 || max > 1.01;
  const span = Math.max(1e-6, max - min);

  const grey = new Uint8ClampedArray(maskW * maskH * 4);
  for (let i = 0; i < maskW * maskH; i++) {
    const v = needsNormalising ? (raw[i] - min) / span : Math.min(1, Math.max(0, raw[i]));
    const b = Math.round(v * 255);
    const p = i * 4;
    grey[p] = b;
    grey[p + 1] = b;
    grey[p + 2] = b;
    grey[p + 3] = 255;
  }

  const small = new OffscreenCanvas(maskW, maskH);
  context(small).putImageData(new ImageData(grey, maskW, maskH), 0, 0);

  const full = new OffscreenCanvas(width, height);
  const ctx = context(full);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, maskW, maskH, 0, 0, width, height);

  const scaled = ctx.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = scaled[i * 4];
  return alpha;
}

self.onmessage = async (event: MessageEvent) => {
  const data = event.data ?? {};

  if (data.type === "warmup") {
    try {
      await load();
    } catch (err) {
      post({ type: "error", id: null, message: (err as Error).message });
    }
    return;
  }

  if (data.type !== "segment") return;
  const { id, buffer, width, height } = data as {
    id: string;
    buffer: ArrayBuffer;
    width: number;
    height: number;
  };

  let model: any;
  try {
    model = await load();
  } catch (err) {
    // A load failure is not this photo's fault -- report it globally so the
    // banner explains what happened instead of just flagging one thumbnail.
    post({ type: "error", id: null, message: (err as Error).message });
    return;
  }

  try {
    const tensor = preprocess(buffer, width, height);

    // Feed the tensor under whatever the graph actually calls its input.
    const inputName: string = model?.sessions?.model?.inputNames?.[0] ?? "input";
    const result = await model({ [inputName]: tensor });
    const out = result?.output ?? Object.values(result ?? {})[0];
    if (!out?.data || !out?.dims) throw new Error("The model returned something unexpected");

    const dims: number[] = out.dims;
    const maskH = dims[dims.length - 2];
    const maskW = dims[dims.length - 1];
    const alpha = postprocess(out.data as Float32Array, maskW, maskH, width, height);
    post({ type: "result", id, alpha, width, height }, [alpha.buffer]);
  } catch (err) {
    post({ type: "error", id, message: (err as Error)?.message ?? "Cut-out failed" });
  }
};
