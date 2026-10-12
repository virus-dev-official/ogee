import pc from "picocolors";

export const ui = {
  json: false,
  /** Prints a line unless we're printing JSON. */
  log(...parts: unknown[]) {
    if (!this.json) console.log(...parts);
  },
  step(msg: string) {
    this.log(`${pc.cyan("›")} ${msg}`);
  },
  ok(msg: string) {
    this.log(`${pc.green("✓")} ${msg}`);
  },
  warn(msg: string) {
    if (this.json) console.error(`warning: ${msg}`);
    else console.log(`${pc.yellow("!")} ${msg}`);
  },
};

export class CliError extends Error {}

/** Stops the command with a message for the user (no stack trace). */
export function fail(msg: string): never {
  throw new CliError(msg);
}

export const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Shows a PNG right in the terminal on iTerm2, WezTerm and VS Code. Does nothing elsewhere. */
export function inlineImage(png: Uint8Array, widthCells = 64): boolean {
  const term = process.env.TERM_PROGRAM ?? "";
  if (!process.stdout.isTTY || !["iTerm.app", "WezTerm", "vscode"].includes(term)) return false;
  const b64 = Buffer.from(png).toString("base64");
  process.stdout.write(`\x1b]1337;File=inline=1;width=${widthCells};preserveAspectRatio=1;size=${png.length}:${b64}\x07\n`);
  return true;
}

export { pc };
