// Wraps @aitjcize/epaper-image-convert: source image bytes -> Spectra-6 dithered output.
// The library handles EXIF rotation, cover-resize to the target geometry, tone-mapping
// and error-diffusion dithering. It reads from a file path, so we stage bytes in a temp file.
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { convertImage, createPNG, createEPDGZ } from "@aitjcize/epaper-image-convert";
import { createCanvas, loadImage } from "canvas";
import type { Orientation } from "./config.js";

export interface ConvertParams {
  width: number;
  height: number;
  orientation: Orientation;
  /** epaper-image-convert processing preset (balanced | dynamic | vivid | soft | grayscale). */
  preset: string;
}

export interface ConvertOutput {
  /** Pre-dithered PNG in the 6-color palette; shown directly by the firmware. */
  png: Buffer;
  /** EPDGZ (4bpp gzipped) of the same output, produced for free by the library. */
  epdgz: Buffer;
}

const PALETTE = "spectra6";

/** Stable short hash of the processing settings (not the image) for cache keys / ETags. */
export function settingsHash(p: ConvertParams): string {
  return createHash("sha1")
    .update(`${p.width}x${p.height}:${p.orientation}:${p.preset}:${PALETTE}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Convert an (already palette-dithered) PNG to EPDGZ — the frame's native 4bpp gzipped format.
 * The frame displays this directly (no multi-MB RGB decode), so it fits in its memory.
 * Pixels are nearest-mapped to the Spectra-6 palette, so composited overlays come through too.
 */
export async function pngToEpdgz(png: Buffer): Promise<Buffer> {
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  return Buffer.from(await createEPDGZ(canvas));
}

export async function convert(source: Buffer, p: ConvertParams): Promise<ConvertOutput> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "photoframe-"));
  const tmp = path.join(dir, `${randomUUID()}.img`);
  try {
    await writeFile(tmp, source);
    const result = await convertImage(tmp, {
      width: p.width,
      height: p.height,
      palettePreset: PALETTE,
      processingPreset: p.preset,
      // Let the library auto-rotate landscape sources to best fill the panel.
      skipRotation: false,
    });
    const png = await createPNG(result.canvas);
    return { png, epdgz: result.buffer };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
