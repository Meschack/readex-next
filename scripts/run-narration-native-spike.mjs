import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { loadNarrationSpikeConfig } from "./setup-narration-spike.mjs";
import { resolveVenvPythonPath } from "./setup-kokoro-reference.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function resolveNativeSpikePaths(config, platform = process.platform) {
  const workspace = resolve(repoRoot, config.workspace);
  return {
    workspace,
    python: resolveVenvPythonPath(join(workspace, "kokoro-reference-venv"), platform),
    manifest: join(repoRoot, "tools", "narration-spike", "native-runtime", "Cargo.toml")
  };
}

export function runNativeSpike(options = {}) {
  const paths = resolveNativeSpikePaths(
    loadNarrationSpikeConfig(options.configPath),
    options.platform
  );
  for (const [label, path] of [
    ["Kokoro reference Python", paths.python],
    ["native runtime manifest", paths.manifest]
  ]) {
    if (!existsSync(path)) {
      throw new Error(`Missing ${label}: ${path}. Run the narration spike setup first.`);
    }
  }

  run(
    paths.python,
    ["tools/narration-spike/kokoro_reference.py", "--native-fixture"],
    "writing native Kokoro fixture"
  );
  for (const memoryMode of ["default", "bounded"]) {
    run(
      "cargo",
      [
        "run",
        "--locked",
        "--release",
        "--manifest-path",
        paths.manifest,
        "--",
        "--workspace",
        paths.workspace,
        "--memory-mode",
        memoryMode
      ],
      `running native narration lifecycle (${memoryMode} memory)`
    );
  }
}

function run(command, args, label) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error != null) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}.`);
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runNativeSpike();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
