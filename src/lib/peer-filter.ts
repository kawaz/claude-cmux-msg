/**
 * DR-0004: peer のグルーピング軸 filter。
 *
 * `--by <axis>` で「自分と同じ何かを持つ peer」を抽出、または
 * `--by <axis>:<pattern>` で「<axis> の値に <pattern> を含む peer」を抽出する
 * (cwd / repo の substring grep モード)。複数 --by 指定は AND。
 *
 * 軸:
 *   - home:         claude_home 一致 (自分基準)
 *   - cwd:          cwd 完全一致 (自分基準)
 *   - cwd:<pat>:    cwd に <pat> を含む (substring、絶対パターン)
 *   - repo:         repo_root 完全一致 (自分基準、両方 repo_root を持つ場合のみ)
 *   - repo:<pat>:   repo_root に <pat> を含む (substring、絶対パターン)
 *   - tag:<name>:   指定タグを peer の tags 配列が含む
 *
 * substring grep は人間が雑に「cmux-msg」と呼ぶ実 repo が `claude-cmux-msg`
 * のような prefix 違いを吸収するための実用配慮 (= 完全一致 / regex は overkill)。
 */

import type { PeerMeta } from "../types";
import { UsageError } from "./errors";

export type ByAxis =
  | { kind: "home" }
  | { kind: "cwd"; pattern?: string }
  | { kind: "repo"; pattern?: string }
  | { kind: "tag"; name: string };

export function parseByAxis(spec: string): ByAxis {
  if (spec === "home") return { kind: "home" };
  if (spec === "cwd") return { kind: "cwd" };
  if (spec === "repo") return { kind: "repo" };
  if (spec.startsWith("cwd:")) {
    const pattern = spec.slice("cwd:".length);
    if (!pattern) throw new UsageError(`--by cwd:<pattern> の pattern が空です`);
    return { kind: "cwd", pattern };
  }
  if (spec.startsWith("repo:")) {
    const pattern = spec.slice("repo:".length);
    if (!pattern) throw new UsageError(`--by repo:<pattern> の pattern が空です`);
    return { kind: "repo", pattern };
  }
  if (spec.startsWith("tag:")) {
    const name = spec.slice("tag:".length);
    if (!name) {
      throw new UsageError(`--by tag:<name> の name が空です`);
    }
    return { kind: "tag", name };
  }
  throw new UsageError(
    `--by の不明な軸: ${spec}\n  有効な軸: home, cwd[:<pat>], repo[:<pat>], tag:<name>`
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
 * cwd / repo に pattern がある場合は substring grep モード (= peer 側の値に
 * pattern が含まれるかどうか、自分基準ではない絶対パターン)。
 */
export function matchAxis(
  me: PeerMeta,
  peer: PeerMeta,
  axis: ByAxis
): boolean {
  switch (axis.kind) {
    case "home":
      return me.claude_home === peer.claude_home;
    case "cwd":
      if (axis.pattern !== undefined) {
        // substring grep モード
        return peer.cwd.includes(axis.pattern);
      }
      return me.cwd === peer.cwd;
    case "repo":
      if (axis.pattern !== undefined) {
        // substring grep モード (= peer が repo_root を持つ前提)
        return !!peer.repo_root && peer.repo_root.includes(axis.pattern);
      }
      // 両方とも repo_root を持ち、かつ一致した時のみ true
      return !!me.repo_root && me.repo_root === peer.repo_root;
    case "tag":
      // 旧 meta.json (tags フィールド不在) の peer を踏んでも TypeError しない。
      return (peer.tags ?? []).includes(axis.name);
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
    case "cwd":
      return axis.pattern !== undefined ? `cwd:${axis.pattern}` : "cwd";
    case "repo":
      return axis.pattern !== undefined ? `repo:${axis.pattern}` : "repo";
    case "tag":
      return `tag:${axis.name}`;
  }
}
