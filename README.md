# 🐾 Sticker Studio

Drop in photos, get back a printable sheet of die-cut stickers.

Point it at a folder of cat pictures and it snips each cat out of its
background, gives it the white die-cut border that makes a sticker look like a
sticker, and arranges the lot on a US Letter or A4 page ready for your printer
and a sheet of sticker paper.

Everything runs in the browser. Photos are never uploaded anywhere.

## How it works

1. **Cut out the subject** — [RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4)
   runs client-side through [transformers.js](https://github.com/huggingface/transformers.js),
   on WebGPU where the browser has it and WebAssembly where it doesn't. The
   weights are fetched from Hugging Face on first use and then cached by the
   browser, so only the first cut-out waits on a download.
2. **Tidy the mask** — stray specks are dropped, the alpha fringe is re-shaped
   to taste, and the result is cropped to the subject.
3. **Add the border** — the silhouette is grown outwards in a few passes and
   filled, giving an even band that follows every contour, plus an optional soft
   shadow.
4. **Lay out the sheet** — stickers are fitted into a centred grid at your
   chosen size, with optional tilt, repeat-to-fill and cut guides.
5. **Export** — a 300 dpi PNG (tagged with its real print size), a
   correctly-sized PDF, or straight to the print dialog.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build && npm start   # production build
npm run typecheck
```

### Test mode

Add `?mock=1` to the URL to swap the model for a crude stand-in cut-out. It
skips the download entirely, which is handy for working on layout and export
without waiting on model weights (and for automated tests).

## Printing tips

- Print at **100% / actual size** — "fit to page" will shrink the sheet and
  your stickers won't match the size you picked.
- The PDF is the most reliable route; it carries the page size with it.
- Turn the sheet background to **No background** for transparent PNGs, or pick a
  colour if you'd rather the paper between stickers were tinted.
- Matte sticker paper cuts cleanly with scissors; glossy needs a sharper blade.

## Project layout

```
app/                 page, layout, global styles
components/          dropzone, sticker tray, controls, sheet preview
lib/canvas.ts        masking, speck removal, trimming, die-cut border
lib/segment.worker.ts model loading and inference, off the main thread
lib/segmenter.ts     worker client + the mock stand-in
lib/pipeline.ts      photo -> cut-out -> finished sticker
lib/sheet.ts         grid maths and page rendering
lib/export.ts        PNG (with dpi tag) and PDF output
```

## Later

Cartoonify and other per-sticker effects, hand-drawn outline styles, mixed
sticker sizes on one sheet, and saved presets.
