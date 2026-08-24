// Dev-loop screenshot helper: start the Vite dev server, load the page in a
// pinned headless Chromium, and save a PNG so changes can be checked visually
// without a human in the loop. See reference/farmer-sim-design-doc-v2.md
// section 1 for why this exists (the artifact environment had no way to see
// its own WebGL output).
//
// Usage: node scripts/screenshot.mjs [outPath] [--wait=ms]
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const waitArg = args.find((a) => a.startsWith("--wait="));
const extraWaitMs = waitArg ? Number(waitArg.split("=")[1]) : 600;
const outPath = args.find((a) => !a.startsWith("--")) ?? path.join(root, "screenshots", "latest.png");

const PORT = 5183;
// Must match vite.config.js `base` — the dev server serves the app under
// that path too, matching production (GitHub Pages) behavior.
const URL = `http://localhost:${PORT}/farmer-life-sim/`;
const CHROMIUM_PATH = "/opt/pw-browsers/chromium";

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // server not up yet
      }
      if (Date.now() - start > timeoutMs) return reject(new Error("dev server did not start in time"));
      setTimeout(poll, 250);
    })();
  });
}

async function main() {
  const viteBin = path.join(root, "node_modules", ".bin", "vite");
  const server = spawn(viteBin, ["--port", String(PORT), "--strictPort"], {
    cwd: root,
    stdio: "pipe",
  });
  server.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  try {
    await waitForServer(URL, 30000);

    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });

    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));

    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(extraWaitMs);

    await page.screenshot({ path: outPath });
    await browser.close();

    console.log(`Saved screenshot to ${outPath}`);
    if (errors.length) {
      console.error("Console errors detected during render:");
      for (const e of errors) console.error(" -", e);
      process.exitCode = 1;
    }
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
