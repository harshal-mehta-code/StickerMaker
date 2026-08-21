export type PageSizeId = "letter" | "a4";

export interface PageSize {
  id: PageSizeId;
  label: string;
  widthIn: number;
  heightIn: number;
}

export const PAGE_SIZES: Record<PageSizeId, PageSize> = {
  letter: { id: "letter", label: 'US Letter (8.5" × 11")', widthIn: 8.5, heightIn: 11 },
  a4: { id: "a4", label: "A4 (210 × 297 mm)", widthIn: 8.2677, heightIn: 11.6929 },
};

export type StickerStatus = "queued" | "working" | "ready" | "error";

export interface StickerItem {
  id: string;
  fileName: string;
  status: StickerStatus;
  error?: string;
  /** Original photo, downscaled for display. */
  sourceUrl: string;
  /** Finished die-cut sticker (transparent PNG) as an object URL. */
  stickerUrl?: string;
  /** Decoded bitmap of the finished sticker, used for sheet rendering. */
  bitmap?: ImageBitmap;
  /** Included in the sheet? */
  enabled: boolean;
  /** How many times this sticker repeats on the sheet. */
  copies: number;
}

export interface StickerStyle {
  /** White die-cut border width, as a fraction of the sticker's longest side. */
  outline: number;
  outlineColor: string;
  /** Soft drop shadow under the sticker. */
  shadow: boolean;
  /** Cut away semi-transparent fringe pixels below this alpha (0-1). */
  edgeTrim: number;
}

export type SheetBackground = "transparent" | "white" | "cream" | "blush" | "mint" | "sky";

export interface SheetConfig {
  pageSize: PageSizeId;
  /** Target size of the longest side of each sticker, in inches. */
  stickerSizeIn: number;
  marginIn: number;
  gapIn: number;
  /** Repeat the stickers until the page is full. */
  fillPage: boolean;
  /** Max random rotation per sticker, in degrees. */
  jitter: number;
  background: SheetBackground;
  cutGuides: boolean;
  /** Randomise placement order. */
  shuffle: boolean;
}

export const DEFAULT_STYLE: StickerStyle = {
  outline: 0.035,
  outlineColor: "#ffffff",
  shadow: true,
  edgeTrim: 0.35,
};

export const DEFAULT_SHEET: SheetConfig = {
  pageSize: "letter",
  stickerSizeIn: 1.6,
  marginIn: 0.35,
  gapIn: 0.16,
  fillPage: true,
  jitter: 4,
  background: "transparent",
  cutGuides: false,
  shuffle: false,
};

export const SHEET_BACKGROUNDS: Record<SheetBackground, string | null> = {
  transparent: null,
  white: "#ffffff",
  cream: "#FFF6EA",
  blush: "#FFEDEC",
  mint: "#EAF8F1",
  sky: "#EAF2FD",
};
