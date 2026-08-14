import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chromium from "@sparticuz/chromium";
import { PNG } from "pngjs";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(root, "artifacts", "render-acceptance");
const port = Number(process.env.RENDER_ACCEPTANCE_PORT || 4178);
const suppliedUrl = process.env.RENDER_ACCEPTANCE_URL;
const baseUrl = suppliedUrl || `http://127.0.0.1:${port}`;
// The default command records interaction performance without pretending that
// SwiftShader represents a phone GPU. The :60hz package script sets this to
// 16.7ms and turns the measurement into a hardware performance gate.
const maximumP95Ms = Number(process.env.RENDER_ACCEPTANCE_MAX_P95_MS || 0);
const minimumTerrainCoverage = Number(process.env.RENDER_ACCEPTANCE_MIN_TERRAIN_COVERAGE || 0.08);
const dragFrames = Math.max(30, Number(process.env.RENDER_ACCEPTANCE_DRAG_FRAMES || 90));
const voxelShader = process.env.RENDER_ACCEPTANCE_VOXEL_SHADER || "diffuse";
const worldTime = process.env.RENDER_ACCEPTANCE_WORLD_TIME || "0.58";
const bokeh = process.env.RENDER_ACCEPTANCE_BOKEH || "default";
const clock = process.env.RENDER_ACCEPTANCE_CLOCK || "0";
const dayLength = process.env.RENDER_ACCEPTANCE_DAY_LENGTH || "180";
const deviceScaleFactor = Number(process.env.RENDER_ACCEPTANCE_DEVICE_SCALE_FACTOR || 3);
const server = suppliedUrl ? null : startViteServer(port);

await mkdir(artifactsDir, { recursive: true });
try {
  if (server) await waitForServer(baseUrl);
  const executablePath = process.env.CHROMIUM_PATH || await chromium.executablePath();
  const browser = await puppeteer.launch({
    executablePath,
    args: [...chromium.args, "--use-gl=angle", "--use-angle=swiftshader"],
    headless: "shell",
    protocolTimeout: 180000,
    defaultViewport: null
  });
  try {
    const report = await runAcceptance(browser);
    const reportPath = path.join(artifactsDir, "report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath, ...report }, null, 2));
    assertAcceptance(report);
  } finally {
    await browser.close();
  }
} finally {
  server?.kill("SIGTERM");
}

function startViteServer(serverPort) {
  return spawn(process.execPath, [
    path.join(root, "node_modules", "vite", "bin", "vite.js"),
    "--host", "127.0.0.1",
    "--port", String(serverPort)
  ], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for the render acceptance server at ${url}`);
}

async function runAcceptance(browser) {
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1");
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor,
    isMobile: true,
    hasTouch: true
  });
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const bokehQuery = bokeh === "default" ? "" : `&bokeh=${encodeURIComponent(bokeh)}`;
  const query = `?mode=agentcity&worldTime=${encodeURIComponent(worldTime)}&clock=${encodeURIComponent(clock)}&dayLength=${encodeURIComponent(dayLength)}&adaptiveQuality=0${bokehQuery}&voxelShader=${encodeURIComponent(voxelShader)}`;
  await page.goto(`${baseUrl}/${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => {
    if (!window.MAGTOPIA?.getObject?.()) return false;
    const diagnostics = JSON.parse(document.documentElement.dataset.magicTownVoxel || "{}");
    return diagnostics.success === true;
  }, { timeout: 120000 });
  await page.evaluate(() => {
    document.documentElement.dataset.magtopiaPureView = "true";
  });
  const graphics = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const debugInfo = context?.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: debugInfo ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "unavailable",
      vendor: debugInfo ? context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : "unavailable"
    };
  });
  // Hold scene resolution at its mobile high-quality starting point. Near-view
  // Bokeh remains active in motion, then fades out across the far transition.
  await delay(1500);

  const nearBefore = await captureVisionFrame(page, "near-before-drag");
  const nearSettledPerformance = await measureSettled(page, Math.max(30, Math.round(dragFrames / 2)));
  const nearPerformance = await measureDrag(page, dragFrames);
  const nearAfter = await captureVisionFrame(page, "near-after-drag");

  await page.evaluate(() => {
    document.querySelector("canvas")?.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      clientX: innerWidth / 2,
      clientY: innerHeight / 2
    }));
  });
  await page.waitForFunction(() => document.documentElement.dataset.magicTownDistrictView === "far", { timeout: 10000 });
  await delay(1200);
  const farBefore = await captureVisionFrame(page, "far-before-drag");
  const farSettledPerformance = await measureSettled(page, Math.max(30, Math.round(dragFrames / 2)));
  const farPerformance = await measureDrag(page, dragFrames);
  const farAfter = await captureVisionFrame(page, "far-after-drag");
  const nearTransition = await captureNearTransition(page);
  const activeVoxelShader = await page.evaluate(() => document.documentElement.dataset.magicTownVoxelShader);
  await page.close();

  return {
    viewport: { css: [390, 844], deviceScaleFactor },
    voxelShader: activeVoxelShader,
    worldTime,
    bokeh,
    clock,
    graphics,
    browserErrors,
    thresholds: { minimumTerrainCoverage, maximumP95Ms },
    near: { vision: { before: nearBefore, after: nearAfter }, settledPerformance: nearSettledPerformance, performance: nearPerformance },
    far: { vision: { before: farBefore, after: farAfter }, settledPerformance: farSettledPerformance, performance: farPerformance },
    nearTransition
  };
}

async function captureNearTransition(page) {
  await page.evaluate(() => {
    document.querySelector("canvas")?.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      clientX: innerWidth / 2,
      clientY: innerHeight / 2
    }));
  });
  await page.waitForFunction(() => {
    const amount = Number(document.documentElement.dataset.magicTownBokehViewAmount || 0);
    return amount > 0.05 && amount < 0.995;
  }, { timeout: 10000, polling: "raf" });
  const amount = await page.evaluate(() => Number(document.documentElement.dataset.magicTownBokehViewAmount || 0));
  const vision = await captureVisionFrame(page, "far-to-near-transition");
  await page.waitForFunction(() => (
    document.documentElement.dataset.magicTownDistrictView === "near"
      && Number(document.documentElement.dataset.magicTownBokehViewAmount || 0) >= 0.999
  ), { timeout: 10000, polling: "raf" });
  return { amount, vision, settled: await getRenderDiagnostics(page) };
}

async function captureVisionFrame(page, label) {
  await page.evaluate(() => {
    document.documentElement.dataset.magtopiaPureView = "true";
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const screenshotPath = path.join(artifactsDir, `${label}.png`);
  await page.screenshot({ path: screenshotPath });
  const terrainState = await page.evaluate(() => {
    let chunks = 0;
    let visibleChunks = 0;
    window.MAGTOPIA.getObject().traverse((object) => {
      if (object.userData?.materialId !== "macroTerrain") return;
      chunks += 1;
      if (object.visible) visibleChunks += 1;
    });
    return {
      viewMode: document.documentElement.dataset.magicTownDistrictView,
      focus: document.documentElement.dataset.magicTownDistrictFocus,
      bokehViewAmount: Number(document.documentElement.dataset.magicTownBokehViewAmount || 0),
      bokehActive: document.documentElement.dataset.magicTownBokehActive === "true",
      chunks,
      visibleChunks
    };
  });
  const terrainCoverage = await measureTerrainCoverage(screenshotPath);
  return { screenshotPath, terrainCoverage, ...terrainState };
}

async function measureTerrainCoverage(imagePath) {
  const png = PNG.sync.read(await readFile(imagePath));
  let terrainPixels = 0;
  const totalPixels = png.width * png.height;
  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    if (green > 70 && green > red * 1.08 && green > blue * 1.1) terrainPixels += 1;
  }
  return Number((terrainPixels / totalPixels).toFixed(4));
}

async function measureDrag(page, frameCount) {
  const dragSample = await page.evaluate((frames) => new Promise((resolve) => {
    const canvas = document.querySelector("canvas");
    const rect = canvas.getBoundingClientRect();
    const pointerId = 71;
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const dispatch = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: "mouse",
      isPrimary: true,
      buttons,
      clientX: x,
      clientY: y
    }));
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.55;
    dispatch("pointerdown", centerX, centerY, 1);
    const samples = [];
    let bokehSuppressedFrames = 0;
    let previous = performance.now();
    let frame = 0;
    const sample = (now) => {
      if (frame > 0) samples.push(now - previous);
      if (document.documentElement.dataset.magicTownBokehMotionSuppressed === "true") bokehSuppressedFrames += 1;
      previous = now;
      const phase = frame / Math.max(1, frames - 1) * Math.PI * 4;
      dispatch(
        "pointermove",
        centerX + Math.sin(phase) * rect.width * 0.18,
        centerY + Math.cos(phase * 0.7) * rect.height * 0.1,
        1
      );
      frame += 1;
      if (frame >= frames) {
        dispatch("pointerup", centerX, centerY, 0);
        resolve({ intervals: samples, bokehSuppressedFrames });
      } else {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
  }), frameCount);

  const intervals = dragSample.intervals;
  const diagnostics = await getRenderDiagnostics(page);
  const sorted = [...intervals].sort((left, right) => left - right);
  const meanMs = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  return {
    frames: intervals.length,
    meanMs: Number(meanMs.toFixed(2)),
    p50Ms: Number(percentile(sorted, 0.5).toFixed(2)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
    meanFps: Number((1000 / meanMs).toFixed(1)),
    bokehSuppressedFrames: dragSample.bokehSuppressedFrames,
    ...diagnostics
  };
}

async function measureSettled(page, frameCount) {
  const intervals = await page.evaluate((frames) => new Promise((resolve) => {
    const samples = [];
    let previous = performance.now();
    let frame = 0;
    const sample = (now) => {
      if (frame > 0) samples.push(now - previous);
      previous = now;
      frame += 1;
      if (frame >= frames) resolve(samples);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), frameCount);
  return summarizeIntervals(intervals, await getRenderDiagnostics(page));
}

async function getRenderDiagnostics(page) {
  return page.evaluate(() => {
    const root = document.documentElement.dataset;
    return {
      dpr: Number(root.magicTownPixelRatio || 0),
      drawCalls: Number(root.magicTownDrawCalls || 0),
      triangles: Number(root.magicTownTriangles || 0),
      bokehQuality: Number(root.magicTownBokehQuality || 0),
      depthOfFieldScale: Number(root.magicTownDepthOfFieldScale || 0),
      bokehEnabled: root.magicTownBokehEnabled === "true",
      bokehActive: root.magicTownBokehActive === "true",
      bokehViewAmount: Number(root.magicTownBokehViewAmount || 0),
      bokehPolicy: root.magicTownBokehPolicy || "unknown",
      voxelShaderMaterials: JSON.parse(root.magicTownVoxelShaderMaterials || "{}"),
      shadowRefresh: JSON.parse(root.magicTownShadowRefresh || "{}"),
      bokehDepth: JSON.parse(root.magicTownBokehDepth || "{}"),
      viewUpdates: JSON.parse(root.magicTownViewUpdates || "{}")
    };
  });
}

function summarizeIntervals(intervals, diagnostics = {}) {
  const sorted = [...intervals].sort((left, right) => left - right);
  const meanMs = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  return {
    frames: intervals.length,
    meanMs: Number(meanMs.toFixed(2)),
    p50Ms: Number(percentile(sorted, 0.5).toFixed(2)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
    meanFps: Number((1000 / meanMs).toFixed(1)),
    ...diagnostics
  };
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
}

function assertAcceptance(report) {
  const failures = [];
  for (const view of ["near", "far"]) {
    const result = report[view];
    for (const phase of ["before", "after"]) {
      const vision = result.vision[phase];
      if (vision.terrainCoverage < minimumTerrainCoverage) {
        failures.push(`${view} ${phase} terrain coverage ${vision.terrainCoverage} < ${minimumTerrainCoverage}`);
      }
      if (vision.visibleChunks === 0) failures.push(`${view} ${phase} has no visible terrain chunks`);
    }
    if (maximumP95Ms > 0 && result.performance.p95Ms > maximumP95Ms) {
      failures.push(`${view} drag p95 ${result.performance.p95Ms}ms > ${maximumP95Ms}ms`);
    }
    if (maximumP95Ms > 0 && result.settledPerformance.p95Ms > maximumP95Ms) {
      failures.push(`${view} settled p95 ${result.settledPerformance.p95Ms}ms > ${maximumP95Ms}ms`);
    }
    if (view === "near" && bokeh !== "0" && result.settledPerformance.bokehDepth.usingSharedDepth !== true) {
      failures.push(`${view} settled Bokeh did not reuse the main scene depth texture`);
    }
    if (view === "near" && bokeh !== "0" && result.settledPerformance.bokehDepth.fallbackDepthRenders !== 0) {
      failures.push(`${view} rendered ${result.settledPerformance.bokehDepth.fallbackDepthRenders} fallback depth passes`);
    }
    if (view === "near" && bokeh !== "0" && result.performance.bokehSuppressedFrames !== 0) {
      failures.push(`${view} suppressed Bokeh for ${result.performance.bokehSuppressedFrames} moving frames`);
    }
    if (view === "near" && bokeh !== "0" && (!result.settledPerformance.bokehActive || result.settledPerformance.bokehViewAmount < 0.999)) {
      failures.push("near view did not retain full Bokeh");
    }
    if (view === "far" && (result.settledPerformance.bokehActive || result.settledPerformance.bokehViewAmount > 0.001)) {
      failures.push("far view retained Bokeh instead of bypassing the post-process");
    }
  }
  if (bokeh !== "0") {
    const transitionAmount = report.nearTransition.amount;
    if (!(transitionAmount > 0.05 && transitionAmount < 0.995)) {
      failures.push(`far-to-near Bokeh transition was not gradual: ${transitionAmount}`);
    }
    if (!report.nearTransition.settled.bokehActive || report.nearTransition.settled.bokehViewAmount < 0.999) {
      failures.push("far-to-near transition did not finish at full Bokeh");
    }
  }
  if (report.browserErrors.length) failures.push(`browser errors: ${report.browserErrors.join(" | ")}`);
  if (failures.length) throw new Error(`Render acceptance failed:\n- ${failures.join("\n- ")}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
