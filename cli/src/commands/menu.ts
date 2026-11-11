/**
 * Interactive TTY menu primitives (arrow-key navigation with a numbered fallback).
 */
import { emitKeypressEvents } from "node:readline";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import { promptLine } from "./shared.js";

export interface MenuOption {
  label: string;
  detail?: string;
}

interface KeypressMeta {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

function parseSelection(value: string, max: number): number | null {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > max) {
    return null;
  }

  return numeric - 1;
}

export function clearTerminalScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function renderMenuScreen(titleLines: string[], options: MenuOption[], selectedIndex: number, cancelHint: string): void {
  clearTerminalScreen();

  for (const line of titleLines) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write("\n");

  options.forEach((option, index) => {
    const cursor = index === selectedIndex ? "❯" : " ";
    process.stdout.write(`${cursor} ${index + 1}. ${option.label}\n`);
    if (option.detail) {
      process.stdout.write(`   ${option.detail}\n`);
    }
  });

  process.stdout.write(`\n↑/↓ to navigate • Space/Enter to select • Esc/${cancelHint} to cancel\n`);
}

export async function promptMenuSelection(
  rl: ReadlineInterface,
  titleLines: string[],
  options: MenuOption[],
  cancelHint = "q"
): Promise<number | null> {
  if (options.length === 0) {
    return null;
  }

  const stdin = process.stdin as NodeJS.ReadStream;
  const canUseKeyNavigation = process.stdin.isTTY && process.stdout.isTTY && typeof stdin.setRawMode === "function";

  if (!canUseKeyNavigation) {
    for (const line of titleLines) {
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write("\n");
    options.forEach((option, index) => {
      process.stdout.write(`${index + 1}. ${option.label}\n`);
      if (option.detail) {
        process.stdout.write(`   ${option.detail}\n`);
      }
    });
    const selected = parseSelection(
      await promptLine(rl, `Select option (1-${options.length}, blank to cancel): `),
      options.length
    );
    return selected;
  }

  return new Promise<number | null>((resolve) => {
    let index = 0;
    let settled = false;
    rl.pause();

    const cleanup = () => {
      stdin.off("keypress", onKeypress as never);
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore cleanup errors
      }
      rl.resume();
    };

    const done = (value: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      process.stdout.write("\n");
      resolve(value);
    };

    const onKeypress = (_chunk: string, key: KeypressMeta) => {
      if (key.ctrl && key.name === "c") {
        done(null);
        return;
      }

      if (key.name === "up" || key.name === "k") {
        index = (index - 1 + options.length) % options.length;
        renderMenuScreen(titleLines, options, index, cancelHint);
        return;
      }

      if (key.name === "down" || key.name === "j") {
        index = (index + 1) % options.length;
        renderMenuScreen(titleLines, options, index, cancelHint);
        return;
      }

      if (key.name === "return" || key.name === "space") {
        done(index);
        return;
      }

      if (key.name === "escape" || key.name === "q") {
        done(null);
        return;
      }

      if (key.sequence && /^[1-9]$/.test(key.sequence)) {
        const numeric = Number(key.sequence);
        if (numeric >= 1 && numeric <= options.length) {
          done(numeric - 1);
        }
      }
    };

    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress as never);

    renderMenuScreen(titleLines, options, index, cancelHint);
  });
}
