"use client";

import { useEffect, useMemo, useState } from "react";
import { Dropzone } from "@/components/Dropzone";
import { SheetPreview } from "@/components/SheetPreview";
import { StickerTray } from "@/components/StickerTray";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button, Card, SectionTitle } from "@/components/ui";
import { deviceProfile } from "@/lib/device";
import { computeGrid } from "@/lib/sheet";
import { useStudio } from "@/lib/useStudio";
import { SheetControls, StyleControls } from "@/components/Controls";

function ModelStatus({ state, mock }: { state: ReturnType<typeof useStudio>["segState"]; mock: boolean }) {
  if (mock) {
    return (
      <p className="rounded-2xl border-2 border-butter bg-butter/30 px-3 py-2 text-[11px] font-bold text-ink">
        🧪 Test mode — using a stand-in cut-out instead of the AI model.
      </p>
    );
  }
  if (state.phase === "loading") {
    const size = state.bytes ? ` · ${Math.round(state.bytes / (1024 * 1024))} MB` : "";
    return (
      <div className="rounded-2xl border-2 border-lilac/50 bg-lilac/15 px-3 py-2">
        <p className="text-[11px] font-bold text-ink">
          Waking up the cut-out brain… {Math.round(state.progress * 100)}%{size}
        </p>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white">
          <div
            className="h-full rounded-full bg-lilac transition-all"
            style={{ width: `${Math.max(4, state.progress * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] font-semibold text-ink-soft">
          One-time download, then it stays cached in your browser.
        </p>
      </div>
    );
  }
  if (state.phase === "ready") {
    return (
      <p className="text-[11px] font-bold text-mint-deep">
        ✅ Cut-out engine ready ({state.backend === "webgpu" ? "GPU" : state.backend}).
      </p>
    );
  }
  if (state.phase === "error") {
    return (
      <p className="rounded-2xl border-2 border-coral/40 bg-coral/10 px-3 py-2 text-[11px] font-bold text-coral-deep">
        Couldn&apos;t start the cut-out engine: {state.message}
      </p>
    );
  }
  return null;
}

function MobileNote() {
  // Read after mount: the server has no user agent to go on.
  const [constrained, setConstrained] = useState(false);
  useEffect(() => setConstrained(deviceProfile().constrained), []);
  if (!constrained) return null;
  return (
    <p className="rounded-2xl border-2 border-butter bg-butter/25 px-3 py-2 text-[11px] font-bold text-ink">
      📱 On a phone or tablet the studio uses a smaller, lighter cut-out model so the browser doesn&apos;t run
      out of memory. Edges come out a little softer than on a laptop — and a few photos at a time works better
      than a big batch.
    </p>
  );
}

export default function Page() {
  const studio = useStudio();
  const grid = useMemo(() => computeGrid(studio.sheet), [studio.sheet]);
  const readyCount = studio.items.filter((item) => item.status === "ready" && item.enabled).length;

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-16 pt-6 sm:px-6">
      <header className="relative mb-6 text-center">
        <span
          className="pointer-events-none absolute left-2 top-2 hidden text-3xl opacity-40 animate-float sm:block"
          style={{ ["--tilt" as string]: "-12deg" }}
          aria-hidden
        >
          🐾
        </span>
        <span
          className="pointer-events-none absolute right-3 top-6 hidden text-2xl opacity-40 animate-float sm:block"
          style={{ ["--tilt" as string]: "14deg" }}
          aria-hidden
        >
          ✂️
        </span>
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Sticker&nbsp;Studio
        </h1>
        <p className="mx-auto mt-1 max-w-lg text-sm font-semibold text-ink-soft">
          Drop in your photos, we snip out the star of each one, and you get a printable sheet of die-cut
          stickers. Everything happens right here in your browser. 🐈
        </p>
      </header>

      {/* On phones the sheet sits right under the photo tray; on desktop the
          controls stack down the left and the sheet stays put on the right. */}
      <ErrorBoundary>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,370px)_minmax(0,1fr)]">
          <Card className="p-4 lg:col-start-1 lg:row-start-1">
            <SectionTitle
              icon="📸"
              hint={
                studio.items.length
                  ? `${studio.items.length} photo${studio.items.length === 1 ? "" : "s"}`
                  : undefined
              }
            >
              Your photos
            </SectionTitle>
            <Dropzone onFiles={studio.addFiles} compact={studio.items.length > 0} />
            <div className="mt-3 space-y-3">
              <MobileNote />
              <ModelStatus state={studio.segState} mock={studio.mockMode} />
              <StickerTray
                items={studio.items}
                onRemove={studio.removeItem}
                onToggle={studio.toggleItem}
                onCopies={studio.setCopies}
                onRetry={studio.retry}
              />
              {studio.items.length > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-ink-soft">{readyCount} on the sheet</span>
                  <Button size="sm" variant="ghost" onClick={studio.clearAll}>
                    clear all
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>

          <Card
            tone="cream"
            className="p-4 sm:p-6 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-6 lg:self-start"
          >
            <SheetPreview items={studio.items} sheet={studio.sheet} busy={studio.restyling} />
          </Card>

          <div className="space-y-5 lg:col-start-1 lg:row-start-2">
            <Card className="p-4">
              <StyleControls style={studio.style} onChange={studio.setStyle} />
            </Card>
            <Card className="p-4">
              <SheetControls sheet={studio.sheet} grid={grid} onChange={studio.setSheet} />
            </Card>
          </div>
        </div>
      </ErrorBoundary>

      <footer className="mt-10 text-center text-[11px] font-semibold text-ink-soft">
        Made for sticker paper, scissors and very patient cats. · Photos never leave your device.
      </footer>
    </div>
  );
}
