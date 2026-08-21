import { jsPDF } from "jspdf";
import { AnyCanvas, canvasToBlob } from "./canvas";
import { PAGE_SIZES, PageSizeId } from "./types";

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Stamp a pHYs chunk into a PNG so image viewers and printers know it is a
 * 300 dpi page rather than a giant 72 dpi one. Without this, "print actual
 * size" comes out several times too big.
 */
export async function tagPngDpi(blob: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // 8-byte signature, then the IHDR chunk (4 length + 4 type + 13 data + 4 crc).
  const insertAt = 8 + 25;
  if (bytes.length < insertAt) return blob;

  const perMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1; // unit: metres
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(bytes.subarray(insertAt), insertAt + chunk.length);
  return new Blob([out], { type: "image/png" });
}

export async function exportPng(canvas: AnyCanvas, filename: string, dpi = 300) {
  const png = await canvasToBlob(canvas, "image/png");
  saveBlob(await tagPngDpi(png, dpi), filename);
}

export async function exportPdf(pages: AnyCanvas[], pageSize: PageSizeId, filename: string) {
  const { widthIn, heightIn } = PAGE_SIZES[pageSize];
  const doc = new jsPDF({
    unit: "in",
    format: [widthIn, heightIn],
    orientation: "portrait",
    compress: true,
  });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) doc.addPage([widthIn, heightIn], "portrait");
    const dataUrl = await blobToDataUrl(await canvasToBlob(pages[i], "image/png"));
    doc.addImage(dataUrl, "PNG", 0, 0, widthIn, heightIn, undefined, "FAST");
  }
  doc.save(filename);
}
