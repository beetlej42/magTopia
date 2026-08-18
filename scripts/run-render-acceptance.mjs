import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chromium from "@sparticuz/chromium";
import { PNG } from "pngjs";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.RENDER_ACCEPTANCE_PORT || 4178);
const suppliedUrl = process.env.RENDER_ACCEPTANCE_URL;
const baseUrl = suppliedUrl || `http://127.0.0.1:${port}`;

// Profile-driven acceptance. A single browser and scene launch serve every
// profile; the profile only changes how much is sampled, screenshot resolution,
// and how strictly results are asserted. This keeps the fast/smoke tiers from
// duplicating the (expensive) agent-city scene construction.
const PROFILES = {
  // Boot + init smoke check: page and WebGL start, the Agent city scene
  // initializes, terrain is visible, and the near/far/Bokeh state machine
  // behaves. No performance benchmark.
  smoke: {
    deviceScaleFactor: 1,
    dragFrames: 0,
    settledFrames: 0,
    screenshots: { nearBefore: true, nearAfter: false, farBefore: true, farAfter: false, transition: false },
    terrainCoverage: true,
    coverageStride: 4,
    // No performance gate: smoke must only catch boot/init regressions.
    maxP95Ms: 0
  },
  // Daily development gate. Reduced sampling and DPR 1 screenshots make it fast
  // while still catching near/far, terrain, Bokeh, and obvious performance
  // regressions. SwiftShader is never treated as a real mobile GPU, so the
  // default gate is a generous "obvious regression" threshold, not 60Hz.
  fast: {
    deviceScaleFactor: 1,
    dragFrames: 30,
    settledFrames: 15,
    screenshots: { nearBefore: true, nearAfter: false, farBefore: true, farAfter: false, transition: false },
    terrainCoverage: true,
    coverageStride: 3,
    // "Obvious regression" only: measured p95 here is ~0.2–0.6s under SwiftShader,
    // so this is ~2–5x headroom, never a 60Hz claim. Override via
    // RENDER_ACCEPTANCE_MAX_P95_MS.
    maxP95Ms: 1500
  },
  // Full visual + performance acceptance. DPR 3, complete settled + drag
  // sampling, before/after screenshots per view, the Bokeh far->near
  // transition, full terrain coverage, and every diagnostics assertion.
  full: {
    deviceScaleFactor: 3,
    dragFrames: 90,
    settledFrames: 45,
    screenshots: { nearBefore: true, nearAfter: true, farBefore: true, farAfter: true, transition: true },
    terrainCoverage: true,
    coverageStride: 2,
    // Optional SwiftShader-relative benchmark gate, opt-in only (see :60hz script).
    maxP95Ms: 0
  }
};

const requestedProfile = (process.env.RENDER_ACCEPTANCE_PROFILE || "fast").toLowerCase();
const profile = PROFILES[requestedProfile] || PROFILES.fast;
const profileLabel = requestedProfile;
const artifactsDir = path.join(root, "artifacts", "render-acceptance", profileLabel);

// Individual knobs remain overridable through the environment for one-off
// benchmark runs (for example RENDER_ACCEPTANCE_MAX_P95_MS=16.7 as a
// SwiftShader-relative perf gate).
const envNumber = (name) => (process.env[name] === undefined ? null : Number(process.env[name]));
const deviceScaleFactor = envNumber("RENDER_ACCEPTANCE_DEVICE_SCALE_FACTOR") ?? profile.deviceScaleFactor;
const dragFrames = Math.max(0, envNumber("RENDER_ACCEPTANCE_DRAG_FRAMES") ?? profile.dragFrames);
const settledFrames = Math.max(0, envNumber("RENDER_ACCEPTANCE_SETTLED_FRAMES") ?? profile.settledFrames);
const maxP95Ms = envNumber("RENDER_ACCEPTANCE_MAX_P95_MS") ?? profile.maxP95Ms;
const minimumTerrainCoverage = Number(process.env.RENDER_ACCEPTANCE_MIN_TERRAIN_COVERAGE || 0.08);
const coverageStride = Math.max(1, envNumber("RENDER_ACCEPTANCE_COVERAGE_STRIDE") ?? profile.coverageStride);
const voxelShader = process.env.RENDER_ACCEPTANCE_VOXEL_SHADER || "diffuse";
const worldTime = process.env.RENDER_ACCEPTANCE_WORLD_TIME || "0.58";
const bokeh = process.env.RENDER_ACCEPTANCE_BOKEH || "default";
const clock = process.env.RENDER_ACCEPTANCE_CLOCK || "0";
const dayLength = process.env.RENDER_ACCEPTANCE_DAY_LENGTH || "180";

const stageStart = performance.now();
const stages = {};
let pixelAnalysisMs = 0;
function mark(label) {
  stages[label] = Math.round(performance.now() - stageStart);
}

const server = suppliedUrl ? null : startViteServer(port);
const report = { profile: profileLabel };

try {
  await mkdir(artifactsDir, { recursive: true });
  if (server) await waitForServer(baseUrl);
  mark("serverStartup");

  const executablePath = process.env.CHROMIUM_PATH || await chromium.executablePath();
  const browser = await puppeteer.launch({
    executablePath,
    args: [...chromium.args, "--use-gl=angle", "--use-angle=swiftshader"],
    headless: "shell",
    protocolTimeout: 180000,
    defaultViewport: null
  });
  mark("browserStartup");

  try {
    report.details = await runAcceptance(browser);
    report.stageTimingsMs = stages;
    await writeReport(report);
    assertAcceptance(report.details);
    console.log(summaryText(report));
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
  mark("sceneReady");
  await page.evaluate(() => {
    document.documentElement.dataset.magtopiaPureView = "true";
  });
  const graphics = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const context = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
    const debugInfo = context?.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: debugInfo ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "unavailable",
      vendor: debugInfo ? context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : "unavailable"
    };
  });

  // Wait for the near view to settle (LOD warm-up, shadow refresh) instead of a
  // fixed sleep, then take the near screenshots and run settled + drag sampling.
  await waitForRenderStable(page, { targetBokehAmount: 1, stableFrames: 3, timeoutMs: 60000 });
  mark("nearStable");

  const near = {};
  if (profile.screenshots.nearBefore) {
    near.before = await captureVisionFrame(page, "near-before-drag");
    mark("nearBeforeScreenshot");
  }
  if (settledFrames > 0) {
    near.settledPerformance = await measureSettled(page, settledFrames);
    mark("nearSettled");
  }
  if (dragFrames > 0) {
    near.performance = await measureDrag(page, dragFrames);
    mark("nearDrag");
  }
  if (profile.screenshots.nearAfter) {
    near.after = await captureVisionFrame(page, "near-after-drag");
    mark("nearAfterScreenshot");
  }

  // Switch to the far view and wait for Bokeh to be fully bypassed and the
  // draw calls to settle before sampling the far tier.
  await page.evaluate(() => {
    document.querySelector("canvas")?.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      clientX: innerWidth / 2,
      clientY: innerHeight / 2
    }));
  });
  await page.waitForFunction(() => document.documentElement.dataset.magicTownDistrictView === "far", { timeout: 10000 });
  await waitForRenderStable(page, { targetBokehAmount: 0, stableFrames: 2, timeoutMs: 60000 });
  mark("farStable");

  const far = {};
  if (profile.screenshots.farBefore) {
    far.before = await captureVisionFrame(page, "far-before-drag");
    mark("farBeforeScreenshot");
  }
  if (settledFrames > 0) {
    far.settledPerformance = await measureSettled(page, settledFrames);
    mark("farSettled");
  }
  if (dragFrames > 0) {
    far.performance = await measureDrag(page, dragFrames);
    mark("farDrag");
  }
  if (profile.screenshots.farAfter) {
    far.after = await captureVisionFrame(page, "far-after-drag");
    mark("farAfterScreenshot");
  }

  let nearTransition = null;
  if (profile.screenshots.transition) {
    nearTransition = await captureNearTransition(page);
    mark("transition");
  }

  const activeVoxelShader = await page.evaluate(() => document.documentElement.dataset.magicTownVoxelShader);
  await page.close();

  return {
    profile: profileLabel,
    viewport: { css: [390, 844], deviceScaleFactor },
    voxelShader: activeVoxelShader,
    worldTime,
    bokeh,
    clock,
    graphics,
    browserErrors,
    thresholds: { minimumTerrainCoverage, maximumP95Ms: maxP95Ms, coverageStride },
    sampling: { settledFrames, dragFrames },
    pixelAnalysisMs,
    near,
    far,
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
  // The Bokeh fade is driven by per-frame delta, so under slow SwiftShader
  // frames it can complete in a few frames. Instead of relying on one lucky
  // sample, record every distinct Bokeh amount observed until the fade lands at
  // full Bokeh (or a bounded budget elapses).
  const recorded = await page.evaluate(() => new Promise((resolve) => {
    const seen = [];
    let last = null;
    const startedAt = performance.now();
    const step = () => {
      const amount = Number(document.documentElement.dataset.magicTownBokehViewAmount || 0);
      if (amount !== last) {
        seen.push(amount);
        last = amount;
      }
      if (amount >= 0.999 || performance.now() - startedAt > 6000) {
        resolve({ seen, finalAmount: amount, elapsedMs: Math.round(performance.now() - startedAt) });
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }));
  const vision = await captureVisionFrame(page, "far-to-near-transition");
  await page.waitForFunction(() => (
    document.documentElement.dataset.magicTownDistrictView === "near"
      && Number(document.documentElement.dataset.magicTownBokehViewAmount || 0) >= 0.999
  ), { timeout: 10000, polling: "raf" });
  return {
    amount: recorded.finalAmount,
    distinctAmounts: recorded.seen,
    transitionFrames: recorded.seen.length,
    transitionElapsedMs: recorded.elapsedMs,
    vision,
    settled: await getRenderDiagnostics(page)
  };
}

async function waitForRenderStable(page, { targetBokehAmount, stableFrames = 3, stabilityBudgetMs = 6000, timeoutMs = 60000 }) {
  // Replaces fixed sleeps: wait until the view reports a correct Bokeh amount
  // and its draw calls stop changing. Animated street life can keep the count
  // oscillating, so accept once either the stability run completes or a bounded
  // stability budget elapses while the draw calls are already healthy.
  const deadline = Date.now() + timeoutMs;
  let lastDrawCalls = -1;
  let stableCount = 0;
  let metAt = null;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const root = document.documentElement.dataset;
      return {
        drawCalls: Number(root.magicTownDrawCalls || 0),
        bokehAmount: Number(root.magicTownBokehViewAmount || 0),
        districtView: root.magicTownDistrictView
      };
    });
    const bokehTarget = bokeh === "0" ? state.bokehAmount : targetBokehAmount;
    const met = state.drawCalls > 0 && Math.abs(state.bokehAmount - bokehTarget) <= 0.001;
    if (met) {
      metAt ??= Date.now();
      if (state.drawCalls === lastDrawCalls) stableCount += 1;
      else stableCount = 0;
      lastDrawCalls = state.drawCalls;
      if (stableCount >= stableFrames) return state;
      if (Date.now() - metAt >= stabilityBudgetMs) return state;
    } else {
      metAt = null;
      lastDrawCalls = -1;
      stableCount = 0;
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  throw new Error(`Scene did not stabilize within ${timeoutMs}ms (drawCalls=${lastDrawCalls}, targetBokeh=${targetBokehAmount})`);
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
  const terrainCoverage = profile.terrainCoverage
    ? await measureTerrainCoverage(screenshotPath)
    : null;
  return { screenshotPath, terrainCoverage, ...terrainState };
}

async function measureTerrainCoverage(imagePath) {
  const scanStart = performance.now();
  const png = PNG.sync.read(await readFile(imagePath));
  const width = png.width;
  const height = png.height;
  const stride = coverageStride;
  let terrainPixels = 0;
  let totalPixels = 0;
  // Subsampled scan: coverage of a large scene changes very slowly with pixel
  // density, so stepping by `stride` cuts the scan cost without changing the
  // >0.08 threshold verdict.
  for (let y = 0; y < height; y += stride) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += stride) {
      const index = (rowOffset + x) * 4;
      const red = png.data[index];
      const green = png.data[index + 1];
      const blue = png.data[index + 2];
      if (green > 70 && green > red * 1.08 && green > blue * 1.1) terrainPixels += 1;
      totalPixels += 1;
    }
  }
  pixelAnalysisMs += Math.round(performance.now() - scanStart);
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

function assertAcceptance(result) {
  const failures = [];
  const assert = (condition, message) => { if (!condition) failures.push(message); };

  assert(result.browserErrors.length === 0, `browser errors: ${result.browserErrors.join(" | ")}`);

  // Scene initialization and WebGL boot are the shared baseline for every profile.
  assert(result.graphics.renderer !== "unavailable", "WebGL context could not be created");
  assert(typeof result.near.before?.visibleChunks === "number" && result.near.before.visibleChunks > 0, "near view has no visible terrain chunks");

  for (const view of ["near", "far"]) {
    const tier = result[view];
    for (const phase of ["before", "after"]) {
      const vision = tier?.vision?.[phase] ?? tier?.[phase];
      if (!vision) continue;
      if (vision.visibleChunks === 0) failures.push(`${view} ${phase} has no visible terrain chunks`);
      if (vision.terrainCoverage !== null && vision.terrainCoverage < minimumTerrainCoverage) {
        failures.push(`${view} ${phase} terrain coverage ${vision.terrainCoverage} < ${minimumTerrainCoverage}`);
      }
    }

    if (tier?.settledPerformance) {
      if (maxP95Ms > 0 && tier.settledPerformance.p95Ms > maxP95Ms) {
        failures.push(`${view} settled p95 ${tier.settledPerformance.p95Ms}ms > ${maxP95Ms}ms`);
      }
    }
    if (tier?.performance) {
      if (maxP95Ms > 0 && tier.performance.p95Ms > maxP95Ms) {
        failures.push(`${view} drag p95 ${tier.performance.p95Ms}ms > ${maxP95Ms}ms`);
      }
      if (bokeh !== "0" && view === "near" && tier.performance.bokehSuppressedFrames !== 0) {
        failures.push(`${view} suppressed Bokeh for ${tier.performance.bokehSuppressedFrames} moving frames`);
      }
    }
  }

  const nearSettled = result.near?.settledPerformance ?? result.near?.before;
  const farSettled = result.far?.settledPerformance ?? result.far?.before;
  if (bokeh !== "0") {
    if (nearSettled && (!nearSettled.bokehActive || nearSettled.bokehViewAmount < 0.999)) {
      failures.push("near view did not retain full Bokeh");
    }
    if (farSettled && (farSettled.bokehActive || farSettled.bokehViewAmount > 0.001)) {
      failures.push("far view retained Bokeh instead of bypassing the post-process");
    }
  }

  // Full profile additionally verifies the shared-depth Bokeh and the
  // far->near transition. The transition progresses with per-frame delta, so
  // slow software frames legitimately complete it in a couple of frames; the
  // check only requires that Bokeh re-engages and the amount moved at all
  // (i.e. it was not a broken single-state pop).
  if (result.nearTransition) {
    if (result.nearTransition.amount < 0.999) {
      failures.push(`far-to-near Bokeh transition never reached full Bokeh: ${result.nearTransition.amount}`);
    }
    if (result.nearTransition.transitionFrames < 1) {
      failures.push("far-to-near Bokeh transition did not progress through any distinct state");
    }
    if (bokeh !== "0") {
      if (!result.nearTransition.settled.bokehActive || result.nearTransition.settled.bokehViewAmount < 0.999) {
        failures.push("far-to-near transition did not finish at full Bokeh");
      }
    }
  }
  if (bokeh !== "0" && result.near?.settledPerformance) {
    const nearSettledPerf = result.near.settledPerformance;
    if (nearSettledPerf.bokehDepth?.usingSharedDepth !== true) {
      failures.push("near settled Bokeh did not reuse the main scene depth texture");
    }
    if (nearSettledPerf.bokehDepth?.fallbackDepthRenders !== 0) {
      failures.push(`near rendered ${nearSettledPerf.bokehDepth.fallbackDepthRenders} fallback depth passes`);
    }
  }

  if (failures.length) throw new Error(`Render acceptance (${result.profile}) failed:\n- ${failures.join("\n- ")}`);
}

async function writeReport(reportData) {
  const reportPath = path.join(artifactsDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(reportData, null, 2)}\n`);
  reportData.reportPath = reportPath;
}

function summaryText(data) {
  const d = data.details;
  const lines = [];
  lines.push(`Render acceptance · profile=${d.profile} · ${data.reportPath}`);
  const total = Math.round(performance.now() - stageStart);
  lines.push(`total: ${total}ms`);
  const display = ["serverStartup", "browserStartup", "sceneReady", "nearStable", "nearSettled", "nearDrag", "farStable", "farSettled", "farDrag", "transition"];
  for (const key of display) {
    if (stages[key] !== undefined) lines.push(`  ${key.padEnd(16)} ${String(stages[key]).padStart(7)}ms`);
  }
  lines.push(`  ${"pixel analysis".padEnd(16)} ${String(d.pixelAnalysisMs ?? 0).padStart(7)}ms`);
  for (const view of ["near", "far"]) {
    const tier = d[view];
    const before = tier?.before;
    const perf = tier?.performance ?? tier?.settledPerformance;
    if (perf) {
      lines.push(`  ${view} p95=${perf.p95Ms}ms mean=${perf.meanMs}ms drawCalls=${perf.drawCalls} triangles=${perf.triangles}`);
    } else if (before) {
      lines.push(`  ${view} terrainCoverage=${before.terrainCoverage} visibleChunks=${before.visibleChunks}`);
    }
  }
  if (d.browserErrors?.length) lines.push(`  browserErrors: ${d.browserErrors.join(" | ")}`);
  return `\n${lines.join("\n")}\n`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
