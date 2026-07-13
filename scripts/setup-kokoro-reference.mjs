import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { loadNarrationSpikeConfig } from "./setup-narration-spike.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const KOKORO_REFERENCE_PACKAGES = [
  "click==8.1.8",
  "misaki[en]==0.9.4",
  "numpy==1.26.4",
  "transformers==4.48.3",
  "onnx==1.17.0",
  "onnxruntime==1.20.1",
  "sounddevice==0.5.1",
  "soundfile==0.13.1"
];

export const KOKORO_ENGLISH_MODEL =
  "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/" +
  "en_core_web_sm-3.8.0-py3-none-any.whl#sha256=" +
  "1932429db727d4bff3deed6b34cfc05df17794f4a52eeb26cf8928f7c1a0fb85";

export function resolveVenvPythonPath(venvDir, platform = process.platform) {
  return platform === "win32"
    ? join(venvDir, "Scripts", "python.exe")
    : join(venvDir, "bin", "python");
}

export function resolvePythonCommand(env = process.env, platform = process.platform) {
  return env.PYTHON ?? (platform === "win32" ? "python" : "python3");
}

export function pythonPackageVersionCheckScript(packageName, expectedVersion) {
  return (
    "import importlib.metadata, sys; " +
    `sys.exit(0 if importlib.metadata.version(${JSON.stringify(packageName)}) == ` +
    `${JSON.stringify(expectedVersion)} else 1)`
  );
}

export function setupKokoroReference(options = {}) {
  const config = loadNarrationSpikeConfig(options.configPath);
  const kokoro = config.engines.find((engine) => engine.id === "kokoro");
  if (kokoro == null) throw new Error("The narration spike does not define Kokoro.");

  const workspace = resolve(repoRoot, config.workspace);
  const sourceDir = join(workspace, "sources", "kokoro");
  const venvDir = join(workspace, "kokoro-reference-venv");
  const venvPython = resolveVenvPythonPath(venvDir, options.platform);
  const env = options.env ?? process.env;

  if (!existsSync(join(sourceDir, "pyproject.toml"))) {
    throw new Error("Kokoro source is missing. Run pnpm spike:narration:setup first.");
  }
  if (!existsSync(venvPython)) {
    run(
      resolvePythonCommand(env, options.platform),
      ["-m", "venv", venvDir],
      "creating Kokoro reference environment",
      repoRoot,
      env
    );
  }

  run(
    venvPython,
    ["-m", "pip", "install", "--upgrade", "pip"],
    "updating reference pip",
    repoRoot,
    env
  );
  run(
    venvPython,
    ["-m", "pip", "install", "torch==2.6.0", "--index-url", "https://download.pytorch.org/whl/cpu"],
    "installing CPU-only PyTorch",
    repoRoot,
    env
  );
  run(
    venvPython,
    ["-m", "pip", "install", "--upgrade", "--editable", sourceDir, ...KOKORO_REFERENCE_PACKAGES],
    "installing pinned Kokoro reference dependencies",
    repoRoot,
    env
  );
  if (!hasPythonPackageVersion(venvPython, "en_core_web_sm", "3.8.0", env)) {
    run(
      venvPython,
      ["-m", "pip", "install", KOKORO_ENGLISH_MODEL],
      "installing pinned Kokoro English parser",
      repoRoot,
      env
    );
  }
  run(
    venvPython,
    ["tools/narration-spike/kokoro_reference.py", "--smoke"],
    "verifying Kokoro reference environment",
    repoRoot,
    env
  );

  if (options.exportOnnx) {
    const outputDir = join(workspace, "kokoro-onnx");
    mkdirSync(outputDir, { recursive: true });
    run(
      venvPython,
      ["examples/export.py", "--output_dir", outputDir],
      "exporting Kokoro ONNX reference",
      sourceDir,
      env
    );
  }

  if (options.runCorpus) {
    run(
      venvPython,
      ["tools/narration-spike/kokoro_reference.py", "--corpus"],
      "running Kokoro alignment corpus",
      repoRoot,
      env
    );
  }

  if (options.writeNativeFixture) {
    run(
      venvPython,
      ["tools/narration-spike/kokoro_reference.py", "--native-fixture"],
      "writing native Kokoro fixture",
      repoRoot,
      env
    );
  }

  return { sourceDir, venvDir };
}

function run(command, args, label, cwd, env) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error != null) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}.`);
}

function hasPythonPackageVersion(python, packageName, expectedVersion, env) {
  const script = pythonPackageVersionCheckScript(packageName, expectedVersion);
  const result = spawnSync(python, ["-c", script], { cwd: repoRoot, env, stdio: "ignore" });
  return result.status === 0;
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setupKokoroReference({
    exportOnnx: process.argv.includes("--export-onnx"),
    runCorpus: process.argv.includes("--corpus"),
    writeNativeFixture: process.argv.includes("--native-fixture")
  });
}
