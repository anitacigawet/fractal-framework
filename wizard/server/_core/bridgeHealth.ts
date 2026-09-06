import type { BridgeRunResult } from "./bridge";

export function bridgeHealth(result: Pick<BridgeRunResult, "exitCode" | "stdout" | "stderr">) {
  const state = /^Auth:\s*(\w+)\s*$/im.exec(result.stdout)?.[1].toLowerCase();
  if (result.exitCode === 0) {
    const ready = state === "valid" || state === "ok";
    return {
      status: ready ? "ok" as const : "warn" as const,
      message: ready ? "Authenticated and ready." : "Bridge reachable but auth state unclear. Try Re-authenticate.",
    };
  }
  const unconfigured = state !== undefined && ["expired", "missing", "unknown"].includes(state);
  return {
    status: unconfigured ? "unconfigured" as const : "bad" as const,
    message: unconfigured ? "Not authenticated. Use the Re-authenticate button below."
      : `Bridge exit ${result.exitCode}: ${result.stderr || result.stdout || "(no output)"}`,
  };
}
