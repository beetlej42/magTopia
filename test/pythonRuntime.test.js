import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { explainPythonError, resolvePythonExecutable } from "../scripts/python-runtime.mjs";

async function makeExecutable(filePath) {
  await writeFile(filePath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(filePath, 0o755);
}

test("project virtual environment is preferred over python3 on PATH", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "magictown-python-runtime-"));
  try {
    const venvBin = path.join(root, ".venv", "bin");
    const fallbackBin = path.join(root, "fallback-bin");
    await mkdir(venvBin, { recursive: true });
    await mkdir(fallbackBin, { recursive: true });
    const venvPython = path.join(venvBin, "python");
    const fallbackPython = path.join(fallbackBin, "python3");
    await makeExecutable(venvPython);
    await makeExecutable(fallbackPython);

    assert.equal(
      await resolvePythonExecutable({ workspace: root, env: { PATH: fallbackBin } }),
      venvPython
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("python3 on PATH is used when the project virtual environment is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "magictown-python-runtime-"));
  try {
    const fallbackPython = path.join(root, "python3");
    await makeExecutable(fallbackPython);
    assert.equal(
      await resolvePythonExecutable({ workspace: root, env: { PATH: root } }),
      fallbackPython
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing Python dependencies produce an actionable installation error", () => {
  const original = new Error("python failed");
  original.stderr = "ModuleNotFoundError: No module named 'PIL'";
  const explained = explainPythonError(original, {
    python: "/tmp/python3",
    script: "/workspace/scripts/generate_parcel_guide.py",
    cwd: "/workspace"
  });

  assert.equal(explained.code, "PYTHON_DEPENDENCY_MISSING");
  assert.match(explained.message, /Pillow/);
  assert.match(explained.message, /generate_parcel_guide\.py/);
  assert.match(explained.message, /pip install -r "\/workspace\/requirements-assets\.txt"/);
});

test("missing interpreters report both supported resolution paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "magictown-python-runtime-"));
  try {
    await assert.rejects(
      resolvePythonExecutable({ workspace: root, env: { PATH: root } }),
      (error) => error.code === "PYTHON_RUNTIME_UNAVAILABLE"
        && /virtual environment/.test(error.message)
        && /python3 on PATH/.test(error.message)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
