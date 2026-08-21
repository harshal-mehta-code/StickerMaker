"use client";

import { useEffect, useState } from "react";
import { cutoutLimit, decodeLimit, deviceProfile, inferenceSize } from "@/lib/device";
import { SegmenterState } from "@/lib/segmenter";
import { StickerItem } from "@/lib/types";

/**
 * A copyable summary of what the studio actually chose to run. Cut-outs happen
 * entirely on the user's device, so when something fails there is no server log
 * to go and read -- this is the only way the details reach anyone who can act
 * on them.
 */
export function Diagnostics({ state, items }: { state: SegmenterState; items: StickerItem[] }) {
  const [report, setReport] = useState("");
  const [copied, setCopied] = useState(false);
  const failures = items.filter((item) => item.status === "error");

  useEffect(() => {
    const profile = deviceProfile();
    const lines = [
      `device: ${profile.iOS ? "iOS" : profile.mobile ? "mobile" : "desktop"}${
        profile.constrained ? " (constrained)" : ""
      }`,
      `memory: ${profile.memoryGb ? `${profile.memoryGb} GB` : "not reported"}`,
      `engine: ${state.phase}${state.phase === "ready" ? ` · ${state.backend}` : ""}`,
      state.phase === "ready"
        ? `weights: ${state.dtype ?? "?"}${state.bytes ? ` · ${Math.round(state.bytes / (1024 * 1024))} MB` : ""}`
        : null,
      `inference: ${state.phase === "ready" && state.inputSize ? state.inputSize : inferenceSize(profile)} px`,
      `limits: decode ${decodeLimit(profile)} px · cut-out ${cutoutLimit(profile)} px`,
      `screen: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}`,
      `ua: ${navigator.userAgent}`,
      ...failures.map((item) => `error [${item.fileName}]: ${item.error ?? "unknown"}`),
    ].filter(Boolean);
    setReport(lines.join("\n"));
  }, [state, items, failures.length]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the text is on screen to select anyway.
      setCopied(false);
    }
  };

  return (
    <details className="rounded-2xl border-2 border-line bg-cream/60 px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-bold text-ink-soft">
        What&apos;s running under the hood{failures.length > 0 ? ` · ${failures.length} failed` : ""}
      </summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-ink-soft">
        {report}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="mt-1 rounded-full bg-paper px-3 py-1 font-display text-[11px] font-bold text-ink shadow-[0_2px_0_var(--color-line)]"
      >
        {copied ? "copied ✓" : "copy details"}
      </button>
    </details>
  );
}
