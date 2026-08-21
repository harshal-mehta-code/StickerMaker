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
   browser, so only the first cut-out waits on a download. Which weights, and at
   what resolution, depends on the device — see below.
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

## Memory, and why phones get a different model

RMBG-1.4 is an IS-Net. Its early layers hold 64 channels at the full input
resolution, so a 1024 x 1024 run needs a single ~270 MB activation tensor, on
top of ~176 MB of full-precision weights. Desktop browsers shrug at that; iOS
Safari kills the tab, which surfaces as "a problem repeatedly occurred".

So the studio sizes the job to the device:

| | desktop | phone / tablet |
| --- | --- | --- |
| weights | full precision preferred | quantised preferred (~4x smaller) |
| inference size | 1024 px | 512 px (~4x less activation memory) |
| photo decoded to | 1400 px | 900 px |
| cut-out kept at | 1000 px | 700 px |

Two rules keep it honest. Before downloading anything it sends a `HEAD` request
for each weight file, so it knows what exists and how big it is rather than
discovering a 404 part-way through a large download — and the real size is shown
in the progress banner. And on a small device it will refuse a model that
won't fit, and say so, rather than starting a download that takes the tab down.

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
