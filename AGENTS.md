# Working on ogee

ogee puts a Cloudflare Worker (or a fetch handler, or a static build step) in front of a single-page app
and gives every page its own `<head>` and a preview card. These notes are for people and coding agents changing ogee itself.

## Layout

- `src/` runs everywhere (Node and Workers): `types.ts` (the public config), `routes.ts`, `page.ts`
  (route → resolved page → head tags), `card.ts` (cards with takumi), `templates.ts` (built-ins),
  `feeds.ts` (sitemap, llms.txt), `core.ts` (request handling for any runtime), `worker.ts` (core plus
  Cloudflare's HTMLRewriter, cache and assets binding), `html.ts` and `handler.ts` (core with a string
  rewriter, for every other runtime and for `ogee build`).
- `src/node/` is the CLI only: `scan.ts` (reads a site in a headless browser), `assets.ts` (logo and
  fonts), `init.ts`, `inspect.ts`, `render.ts`, `build.ts` (static hosts), `check.ts`, `plate.ts`, `guide.ts` (the agent instructions,
  shared by `inspect` and `ogee skill`).
- Code in `src/` outside `node/` must not import Node built-ins: it's bundled into users' Workers.

## Checks

```bash
npm run typecheck && npm test && npm run build && npm run test:e2e
```

`test:e2e` runs the built Worker in `wrangler dev` in front of a small fake app and checks every behavior
(rewrites, cards, 404s, redirects, POST passthrough, sitemap, llms.txt).

When you change a template, render it and look at it: `npx jiti test/visual.ts <dir>` writes every built-in
template for a dark and a light brand.

## Known renderer quirks

- `line-clamp` drops the last line when text fits exactly; templates use `clip()` instead.
- Absolutely positioned elements paint over normal ones (CSS paint order): put text in a
  `position:relative` box after background layers.
