/**
 * DR-0004: peer のグルーピング軸 filter。
 *
 * `--by <axis>` で「自分と同じ何かを持つ peer」を抽出する。
 * 複数 --by 指定は AND (全条件一致のみ通過)。
 *
 * 軸:
 *   - home: claude_home 一致
 *   - ws:   workspace_id 一致
 *   - cwd:  cwd 一致
 *   - repo: repo_root 一致 (どちらかが null なら不一致)
 *   - tag:<name>: 指定タグを peer の tags 配列が含む
 */

import type { PeerMeta } from "../types";
import { UsageError } from "./errors";

export type ByAxis =
  | { kind: "home" }
  | { kind: "ws" }
  | { kind: "cwd" }
  | { kind: "repo" }
  | { kind: "tag"; name: string };

export function parseByAxis(spec: string): ByAxis {
  if (spec === "home") return { kind: "home" };
  if (spec === "ws") return { kind: "ws" };
  if (spec === "cwd") return { kind: "cwd" };
  if (spec === "repo") return { kind: "repo" };
  if (spec.startsWith("tag:")) {
    const name = spec.slice("tag:".length);
    if (!name) {
      throw new UsageError(`--by tag:<name> の name が空です`);
    }
    return { kind: "tag", name };
  }
  throw new UsageError(
    `--by の不明な軸: ${spec}\n  有効な軸: home, ws, cwd, repo, tag:<name>`
  );
}

/**
 * `args` から `--by <spec>` / `--by=<spec>` / `--all` を抽出して残りを返す。
 *
 * Returns:
 *   - axes: 解釈された軸の配列 (複数の --by を順番に積む)
 *   - all: `--all` フラグが指定されていれば true
 *   - rest: --by / --all を取り除いた残り (引数解析の続きに使う)
 */
export interface ParsedByArgs {
  axes: ByAxis[];
  all: boolean;
  rest: string[];
}

export function extractByArgs(args: string[]): ParsedByArgs {
  const axes: ByAxis[] = [];
  let all = false;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--by") {
      const v = args[i + 1];
      if (v === undefined) {
        throw new UsageError("--by には値が必要です");
      }
      axes.push(parseByAxis(v));
      i++;
      continue;
    }
    if (arg.startsWith("--by=")) {
      axes.push(parseByAxis(arg.slice("--by=".length)));
      continue;
    }
    rest.push(arg);
  }
  return { axes, all, rest };
}

/**
 * `me` (自分の meta) と `peer` (相手 meta) が axis で一致するかを判定。
 */
export function matchAxis(
  me: PeerMeta,
  peer: PeerMeta,
  axis: ByAxis
): boolean {
  switch (axis.kind) {
    case "home":
      return me.claude_home === peer.claude_home;
    case "ws":
      return me.workspace_id === peer.workspace_id;
    case "cwd":
      return me.cwd === peer.cwd;
    case "repo":
      // 両方とも repo_root を持ち、かつ一致した時のみ true
      return !!me.repo_root && me.repo_root === peer.repo_root;
    case "tag":
      return peer.tags.includes(axis.name);
  }
}

/**
 * 全 axis が一致 (AND) する場合のみ true。
 * axis 配列が空なら true (no-op filter)。
 */
export function matchAllAxes(
  me: PeerMeta,
  peer: PeerMeta,
  axes: ByAxis[]
): boolean {
  return axes.every((a) => matchAxis(me, peer, a));
}

/**
 * axis を人間可読な短いラベルに変換 (help 表示用)。
 */
export function describeAxis(axis: ByAxis): string {
  switch (axis.kind) {
    case "home":
      return "home";
    case "ws":
      return "ws";
    case "cwd":
      return "cwd";
    case "repo":
      return "repo";
    case "tag":
      return `tag:${axis.name}`;
  }
}
