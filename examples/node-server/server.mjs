// ogee in front of a single-page app, on a plain Node server (Node 20+).
// Pages come from ORIGIN (your app's own server, or its preview server); every page gets its own
// <head>, and cards are drawn at /__ogee/card/….
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createHandler } from "@virusdev/ogee/handler";
import config from "./ogee.config.js";

const PORT = Number(process.env.PORT ?? 3000);
const ORIGIN = process.env.ORIGIN ?? "http://localhost:4173";

const ogee = createHandler(config, {
  origin: ORIGIN,
  // The logo, fonts and plates, from ./assets.
  loadAsset: (path) => readFile(new URL(`./assets/${path}`, import.meta.url)).then((b) => new Uint8Array(b), () => null),
});

createServer(async (req, res) => {
  try {
    const response = await ogee.fetch(toRequest(req));
    res.writeHead(response.status, [...response.headers]);
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch (e) {
    console.error(e);
    res.writeHead(500).end();
  }
}).listen(PORT, () => console.log(`ogee on http://localhost:${PORT}, pages from ${ORIGIN}`));

/** Node's request as a web Request. */
function toRequest(req) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: "half" });
}
