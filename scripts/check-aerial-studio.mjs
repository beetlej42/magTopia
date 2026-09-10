import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const dir = new URL("../artifacts/palette-study/", import.meta.url).pathname;
await mkdir(dir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--enable-gpu", "--no-sandbox"], protocolTimeout: 180000
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => new URL(r.url()).pathname === "/favicon.ico" ? r.respond({status:204}) : r.continue());
  const emptyFrameMs = await page.evaluate(() => new Promise(resolve => {
    const frames = []; let previous;
    function tick(now) {
      if (previous !== undefined) frames.push(now - previous);
      previous = now;
      if (frames.length < 90) requestAnimationFrame(tick);
      else resolve(frames.reduce((a,b)=>a+b) / frames.length);
    }
    requestAnimationFrame(tick);
  }));
  for (const enabled of [1, 0]) {
    await page.goto(`http://127.0.0.1:4178/studio?mode=district&calibration=sunlit&clock=0&worldTime=0.38&bokeh=0&aerialPerspective=${enabled}`, {waitUntil:"networkidle0"});
    await page.waitForFunction(() => window.MAGTOPIA?.getObject?.() && document.documentElement.dataset.magicTownMode === "district");
    for (const view of ["near", "far"]) {
      if (view === "far") {
        await page.evaluate(() => document.querySelector("canvas").dispatchEvent(new MouseEvent("dblclick", {bubbles:true,clientX:720,clientY:500})));
        await page.waitForFunction(() => document.documentElement.dataset.magicTownDistrictView === "far");
      }
      await new Promise(r=>setTimeout(r,1500));
      await page.evaluate(()=>{document.documentElement.dataset.magtopiaPureView="true";});
      await page.screenshot({path:`${dir}aerial-${enabled}-${view}.png`});
    }
  }
  const comparisons = [];
  for (const view of ["near", "far"]) {
    const on = PNG.sync.read(await readFile(`${dir}aerial-1-${view}.png`));
    const off = PNG.sync.read(await readFile(`${dir}aerial-0-${view}.png`));
    // Fixed foreground ground patch; below all animated sky/building features.
    let maximum = 0, sum = 0, count = 0;
    for (let y = 850; y < 980; y++) for (let x = 700; x < 1200; x++) for (let c = 0; c < 3; c++) {
      const i = (y * on.width + x) * 4 + c;
      const delta = Math.abs(on.data[i] - off.data[i]);
      maximum = Math.max(maximum, delta); sum += delta; count++;
    }
    comparisons.push({view, foregroundMaximumChannelDelta:maximum, foregroundMeanChannelDelta:sum/count});
  }
  const report = {emptyFrameMs, errors, comparisons};
  await writeFile(`${dir}aerial-check.json`, JSON.stringify(report,null,2));
  console.log(report);
  if (errors.length || comparisons.some(x=>x.foregroundMaximumChannelDelta > 1)) throw new Error("Foreground haze regression");
} finally { await browser.close(); }
