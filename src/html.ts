/**
 * Rewrites a page's HTML as a string, for runtimes without Cloudflare's HTMLRewriter (Node, Bun, Deno,
 * Vercel, Netlify) and for `ogee build`. A single-page app's index.html is small, so reading it whole is fine.
 *
 * The parser only finds where things are; the edits are spliced into the original text, so everything
 * ogee doesn't touch comes out byte for byte as it went in.
 */
import { parse, type HTMLElement } from "node-html-parser";
import { escText } from "./core.js";
import { headTags, type Site } from "./page.js";
import type { ResolvedPage } from "./types.js";

const DROP = [
  "title",
  'meta[name="description"]',
  'meta[name="robots"]',
  'link[rel="canonical"]',
  'meta[property^="og:"]',
  'meta[name^="twitter:"]',
  'script[type="application/ld+json"]',
];

/** The HTML with this page's tags in <head>, and `page.html` in the mount element when it has some. */
export function rewriteHtml(html: string, site: Site, m: ResolvedPage): string {
  const root = parse(html, { comment: true, blockTextElements: { script: true, style: true, noscript: true, pre: true } });
  const head = root.querySelector("head");
  if (!head) return html;

  const edits: { start: number; end: number; text: string }[] = [];
  for (const el of head.querySelectorAll(DROP.join(", "))) edits.push({ start: el.range[0], end: el.range[1], text: "" });

  // Just before </head>, which is where HTMLRewriter's append puts it too.
  const close = html.lastIndexOf("</head", head.range[1]);
  const at = close >= head.range[0] ? close : head.range[1];
  edits.push({ start: at, end: at, text: `<title>${escText(m.title)}</title>` + headTags(site, m) });

  if (m.html) {
    const sels = (site.config.mount ?? "#root, #app").split(",").map((s) => s.trim()).filter(Boolean);
    const el = sels.map((s) => root.querySelector(s)).find((e): e is HTMLElement => !!e);
    if (el) {
      const inner = innerRange(html, el);
      if (inner) edits.push({ start: inner[0], end: inner[1], text: m.html });
    }
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Where an element's content starts and ends in the source: after its start tag, before its end tag. */
function innerRange(html: string, el: HTMLElement): [number, number] | null {
  const [start, end] = el.range;
  const open = html.indexOf(">", start);
  const close = html.lastIndexOf("</", end);
  if (open < 0 || close < open || html.slice(close + 2, end).trim().toLowerCase().replace(/>$/, "") !== el.rawTagName.toLowerCase()) return null;
  return [open + 1, close];
}
