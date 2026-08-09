#!/usr/bin/env node

import { access, constants } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ASSET_REQUIREMENTS = "requirements-assets.txt";

/**
 * Resolve the Python interpreter used by asset-production tooling.
 *
 * An explicitly configured interpreter is authoritative. Otherwise the
 * project's virtual environment wins, with python3 as the portable fallback.
 */
export async function resolvePythonExecutable({
  workspace = process.cwd(),
  configuredPath = null,
  env = process.env
} = {}) {
  if (configuredPath) {
    const configured = await resolveCandidate(configuredPath, workspace, env);
    if (configured) return configured;
    throw runtimeError(
      `Configured Python interpreter "${configuredPath}" is not executable. ` +
      "Set it to a valid interpreter or unset the Python override to use the project virtual environment."
    );
  }

  const virtualEnvironmentCandidates = [
    path.join(workspace, ".venv", "bin", "python"),
    path.join(workspace, ".venv", "bin", "python3"),
    path.join(workspace, ".venv", "Scripts", "python.exe")
  ];
  for (const candidate of virtualEnvironmentCandidates) {
    if (await isExecutable(candidate)) return candidate;
  }

  const fallback = await findOnPath("python3", env);
  if (fallback) return fallback;

  throw runtimeError(
    `No usable Python interpreter was found. Expected a project virtual environment under ${path.join(workspace, ".venv")} ` +
    "or python3 on PATH. Create the virtual environment or install Python 3, then retry."
  );
}

/** Execute a Python script and turn missing import errors into actionable messages. */
export async function execPythonFile(python, script, args = [], options = {}) {
  try {
    return await execFileAsync(python, [script, ...args], options);
  } catch (error) {
    throw explainPythonError(error, { python, script, cwd: options.cwd });
  }
}

export function explainPythonError(error, { python, script, cwd = process.cwd() } = {}) {
  const output = [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n");
  const missingModule = output.match(/ModuleNotFoundError:\s+No module named ["']([^"']+)["']/);
  if (missingModule) {
    const importName = missingModule[1];
    const packageName = packageNameForImport(importName);
    const requirementsPath = path.join(cwd, ASSET_REQUIREMENTS);
    const wrapped = new Error(
      `Python dependency "${packageName}" (import "${importName}") is required by ${path.basename(script)} ` +
      `but is not installed for ${python}. Install asset dependencies with: ` +
      `"${python}" -m pip install -r "${requirementsPath}"`,
      { cause: error }
    );
    wrapped.code = "PYTHON_DEPENDENCY_MISSING";
    return wrapped;
  }
  return error;
}

function packageNameForImport(importName) {
  const topLevel = importName.split(".")[0];
  return {
    PIL: "Pillow",
    cv2: "opencv-python",
    sklearn: "scikit-learn",
    yaml: "PyYAML"
  }[topLevel] ?? topLevel;
}

async function resolveCandidate(candidate, workspace, env) {
  const resolved = candidate.includes(path.sep) || candidate.includes("/") || candidate.includes("\\")
    ? path.resolve(workspace, candidate)
    : await findOnPath(candidate, env);
  if (!resolved || !(await isExecutable(resolved))) return null;
  return resolved;
}

async function findOnPath(command, env) {
  const pathValue = env?.PATH ?? "";
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function isExecutable(candidate) {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function runtimeError(message) {
  const error = new Error(message);
  error.code = "PYTHON_RUNTIME_UNAVAILABLE";
  return error;
}

async function main() {
  const args = process.argv.slice(2);
  const python = await resolvePythonExecutable();
  if (args[0] === "--print") {
    console.log(python);
    return;
  }
  if (!args.length) {
    throw new Error("Usage: node scripts/python-runtime.mjs [--print] <script.py> [args...]");
  }
  const result = await execPythonFile(python, args[0], args.slice(1), {
    cwd: process.cwd(),
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
