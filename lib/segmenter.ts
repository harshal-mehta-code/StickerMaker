/**
 * Main-thread front end for the background-removal worker: one worker, one
 * queue, promises per image.
 */

export type SegmenterState =
  | { phase: "idle" }
  | { phase: "loading"; backend: string; progress: number; bytes?: number }
  | { phase: "ready"; backend: string }
  | { phase: "error"; message: string };

type Pending = {
  resolve: (mask: Uint8Array) => void;
  reject: (err: Error) => void;
};

export class Segmenter {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();
  private counter = 0;
  private listeners = new Set<(state: SegmenterState) => void>();
  state: SegmenterState = { phase: "idle" };

  subscribe(fn: (state: SegmenterState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  protected setState(state: SegmenterState) {
    this.state = state;
    this.listeners.forEach((fn) => fn(state));
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./segment.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data ?? {};
      switch (data.type) {
        case "loading":
          this.setState({
            phase: "loading",
            backend: data.backend,
            progress: data.progress ?? 0,
            bytes: data.bytes,
          });
          break;
        case "loaded":
          this.setState({ phase: "ready", backend: data.backend });
          break;
        case "result": {
          const entry = this.pending.get(data.id);
          if (entry) {
            this.pending.delete(data.id);
            entry.resolve(new Uint8Array(data.alpha));
          }
          break;
        }
        case "error": {
          const message: string = data.message ?? "Cut-out failed";
          if (data.id && this.pending.has(data.id)) {
            const entry = this.pending.get(data.id)!;
            this.pending.delete(data.id);
            entry.reject(new Error(message));
          } else {
            this.setState({ phase: "error", message });
            this.pending.forEach((p) => p.reject(new Error(message)));
            this.pending.clear();
          }
          break;
        }
      }
    };
    worker.onerror = (event) => {
      const message = event.message || "The cut-out worker crashed";
      this.setState({ phase: "error", message });
      this.pending.forEach((p) => p.reject(new Error(message)));
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  warmup() {
    this.ensureWorker().postMessage({ type: "warmup" });
  }

  /** Returns a single-channel alpha mask the same size as the input. */
  segment(image: ImageData): Promise<Uint8Array> {
    const worker = this.ensureWorker();
    const id = `seg-${++this.counter}`;
    const buffer = image.data.buffer.slice(0) as ArrayBuffer;
    return new Promise<Uint8Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: "segment", id, buffer, width: image.width, height: image.height }, [buffer]);
    });
  }
}

/**
 * A model-free stand-in used by `?mock=1`, so the layout and export pipeline can
 * be exercised (and demoed offline) without a 170 MB download. It keeps a soft
 * centre oval and drops pixels that match the photo's border colour.
 */
export class MockSegmenter extends Segmenter {
  override warmup() {
    this.setState({ phase: "ready", backend: "mock" });
  }

  override async segment(image: ImageData): Promise<Uint8Array> {
    const { width, height, data } = image;
    const mask = new Uint8Array(width * height);
    const cx = width / 2;
    const cy = height / 2;
    const rx = width * 0.42;
    const ry = height * 0.42;
    // Average the four corners to guess the backdrop colour.
    const corners = [0, (width - 1) * 4, (height - 1) * width * 4, (width * height - 1) * 4];
    let br = 0;
    let bg = 0;
    let bb = 0;
    for (const c of corners) {
      br += data[c];
      bg += data[c + 1];
      bb += data[c + 2];
    }
    br /= 4;
    bg /= 4;
    bb /= 4;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const p = i * 4;
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const oval = Math.max(0, 1 - (dx * dx + dy * dy));
        const dist = Math.abs(data[p] - br) + Math.abs(data[p + 1] - bg) + Math.abs(data[p + 2] - bb);
        const notBackdrop = Math.min(1, dist / 120);
        mask[i] = Math.round(Math.min(1, oval * 3) * notBackdrop * 255);
      }
    }
    return mask;
  }
}

let instance: Segmenter | null = null;

export function getSegmenter(): Segmenter {
  if (!instance) {
    const mock =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mock") === "1";
    instance = mock ? new MockSegmenter() : new Segmenter();
  }
  return instance;
}

export function isMockMode(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mock") === "1";
}
