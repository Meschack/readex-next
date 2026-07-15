import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(repoRoot, "tools", "narration-spike", "engines.json");
const defaultDownloadTimeoutMs = 30 * 60 * 1000;

export function loadNarrationSpikeConfig(path = configPath) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  validateConfig(config);
  return config;
}

export function selectSpikeEngines(config, requestedEngine = "all") {
  if (requestedEngine === "all") return config.engines;

  const engine = config.engines.find((candidate) => candidate.id === requestedEngine);
  if (engine == null) {
    throw new Error(`Unknown narration engine '${requestedEngine}'.`);
  }
  return [engine];
}

export function narrationArtifactUrl(model, artifact) {
  if (typeof artifact.url === "string" && artifact.url.trim() !== "") {
    return artifact.url;
  }

  const remotePath = artifact.remotePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://huggingface.co/${model.repository}/resolve/${model.revision}/${remotePath}?download=true`;
}

export async function isNarrationArtifactReady(path, artifact) {
  if (!existsSync(path) || statSync(path).size !== artifact.sizeBytes) return false;
  return (await sha256(path)) === artifact.sha256;
}

export async function setupNarrationSpike(options = {}) {
  const config = loadNarrationSpikeConfig(options.configPath);
  const workspace = resolve(repoRoot, config.workspace);
  const engines = selectSpikeEngines(config, options.engine);

  mkdirSync(workspace, { recursive: true });

  for (const engine of engines) {
    const sourceDir = join(workspace, "sources", engine.id);
    if (options.verifyOnly) {
      verifySourceRevision(sourceDir, engine.source.revision);
    } else {
      prepareSource(engine, sourceDir);
    }

    if (!options.models) continue;

    for (const artifact of engine.model.artifacts) {
      const target = join(sourceDir, artifact.targetPath);
      if (options.verifyOnly) {
        if (!(await isNarrationArtifactReady(target, artifact))) {
          throw new Error(`${engine.id} artifact is missing or invalid: ${artifact.targetPath}`);
        }
      } else {
        await downloadArtifact(engine.model, artifact, target, options.env ?? process.env);
      }
    }
  }

  return { workspace, engineIds: engines.map((engine) => engine.id) };
}

function validateConfig(config) {
  if (config?.schemaVersion !== 1 || typeof config.workspace !== "string") {
    throw new Error("Narration spike configuration has an unsupported schema.");
  }
  if (!Array.isArray(config.engines) || config.engines.length === 0) {
    throw new Error("Narration spike configuration must contain at least one engine.");
  }

  const ids = new Set();
  for (const engine of config.engines) {
    if (typeof engine.id !== "string" || ids.has(engine.id)) {
      throw new Error("Narration spike engine IDs must be unique strings.");
    }
    ids.add(engine.id);
    if (!/^[a-f0-9]{40}$/u.test(engine.source?.revision ?? "")) {
      throw new Error(`${engine.id} source revision must be a full Git commit.`);
    }
    if (!/^[a-f0-9]{40}$/u.test(engine.model?.revision ?? "")) {
      throw new Error(`${engine.id} model revision must be a full snapshot commit.`);
    }
    for (const artifact of engine.model.artifacts ?? []) {
      if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
        throw new Error(`${engine.id} artifact size is invalid: ${artifact.remotePath}`);
      }
      if (!/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? "")) {
        throw new Error(`${engine.id} artifact hash is invalid: ${artifact.remotePath}`);
      }
    }
  }
}

function prepareSource(engine, sourceDir) {
  if (!existsSync(join(sourceDir, ".git"))) {
    mkdirSync(dirname(sourceDir), { recursive: true });
    run(
      "git",
      ["clone", "--filter=blob:none", "--no-checkout", engine.source.repository, sourceDir],
      `cloning ${engine.id}`
    );
  }

  run(
    "git",
    ["-C", sourceDir, "fetch", "--depth=1", "origin", engine.source.revision],
    `fetching ${engine.id} ${engine.source.revision}`
  );
  run(
    "git",
    ["-C", sourceDir, "checkout", "--detach", engine.source.revision],
    `checking out ${engine.id}`
  );
  verifySourceRevision(sourceDir, engine.source.revision);
}

function verifySourceRevision(sourceDir, expectedRevision) {
  if (!existsSync(join(sourceDir, ".git"))) {
    throw new Error(`Narration spike source is missing: ${sourceDir}`);
  }
  const result = spawnSync("git", ["-C", sourceDir, "rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.status !== 0 || result.stdout.trim() !== expectedRevision) {
    throw new Error(`Narration spike source revision is invalid: ${sourceDir}`);
  }
}

async function downloadArtifact(model, artifact, target, env) {
  if (await isNarrationArtifactReady(target, artifact)) {
    console.log(`> ready ${artifact.targetPath}`);
    return;
  }

  rmSync(target, { force: true });
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.download`;
  const attempts = Number(env.SONELLE_NARRATION_SPIKE_DOWNLOAD_RETRIES ?? 3);
  const timeoutMs = Number(
    env.SONELLE_NARRATION_SPIKE_DOWNLOAD_TIMEOUT_MS ?? defaultDownloadTimeoutMs
  );
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const resumeFrom = existsSync(temporary) ? statSync(temporary).size : 0;
      const headers = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : undefined;
      const response = await fetch(narrationArtifactUrl(model, artifact), {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok || response.body == null) {
        throw new Error(`Could not download ${artifact.remotePath}: HTTP ${response.status}`);
      }

      const resuming = resumeFrom > 0 && response.status === 206;
      if (!resuming) rmSync(temporary, { force: true });
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(temporary, { flags: resuming ? "a" : "w" })
      );

      if (!(await isNarrationArtifactReady(temporary, artifact))) {
        rmSync(temporary, { force: true });
        throw new Error(
          `Downloaded narration artifact failed verification: ${artifact.remotePath}`
        );
      }

      renameSync(temporary, target);
      console.log(`> downloaded ${artifact.targetPath}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(
          `> retrying ${artifact.remotePath} from the last received byte (${attempt + 1}/${attempts})`
        );
      }
    }
  }

  throw lastError;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function run(command, args, label) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error != null) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}.`);
}

function parseArguments(args) {
  const engineArg = args.find((arg) => arg.startsWith("--engine="));
  return {
    engine: engineArg?.slice("--engine=".length) ?? "all",
    models: args.includes("--models"),
    verifyOnly: args.includes("--verify-only")
  };
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setupNarrationSpike(parseArguments(process.argv.slice(2)))
    .then(({ workspace, engineIds }) => {
      console.log(`\nNarration spike ready: ${engineIds.join(", ")}`);
      console.log(`Workspace: ${workspace}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
