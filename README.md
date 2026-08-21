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
2. **Tidy the mask** — while it is still at full resolution, the mask is
   blurred and re-thresholded to kill speckle, opened to drop what survives,
   closed to fill pinholes, and pruned of islands too small to be part of the
   subject. Then the result is cropped. See below.
3. **Add the border** — the silhouette is grown outwards in a few passes and
   filled, giving an even band that follows every contour, plus an optional soft
   shadow.
4. **Lay out the sheet** — stickers are fitted into a centred grid at your
   chosen size, with optional tilt, repeat-to-fill and cut guides.
5. **Polish by hand** — anything the model got wrong can be fixed per sticker:
   tap a leftover blob to delete it outright, brush away a stray edge, or paint
   back a bit that was wrongly cut.
6. **Export** — a 300 dpi PNG (tagged with its real print size), a
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

## Mask clean-up

A matting model's raw output is speckled: stray pixels of carpet keep some
alpha, fur gradients leave pinholes, and the contour is jagged pixel to pixel.
At sticker size all of that prints as dirt around the edge.

`lib/mask.ts` runs a fixed pipeline on the full-resolution mask — blur,
re-threshold, open, close, prune islands, soften — which on a synthetic case
with 3538 px of scattered noise, a stray corner blob and 196 pinholes leaves
zero noise and zero holes while keeping 100% of the subject, including a thin
limb 22 px wide. Detail that thin surviving is the point: the aim is to remove
what the model was unsure about without amputating what it was sure about.

Two things stay adjustable per sheet, because they are taste rather than
correctness: **edge smoothing** (extra contour blur) and **edge crispness**
(where the alpha cut-off sits — low keeps wispy fur, high gives a clean
die-cut edge). Both re-render from the stored cut-out, so they are live.

## Polishing a sticker by hand

No mask is right every time, so each sticker has a full-screen editor (the ✏️
on its thumbnail):

- **Zap blob** — tap a leftover lump and the whole connected region goes. This
  is the one-tap answer to "it kept a scrap of the sofa".
- **Erase** — brush away anything else that shouldn't be there.
- **Bring back** — paint back a bit the cut-out missed. "Show what was cut"
  fades the discarded pixels in so it is obvious where to paint.

**Zoom and pan** are what make fine work possible: pinch or scroll to zoom,
drag with two fingers (or one, with ✋, or with any tool that has no drag
action) to pan, and `+` / `-` / `0` on a keyboard. The brush is sized in image
pixels, so zooming in is what buys precision — the same 120-pixel gesture on
screen covers 985 image pixels at fit and 102 at 967%.

Two rules keep gestures from costing you work. A blob tap fires on *release*,
not on contact, so the first finger of a pinch cannot delete anything; and if a
second finger lands mid-stroke, the stroke is rolled back before the zoom
begins. Undo keeps the last dozen steps, storing alpha snapshots only since the
colour channels never change — on a phone that is the difference between
working and not.

Painting detail back needs the original pixels, which the cut-out cannot
supply: once alpha hits zero the colour is gone through the first canvas round
trip. Rather than keep a second full copy of every photo in memory, the crop
box is recorded at extraction and the file is simply decoded again when the
editor opens.

## Memory, and why phones get different settings

RMBG-1.4 is an IS-Net. Its early layers hold 64 channels at the full input
resolution, so a run needs a single ~270 MB activation tensor, on top of the
weights. Desktop browsers shrug at that; iOS Safari kills the tab, which
surfaces as "a problem repeatedly occurred".

The one knob that is *not* available is the model's own input size: this ONNX
export declares static 1024 x 1024 dimensions, and onnxruntime rejects anything
else outright. So the savings come from the weights and the images:

| | desktop | phone / tablet |
| --- | --- | --- |
| weights | full precision preferred | quantised preferred (~42 MB vs ~176 MB) |
| inference size | 1024 px | 1024 px (fixed by the model) |
| photo decoded to | 1400 px | 1024 px |
| cut-out kept at | 1000 px | 700 px |

Before downloading anything it sends a `HEAD` request for each weight file, so
it knows what exists and how big it is rather than discovering a 404 part-way
through a large download, and the real size is shown in the progress banner. On
a small device it will refuse a model that won't fit, and say so, rather than
starting a download that takes the tab down.

When a cut-out does fail, the message is shown on the thumbnail, and the
"What's running under the hood" panel under the photo tray reports the device,
backend, weights, limits and every failure, with a copy button. Cut-outs happen
on-device, so there is no server log — that panel is the only way the details
reach anyone who can act on them.

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
