// Type declarations for @aitjcize/epaper-image-convert (ships as plain ESM JS, no types).
// Only the surface we use is declared here.
declare module "@aitjcize/epaper-image-convert" {
  import type { Canvas } from "canvas";

  export interface ConvertOptions {
    /** Target display width in pixels (default 800). */
    width?: number;
    /** Target display height in pixels (default 480). */
    height?: number;
    /** Palette preset name, e.g. "spectra6" (default). */
    palettePreset?: string;
    /** Custom palette pair { theoretical, perceived }. Overrides palettePreset. */
    palette?: unknown;
    /** Processing preset: balanced | dynamic | vivid | soft | grayscale. */
    processingPreset?: string;
    /** Custom processing params, overrides processingPreset. */
    params?: unknown;
    /** Skip automatic portrait rotation of landscape sources (default false). */
    skipRotation?: boolean;
    verbose?: boolean;
  }

  export interface ConvertResult {
    /** Dithered output canvas at target dimensions. */
    canvas: Canvas;
    /** EXIF-corrected source canvas before dithering. */
    originalCanvas: Canvas;
    /** EPDGZ (4bpp gzipped) buffer of the dithered output. */
    buffer: Buffer;
  }

  export function convertImage(
    inputPath: string,
    options?: ConvertOptions,
  ): Promise<ConvertResult>;

  export function createPNG(canvas: Canvas): Promise<Buffer>;
  export function createBMP(canvas: Canvas): Buffer;
  export function createEPDGZ(canvas: Canvas): Promise<Buffer>;
  export function generateThumbnail(canvas: Canvas, maxDimension?: number): Canvas;

  export function getPaletteNames(): string[];
  export function getPresetNames(): string[];
}
