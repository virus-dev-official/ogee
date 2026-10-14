# ogee on a Node server

A plain `node:http` server that puts ogee in front of a single-page app: every page gets its own
`<head>`, cards are drawn at `/__ogee/card/…`, and `/sitemap.xml` and `/llms.txt` are served. Everything
else (scripts, images, POSTs) passes through to your app untouched.

`server.mjs` only turns Node's requests into web `Request`s and back. Runtimes that speak `Request` and
`Response` need no glue at all:

```js
Bun.serve({ fetch: (req) => ogee.fetch(req) });   // Bun
Deno.serve((req) => ogee.fetch(req));             // Deno
app.all("*", (c) => ogee.fetch(c.req.raw));       // Hono
```

## Run it

Start your app on port 4173 (`vite preview` does), then:

```bash
npm install
ORIGIN=http://localhost:4173 npm start
npx @virusdev/ogee check http://localhost:3000/pricing
```

Edit `ogee.config.js` for your own pages and brand, and put a logo and fonts in `assets/`.
