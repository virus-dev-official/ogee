import { parse, type HTMLElement } from "node-html-parser";
import { imageSize } from "../card.js";
import { inlineImage, kb, pc, ui } from "./ui.js";

/** What link-preview bots call themselves. We fetch as Facebook's by default: most sites treat it like the rest. */
export const BOTS: Record<string, string> = {
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  whatsapp: "WhatsApp/2.24.20.80 A",
  x: "Twitterbot/1.0",
  linkedin: "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  discord: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  imessage: "facebookexternalhit/1.1 Facebot Twitterbot/1.0",
};

export interface HeadInfo {
  status: number;
  finalUrl: string;
  title: string;
  description: string;
  canonical: string;
  og: Record<string, string>;
  twitter: Record<string, string>;
  jsonLd: number;
  /** Length of the text crawlers can read in <body>, without scripts. */
  bodyText: number;
}

export async function fetchHead(url: string, ua = BOTS.facebook!): Promise<HeadInfo> {
  const r = await fetch(url, { headers: { "user-agent": ua, accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  const html = await r.text();
  return { ...readHead(html), status: r.status, finalUrl: r.url };
}

export function readHead(html: string): Omit<HeadInfo, "status" | "finalUrl"> {
  const doc = parse(html, { comment: false });
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute("content")?.trim() ?? "";
  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  for (const m of doc.querySelectorAll("meta")) {
    const key = m.getAttribute("property") ?? m.getAttribute("name") ?? "";
    const val = m.getAttribute("content") ?? "";
    if (key.startsWith("og:") && !(key in og)) og[key.slice(3)] = val;
    if (key.startsWith("twitter:") && !(key in twitter)) twitter[key.slice(8)] = val;
  }
  const body = doc.querySelector("body");
  body?.querySelectorAll("script, style, noscript, template").forEach((e: HTMLElement) => e.remove());
  return {
    title: doc.querySelector("title")?.text.trim() ?? "",
    description: meta('meta[name="description"]'),
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
    og,
    twitter,
    jsonLd: doc.querySelectorAll('script[type="application/ld+json"]').length,
    bodyText: (body?.text ?? "").replace(/\s+/g, " ").trim().length,
  };
}

type Level = "ok" | "warn" | "bad";
interface Finding {
  level: Level;
  key: string;
  message: string;
}

export interface CheckResult {
  url: string;
  head: HeadInfo;
  preview: { title: string; description: string; image: string; site: string };
  image: { url: string; status: number; type: string; bytes: number; width?: number; height?: number } | null;
  spa: { sameAsMissingPage: boolean; sameAsHome: boolean | null };
  findings: Finding[];
  score: number;
}

export async function check(input: string, opts: { image?: boolean } = {}): Promise<CheckResult> {
  const url = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`).toString();
  const head = await fetchHead(url);
  const findings: Finding[] = [];
  const add = (level: Level, key: string, message: string) => findings.push({ level, key, message });

  const title = head.og.title || head.twitter.title || head.title;
  const description = head.og.description || head.twitter.description || head.description;
  const imageRaw = head.og.image || head.twitter.image || head.twitter["image:src"] || "";
  const imageUrl = imageRaw ? new URL(imageRaw, head.finalUrl).toString() : "";

  if (head.status >= 400) add("bad", "status", `The page answered ${head.status}. Bots won't show a preview.`);

  if (!title) add("bad", "title", "No title at all. Previews will show the bare URL.");
  else if (!head.og.title) add("warn", "og:title", "No og:title. Most apps fall back to <title>, but some show nothing.");
  else add("ok", "og:title", `"${short(title, 70)}"`);

  if (!description) add("warn", "description", "No description. The preview will be just a title.");
  else add("ok", "description", `"${short(description, 70)}"`);

  let image: CheckResult["image"] = null;
  if (!imageUrl) add("bad", "og:image", "No og:image. WhatsApp, X, LinkedIn and Slack will show a small, plain link.");
  else {
    if (!/^https?:\/\//.test(imageRaw)) add("warn", "og:image", "og:image is a relative URL. Facebook and LinkedIn need a full https:// address.");
    try {
      const r = await fetch(imageUrl, { headers: { "user-agent": BOTS.facebook! }, signal: AbortSignal.timeout(15000) });
      const buf = new Uint8Array(await r.arrayBuffer());
      const size = imageSize(buf);
      image = { url: imageUrl, status: r.status, type: r.headers.get("content-type") ?? "", bytes: buf.length, ...size };
      if (!r.ok) add("bad", "og:image", `The image answers ${r.status}. No picture will show.`);
      else if (!image.type.startsWith("image/")) add("bad", "og:image", `The image URL returns ${image.type || "something"} instead of an image.`);
      else {
        add("ok", "og:image", `${size ? `${size.width}×${size.height}` : "size unknown"} · ${image.type.replace("image/", "")} · ${kb(buf.length)}`);
        if (size && (size.width < 600 || size.height < 315)) add("warn", "og:image", "Smaller than 600×315: X and LinkedIn show it as a small thumbnail, not a big card.");
        if (size && Math.abs(size.width / size.height - 1.91) > 0.25 && size.width >= 600) add("warn", "og:image", `Shaped ${(size.width / size.height).toFixed(2)}:1. Big cards are 1.91:1 (1200×630); other shapes get cropped.`);
        if (buf.length > 600 * 1024) add("warn", "og:image", `${kb(buf.length)} is heavy. WhatsApp often skips images this big; aim for under 600 KB.`);
        if (opts.image && !ui.json) inlineImage(buf);
      }
    } catch (e) {
      add("bad", "og:image", `Couldn't fetch the image: ${(e as Error).message}`);
    }
  }

  if (!head.twitter.card) add("warn", "twitter:card", 'No twitter:card. X shows a small card; set it to "summary_large_image".');
  if (!head.canonical) add("warn", "canonical", "No canonical URL. Search engines may index duplicates.");
  if (head.bodyText < 80) add("warn", "content", "The HTML has almost no text before JavaScript runs. Crawlers and AI search see an empty page.");

  // The single-page-app test: does a page that can't exist get the same head as this one?
  const u = new URL(head.finalUrl);
  const probe = new URL(`/ogee-check-${Math.random().toString(36).slice(2, 8)}`, u).toString();
  let sameAsMissingPage = false;
  let sameAsHome: boolean | null = null;
  try {
    const missing = await fetchHead(probe);
    sameAsMissingPage = missing.status === 200 && fingerprint(missing) === fingerprint(head);
    if (u.pathname !== "/") {
      const home = await fetchHead(new URL("/", u).toString());
      sameAsHome = fingerprint(home) === fingerprint(head);
    }
  } catch {
    /* the probe is a bonus */
  }
  if (sameAsHome) add("bad", "spa", `This page has the same preview as the home page. It's a single-page app: every link to this site looks identical.`);
  else if (sameAsMissingPage) add("warn", "spa", `A page that doesn't exist (${new URL(probe).pathname}) gets this exact preview too. Single-page apps do this: every link shows the same card.`);

  const weights = { bad: 0, warn: 0.5, ok: 1 };
  const keys = ["og:title", "description", "og:image", "twitter:card", "canonical", "content", "spa"];
  const worst = (k: string) => {
    const fs = findings.filter((f) => f.key === k || (k === "og:title" && f.key === "title"));
    if (!fs.length) return 1;
    return Math.min(...fs.map((f) => weights[f.level]));
  };
  let score = Math.round((keys.reduce((s, k) => s + worst(k), 0) / keys.length) * 10);
  // Every link looking like the home page defeats the point of previews, however good that one preview is.
  if (sameAsHome) score = Math.min(score, 4);
  else if (sameAsMissingPage) score = Math.min(score, 7);

  return {
    url,
    head,
    preview: { title, description, image: imageUrl, site: head.og.site_name || u.host.replace(/^www\./, "") },
    image,
    spa: { sameAsMissingPage, sameAsHome },
    findings,
    score,
  };
}

const fingerprint = (h: HeadInfo) => JSON.stringify([h.title, h.description, h.og.title, h.og.description, h.og.image]);
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function printCheck(r: CheckResult) {
  const w = 60;
  const line = (s: string) => `  ${pc.dim("│")} ${s}${" ".repeat(Math.max(0, w - visible(s)))} ${pc.dim("│")}`;
  console.log();
  console.log(`  ${pc.bold("ogee check")}  ${pc.underline(r.url)}`);
  console.log();
  console.log(`  ${pc.dim("┌" + "─".repeat(w + 2) + "┐")}`);
  console.log(line(r.image?.width ? pc.dim(`[ image ${r.image.width}×${r.image.height} ]`) : pc.red("[ no image ]")));
  console.log(line(pc.dim(r.preview.site.toUpperCase())));
  console.log(line(pc.bold(short(r.preview.title || "(no title)", w))));
  const lines = wrap(r.preview.description || "(no description)", w);
  if (lines.length > 2) lines[1] = short(lines[1]!, w - 1) + "…";
  for (const l of lines.slice(0, 2)) console.log(line(pc.dim(l)));
  console.log(`  ${pc.dim("└" + "─".repeat(w + 2) + "┘")}`);
  console.log();
  const icon = { ok: pc.green("✓"), warn: pc.yellow("!"), bad: pc.red("✗") };
  for (const f of r.findings) console.log(`  ${icon[f.level]} ${pc.bold(f.key.padEnd(13))} ${f.message}`);
  const color = r.score >= 8 ? pc.green : r.score >= 5 ? pc.yellow : pc.red;
  console.log();
  console.log(`  Preview score: ${color(pc.bold(`${r.score}/10`))}`);
  if (r.findings.some((f) => f.level !== "ok" && ["spa", "og:image", "content", "title", "og:title", "description"].includes(f.key))) {
    console.log();
    console.log(`  ${pc.cyan("→")} Fix it: ${pc.bold("npx ogee-cli init " + new URL(r.url).origin)}`);
  }
  console.log();
}

// eslint-disable-next-line no-control-regex
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

function wrap(s: string, w: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of s.split(/\s+/)) {
    if ((cur + " " + word).trim().length > w) {
      out.push(cur);
      cur = word;
    } else cur = (cur + " " + word).trim();
  }
  if (cur) out.push(cur);
  return out;
}
