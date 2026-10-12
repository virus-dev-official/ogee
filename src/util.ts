/** Escapes text for HTML content and attribute values. */
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 32-bit FNV-1a. Small, fast and stable everywhere, which is all we need it for. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const hashHex = (s: string) => hash(s).toString(36);

/** A stable random number in [0, 1) for a seed and an index. */
export function rand(seed: number, i: number): number {
  let t = (seed + Math.imul(i + 1, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

/** Paths whose last segment has a file extension are assets (JS, CSS, images…), not pages. */
export const isAssetPath = (path: string) => /\.[a-z0-9]{1,8}$/i.test(path.split("/").pop() ?? "");

export const trimSlash = (s: string) => s.replace(/\/+$/, "");

/* ---------------------------------------------------------------- colors */

export type RGB = [number, number, number];

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(). Returns null for anything else. */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return [+m[1]!, +m[2]!, +m[3]!].map((v) => Math.max(0, Math.min(255, Math.round(v)))) as RGB;
  }
  return null;
}

export const toHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** Relative luminance (WCAG). */
export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

export const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as RGB;

/** Saturation in HSL terms, 0 to 1: how colorful a color is. */
export function saturation([r, g, b]: RGB): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/** A color with an alpha channel, as rgb(). Falls back to the input for colors we can't parse. */
export function alpha(color: string, a: number): string {
  const c = parseColor(color);
  return c ? `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})` : color;
}

export const isDark = (color: string) => {
  const c = parseColor(color);
  return c ? luminance(c) < 0.4 : false;
};

/** Black or white, whichever reads better on `bg`. */
export function readableOn(bg: string, dark = "#0a0a0a", light = "#fafafa"): string {
  const c = parseColor(bg);
  if (!c) return dark;
  return contrast(c, parseColor(dark)!) >= contrast(c, parseColor(light)!) ? dark : light;
}
