#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ports = [1420, 1421];
const graceMs = 2000;

const candidates = new Map();
const processTable = await readProcessTable();

for (const port of ports) {
  for (const pid of await pidsListeningOnPort(port)) {
    const processInfo = processTable.find((entry) => entry.pid === pid);
    if (await isReadexOwnedProcess(processInfo)) {
      addCandidate(pid, `listening on port ${port}`);
    }
  }
}

for (const processInfo of processTable) {
  if (await isReadexDevProcess(processInfo)) {
    addCandidate(processInfo.pid, processInfo.command);
  }
}

const ownPid = process.pid;
candidates.delete(ownPid);

if (candidates.size === 0) {
  console.log("No Readex dev server processes found.");
  process.exit(0);
}

console.log(
  `Stopping ${candidates.size} Readex dev process${candidates.size === 1 ? "" : "es"}...`
);

for (const pid of candidates.keys()) {
  stopProcess(pid, "SIGTERM");
}

await waitForExit([...candidates.keys()], graceMs);

const remaining = [...candidates.keys()].filter(isRunning);
for (const pid of remaining) {
  stopProcess(pid, "SIGKILL");
}

if (remaining.length > 0) {
  await waitForExit(remaining, 500);
}

const failed = [...candidates.keys()].filter(isRunning);
if (failed.length > 0) {
  console.error(`Could not stop: ${failed.join(", ")}`);
  process.exit(1);
}

console.log("Readex dev server stopped.");

function addCandidate(pid, reason) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const current = candidates.get(pid);
  candidates.set(pid, current == null ? reason : `${current}; ${reason}`);
}

async function pidsListeningOnPort(port) {
  const pids = new Set();

  for (const command of [
    ["lsof", ["-ti", `tcp:${port}`]],
    ["fuser", ["-n", "tcp", port.toString()]]
  ]) {
    const output = await runOptional(command[0], command[1]);
    for (const token of output.split(/\s+/)) {
      const pid = Number(token.trim());
      if (Number.isInteger(pid)) pids.add(pid);
    }
  }

  return [...pids];
}

async function readProcessTable() {
  const output = await runOptional("ps", ["-eo", "pid=,ppid=,command="]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (match == null) return null;

      return {
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        command: match[3]
      };
    })
    .filter(Boolean);
}

async function isReadexDevProcess(processInfo) {
  if (processInfo.pid === process.pid || processInfo.command.includes("dev-stop")) return false;
  if (processInfo.command.includes("dev:stop")) return false;
  if (!matchesDevCommand(processInfo.command)) return false;

  return isReadexOwnedProcess(processInfo);
}

async function isReadexOwnedProcess(processInfo) {
  if (processInfo == null) return false;

  const cwd = await processCwd(processInfo.pid);
  if (cwd == null) {
    return processInfo.command.includes(rootDir);
  }

  return isInsideRoot(cwd);
}

function matchesDevCommand(command) {
  return [
    "pnpm dev:desktop",
    "pnpm dev:web",
    "@readex/desktop tauri dev",
    "@readex/desktop dev",
    "tauri dev",
    "vite --"
  ].some((pattern) => command.includes(pattern));
}

async function processCwd(pid) {
  if (process.platform !== "linux") return null;

  try {
    return await readlink(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

function isInsideRoot(path) {
  const normalizedRoot = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
  return path === rootDir || path.startsWith(normalizedRoot);
}

async function runOptional(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: rootDir,
      windowsHide: true
    });

    return `${stdout}${stderr}`;
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

function stopProcess(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited or is not owned by this user.
  }
}

async function waitForExit(pids, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (pids.every((pid) => !isRunning(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
