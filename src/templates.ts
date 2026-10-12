import type { CardData, Template } from "./types.js";
import { alpha, esc, readableOn } from "./util.js";

/**
 * A title size that keeps long titles inside the card: pass the title and the size you'd like
 * for a short one. Sizes step down as the title gets longer.
 */
export function fitTitle(title: string, max = 84): number {
  const n = title.length;
  const scale = n <= 24 ? 1 : n <= 40 ? 0.92 : n <= 60 ? 0.82 : n <= 90 ? 0.72 : 0.62;
  return Math.round(max * scale);
}

/** Cuts text at a word boundary so it fits in `max` characters, adding "…" when it had to cut. */
export function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  // If the cut lands right at the end of a word, keep that word.
  const at = t[max - 1] === " " ? cut.length : cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–—-]+$/, "") + "…";
}

/** True for paths worth printing on a card: short, and no IDs like UUIDs or long numbers. */
export const readablePath = (path: string) => path !== "/" && path.length <= 32 && !path.split("/").some(isIdSegment);

/** Segments that look like database IDs rather than words. */
export const isIdSegment = (seg: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^\d{3,}$/.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) || (/^[a-z0-9]{20,}$/i.test(seg) && /\d/.test(seg));

/** The full-bleed background: the plate if there is one, else whatever the template draws. */
const backdrop = (c: CardData, fallback: string) =>
  c.plate
    ? `<img src="${esc(c.plate)}" style="position:absolute;left:0;top:0;width:${c.width}px;height:${c.height}px;object-fit:cover">`
    : fallback;

/** Logo and site name, side by side. */
function mark(c: CardData, color: string, size = 44) {
  // A wide logo is a wordmark: it already says the name.
  if (c.logo && c.logoAspect >= 2.2) {
    const h = Math.round(size * 0.9);
    return `<div style="display:flex"><img src="${esc(c.logo)}" style="height:${h}px;width:${Math.round(h * Math.min(c.logoAspect, 7))}px;object-fit:contain"></div>`;
  }
  const logo = c.logo ? `<img src="${esc(c.logo)}" style="width:${size}px;height:${size}px;object-fit:contain;border-radius:${Math.round(size * 0.2)}px">` : "";
  return `<div style="display:flex;align-items:center;gap:16px">${logo}<span style="font-family:'${c.headingFont}';font-size:${Math.round(size * 0.64)}px;font-weight:600;color:${color};letter-spacing:-0.01em">${esc(c.siteName)}</span></div>`;
}

function textBlock(c: CardData, fg: string, muted: string, opts: { max?: number; width?: number; eyebrowColor?: string; compact?: boolean } = {}) {
  const title = clip(c.title, opts.compact ? 70 : 96);
  const size = fitTitle(title, opts.max ?? 84);
  return `<div style="display:flex;flex-direction:column;gap:20px;max-width:${opts.width ?? 960}px">
  ${c.eyebrow ? `<div style="display:flex;font-family:'${c.bodyFont}';font-size:24px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${opts.eyebrowColor ?? c.colors.accent}">${esc(c.eyebrow)}</div>` : ""}
  <div style="font-family:'${c.headingFont}';font-size:${size}px;font-weight:${c.headingWeight};line-height:1.06;letter-spacing:${c.headingWeight >= 600 ? "-0.02em" : "-0.01em"};color:${fg};text-wrap:balance">${esc(title)}</div>
  ${c.description ? `<div style="font-family:'${c.bodyFont}';font-size:${opts.compact ? 26 : 30}px;line-height:1.38;color:${muted};text-wrap:pretty">${esc(clip(c.description, opts.compact ? 90 : 120))}</div>` : ""}
</div>`;
}

/** How big the page's picture is drawn: tall for flyers and phone screens, wide for photos. */
function mediaSize(c: CardData): { w: number; h: number } {
  const a = c.imageAspect || 1;
  const maxH = c.height - 120;
  if (a < 0.9) return { w: Math.round(Math.max(300, Math.min(maxH * a, 440))), h: maxH };
  if (a <= 1.15) return { w: 430, h: 430 };
  return { w: 500, h: Math.round(Math.max(280, Math.min(500 / a, maxH))) };
}

/**
 * The content area every built-in template shares: logo, text and an optional footer in a column,
 * and the page's own picture beside them in a rounded frame when there is one.
 */
function body(c: CardData, o: { pad: [number, number, number, number]; fg: string; muted: string; eyebrowColor?: string; max?: number; footer?: string }) {
  const m = c.image ? mediaSize(c) : null;
  const gap = 56;
  const textW = c.width - o.pad[1] - o.pad[3] - (m ? m.w + gap : 0);
  const column = `<div style="display:flex;flex-direction:column;justify-content:space-between;width:${textW}px;height:100%">
    ${mark(c, o.fg)}
    ${textBlock(c, o.fg, o.muted, { max: m ? Math.min(o.max ?? 84, 64) : o.max, width: textW, eyebrowColor: o.eyebrowColor, compact: !!m })}
    ${o.footer ?? ""}
  </div>`;
  const media = m
    ? `<div style="display:flex;align-items:center;margin-left:${gap}px"><img src="${esc(c.image!)}" style="width:${m.w}px;height:${m.h}px;object-fit:cover;border-radius:22px;border:1px solid ${alpha(o.fg, 0.12)};box-shadow:0 30px 70px rgb(0 0 0 / 0.35)"></div>`
    : "";
  return `<div style="position:relative;display:flex;width:100%;height:100%;padding:${o.pad.map((n) => n + "px").join(" ")}">${column}${media}</div>`;
}

const frame = (c: CardData, bg: string, inner: string) =>
  `<div style="position:relative;display:flex;width:${c.width}px;height:${c.height}px;overflow:hidden;background:${bg};font-family:'${c.bodyFont}'">${inner}</div>`;

/** Quiet and typographic: the brand's own background, a thin accent rule, big title. */
const minimal: Template = (c) => {
  const { background: bg, foreground: fg, muted, accent } = c.colors;
  return frame(
    c,
    bg,
    `${backdrop(c, `<div style="position:absolute;left:0;top:0;width:${c.width}px;height:10px;background:${accent}"></div>`)}
${body(c, {
  pad: [72, 80, 64, 80],
  fg,
  muted,
  footer: `<div style="display:flex;font-size:24px;color:${muted};letter-spacing:0.01em">${esc(c.host)}${readablePath(c.path) && !c.image ? `<span style="opacity:0.6">${esc(c.path)}</span>` : ""}</div>`,
})}`,
  );
};

/** Soft blurred blobs in the brand colors. Each page gets its own arrangement. */
const glow: Template = (c) => {
  const { background: bg, foreground: fg, muted, accent, accent2 } = c.colors;
  const r = c.rand;
  // Blobs sit in the top two thirds, where they don't fight the title.
  const blob = (color: string, i: number, size: number, op: number) => {
    const x = Math.round((0.1 + r(i) * 0.8) * c.width - size / 2);
    const y = Math.round((0.05 + r(i + 10) * 0.45) * c.height - size / 2);
    return `<div style="position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:9999px;background:${color};opacity:${op};filter:blur(${Math.round(size / 5)}px)"></div>`;
  };
  const blobs = [blob(accent, 1, 520 + r(2) * 160, 0.9), blob(accent2, 3, 460 + r(4) * 140, 0.8), blob(accent, 5, 280 + r(6) * 120, 0.5)].join("");
  return frame(
    c,
    bg,
    `${backdrop(c, blobs)}
<div style="position:absolute;left:0;top:0;width:${c.width}px;height:${c.height}px;background:linear-gradient(to top, ${alpha(bg, 0.85)} 0%, ${alpha(bg, 0.35)} 45%, ${alpha(bg, 0)} 100%)"></div>
${body(c, { pad: [72, 80, 68, 80], fg, muted, eyebrowColor: fg })}`,
  );
};

/** Text on one side, the page's image (or a big logo) on the other. Good for products and posts. */
const split: Template = (c) => {
  const { background: bg, foreground: fg, muted, accent } = c.colors;
  const panelW = Math.round(c.width * 0.42);
  // Portrait and square pictures fill the panel; wide ones would lose their sides, so they sit in a frame.
  const right = c.image && c.imageAspect <= 1.2
    ? `<img src="${esc(c.image)}" style="width:${panelW}px;height:${c.height}px;object-fit:cover">`
    : c.image
    ? `<div style="display:flex;align-items:center;justify-content:center;width:${panelW}px;height:${c.height}px;background:${accent}"><img src="${esc(c.image)}" style="width:${panelW - 64}px;height:${Math.round(Math.min((panelW - 64) / c.imageAspect, c.height - 120))}px;object-fit:cover;border-radius:18px;box-shadow:0 24px 60px rgb(0 0 0 / 0.3)"></div>`
    : `<div style="display:flex;align-items:center;justify-content:center;width:${panelW}px;height:${c.height}px;background:${accent}">${
        c.logo ? `<img src="${esc(c.logo)}" style="width:${Math.round(panelW * 0.42)}px;height:${Math.round(panelW * 0.42)}px;object-fit:contain">` : `<div style="font-family:'${c.headingFont}';font-size:160px;font-weight:700;color:${readableOn(accent)}">${esc(c.siteName.slice(0, 1))}</div>`
      }</div>`;
  return frame(
    c,
    bg,
    `${backdrop(c, "")}
<div style="position:relative;display:flex;width:100%;height:100%">
  <div style="display:flex;flex-direction:column;justify-content:space-between;width:${c.width - panelW}px;height:100%;padding:64px 56px 60px 72px">
    ${mark(c, fg, 40)}
    ${textBlock(c, fg, muted, { max: 64, width: c.width - panelW - 128 })}
    <div style="display:flex;font-size:22px;color:${muted}">${esc(c.host)}</div>
  </div>
  ${right}
</div>`,
  );
};

/** The whole card in the accent color, with a huge title. Loud on purpose. */
const bold: Template = (c) => {
  const { accent } = c.colors;
  const fg = readableOn(accent);
  const muted = alpha(fg, 0.72);
  return frame(
    c,
    accent,
    `${backdrop(c, `<div style="position:absolute;right:-180px;bottom:-260px;width:720px;height:720px;border-radius:9999px;border:2px solid ${alpha(fg, 0.18)}"></div><div style="position:absolute;right:-60px;bottom:-140px;width:480px;height:480px;border-radius:9999px;border:2px solid ${alpha(fg, 0.14)}"></div>`)}
${body(c, { pad: [72, 80, 64, 80], fg, muted, max: 92, eyebrowColor: fg })}`,
  );
};

export const builtinTemplates: Record<string, Template> = { minimal, glow, split, bold };
