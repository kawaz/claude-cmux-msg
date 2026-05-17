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

/**
 * surface のシェルが入力受付可能 (= 出力が落ち着いた) かを判定する純粋関数。
 *
 * 連続する 2 つの read-screen サンプル (prev / curr) を比較し、
 * 「画面が非空」かつ「prev と curr が一致 (出力が静止した)」を満たすと settled とみなす。
 *
 * Design rationale: cmux 側に「surface のシェルが ready になった」を通知する API が
 * 無いため、画面サンプリングの heuristic で代替する。プロンプト記号 (`❯` 等) は
 * ユーザ環境・シェル設定で千差万別なので、記号への依存を避け「出力が静止したか」だけで
 * 判定する。これにより new-split 直後の遅延起動シェルでも環境非依存で ready 検出できる。
 *
 * @param prev 直前のサンプル。初回サンプル時は null。
 * @param curr 今回のサンプル。
 */
export function isSurfaceSettled(prev: string | null, curr: string): boolean {
  // 初回サンプルは比較相手が無いので未確定
  if (prev === null) return false;
  // 画面がまだ何も描画されていない (空白のみ含む) なら未確定
  if (curr.trim() === "") return false;
  // 非空かつ前回と一致 = 出力が静止 = シェル ready とみなす
  return prev === curr;
}

export type SurfaceReadyResult =
  | { kind: "ready"; elapsedMs: number }
  | { kind: "timeout"; elapsedMs: number };

/**
 * surface のシェルが ready になるまで read-screen をポーリングする。
 *
 * new-split で作った直後の terminal surface は zsh 等のシェルが遅延起動する
 * (数秒かかる) ため、ここで起動完了を待ってから claude 起動コマンドを送る必要がある。
 *
 * `cmuxReadScreen` が一時的に失敗 (surface not found 等) しても catch して
 * 次サンプルへ進む。タイムアウトに達したら ready 扱いせず timeout で返す
 * (呼び出し側が best-effort で送信を続けられるよう、ready/timeout を区別する)。
 */
export async function cmuxWaitSurfaceReady(
  surfaceRef: string,
  options: { timeoutMs: number; intervalMs: number }
): Promise<SurfaceReadyResult> {
  const start = performance.now();
  let prev: string | null = null;
  while (performance.now() - start < options.timeoutMs) {
    let curr = "";
    try {
      curr = await cmuxReadScreen(surfaceRef);
    } catch {
      // read 失敗 (surface 未生成等) は無視して次サンプルへ
      curr = "";
    }
    if (isSurfaceSettled(prev, curr)) {
      return { kind: "ready", elapsedMs: performance.now() - start };
    }
    prev = curr;
    await new Promise((r) => setTimeout(r, options.intervalMs));
  }
  return { kind: "timeout", elapsedMs: performance.now() - start };
}
