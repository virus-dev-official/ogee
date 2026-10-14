import type { Browser } from "playwright-core";
import { fail } from "./ui.js";

/**
 * Starts a headless browser: the Chrome or Edge already on this machine if there is one,
 * else Playwright's own Chromium. Nothing is downloaded behind your back.
 */
export async function launchBrowser(): Promise<Browser> {
  // An optional dependency, loaded only here: when it's missing, every command that doesn't need a
  // browser still works, and the ones that do say how to get it.
  let chromium: typeof import("playwright-core").chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    fail("This command reads your site in a headless browser, and playwright-core isn't installed.\nInstall it next to ogee: npm install playwright-core");
  }
  const errors: string[] = [];
  for (const channel of ["chrome", "msedge", "chromium", undefined]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (e) {
      errors.push(`${channel ?? "playwright chromium"}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  fail(
    "ogee needs a Chromium-based browser for this, and couldn't start one.\n" +
      "Install Google Chrome, or run: npx playwright-core install chromium\n\n" +
      errors.join("\n"),
  );
}
