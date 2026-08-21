"use client";

import { StickerItem } from "@/lib/types";
import { Button } from "./ui";

function StatusBadge({ item }: { item: StickerItem }) {
  if (item.status === "ready") return null;
  const map: Record<string, { text: string; className: string }> = {
    queued: { text: "waiting", className: "bg-butter/80 text-ink" },
    working: { text: "snipping…", className: "bg-lilac/80 text-white" },
    error: { text: "oops", className: "bg-coral text-white" },
  };
  const badge = map[item.status];
  return (
    <span
      className={`absolute inset-x-1 bottom-1 rounded-full px-2 py-0.5 text-center font-display text-[10px] font-bold ${badge.className}`}
    >
      {badge.text}
    </span>
  );
}

export function StickerTray({
  items,
  onRemove,
  onToggle,
  onCopies,
  onRetry,
  onEdit,
}: {
  items: StickerItem[];
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onCopies: (id: string, copies: number) => void;
  onRetry: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl bg-cream/70 px-4 py-6 text-center text-xs font-semibold text-ink-soft">
        Your cut-outs will land here. ✂️
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.id} className="group relative">
          <button
            type="button"
            onClick={() => item.status === "ready" && onToggle(item.id, !item.enabled)}
            title={item.enabled ? "Click to leave off the sheet" : "Click to put back on the sheet"}
            className={`checkerboard relative block aspect-square w-full overflow-hidden rounded-2xl border-2 transition-all ${
              item.enabled && item.status === "ready"
                ? "border-mint shadow-[0_3px_0_var(--color-mint-deep)]"
                : "border-line opacity-60 grayscale"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.stickerUrl ?? item.sourceUrl}
              alt={item.fileName}
              className="h-full w-full object-contain p-1"
            />
            {item.status === "working" ? (
              <span className="absolute inset-0 flex items-center justify-center bg-white/60 text-xl animate-wiggle">
                ✂️
              </span>
            ) : null}
            <StatusBadge item={item} />
          </button>

          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={`Remove ${item.fileName}`}
            className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full border-2 border-white bg-ink/80 text-xs font-bold text-white opacity-60 transition-opacity group-hover:opacity-100 focus:opacity-100"
          >
            ×
          </button>

          {item.status === "ready" ? (
            <button
              type="button"
              onClick={() => onEdit(item.id)}
              aria-label={`Polish ${item.fileName}`}
              title="Polish this sticker"
              className="absolute -left-1.5 -top-1.5 h-6 w-6 rounded-full border-2 border-white bg-lilac text-[11px] shadow"
            >
              ✏️
            </button>
          ) : null}

          {item.status === "ready" ? (
            <div className="mt-1 flex items-center justify-center gap-1">
              <button
                type="button"
                aria-label="Fewer copies"
                onClick={() => onCopies(item.id, item.copies - 1)}
                className="h-5 w-5 rounded-full bg-cream-deep font-display text-xs font-bold text-ink hover:bg-butter"
              >
                −
              </button>
              <span className="min-w-6 text-center font-display text-[11px] font-bold text-ink-soft">
                ×{item.copies}
              </span>
              <button
                type="button"
                aria-label="More copies"
                onClick={() => onCopies(item.id, item.copies + 1)}
                className="h-5 w-5 rounded-full bg-cream-deep font-display text-xs font-bold text-ink hover:bg-butter"
              >
                +
              </button>
            </div>
          ) : null}

          {item.status === "error" ? (
            <div className="mt-1 space-y-1 text-center">
              {/* The message is the whole point of an error state -- "oops" on
                  its own tells nobody anything. */}
              <p
                title={item.error}
                className="break-words rounded-lg bg-coral/10 px-1.5 py-1 text-[10px] font-semibold leading-tight text-coral-deep"
              >
                {item.error ?? "Something went wrong"}
              </p>
              <Button size="sm" variant="ghost" onClick={() => onRetry(item.id)}>
                retry
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
