/**
 * The instructions coding agents follow. `ogee inspect --for-agent` writes them next to the
 * screenshots, and `ogee skill` installs them as a Claude Code skill. One text, so they never drift.
 */
export const TEMPLATE_GUIDE = `## Writing a card template

A template is a function that takes \`card\` and returns an HTML string. Put it in
\`templates/<name>.ts\`, register it in \`ogee.config.ts\`, and select it:

\`\`\`ts
// templates/brand.ts
import { esc, fitTitle, alpha, type Template } from "ogee";

export const brand: Template = (card) => \`
<div style="position:relative;display:flex;width:\${card.width}px;height:\${card.height}px;background:\${card.colors.background};overflow:hidden">
  <!-- background layers first, all position:absolute -->
  <div style="position:absolute;left:-120px;top:-160px;width:620px;height:620px;border-radius:9999px;background:\${card.colors.accent};filter:blur(120px);opacity:.8"></div>
  <!-- content last, position:relative, so it paints on top -->
  <div style="position:relative;display:flex;flex-direction:column;justify-content:flex-end;width:100%;height:100%;padding:72px 80px">
    <div style="font-family:'\${card.headingFont}';font-size:\${fitTitle(card.title)}px;font-weight:700;line-height:1.06;color:\${card.colors.foreground};text-wrap:balance">\${esc(card.title)}</div>
  </div>
</div>\`;
\`\`\`

\`\`\`ts
// ogee.config.ts
import { brand } from "./templates/brand";
export default defineConfig({ /* … */ templates: { brand }, card: { template: "brand" } });
\`\`\`

\`card\` has: \`title\`, \`description\`, \`eyebrow\`, \`siteName\`, \`host\`, \`path\`, \`url\`,
\`image\` (the page's own photo, if any), \`logo\` and \`logoAspect\` (width ÷ height; above ~2.2 it's a wordmark),
\`plate\` (background image, if any), \`colors\` (\`background\`, \`foreground\`, \`accent\`, \`accent2\`, \`muted\`),
\`headingFont\`, \`bodyFont\`, \`width\`, \`height\` (1200×630), \`seed\` and \`rand(i)\` (stable per page, for
variety), and \`data\` (whatever the route put in \`data\`).
Use \`<img src="\${card.logo}">\`, \`<img src="\${card.plate}">\` and \`<img src="\${card.image}">\` as they are.

Helpers from "ogee": \`esc\` (always escape text), \`fitTitle(title, maxPx)\` (size that fits),
\`clip(text, chars)\` (shorten at a word), \`alpha(color, 0.5)\`, \`readableOn(bg)\` (black or white), \`isDark(color)\`.

### What the renderer supports (takumi, not a browser)
- Layout: flexbox and block. Give every element with more than one child \`display:flex\` to be safe.
- Works: linear/radial/conic gradients, \`filter: blur()\`, \`opacity\`, \`box-shadow\`, \`text-shadow\`, \`border-radius\`,
  \`mix-blend-mode\`, \`mask-image\`, \`clip-path\`, \`background-clip:text\`, \`text-wrap: balance\`, inline SVG
  and SVG filters (feTurbulence for grain), \`transform\`.
- Stacking: CSS paint order. Absolutely positioned elements paint over normal ones, so put content in a
  \`position:relative\` box *after* the background layers.
- Don't use \`line-clamp\` on text that might fit exactly (it drops the last line). Use \`clip()\` instead.
- No external CSS, no web fonts by URL, no JavaScript. Fonts must be listed in \`brand.fonts\` (files in \`assets/\`).
- If the look needs something the renderer can't draw (WebGL, complex CSS, photos composited with text),
  make a **plate**: write \`plate.html\` with the background only (no text), run \`npx ogee plate plate.html\`,
  set \`brand.plate: "plate.png"\`, and draw the text on top in the template.
`;

export const AGENT_STEPS = `## How to make great cards

1. **Look at the site.** Open the screenshots (home.png, home-mobile.png and the other pages). Note the
   background, the accent colors, the type, any signature shapes (blobs, grids, gradients, noise, outlines).
2. **Check the brand** in \`ogee.config.ts\` against what you saw: colors, fonts, logo. Fix what's off.
   \`brand.json\` has the raw values the scanner found.
3. **Pick the approach:**
   - A built-in template (\`minimal\`, \`glow\`, \`split\`, \`bold\`) with the right colors, if one already fits.
   - A custom template that echoes the site's signature look. This is usually what makes cards feel like
     the site and not like a generic tool.
   - A plate, when the look can't be drawn by the card renderer.
4. **Write real page text.** Every route in \`routes\` needs a specific title and a description that would make
   someone click. Not the site tagline repeated, not "Home".
5. **Render and look.** Run \`npx ogee render --json\`, then open every PNG it lists. Check: nothing cut off,
   text readable at small sizes (cards show at ~500px wide in chats), the logo clear, the brand obvious.
   Long titles must still fit. Fix and render again until every card is good.
6. **Show the person** the gallery (\`.ogee/cards/index.html\`). Don't deploy without asking them.
`;

export function agentGuide(opts: { site: string; dir: string; files: string[] }) {
  return `# ogee: make the link previews for ${opts.site}

You're making the preview cards (the image and text that show up when someone shares a link on WhatsApp,
X, LinkedIn, Slack, iMessage) for this site. ogee's config is in \`${opts.dir}\`.

Files from the inspection:
${opts.files.map((f) => `- \`${f}\``).join("\n")}

${AGENT_STEPS}
${TEMPLATE_GUIDE}`;
}
