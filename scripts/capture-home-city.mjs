import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-gpu'], protocolTimeout: 180000 });
await mkdir('artifacts/homepage/native', { recursive: true });
try {
 const page = await browser.newPage();
 await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});
 await page.goto('http://127.0.0.1:4178/studio?mode=district&worldTime=0.38&clock=0&bokeh=0&aerialPerspective=0', {waitUntil:'networkidle0',timeout:180000});
 await page.waitForFunction(()=>window.MAGTOPIA?.getObject?.(),{timeout:180000});
 await page.evaluate(()=>{document.documentElement.dataset.magtopiaPureView='true';});
 await page.evaluate(()=>{window.homeStageMeshes=[];window.MAGTOPIA.getObject().traverse(mesh=>{if(mesh.userData.studioPlotName) window.homeStageMeshes.push({mesh,parent:mesh.parent,plot:mesh.userData.studioPlotName});});});
 await new Promise(r=>setTimeout(r,2500));
 await page.screenshot({path:'public/brand/city-day.jpg',type:'jpeg',quality:90});
 await page.evaluate(()=>window.MAGTOPIA.setWorldTime(.8));
 await new Promise(r=>setTimeout(r,1800));
 await page.screenshot({path:'public/brand/city-night.jpg',type:'jpeg',quality:90});
 await page.evaluate(()=>window.MAGTOPIA.setWorldTime(.38));
 for (const stage of [0,1,2]) {
  await page.evaluate(stage=>{
   for (const {mesh,parent,plot} of window.homeStageMeshes) {
    const show=stage===2||(stage===1&&plot==='IntentPlot-RetailTerrace');
    if(show&&!mesh.parent) parent.add(mesh);
    else if(!show&&mesh.parent) mesh.removeFromParent();
   }
   window.MAGTOPIA.setWorldTime(.38+stage*.0001);
  },stage);
  await new Promise(r=>setTimeout(r,500));
  await page.screenshot({path:`public/brand/city-stage-${stage}.jpg`,type:'jpeg',quality:86});
 }
 console.log('Native city images captured');
} finally { await browser.close(); }
