import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLAYBOOK_PATH = path.resolve(SERVER_DIR, "../docs/agent-playbook.md");

test("the Agent playbook describes the cooldown contract and never claims a deadline auto-settle", async () => {
  const playbook = await readFile(PLAYBOOK_PATH, "utf8");
  assert.match(playbook, /## MAGTOPIA Gameplay Model/, "the playbook opens with the consolidated gameplay model");
  assert.match(playbook, /There is no automatic deadline settlement/, "the playbook states there is no deadline auto-settle");
  assert.match(playbook, /nextTurnUnlockAt/, "the playbook documents the cooldown gate");
  assert.match(playbook, /TURN_NOT_UNLOCKED/, "the playbook documents the unlock rejection code");
  assert.doesNotMatch(playbook, /auto-settles a turn once `turn_deadline_at` passes/, "no deadline auto-settle claim remains");
  assert.doesNotMatch(playbook, /server force-settles it through the exact same `resolveTurn\(\)`/, "no deadline force-settle claim remains");
  assert.match(playbook, /it must be resolved through the normal flow — the server never settles it automatically/, "the playbook says the server never auto-settles");
  assert.match(playbook, /Agent resolves the turn when appropriate and unlocked/, "the core loop names active Agent resolution");
});
