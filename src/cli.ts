import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import cac from "cac";
import { headTags, resolvePage } from "./page.js";
import { check, printCheck } from "./node/check.js";
import { loadProject } from "./node/config.js";
import { AGENT_STEPS, TEMPLATE_GUIDE } from "./node/guide.js";
import { init, packageRoot } from "./node/init.js";
import { inspect } from "./node/inspect.js";
import { plate } from "./node/plate.js";
import { renderCards } from "./node/render.js";
import { CliError, fail, pc, ui } from "./node/ui.js";

const cli = cac("ogee");
const pkg = JSON.parse(await readFile(join(packageRoot(), "package.json"), "utf8")) as { version: string };

cli.option("--json", "Print machine-readable JSON (for scripts and coding agents)");

cli
  .command("check <url>", "See how a link previews on WhatsApp, X, LinkedIn and Slack, and what's wrong with it")
  .option("--no-image", "Don't show the preview image in the terminal")
  .example("ogee check https://example.com/pricing")
  .action(async (url: string, o: { image: boolean }) => {
    const r = await check(url, { image: o.image });
    if (ui.json) console.log(JSON.stringify(r, null, 2));
    else printCheck(r);
  });

cli
  .command("init <url>", "Set up ogee for a site: reads its brand, logo, fonts and pages")
  .option("--dir <dir>", "Folder to create", { default: "ogee" })
  .option("--origin <url>", "Where the site really lives, if the Worker won't run in front of it (e.g. https://myapp.lovable.app)")
  .option("--pages <n>", "How many pages to read", { default: 12 })
  .option("--no-install", "Don't run npm install")
  .option("--force", "Overwrite an existing setup")
  .example("ogee init https://example.com")
  .action(async (url: string, o: { dir: string; origin?: string; pages: number; install: boolean; force?: boolean }) => {
    await init(url, { dir: o.dir, origin: o.origin, pages: Number(o.pages), install: o.install, force: !!o.force });
  });

cli
  .command("inspect [url]", "Screenshot the site and gather its brand, for a coding agent to design the cards")
  .option("--for-agent", "Write AGENT.md with step-by-step instructions (the default)")
  .option("--pages <n>", "How many pages to screenshot", { default: 6 })
  .option("--out <dir>", "Where to save everything (default: .ogee/inspect)")
  .action(async (url: string | undefined, o: { pages: number; out?: string }) => {
    await inspect(url, { pages: Number(o.pages), out: o.out });
  });

cli
  .command("render [...paths]", "Draw the cards into .ogee/cards/ (every page, or the paths you give)")
  .option("--template <name>", "Try a different template for all cards")
  .option("--out <dir>", "Where to save the cards")
  .option("--open", "Open the gallery when done")
  .example("ogee render")
  .example("ogee render /pricing /blog/hello-world --template glow")
  .action(async (paths: string[], o: { template?: string; out?: string; open?: boolean }) => {
    const project = await loadProject();
    ui.step(`Rendering cards for ${pc.bold(project.config.name)}`);
    const { out, cards } = await renderCards(project, { paths, out: o.out, template: o.template });
    const gallery = join(out, "index.html");
    if (ui.json) return console.log(JSON.stringify({ gallery, cards }, null, 2));
    ui.ok(`${cards.filter((c) => c.file).length} cards. Look at them: ${pc.cyan(relative(process.cwd(), gallery))}`);
    if (o.open) spawn(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [gallery], { stdio: "ignore", detached: true }).unref();
  });

cli
  .command("plate <html>", "Turn an HTML file into a background image in assets/, with a real browser")
  .option("--name <file>", "File name in assets/ (default: <html name>.png)")
  .action(async (html: string, o: { name?: string }) => {
    await plate(await loadProject(), html, o);
  });

cli
  .command("meta <path>", "Show the tags ogee writes into a page's <head>")
  .action(async (path: string) => {
    const project = await loadProject();
    const page = await resolvePage(project.site, path);
    if (!page) fail(`No page at ${path}: its route returned null (or it matches nothing and \`unmatched\` is "passthrough").`);
    if (ui.json) return console.log(JSON.stringify(page, null, 2));
    console.log(`<title>${page.title}</title>` + headTags(project.site, page));
  });

cli
  .command("dev", "Run the Worker locally, in front of your live site")
  .option("--port <port>", "Port", { default: 8787 })
  .action(async (o: { port: number }) => {
    const project = await loadProject();
    const origin = project.config.origin ?? project.config.site;
    ui.log(`\n  ${pc.bold("ogee dev")}  pages from ${pc.cyan(origin)}\n  Try: ${pc.cyan(`npx @virusdev/ogee check http://localhost:${o.port}/`)}\n`);
    // --local-upstream keeps request URLs on localhost, so card links in the HTML work locally.
    // Pages still come from the real site, through OGEE_ORIGIN.
    await run("npx", ["wrangler", "dev", "--port", String(o.port), "--local-upstream", `localhost:${o.port}`, "--var", `OGEE_ORIGIN:${origin}`], project.dir);
  });

cli
  .command("deploy", "Put the Worker live on Cloudflare")
  .action(async () => {
    const project = await loadProject();
    await run("npx", ["wrangler", "deploy"], project.dir);
    ui.log(`\n  Check it: ${pc.cyan(`npx @virusdev/ogee check ${project.config.site}`)}\n`);
  });

cli
  .command("skill", "Install the ogee skill for Claude Code into .claude/skills/ogee")
  .option("--print", "Print it instead")
  .action(async (o: { print?: boolean }) => {
    if (o.print) return void process.stdout.write(SKILL);
    const dir = join(process.cwd(), ".claude", "skills", "ogee");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), SKILL);
    ui.ok(`Installed ${pc.bold(relative(process.cwd(), join(dir, "SKILL.md")))}. Ask Claude Code to "fix my link previews".`);
  });

const SKILL = `---
name: ogee
description: Fix and design link previews (Open Graph tags, preview cards, sitemap, llms.txt) for websites, especially single-page apps (React, Vite, Vue, Lovable, Bolt, v0) where every link shows the same preview. Use when someone wants their links to look good on WhatsApp, X, LinkedIn, Slack or iMessage, wants OG images, or asks why their shared links all look the same.
---

# ogee

ogee runs a Cloudflare Worker in front of a site and gives every page its own <head> and a preview card
drawn in the site's brand. You design the cards; ogee's CLI collects evidence and renders what you write.

## Getting started

1. \`npx @virusdev/ogee check <url>\`: see what's wrong with a link's preview today (\`--json\` for details).
2. \`npx @virusdev/ogee init <url>\`: makes an \`ogee/\` folder with the config, Worker, logo and fonts.
   Use \`--origin <url>\` when the site is hosted somewhere the Worker can't sit in front of (Lovable, Vercel…).
3. \`cd ogee && npx @virusdev/ogee inspect --for-agent --json\`: screenshots and brand data. Read the AGENT.md it writes.
4. Design, \`npx @virusdev/ogee render --json\`, look at every PNG, repeat.
5. \`npx @virusdev/ogee dev\` to try the Worker locally; \`npx @virusdev/ogee deploy\` only when the person says so.

${AGENT_STEPS}
${TEMPLATE_GUIDE}`;

function run(cmd: string, args: string[], cwd: string) {
  return new Promise<void>((done, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    p.on("exit", (code) => (code === 0 ? done() : reject(new CliError(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

cli.help();
cli.version(pkg.version);

try {
  const parsed = cli.parse(process.argv, { run: false });
  ui.json = !!parsed.options.json;
  if (!cli.matchedCommand && !parsed.options.help && !parsed.options.version) cli.outputHelp();
  else await cli.runMatchedCommand();
} catch (e) {
  if (e instanceof CliError) {
    console.error(`${pc.red("✗")} ${e.message}`);
  } else console.error(e);
  process.exit(1);
}
