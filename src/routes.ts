import type { Route } from "./types.js";

export interface CompiledRoute {
  pattern: string;
  route: Route;
  regex: RegExp;
  keys: string[];
  /** Higher wins: fixed segments beat params, params beat wildcards. */
  score: number;
  /** True for patterns without params or wildcards: these go in the sitemap as they are. */
  fixed: boolean;
}

/** Normalizes a path: one leading slash, no repeated or trailing slashes ("/" stays "/"). */
export function normalizePath(path: string): string {
  const p = ("/" + path).replace(/\/{2,}/g, "/");
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export function compileRoute(pattern: string, route: Route): CompiledRoute {
  const keys: string[] = [];
  const segments = normalizePath(pattern).split("/").slice(1);
  let score = 0;
  const parts = segments.map((seg, i) => {
    if (seg === "*") {
      if (i !== segments.length - 1) throw new Error(`ogee: "*" must be the last segment in route "${pattern}"`);
      keys.push("wild");
      return "(?:/(.*))?";
    }
    if (seg.startsWith(":")) {
      keys.push(seg.slice(1));
      score += 2;
      return "/([^/]+)";
    }
    score += 3;
    return "/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  const source = parts.join("") || "/";
  return {
    pattern,
    route,
    regex: new RegExp(`^${source === "/" ? "/" : source}$`),
    keys,
    score: score * 100 + segments.length,
    fixed: keys.length === 0,
  };
}

export function compileRoutes(routes: Record<string, Route> = {}): CompiledRoute[] {
  return Object.entries(routes)
    .map(([pattern, route]) => compileRoute(pattern, route))
    .sort((a, b) => b.score - a.score);
}

export function matchRoute(routes: CompiledRoute[], path: string): { route: CompiledRoute; params: Record<string, string> } | null {
  const p = normalizePath(path);
  for (const route of routes) {
    const m = route.regex.exec(p);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => {
      const v = m[i + 1];
      if (v !== undefined) {
        try {
          params[k] = decodeURIComponent(v);
        } catch {
          params[k] = v;
        }
      }
    });
    return { route, params };
  }
  return null;
}

/** The URL path of a page's card: "/" → "/__ogee/card/index.png", "/blog/a" → "/__ogee/card/blog/a.png". */
export const cardPath = (path: string, ext: "png" | "jpg" = "png") => `/__ogee/card/${path === "/" ? "index" : normalizePath(path).slice(1)}.${ext}`;

/** The page path a card URL belongs to, or null if it isn't a card URL. */
export function pathFromCard(cardUrlPath: string): string | null {
  const m = cardUrlPath.match(/^\/__ogee\/card\/(.+)\.(?:png|jpg)$/);
  if (!m) return null;
  return m[1] === "index" ? "/" : normalizePath(m[1]!);
}
