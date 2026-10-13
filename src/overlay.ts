// Composites enabled overlay widgets onto the converted photo using node-canvas.
// Widgets are white rounded panels with black (or red-accent) content — palette-friendly
// for the e-paper. Panels stack at their assigned corner.
import { createCanvas, loadImage, type Canvas, type CanvasRenderingContext2D } from "canvas";
import type { Overlay, OverlayItem, OverlayPosition } from "./repositories/overlays.js";
import type { Weather } from "./weather.js";

export interface OverlayContext {
  battery?: number | null;
  nextThumb?: Buffer | null;
  weather?: Weather | null;
  todos?: OverlayItem[];
  birthdays?: OverlayItem[];
  /** Photo buffers for birthday people, keyed by Immich person id (item.ref). */
  faces?: Record<string, Buffer>;
  /** EXIF of the current photo for the date/location overlays. */
  photoDate?: string | null; // ISO taken-at
  photoPlace?: string | null;
}

const CORNERS: OverlayPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

export async function composite(basePng: Buffer, overlays: Overlay[], ctx: OverlayContext): Promise<Buffer> {
  const enabled = overlays.filter((o) => o.enabled);
  if (enabled.length === 0) return basePng;

  const img = await loadImage(basePng);
  const W = img.width;
  const H = img.height;
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");
  g.drawImage(img, 0, 0);

  const margin = Math.round(W * 0.02);
  const baseFont = W * 0.026;

  for (const corner of CORNERS) {
    const list = enabled.filter((o) => o.position === corner);
    let offset = margin;
    for (const o of list) {
      const panel = await renderPanel(o, ctx, baseFont * o.scale, W);
      if (!panel) continue;
      const x = corner.endsWith("left") ? margin : W - margin - panel.width;
      const y = corner.startsWith("top") ? offset : H - offset - panel.height;
      g.drawImage(panel, x, y);
      offset += panel.height + Math.round(margin * 0.6);
    }
  }

  return canvas.toBuffer("image/png");
}

async function renderPanel(o: Overlay, ctx: OverlayContext, fs: number, baseW: number): Promise<Canvas | null> {
  try {
    return await renderPanelInner(o, ctx, fs, baseW);
  } catch (err) {
    console.warn(`[overlay] panel ${o.type} failed:`, (err as Error).message);
    return null;
  }
}

async function renderPanelInner(o: Overlay, ctx: OverlayContext, fs: number, baseW: number): Promise<Canvas | null> {
  switch (o.type) {
    case "battery":
      return ctx.battery == null ? null : batteryPanel(ctx.battery, fs);
    case "weather":
      return ctx.weather ? weatherPanel(ctx.weather, fs) : null;
    case "next_photo":
      return await nextPhotoPanel(ctx.nextThumb ?? null, fs, baseW);
    case "todos": {
      const open = (ctx.todos ?? []).filter((t) => !t.done).slice(0, 5);
      return open.length ? listPanel("To-do", open.map((t) => `• ${t.text}`), fs) : null;
    }
    case "birthdays": {
      const up = upcomingBirthdays(ctx.birthdays ?? []).slice(0, 4);
      return up.length ? await birthdaysPanel(up, ctx.faces ?? {}, fs) : null;
    }
    case "photo_date":
      return ctx.photoDate ? listPanel(formatPhotoDate(ctx.photoDate), [], fs) : null;
    case "photo_place":
      return ctx.photoPlace ? listPanel(ctx.photoPlace, [], fs) : null;
    case "local_time": {
      // Server-side local time at render — a clock to sanity-check the time on the frame.
      const now = new Date();
      const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const date = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      return listPanel(time, [date], fs);
    }
    default:
      return null;
  }
}

// --- panels -------------------------------------------------------------

function listPanel(title: string, lines: string[], fs: number): Canvas {
  const pad = fs * 0.6;
  const lh = fs * 1.35;
  const scratch = createCanvas(10, 10).getContext("2d");
  scratch.font = `bold ${fs}px sans-serif`;
  let w = scratch.measureText(title).width;
  scratch.font = `${fs}px sans-serif`;
  for (const l of lines) w = Math.max(w, scratch.measureText(l).width);
  const width = Math.ceil(w + pad * 2);
  const height = Math.ceil(pad * 2 + lh * (lines.length + 1));
  const { canvas, g } = panelBase(width, height);
  g.fillStyle = "#000";
  g.font = `bold ${fs}px sans-serif`;
  g.textBaseline = "top";
  g.fillText(title, pad, pad);
  g.font = `${fs}px sans-serif`;
  lines.forEach((l, i) => g.fillText(l, pad, pad + lh * (i + 1)));
  return canvas;
}

function weatherPanel(w: Weather, fs: number): Canvas {
  const lines = [`${w.temp}°${w.units}  ${w.description}`];
  if (w.daily[0]) lines.push(`Today ${w.daily[0].min}–${w.daily[0].max}°`);
  return listPanel(w.location, lines, fs);
}

function batteryPanel(pct: number, fs: number): Canvas {
  const pad = fs * 0.6;
  const label = `${Math.round(pct)}%`;
  const iconW = fs * 1.7;
  const iconH = fs * 0.9;
  const scratch = createCanvas(10, 10).getContext("2d");
  scratch.font = `bold ${fs}px sans-serif`;
  const textW = scratch.measureText(label).width;
  const width = Math.ceil(pad * 2 + iconW + fs * 0.4 + textW + fs * 0.2);
  const height = Math.ceil(pad * 2 + Math.max(iconH, fs));
  const { canvas, g } = panelBase(width, height);
  const low = pct <= 20;
  const cy = height / 2;
  // battery outline
  g.strokeStyle = "#000";
  g.lineWidth = Math.max(2, fs * 0.07);
  g.strokeRect(pad, cy - iconH / 2, iconW, iconH);
  g.fillStyle = "#000";
  g.fillRect(pad + iconW, cy - iconH * 0.18, fs * 0.18, iconH * 0.36); // nub
  // fill
  const fillW = (iconW - fs * 0.18) * Math.max(0, Math.min(1, pct / 100));
  g.fillStyle = low ? "#e5161c" : "#000";
  g.fillRect(pad + fs * 0.09, cy - iconH / 2 + fs * 0.09, Math.max(0, fillW - fs * 0.09), iconH - fs * 0.18);
  // label
  g.fillStyle = low ? "#e5161c" : "#000";
  g.font = `bold ${fs}px sans-serif`;
  g.textBaseline = "middle";
  g.fillText(label, pad + iconW + fs * 0.4, cy + 1);
  return canvas;
}

async function nextPhotoPanel(thumb: Buffer | null, fs: number, baseW: number): Promise<Canvas> {
  const pad = fs * 0.5;
  const imgW = Math.round(baseW * 0.16);
  const img = thumb ? await loadImage(thumb) : null;
  const imgH = img ? Math.round((img.height / img.width) * imgW) : Math.round(imgW * 1.33);
  const lh = fs * 1.3;
  const width = imgW + pad * 2;
  const height = Math.ceil(pad * 2 + lh + imgH);
  const { canvas, g } = panelBase(width, height);
  g.fillStyle = "#000";
  g.font = `bold ${fs}px sans-serif`;
  g.textBaseline = "top";
  g.fillText("Next", pad, pad);
  if (img) {
    g.drawImage(img, pad, pad + lh, imgW, imgH);
  } else {
    // No next photo known (e.g. in the preview): draw an empty placeholder so the spot still shows.
    g.fillStyle = "#0002";
    g.fillRect(pad, pad + lh, imgW, imgH);
    g.strokeStyle = "#0004";
    g.strokeRect(pad, pad + lh, imgW, imgH);
  }
  return canvas;
}

// --- helpers ------------------------------------------------------------

function panelBase(width: number, height: number): { canvas: Canvas; g: CanvasRenderingContext2D } {
  const canvas = createCanvas(width, height);
  const g = canvas.getContext("2d");
  // Thick border so it survives e-paper dithering and the rounded corners stay visible.
  const border = Math.max(4, Math.round(Math.min(width, height) * 0.05));
  const inset = border / 2;
  const r = Math.min(width, height) * 0.16;
  roundRect(g, inset, inset, width - border, height - border, r);
  g.fillStyle = "#ffffff"; // opaque white = palette-exact for the e-paper
  g.fill();
  g.strokeStyle = "#000000";
  g.lineWidth = border;
  g.stroke();
  return { canvas, g };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

interface BirthdayRow {
  text: string;
  ref: string | null;
  days: number;
}

function formatPhotoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function upcomingBirthdays(items: OverlayItem[]): BirthdayRow[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const out: BirthdayRow[] = [];
  for (const b of items) {
    if (!b.date) continue;
    const m = /(\d{1,2})-(\d{1,2})$/.exec(b.date); // MM-DD or YYYY-MM-DD
    if (!m) continue;
    const mon = Number(m[1]) - 1;
    const day = Number(m[2]);
    let next = new Date(today.getFullYear(), mon, day);
    if (next < today) next = new Date(today.getFullYear() + 1, mon, day);
    const days = Math.round((next.getTime() - today.getTime()) / 86400000);
    if (days <= 60) out.push({ days, ref: b.ref, text: `${b.text} — ${months[mon]} ${day}` });
  }
  return out.sort((a, b) => a.days - b.days);
}

async function birthdaysPanel(rows: BirthdayRow[], faces: Record<string, Buffer>, fs: number): Promise<Canvas> {
  const pad = fs * 0.6;
  const photo = fs * 1.8;
  const gap = fs * 0.5;
  const rowH = Math.max(photo, fs) + fs * 0.4;
  const scratch = createCanvas(10, 10).getContext("2d");
  scratch.font = `${fs}px sans-serif`;
  let textW = 0;
  for (const r of rows) textW = Math.max(textW, scratch.measureText(r.text).width);
  const width = Math.ceil(pad * 2 + photo + gap + textW);
  const height = Math.ceil(pad * 2 + fs * 1.35 + rows.length * rowH);
  const { canvas, g } = panelBase(width, height);
  g.fillStyle = "#000";
  g.textBaseline = "top";
  g.font = `bold ${fs}px sans-serif`;
  g.fillText("Birthdays", pad, pad);

  let y = pad + fs * 1.35;
  for (const r of rows) {
    const cy = y + rowH / 2;
    const buf = r.ref ? faces[r.ref] : undefined;
    if (buf) {
      try {
        const img = await loadImage(buf);
        const side = Math.min(img.width, img.height);
        g.save();
        roundRect(g, pad, cy - photo / 2, photo, photo, photo * 0.25);
        g.clip();
        g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, pad, cy - photo / 2, photo, photo);
        g.restore();
      } catch {
        /* no photo */
      }
    }
    g.fillStyle = "#000";
    g.font = `${fs}px sans-serif`;
    g.textBaseline = "middle";
    g.fillText(r.text, pad + photo + gap, cy);
    y += rowH;
  }
  return canvas;
}
