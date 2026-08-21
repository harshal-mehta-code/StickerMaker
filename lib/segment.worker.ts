/// <reference lib="webworker" />
/**
 * Runs the background-removal model off the main thread so the UI keeps
 * bouncing while a photo is being cut out. Everything happens in the browser --
 * no photo ever leaves the device.
 *
 * Pre- and post-processing are done by hand rather than through AutoProcessor:
 * it keeps the only network fetch the model weights themselves, and it means
 * the exact resize/normalise RMBG-1.4 expects is spelled out here.
 *
 * Memory is the constraint that shapes the rest. RMBG-1.4 is an IS-Net, whose
 * early layers hold 64 channels at the full input resolution -- at 1024 square
 * that is a ~270 MB tensor, on top of ~176 MB of full-precision weights. Mobile
 * Safari kills a tab well before that, so on a constrained device we take the
 * quantised weights and run the model at half the side length.
 */
import { AutoModel, Tensor, env } from "@huggingface/transformers";
import { deviceProfile, inferenceSize } from "./device";

env.allowLocalModels = false;

const MODEL_ID = "briaai/RMBG-1.4";
/** The size RMBG-1.4 was trained at, and the fallback if a smaller one fails. */
const NATIVE_INPUT_SIZE = 1024;
const IMAGE_MEAN = 0.5;
const IMAGE_STD = 1.0;

// The architecture is not one transformers.js knows by name, so hand it a
// config directly -- that also saves a round trip for config.json.
const MODEL_CONFIG = { model_type: "custom" };

type Dtype = "fp32" | "q8";

const WEIGHT_FILES: Record<Dtype, string> = {
  fp32: "onnx/model.onnx",
  q8: "onnx/model_quantized.onnx",
};

/** Above this, a download is more than a phone browser will survive. */
const CONSTRAINED_WEIGHT_BUDGET = 120 * 1024 * 1024;

function weightUrl(dtype: Dtype) {
  return `https://huggingface.co/${MODEL_ID}/resolve/main/${WEIGHT_FILES[dtype]}`;
}

/**
 * Ask which weight files actually exist, and how big they are, before
 * committing to one. Guessing and falling back on a 404 means a phone can end
 * up part-way through a 176 MB download before anything goes wrong.
 *
 * @returns byte count, 0 if it exists at an unknown size, or null if absent.
 */
async function probeWeights(dtype: Dtype): Promise<number | null> {
  try {
    const response = await fetch(weightUrl(dtype), { method: "HEAD" });
    if (!response.ok) return null;
    const length = response.headers.get("content-length");
    return length ? Number(length) : 0;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number) {
  return bytes > 0 ? `${Math.round(bytes / (1024 * 1024))} MB` : "unknown size";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Loaded {
  model: any;
  backend: string;
  inputSize: number;
  constrained: boolean;
}

let loading: Promise<Loaded> | null = null;

async function chooseWeights(constrained: boolean): Promise<{ dtype: Dtype; bytes: number }> {
  // Smallest first on a phone, best quality first on a desktop.
  const order: Dtype[] = constrained ? ["q8", "fp32"] : ["fp32", "q8"];
  const found: { dtype: Dtype; bytes: number }[] = [];
  for (const dtype of order) {
    const bytes = await probeWeights(dtype);
    if (bytes !== null) found.push({ dtype, bytes });
  }
  if (found.length === 0) {
    throw new Error("Couldn't reach the cut-out model files. Check your connection and try again.");
  }
  if (constrained) {
    const affordable = found.filter((entry) => entry.bytes === 0 || entry.bytes <= CONSTRAINED_WEIGHT_BUDGET);
    if (affordable.length > 0) return affordable[0];
    // Attempting it anyway would take the browser tab down with it.
    throw new Error(
      `The only cut-out model available is ${formatBytes(found[0].bytes)}, which is more than a phone browser can hold. ` +
        `Try this on a laptop or desktop.`,
    );
  }
  return found[0];
}

function load(): Promise<Loaded> {
  if (loading) return loading;
  const started = (async (): Promise<Loaded> => {
    const profile = deviceProfile();
    const { dtype, bytes } = await chooseWeights(profile.constrained);

    const devices: ("webgpu" | "wasm")[] = [];
    // WebGPU keeps activations off the JS heap, which is exactly what a phone
    // needs, but quantised graphs are patchy there -- so only take it for fp32.
    if (typeof navigator !== "undefined" && "gpu" in navigator && dtype === "fp32") devices.push("webgpu");
    devices.push("wasm");

    const tried: string[] = [];
    for (const device of devices) {
      try {
        post({ type: "loading", backend: device, progress: 0, bytes });
        const model = await AutoModel.from_pretrained(MODEL_ID, {
          config: MODEL_CONFIG as any,
          device,
          dtype,
          progress_callback: (p: any) => {
            if (p?.status === "progress" && typeof p.progress === "number") {
              post({ type: "loading", backend: device, progress: p.progress / 100, bytes });
            }
          },
        } as any);
        post({ type: "loaded", backend: device });
        return { model, backend: device, inputSize: inferenceSize(profile), constrained: profile.constrained };
      } catch (err) {
        tried.push(`${device}/${dtype}: ${(err as Error)?.message ?? err}`);
      }
    }
    console.error("Cut-out model failed to load:", tried);
    throw new Error(
      "Couldn't start the cut-out model. Check your connection and try again — the details are in the browser console.",
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
function preprocess(rgba: ArrayBuffer, width: number, height: number, size: number): Tensor {
  const source = new OffscreenCanvas(width, height);
  const sourceCtx = context(source);
  const frame = sourceCtx.createImageData(width, height);
  frame.data.set(new Uint8Array(rgba));
  sourceCtx.putImageData(frame, 0, 0);

  const square = new OffscreenCanvas(size, size);
  const ctx = context(square);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height, 0, 0, size, size);

  const pixels = ctx.getImageData(0, 0, size, size).data;
  const plane = size * size;
  const data = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    data[i] = (pixels[p] / 255 - IMAGE_MEAN) / IMAGE_STD;
    data[plane + i] = (pixels[p + 1] / 255 - IMAGE_MEAN) / IMAGE_STD;
    data[plane * 2 + i] = (pixels[p + 2] / 255 - IMAGE_MEAN) / IMAGE_STD;
  }
  return new Tensor("float32", data, [1, 3, size, size]);
}

/**
 * Model output -> an 8-bit alpha mask at the photo's own size. The ONNX export
 * usually emits probabilities already, but the reference implementation
 * min-max normalises, so do that whenever the range says it is needed.
 */
function postprocess(
  raw: Float32Array,
  maskW: number,
  maskH: number,
  width: number,
  height: number,
): Uint8Array {
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

async function infer(loaded: Loaded, buffer: ArrayBuffer, width: number, height: number, size: number) {
  const tensor = preprocess(buffer, width, height, size);
  // Feed the tensor under whatever the graph actually calls its input.
  const inputName: string = loaded.model?.sessions?.model?.inputNames?.[0] ?? "input";
  const result = await loaded.model({ [inputName]: tensor });
  const out = result?.output ?? Object.values(result ?? {})[0];
  if (!out?.data || !out?.dims) throw new Error("The model returned something unexpected");
  const dims: number[] = out.dims;
  return postprocess(out.data as Float32Array, dims[dims.length - 1], dims[dims.length - 2], width, height);
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

  let loaded: Loaded;
  try {
    loaded = await load();
  } catch (err) {
    // A load failure is not this photo's fault -- report it globally so the
    // banner explains what happened instead of just flagging one thumbnail.
    post({ type: "error", id: null, message: (err as Error).message });
    return;
  }

  try {
    let alpha: Uint8Array;
    try {
      alpha = await infer(loaded, buffer, width, height, loaded.inputSize);
    } catch (err) {
      if (loaded.inputSize === NATIVE_INPUT_SIZE) throw err;
      if (loaded.constrained) {
        // Never escalate on a small device. Running this model at its native
        // size is what takes a phone's browser tab down, and a tab crash is a
        // far worse answer than saying so.
        console.error(`Inference at ${loaded.inputSize}px failed`, err);
        throw new Error(
          "This photo needs more memory than this device's browser will give us. Try a laptop or desktop."
        );
      }
      // Some ONNX exports pin their input dimensions; if the smaller run is
      // rejected, take the size the model was trained at.
      console.warn(`Inference at ${loaded.inputSize}px failed, retrying at ${NATIVE_INPUT_SIZE}px`, err);
      loaded.inputSize = NATIVE_INPUT_SIZE;
      alpha = await infer(loaded, buffer, width, height, NATIVE_INPUT_SIZE);
    }
    post({ type: "result", id, alpha, width, height }, [alpha.buffer]);
  } catch (err) {
    post({ type: "error", id, message: (err as Error)?.message ?? "Cut-out failed" });
  }
};
