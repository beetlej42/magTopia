import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
const label = process.argv[2] || 'latest';
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid screenshot label');
const output = `artifacts/homepage/${label}`;
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
 for (const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',360,800]]) {
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width,height,deviceScaleFactor:1});
  await page.goto('http://127.0.0.1:4192',{waitUntil:'networkidle0'});
  await page.evaluate(async()=>{await Promise.all([...document.images].map(image=>{image.loading='eager';return image.decode().catch(()=>{});}));});
  await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error(`${name}: horizontal overflow`);
  await page.click('[data-scene="night"]');
  await page.waitForFunction(()=>document.querySelector('[data-scene="night"]').getAttribute('aria-pressed')==='true');
  await page.waitForFunction(()=>document.querySelector('#city-image').complete);
  await page.click('[data-scene="day"]');
  await page.waitForFunction(()=>document.querySelector('[data-scene="day"]').getAttribute('aria-pressed')==='true');
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:`${output}/${name}-first-screen.png`});
  await page.click('.landmark-pin');
  await page.waitForFunction(()=>document.querySelector('.landmark-pin').getAttribute('aria-expanded')==='true' && !document.querySelector('.note-landmark').hidden);
  await page.click('.landmark-pin');
  await page.waitForFunction(()=>!document.querySelector('.note-default').hidden && document.querySelector('.note-landmark').hidden);
  if(errors.length) throw new Error(errors.join('\n'));
  const broken=await page.evaluate(()=>[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src));
  if(broken.length) throw new Error(broken.join('\n'));
  console.log(`${name}: images, scene switching, landmark interaction, console, and overflow passed`);
  await page.close();
 }
} finally { await browser.close(); }
