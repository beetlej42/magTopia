import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const label = process.argv[2] || "after";
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("Use an alphanumeric screenshot label");
const dir = fileURLToPath(new URL("../artifacts/sunlit-alignment/", import.meta.url));
const sceneMode = process.env.STUDIO_MODE || "agentcity";
const worldTime = process.env.STUDIO_TIME || "0.38";
const baseUrl = process.env.STUDIO_URL || "http://127.0.0.1:4178";
await mkdir(dir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-gpu", "--no-sandbox"],
  protocolTimeout: 180000
});
const results = [];
try {
  for (const [name, width, height, dpr] of [["desktop", 1440, 1000, 1], ["mobile", 390, 844, 2]]) {
    const page = await browser.newPage();
    // Chrome requests an optional favicon even though this Studio has none.
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/favicon.ico") request.respond({ status: 204 });
      else request.continue();
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setViewport({ width, height, deviceScaleFactor: dpr, isMobile: name === "mobile", hasTouch: name === "mobile" });
    const query = new URLSearchParams({ mode: sceneMode, worldTime, clock: "0" });
    await page.goto(`${baseUrl}/studio?${query}`, { waitUntil: "networkidle0", timeout: 180000 });
    await page.waitForFunction((mode) => window.MAGTOPIA?.getObject?.()
      && document.documentElement.dataset.magicTownMode === mode, { timeout: 180000 }, sceneMode);
    await page.evaluate(() => { document.documentElement.dataset.magtopiaPureView = "true"; });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await page.screenshot({ path: `${dir}${label}-${name}.png` });
    let lighting = null;
    if (process.env.STUDIO_LIGHTING === "1") {
      lighting = await page.evaluate(() => {
        const root = window.MAGTOPIA.getObject();
        const plots = root.children.filter((child) => child.name.startsWith("IntentPlot-"));
        return plots.map((plot) => {
          let casters = 0;
          root.traverse((mesh) => {
            if (mesh.isMesh && mesh.castShadow && mesh.userData.studioPlotName === plot.name) casters += 1;
          });
          return { name: plot.name, casters };
        });
      });
      if (lighting.some((plot) => plot.casters === 0)) throw new Error("Studio building shadow casters are missing");
      for (const time of [0.32, 0.5, 0.68]) {
        await page.evaluate((time) => {
          window.MAGTOPIA.setWorldTime(time);
          document.documentElement.dataset.magtopiaPureView = "true";
        }, time);
        await new Promise((resolve) => setTimeout(resolve, 600));
        await page.screenshot({ path: `${dir}${label}-${name}-sun-${time}.png` });
      }
      await page.evaluate((time) => {
        window.MAGTOPIA.setWorldTime(Number(time));
        document.documentElement.dataset.magtopiaPureView = "true";
      }, worldTime);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    const metrics = await page.evaluate(async () => {
      const canvas = document.querySelector("canvas");
      const gl = canvas.getContext("webgl2");
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const sample = (moving) => new Promise((resolve) => {
        const originalCapture = canvas.setPointerCapture;
        const originalRelease = canvas.releasePointerCapture;
        canvas.releasePointerCapture = () => {};
        canvas.setPointerCapture = () => {};
        const dispatch = (type, x, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
          pointerId: 71, pointerType: "mouse", isPrimary: true, buttons,
          clientX: x, clientY: innerHeight / 2, bubbles: true
        }));
        if (moving) dispatch("pointerdown", innerWidth / 2, 1);
        let previous;
        const frames = [];
        const tick = (now) => {
          if (previous !== undefined) frames.push(now - previous);
          previous = now;
          if (moving) dispatch("pointermove", innerWidth / 2 + Math.sin(frames.length / 25) * 30, 1);
          if (frames.length < 180) return requestAnimationFrame(tick);
          if (moving) dispatch("pointerup", innerWidth / 2, 0);
          canvas.setPointerCapture = originalCapture;
          canvas.releasePointerCapture = originalRelease;
          frames.sort((a, b) => a - b);
          resolve({ median: frames[90], p95: frames[171], mean: frames.reduce((a, b) => a + b) / frames.length });
        };
        requestAnimationFrame(tick);
      });
      return {
        gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
        settled: await sample(false), moving: await sample(true),
        dataset: { ...document.documentElement.dataset }
      };
    });
    await page.evaluate(() => document.querySelector("canvas").dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2
    })));
    await page.waitForFunction(() => document.documentElement.dataset.magicTownBokehActive === "false", { timeout: 15000 });
    await page.evaluate(() => { document.documentElement.dataset.magtopiaPureView = "true"; });
    await page.screenshot({ path: `${dir}${label}-${name}-far.png` });
    const farBokeh = await page.evaluate(() => document.documentElement.dataset.magicTownBokehActive);
    await page.evaluate(() => window.MAGTOPIA.setWorldTime(0.02));
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.evaluate(() => { document.documentElement.dataset.magtopiaPureView = "true"; });
    await page.screenshot({ path: `${dir}${label}-${name}-night.png` });
    results.push({ name, sceneMode, worldTime, width, height, dpr, errors, lighting, farBokeh, ...metrics });
    await page.close();
  }
  await writeFile(`${dir}${label}-report.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ dataset, ...result }) => result), null, 2));
} finally {
  await browser.close();
}
