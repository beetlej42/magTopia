import { mkdir, writeFile } from 'node:fs/promises';
import { createConstructionSite } from '../src/generators/constructionSite.js';
import { rasterizeBuildingObject } from '../src/render/buildingVisualization.js';
import { disposeBuildingObject } from '../src/generators/buildingDesignObject.js';
const out = process.argv[2] ?? '/tmp/construction-preview';
await mkdir(out, { recursive: true });
const variants = [
  ['construction-1x1', { magicLevel: 0.6 }],
  ['construction-2x2', { cellOffsets: [{x:-2,z:-2},{x:2,z:-2},{x:-2,z:2},{x:2,z:2}], magicLevel: 0.6 }],
  ['construction-garden', { openSpace: true }],
  ['construction-underground', { underground: true }]
];
for (const [name, options] of variants) {
  const object = createConstructionSite(options);
  object.rotation.y = Math.PI; // Face the south entrance toward the preview camera.
  const result = rasterizeBuildingObject(object, { size: 512 });
  await writeFile(`${out}/${name}.png`, result.png);
  console.log(name, result.triangleCount);
  disposeBuildingObject(object);
}
