"use client";

import {
  PAGE_SIZES,
  PageSizeId,
  SHEET_BACKGROUNDS,
  SheetBackground,
  SheetConfig,
  StickerStyle,
} from "@/lib/types";
import { Grid } from "@/lib/sheet";
import { SectionTitle, SegmentedControl, Slider, Swatches, Toggle } from "./ui";

const inches = (value: number) => `${value.toFixed(2)}"`;

const BACKGROUND_LABELS: Record<SheetBackground, string> = {
  transparent: "No background",
  white: "White paper",
  cream: "Cream",
  blush: "Blush",
  mint: "Mint",
  sky: "Sky",
};

export function StyleControls({
  style,
  onChange,
}: {
  style: StickerStyle;
  onChange: (style: StickerStyle) => void;
}) {
  const set = <K extends keyof StickerStyle>(key: K, value: StickerStyle[K]) =>
    onChange({ ...style, [key]: value });

  return (
    <div className="space-y-4">
      <SectionTitle icon="✂️">Sticker look</SectionTitle>
      <Slider
        label="White border"
        min={0}
        max={0.09}
        step={0.005}
        value={style.outline}
        onChange={(value) => set("outline", value)}
        format={(value) => (value === 0 ? "none" : `${Math.round(value * 1000) / 10}%`)}
      />
      <Slider
        label="Edge crispness"
        min={0.05}
        max={0.8}
        step={0.05}
        value={style.edgeTrim}
        onChange={(value) => set("edgeTrim", value)}
        format={(value) => (value < 0.3 ? "fluffy" : value < 0.55 ? "balanced" : "crisp")}
      />
      <Swatches
        label="Border colour"
        value={style.outlineColor}
        onChange={(value) => set("outlineColor", value)}
        options={[
          { value: "#ffffff", color: "#ffffff", label: "White" },
          { value: "#FFF1DC", color: "#FFF1DC", label: "Cream" },
          { value: "#FFD98E", color: "#FFD98E", label: "Butter" },
          { value: "#FF8A7A", color: "#FF8A7A", label: "Coral" },
          { value: "#7ED3B2", color: "#7ED3B2", label: "Mint" },
          { value: "#BFB2F6", color: "#BFB2F6", label: "Lilac" },
          { value: "#4A3B33", color: "#4A3B33", label: "Ink" },
        ]}
      />
      <Toggle
        label="Soft shadow"
        hint="A gentle drop shadow under each sticker"
        checked={style.shadow}
        onChange={(value) => set("shadow", value)}
      />
    </div>
  );
}

export function SheetControls({
  sheet,
  grid,
  onChange,
}: {
  sheet: SheetConfig;
  grid: Grid;
  onChange: (sheet: SheetConfig) => void;
}) {
  const set = <K extends keyof SheetConfig>(key: K, value: SheetConfig[K]) =>
    onChange({ ...sheet, [key]: value });

  return (
    <div className="space-y-4">
      <SectionTitle icon="📄" hint={`${grid.cols} × ${grid.rows} = ${grid.perPage} per sheet`}>
        Sheet layout
      </SectionTitle>
      <SegmentedControl<PageSizeId>
        label="Paper"
        value={sheet.pageSize}
        onChange={(value) => set("pageSize", value)}
        options={Object.values(PAGE_SIZES).map((page) => ({
          value: page.id,
          label: page.id === "letter" ? "US Letter" : "A4",
        }))}
      />
      <Slider
        label="Sticker size"
        min={0.6}
        max={3.5}
        step={0.05}
        value={sheet.stickerSizeIn}
        onChange={(value) => set("stickerSizeIn", value)}
        format={inches}
      />
      <Slider
        label="Spacing"
        min={0}
        max={0.6}
        step={0.02}
        value={sheet.gapIn}
        onChange={(value) => set("gapIn", value)}
        format={inches}
      />
      <Slider
        label="Page margin"
        min={0.1}
        max={1}
        step={0.05}
        value={sheet.marginIn}
        onChange={(value) => set("marginIn", value)}
        format={inches}
      />
      <Slider
        label="Playful tilt"
        min={0}
        max={20}
        step={1}
        value={sheet.jitter}
        onChange={(value) => set("jitter", value)}
        format={(value) => (value === 0 ? "straight" : `±${value}°`)}
      />
      <Swatches<SheetBackground>
        label="Sheet background"
        value={sheet.background}
        onChange={(value) => set("background", value)}
        options={(Object.keys(SHEET_BACKGROUNDS) as SheetBackground[]).map((key) => ({
          value: key,
          color: SHEET_BACKGROUNDS[key],
          label: BACKGROUND_LABELS[key],
        }))}
      />
      <div className="space-y-1 pt-1">
        <Toggle
          label="Fill the whole sheet"
          hint="Repeat your stickers until every slot is taken"
          checked={sheet.fillPage}
          onChange={(value) => set("fillPage", value)}
        />
        <Toggle
          label="Shuffle the order"
          checked={sheet.shuffle}
          onChange={(value) => set("shuffle", value)}
        />
        <Toggle
          label="Show cut guides"
          hint="Faint dashed boxes — handy for scissors"
          checked={sheet.cutGuides}
          onChange={(value) => set("cutGuides", value)}
        />
      </div>
    </div>
  );
}
