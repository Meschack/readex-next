import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const versionFiles = {
  rootPackage: "package.json",
  desktopPackage: "apps/desktop/package.json",
  tauriConfig: "apps/desktop/src-tauri/tauri.conf.json",
  cargoManifest: "apps/desktop/src-tauri/Cargo.toml"
};

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (match == null) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

export function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function compareVersions(first, second) {
  return first.major - second.major || first.minor - second.minor || first.patch - second.patch;
}

export function nextReleaseVersion(baseVersionValue, tagValues) {
  const baseVersion = parseVersion(baseVersionValue);
  if (baseVersion == null) {
    throw new Error(`Invalid base version: ${baseVersionValue}`);
  }

  const latestTaggedVersion = tagValues
    .map((tag) => parseVersion(tag))
    .filter((version) => version != null)
    .sort(compareVersions)
    .at(-1);

  if (latestTaggedVersion == null || compareVersions(baseVersion, latestTaggedVersion) > 0) {
    return formatVersion(baseVersion);
  }

  return formatVersion({
    ...latestTaggedVersion,
    patch: latestTaggedVersion.patch + 1
  });
}

export function patchReleaseVersion(version) {
  updateJsonVersion(versionFiles.rootPackage, version);
  updateJsonVersion(versionFiles.desktopPackage, version);
  updateJsonVersion(versionFiles.tauriConfig, version);
  updateCargoManifestVersion(versionFiles.cargoManifest, version);
}

function updateJsonVersion(path, version) {
  const payload = JSON.parse(readFileSync(path, "utf8"));
  payload.version = version;
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function updateCargoManifestVersion(path, version) {
  const manifest = readFileSync(path, "utf8");
  const nextManifest = manifest.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);

  if (nextManifest === manifest) {
    throw new Error(`Could not find Cargo package version in ${path}`);
  }

  writeFileSync(path, nextManifest);
}

function gitTags() {
  try {
    return execFileSync("git", ["tag", "--list", "v[0-9]*"], {
      encoding: "utf8"
    })
      .split("\n")
      .map((tag) => tag.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeGithubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath == null || outputPath.length === 0) return;

  const output = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  writeFileSync(outputPath, `${output}\n`, { flag: "a" });
}

function main() {
  if (!existsSync(versionFiles.tauriConfig)) {
    throw new Error("Run this script from the repository root.");
  }

  const tauriConfig = JSON.parse(readFileSync(versionFiles.tauriConfig, "utf8"));
  const version = nextReleaseVersion(tauriConfig.version, gitTags());
  const tag = `v${version}`;

  patchReleaseVersion(version);
  writeGithubOutput({
    version,
    tag,
    release_name: `Readex Next ${tag}`
  });

  console.log(`Prepared ${tag}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
