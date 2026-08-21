"use client";

import { ReactNode } from "react";

export function Card({
  children,
  className = "",
  tone = "paper",
}: {
  children: ReactNode;
  className?: string;
  tone?: "paper" | "cream";
}) {
  const bg = tone === "cream" ? "bg-cream/70" : "bg-paper";
  return (
    <section
      className={`${bg} rounded-[1.75rem] border-2 border-line shadow-[0_10px_0_-4px_rgba(242,226,211,0.9),0_18px_36px_-24px_rgba(74,59,51,0.5)] ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionTitle({ icon, children, hint }: { icon: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span aria-hidden className="text-lg leading-none">
        {icon}
      </span>
      <h2 className="font-display text-lg font-extrabold tracking-tight text-ink">{children}</h2>
      {hint ? <span className="ml-auto text-[11px] font-semibold text-ink-soft">{hint}</span> : null}
    </div>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "mint" | "ghost";
  size?: "md" | "sm";
  className?: string;
  title?: string;
  type?: "button" | "submit";
};

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  size = "md",
  className = "",
  title,
  type = "button",
}: ButtonProps) {
  const palettes: Record<string, string> = {
    primary: "bg-coral text-white shadow-[0_4px_0_var(--color-coral-deep)]",
    mint: "bg-mint text-[#0f4d38] shadow-[0_4px_0_var(--color-mint-deep)]",
    ghost: "bg-paper text-ink border-2 border-line shadow-[0_4px_0_var(--color-line)]",
  };
  const sizes = size === "sm" ? "px-3 py-1.5 text-xs" : "px-5 py-2.5 text-sm";
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`btn-pop inline-flex items-center justify-center gap-2 rounded-full font-display font-bold tracking-tight ${palettes[variant]} ${sizes} ${className}`}
    >
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-bold text-ink-soft">
        {label}
        <span className="rounded-full bg-cream px-2 py-0.5 font-display text-[11px] text-ink">
          {format ? format(value) : value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-2xl px-1 py-1.5 text-left transition-colors hover:bg-cream/70"
    >
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full border-2 transition-colors ${
          checked ? "border-mint-deep bg-mint" : "border-line bg-cream-deep"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-ink">{label}</span>
        {hint ? <span className="block text-[11px] text-ink-soft">{hint}</span> : null}
      </span>
    </button>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      {label ? <span className="mb-1.5 block text-xs font-bold text-ink-soft">{label}</span> : null}
      <div className="flex gap-1 rounded-full border-2 border-line bg-cream p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-full px-2 py-1.5 font-display text-xs font-bold transition-all ${
              value === option.value
                ? "bg-paper text-ink shadow-[0_2px_0_var(--color-line)]"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Swatches<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; color: string | null; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-bold text-ink-soft">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`h-8 w-8 rounded-full border-2 transition-all ${
              value === option.value
                ? "border-coral ring-2 ring-coral/30 scale-110"
                : "border-line hover:border-ink-soft"
            } ${option.color ? "" : "checkerboard"}`}
            style={option.color ? { background: option.color } : undefined}
          />
        ))}
      </div>
    </div>
  );
}
