/**
 * cmux CLI ラッパー
 */

import { $ } from "bun";

export async function cmuxExec(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await $`cmux ${args}`.quiet().nothrow();
    return {
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
      exitCode: result.exitCode,
    };
  } catch (e) {
    // Error なら message のみ取り出す。それ以外は String() で文字列化。
    const stderr = e instanceof Error ? e.message : String(e);
    return {
      stdout: "",
      stderr,
      exitCode: 1,
    };
  }
}

export async function cmuxNewSplit(
  direction: string,
  options?: { surface?: string; workspace?: string }
): Promise<string> {
  const args = ["new-split", direction];
  if (options?.surface) {
    args.push("--surface", options.surface);
  }
  if (options?.workspace) {
    args.push("--workspace", options.workspace);
  }
  const result = await cmuxExec(args);
  if (result.exitCode !== 0 || !result.stdout.startsWith("OK")) {
    throw new Error(
      `分割ペイン作成に失敗: ${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}

export async function cmuxSend(
  surfaceRef: string,
  text: string
): Promise<void> {
  await cmuxExec(["send", "--surface", surfaceRef, text]);
}

export async function cmuxSendKey(
  surfaceRef: string,
  key: string
): Promise<void> {
  await cmuxExec(["send-key", "--surface", surfaceRef, key]);
}

export async function cmuxReadScreen(
  surfaceRef?: string,
  scrollback = false
): Promise<string> {
  const args = ["read-screen"];
  if (surfaceRef) {
    args.push("--surface", surfaceRef);
  }
  if (scrollback) {
    args.push("--scrollback");
  }
  const result = await cmuxExec(args);
  return result.stdout;
}

export async function cmuxRenameTab(
  surfaceRef: string,
  title: string
): Promise<void> {
  await cmuxExec(["rename-tab", "--surface", surfaceRef, title]);
}

export async function cmuxNewSurface(paneRef: string): Promise<string> {
  const result = await cmuxExec(["new-surface", "--pane", paneRef]);
  if (result.exitCode !== 0 || !result.stdout.startsWith("OK")) {
    throw new Error(
      `新規サーフェス作成に失敗: ${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}

export async function cmuxListPanes(): Promise<string> {
  const result = await cmuxExec(["list-panes"]);
  return result.stdout;
}

export async function cmuxIdentify(surfaceRef: string): Promise<{ paneRef: string; surfaceRef: string }> {
  const result = await cmuxExec(["identify", "--surface", surfaceRef]);
  try {
    const json = JSON.parse(result.stdout);
    return {
      paneRef: json.caller?.pane_ref || "",
      surfaceRef: json.caller?.surface_ref || "",
    };
  } catch {
    return { paneRef: "", surfaceRef: "" };
  }
}

export async function cmuxCloseSurface(surfaceRef: string): Promise<void> {
  await cmuxExec(["close-surface", "--surface", surfaceRef]);
}

export type WaitForKind = "received" | "timeout" | "error";

export type WaitForResult =
  | { kind: "received"; elapsedMs: number }
  | { kind: "timeout"; elapsedMs: number }
  | { kind: "error"; elapsedMs: number; exitCode: number; stderr: string };

export function interpretWaitForResult(result: {
  exitCode: number;
  stderr: string;
}): WaitForKind {
  if (result.exitCode === 0) return "received";
  if (result.stderr.includes("timed out")) return "timeout";
  return "error";
}

export async function cmuxWaitFor(
  signal: string,
  timeout?: number
): Promise<WaitForResult> {
  const args = ["wait-for", signal];
  if (timeout !== undefined) {
    args.push("--timeout", String(timeout));
  }
  const start = performance.now();
  const result = await cmuxExec(args);
  const elapsedMs = performance.now() - start;
  const kind = interpretWaitForResult(result);
  if (kind === "received") return { kind, elapsedMs };
  if (kind === "timeout") return { kind, elapsedMs };
  return {
    kind: "error",
    elapsedMs,
    exitCode: result.exitCode,
    stderr: result.stderr,
  };
}

export async function cmuxSignal(signal: string): Promise<void> {
  await cmuxExec(["wait-for", "-S", signal]);
}
