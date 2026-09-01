// Subprocess wrapper around the repository's Python NotebookLM bridge.

import { spawn } from "child_process";
import { resolve } from "path";
import { BRIDGE_ROOT } from "./paths";
// ChildProcess type is imported later (after BRIDGE_PATHS) to keep the
// re-auth state block colocated with its helpers.

const BRIDGE_DIR = BRIDGE_ROOT;
// Parent of the bridge package — Python's `-m notebooklm_bridge.runner` needs
// to be invoked from a directory where `notebooklm_bridge` is importable.
// The bridge's runtime state (outputs/, .budget.json) is keyed off __file__
// inside the package, not cwd, so this doesn't affect where state lands.
const BRIDGE_PARENT_DIR = resolve(BRIDGE_DIR, "..");

export interface BridgeRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface RunBridgeOptions {
  args: string[];
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
}

// Picks the right Python launcher. On Windows we use `py` (the standard
// Python launcher). Override via the BRIDGE_PYTHON env var if needed
// (e.g. a venv-specific binary, or `python3` on Linux/macOS once we ship there).
function pythonCommand(): string {
  return (
    process.env.BRIDGE_PYTHON ??
    (process.platform === "win32" ? "py" : "python3")
  );
}

export function runBridge(opts: RunBridgeOptions): Promise<BridgeRunResult> {
  return new Promise((resolveResult) => {
    const started = Date.now();
    const child = spawn(
      pythonCommand(),
      ["-m", "notebooklm_bridge.runner", ...opts.args],
      {
        cwd: BRIDGE_PARENT_DIR,
        shell: false,
        env: {
          ...process.env,
          // The bridge's operating-hours guard (07:00-24:00 local) exists to
          // prevent unattended cron-like jobs from hitting NotebookLM at
          // anomalous hours. Wizard calls are always user-initiated (the user
          // just clicked a button), so the guard is unnecessary friction
          // here. Direct CLI use of the bridge still respects the guard.
          BRIDGE_OPERATING_HOURS_ENABLED: "false",
        },
      }
    );

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";

    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      if (opts.onStdoutLine) {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line) opts.onStdoutLine(line);
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    let timedOut = false;
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, opts.timeoutMs)
      : null;

    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      resolveResult({
        exitCode: -1,
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}\n`,
        durationMs: Date.now() - started,
        timedOut: false,
      });
    });

    child.on("close", (exitCode) => {
      if (timeout) clearTimeout(timeout);
      if (opts.onStdoutLine && stdoutBuffer) {
        opts.onStdoutLine(stdoutBuffer);
      }
      resolveResult({
        exitCode: timedOut ? -2 : exitCode ?? -1,
        stdout,
        stderr: timedOut ? stderr + "\n[timeout]\n" : stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    });
  });
}

export const BRIDGE_PATHS = {
  bridgeDir: BRIDGE_DIR,
};

// ─────────────────────────────────────────────────────────────────────────
// NotebookLM re-authentication (two-step: spawn login subprocess, then
// confirm once the user has completed Google sign-in in the browser).
// State is held module-level: a single in-flight re-auth at a time.
// ─────────────────────────────────────────────────────────────────────────

import type { ChildProcess } from "child_process";

let _reauthChild: ChildProcess | null = null;
let _reauthOutput = "";
let _reauthExited = false;

export interface ReauthStartResult {
  spawned: boolean;
  note: string;
}

export interface ReauthConfirmResult {
  confirmed: boolean;
  exitCode: number | null;
  output: string;
  error?: string;
}

// Kill whatever's in flight (best-effort) before starting a new login. The
// bridge's own auth_check.py does this for the same reason: leftover login
// subprocesses can leave storage_state.json in a half-saved state.
function killAnyExistingReauth(): void {
  if (_reauthChild && !_reauthExited) {
    try {
      _reauthChild.kill();
    } catch {
      // ignore
    }
  }
  _reauthChild = null;
  _reauthExited = false;
  _reauthOutput = "";
}

export function startReauth(): ReauthStartResult {
  killAnyExistingReauth();
  try {
    const child = spawn(pythonCommand(), ["-m", "notebooklm", "login"], {
      cwd: BRIDGE_PARENT_DIR,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      // On Windows, use a separate process group so the authentication
      // browser can outlive the wizard backend console when needed.
      detached: process.platform === "win32",
      windowsHide: false,
    });
    _reauthChild = child;
    child.stdout?.on("data", (d: Buffer) => {
      _reauthOutput += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      _reauthOutput += d.toString();
    });
    child.on("close", () => {
      _reauthExited = true;
    });
    child.on("error", (err) => {
      _reauthOutput += `\n[spawn error] ${err.message}\n`;
      _reauthExited = true;
    });
    return {
      spawned: true,
      note: "Login subprocess spawned. A browser window should open. Complete the Google sign-in there, THEN click Confirm — only then will cookies be saved.",
    };
  } catch (e) {
    return {
      spawned: false,
      note: `Failed to spawn login subprocess: ${(e as Error).message}`,
    };
  }
}

export function confirmReauth(timeoutMs = 60_000): Promise<ReauthConfirmResult> {
  return new Promise((resolveResult) => {
    if (!_reauthChild) {
      resolveResult({
        confirmed: false,
        exitCode: null,
        output: "No re-authentication is in flight. Click Re-authenticate first.",
        error: "no_child",
      });
      return;
    }
    const child = _reauthChild;
    // If the child already exited (e.g., user closed browser, or cookies got
    // saved without needing the ENTER prompt), return the captured output.
    if (_reauthExited) {
      const code = child.exitCode ?? null;
      _reauthChild = null;
      resolveResult({
        confirmed: code === 0,
        exitCode: code,
        output: _reauthOutput,
      });
      return;
    }
    // Feed ENTER to the subprocess to signal "I've signed in." On Windows
    // the upstream CLI may have already closed stdin, in which case the
    // write throws EPIPE/EOF — that's fine, we just wait for close.
    try {
      child.stdin?.write("\n");
      child.stdin?.end();
    } catch (e) {
      _reauthOutput += `\n[stdin write soft-fail] ${(e as Error).message}\n`;
    }
    // Hard timeout: if the subprocess doesn't exit, kill it so we don't
    // leave storage_state.json in a half-written state. The bridge's
    // auth_check.py uses the same pattern.
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolveResult({
        confirmed: false,
        exitCode: child.exitCode ?? null,
        output:
          _reauthOutput +
          `\n[timeout: subprocess did not exit within ${timeoutMs}ms — killed]`,
        error: "timeout",
      });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timeout);
      _reauthChild = null;
      resolveResult({
        confirmed: code === 0,
        exitCode: code,
        output: _reauthOutput,
      });
    });
  });
}

export function getReauthState(): { inFlight: boolean; exited: boolean } {
  return {
    inFlight: !!_reauthChild,
    exited: _reauthExited,
  };
}
