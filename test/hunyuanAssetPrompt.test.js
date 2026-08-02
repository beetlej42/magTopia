import assert from "node:assert/strict";
import test from "node:test";
import {
  MAGIC_LONDON_WORLD_CONTEXT,
  MAGIC_LONDON_WORLD_PROMPT_VERSION,
  composeHunyuanDayOffPrompt
} from "../scripts/hunyuan_asset_prompt.mjs";

test("Hunyuan asset prompt concatenates world, agent brief, and render contract in order", () => {
  const agentBrief = "一栋两层联排药剂铺，首层临街营业，二层用于居住。";
  const prompt = composeHunyuanDayOffPrompt({
    cells: "1x2x2",
    dimensions: "4x8x8",
    agentBrief
  });
  const worldIndex = prompt.indexOf(`[WORLD_CONTEXT:${MAGIC_LONDON_WORLD_PROMPT_VERSION}]`);
  const briefIndex = prompt.indexOf("[AGENT_BRIEF]");
  const contractIndex = prompt.indexOf("[RENDER_CONTRACT]");
  assert.ok(worldIndex >= 0 && worldIndex < briefIndex && briefIndex < contractIndex);
  assert.match(prompt, new RegExp(agentBrief));
  assert.match(prompt, /建筑规格为 1x2x2 个地块单元，世界尺寸 4x8x8/);
  assert.match(prompt, /south\/front 正面/);
  assert.match(prompt, /恰好有 2 层正常人类尺度的地上使用层/);
});

test("1x1x1 Hunyuan prompt forbids every form of a second occupied level", () => {
  const prompt = composeHunyuanDayOffPrompt({
    cells: "1x1x1",
    dimensions: "4x4x4",
    agentBrief: "一栋小型维修铺。"
  });
  assert.match(prompt, /只能有一层正常人类尺度的地上使用层/);
  assert.match(prompt, /禁止第二排立面窗、二层、夹层、可居住阁楼、老虎窗/);
  assert.match(prompt, /屋顶、圆顶、塔帽、烟囱和招牌也必须全部留在图1蓝灰包络/);
});

test("world prompt stays independent of a concrete building purpose", () => {
  assert.match(MAGIC_LONDON_WORLD_CONTEXT, /1880—1900 年代维多利亚晚期伦敦/);
  assert.match(MAGIC_LONDON_WORLD_CONTEXT, /时代感来自轮廓、比例与大型构件/);
  assert.doesNotMatch(MAGIC_LONDON_WORLD_CONTEXT, /钟表匠|药剂铺/);
  assert.throws(
    () => composeHunyuanDayOffPrompt({ cells: "1x1x1", dimensions: "4x4x4", agentBrief: "" }),
    /agentBrief is required/
  );
});
