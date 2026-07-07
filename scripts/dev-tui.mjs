#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(rootDir, ".dev-tui.json");
const config = JSON.parse(await readFile(configPath, "utf8"));

const entries = config.tabs.map((entry) => ({
  name: entry.name,
  dir: resolve(rootDir, entry.dir ?? "."),
  cmd: entry.cmd,
  color: entry.color ?? "white"
}));

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  purple: "\x1b[35m",
  yellow: "\x1b[33m",
  white: "\x1b[37m"
};

let selected = 0;

if (process.argv.includes("--list")) {
  for (const entry of entries) {
    console.log(`${entry.name}: ${entry.cmd}`);
  }

  process.exit(0);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("The Readex dev TUI needs an interactive terminal.");
  console.error("Run a direct command instead, for example: pnpm dev:web");
  process.exit(1);
}

readline.emitKeypressEvents(process.stdin);

process.on("SIGINT", () => {
  restoreTerminal();
  process.exit(130);
});

bindMenu();

function bindMenu() {
  process.stdin.removeAllListeners("keypress");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", (_input, key) => {
    if (key.ctrl && key.name === "c") {
      restoreTerminal();
      process.exit(130);
    }

    if (key.name === "q" || key.name === "escape") {
      restoreTerminal();
      process.exit(0);
    }

    if (key.name === "up" || key.name === "k") {
      selected = (selected - 1 + entries.length) % entries.length;
      render();
      return;
    }

    if (key.name === "down" || key.name === "j") {
      selected = (selected + 1) % entries.length;
      render();
      return;
    }

    if (key.name === "return") {
      run(entries[selected]);
    }
  });

  render();
}

function run(entry) {
  process.stdin.removeAllListeners("keypress");
  process.stdin.setRawMode(false);
  clear();

  console.log(`${ansi.bold}${entry.name}${ansi.reset} ${ansi.dim}${entry.cmd}${ansi.reset}\n`);

  const child = spawn(entry.cmd, {
    cwd: entry.dir,
    env: process.env,
    shell: true,
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    const outcome =
      signal == null ? `exited with code ${code ?? 0}` : `stopped by signal ${signal}`;

    console.log(`\n${ansi.dim}${entry.name} ${outcome}.${ansi.reset}`);
    console.log(`${ansi.dim}Press any key to return to the menu, or q to quit.${ansi.reset}`);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("keypress", (_input, key) => {
      if ((key.ctrl && key.name === "c") || key.name === "q" || key.name === "escape") {
        restoreTerminal();
        process.exit(0);
      }

      bindMenu();
    });
  });
}

function render() {
  clear();
  console.log(`${ansi.bold}Readex Dev TUI${ansi.reset}`);
  console.log(`${ansi.dim}Use ↑/↓ or k/j, Enter to run, q to quit.${ansi.reset}\n`);

  entries.forEach((entry, index) => {
    const pointer = index === selected ? ">" : " ";
    const color = ansi[entry.color] ?? ansi.white;
    const label = `${color}${entry.name.padEnd(8)}${ansi.reset}`;

    console.log(`${pointer} ${label} ${ansi.dim}${entry.cmd}${ansi.reset}`);
  });
}

function clear() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function restoreTerminal() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  process.stdin.pause();
  process.stdout.write(ansi.reset);
}
