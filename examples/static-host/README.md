# ogee on a static host

For single-page apps on Vercel, Netlify, GitHub Pages, Cloudflare Pages, S3 or anything else that serves
files. Nothing runs on a server: ogee is a step after your app's build that writes each page's HTML with
its own tags, its card, `sitemap.xml` and `llms.txt` into the build folder.

## Set up

```bash
npx @virusdev/ogee init https://your-site.com --host static
```

(On Vercel, Netlify and GitHub Pages, `init` picks this by itself.) Then add ogee to your build, in your
app's `package.json`:

```json
{
  "scripts": {
    "build": "vite build && ogee build dist"
  },
  "devDependencies": {
    "@virusdev/ogee": "^0.3.0"
  }
}
```

Netlify, Vercel and Cloudflare Pages run the build on every deploy; on GitHub Pages, your Actions
workflow does. `ogee build` finds `ogee/ogee.config.ts` from the project root.

## Pages from your data

A static build only knows the fixed routes plus whatever `sitemap.paths` returns. For pages like
`/blog/:slug`, list them there:

```ts
routes: {
  "/blog/:slug": async ({ params, fetch }) => {
    const r = await fetch(`https://api.example.com/posts/${params.slug}`);
    if (!r.ok) return null;
    const post = await r.json();
    return { title: post.title, description: post.excerpt, image: post.cover, eyebrow: "Blog" };
  },
},
sitemap: {
  paths: async ({ fetch }) => (await (await fetch("https://api.example.com/posts")).json()).map((p) => `/blog/${p.slug}`),
},
```

Pages added after a deploy show the home page's preview until the next build. If they come and go faster
than you deploy, use the Worker or `createHandler` instead.

## Host notes

- **GitHub Pages** publishing from a branch runs Jekyll, which skips folders starting with `_`: add an
  empty `.nojekyll` file to the build folder. Deploying through Actions serves every file as is.
- **Netlify, Vercel, Cloudflare Pages** need nothing else: ogee writes both `about.html` and
  `about/index.html`, so every host finds the page.
