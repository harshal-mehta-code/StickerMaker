"use client";

import { useCallback, useRef, useState } from "react";

export function Dropzone({ onFiles, compact }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setOver(false);
      onFiles(Array.from(event.dataTransfer.files));
    },
    [onFiles]
  );

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
      }}
      className={`group cursor-pointer rounded-[1.5rem] border-[3px] border-dashed text-center transition-all ${
        compact ? "px-4 py-5" : "px-6 py-10"
      } ${
        over
          ? "border-coral bg-coral/10 scale-[1.01]"
          : "border-line bg-cream/60 hover:border-coral/60 hover:bg-coral/5"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <div className={`${compact ? "text-2xl" : "text-4xl"} ${over ? "animate-wiggle" : ""}`} aria-hidden>
        {over ? "😻" : "🐾"}
      </div>
      <p className={`mt-2 font-display font-extrabold text-ink ${compact ? "text-sm" : "text-lg"}`}>
        {over ? "Drop them right here!" : "Drop photos here"}
      </p>
      {!compact ? (
        <p className="mt-1 text-xs font-semibold text-ink-soft">
          or click to browse · JPG, PNG, WebP · pick as many as you like
        </p>
      ) : null}
    </div>
  );
}
