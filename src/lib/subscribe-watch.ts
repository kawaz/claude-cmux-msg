/**
 * subscribe (Monitor 起動の long-running プロセス) の生存チェック (DR-0007 決定10)
 *
 * `cmux-msg subscribe` は claude プロセス終了で道連れに死ぬ。`claude --resume` で
 * 再開した新プロセスでは復活しないため、SessionStart hook が「自分の claude の
 * 子孫プロセスツリーに subscribe が居るか」を `ps` で確認し、`source` と実検出を
 * 組み合わせて AI に張り直し要否の文言を出す。
 *
 * 本モジュールはツリー探索と source×検出→文言決定を純粋関数として切り出す
 * (テスト可能)。`ps` の実行は session-proc.ts の parsePsOutput を使う。
 */

import { parsePsOutput, lookupSidProcess } from "./session-proc";

/** pid/ppid だけを持つ最小プロセスノード (子孫ツリー探索用)。 */
export interface ProcNode {
  pid: number;
  ppid: number;
}

/** subscribe 検出に使う最小行 (pid/ppid/command)。 */
export interface ProcCommandRow {
  pid: number;
  ppid: number;
  command: string;
}

/**
 * pid/ppid のリストから rootPid の子孫 pid 集合を求める (root 自身は含めない)。
 *
 * BFS で辿る。異常データ (ppid 循環) でも訪問済み集合で無限ループを防ぐ。
 */
export function collectDescendantPids(
  procs: ProcNode[],
  rootPid: number
): Set<number> {
  // ppid → 子 pid 群
  const childrenByPpid = new Map<number, number[]>();
  for (const p of procs) {
    const arr = childrenByPpid.get(p.ppid);
    if (arr) arr.push(p.pid);
    else childrenByPpid.set(p.ppid, [p.pid]);
  }
  const result = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const children = childrenByPpid.get(cur) ?? [];
    for (const child of children) {
      if (child === rootPid) continue; // root 自身は含めない (循環対策含む)
      if (result.has(child)) continue; // 訪問済み (循環対策)
      result.add(child);
      queue.push(child);
    }
  }
  return result;
}

/**
 * ps の command 表示文字列が `cmux-msg subscribe` 相当かを判定する。
 *
 * 想定パターン:
 *   - コンパイル済み: `/path/to/cmux-msg subscribe [opts...]`
 *   - bun 経由      : `bun /path/to/src/cli.ts subscribe [opts...]`
 *
 * 判定: トークン列に `cmux-msg` (basename) または `cli.ts` (basename) が現れ、
 * その直後トークンが `subscribe` であること。`subscribe` が引数値として末尾に
 * 出るだけのケース (`cmux-msg send sid subscribe`) は弾く。
 */
export function isSubscribeCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/).filter((t) => t !== "");
  for (let i = 0; i < tokens.length - 1; i++) {
    const base = tokens[i]!.split("/").pop();
    const isCmuxMsgEntry = base === "cmux-msg" || base === "cmux-msg-bin" || base === "cli.ts";
    if (isCmuxMsgEntry && tokens[i + 1] === "subscribe") {
      return true;
    }
  }
  return false;
}

/**
 * rootPid (自分の claude) の子孫プロセスツリーに subscribe プロセスが居るか。
 */
export function detectSubscribeInTree(
  rows: ProcCommandRow[],
  rootPid: number
): boolean {
  const descendants = collectDescendantPids(
    rows.map((r) => ({ pid: r.pid, ppid: r.ppid })),
    rootPid
  );
  for (const r of rows) {
    if (descendants.has(r.pid) && isSubscribeCommand(r.command)) {
      return true;
    }
  }
  return false;
}

/**
 * 自分の claude pid を起点に、`ps` を実行して子孫ツリーに subscribe が居るか判定する
 * ランタイム関数 (DR-0007 決定10)。
 *
 * - `lookupSidProcess(sid)` が found でなければ「自分の claude pid が引けない」状態。
 *   検出不能なので false (= 未検出扱い) を返す。これにより未検出時は source 別に
 *   start / restart の文言になり、安全側 (張り直しを促す) に倒れる。
 * - `ps` の失敗時も false を返す (検出不能 → 安全側)。
 */
export function detectSubscribeForSid(sid: string): boolean {
  const self = lookupSidProcess(sid);
  if (self.kind !== "found") return false;
  try {
    const proc = Bun.spawnSync({
      cmd: ["ps", "-axww", "-o", "pid,ppid,pgid,tpgid,stat,tty,lstart,command"],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
    if (proc.exitCode !== 0) return false;
    const rows = parsePsOutput(new TextDecoder().decode(proc.stdout));
    return detectSubscribeInTree(rows, self.pid);
  } catch {
    return false;
  }
}

/** 出し分ける文言の種別。 */
export type SubscribeMessageVariant = "start" | "restart" | "running";

export interface SubscribeMessage {
  variant: SubscribeMessageVariant;
  /** AI 向けの案内テキスト (1 段落)。 */
  text: string;
}

/**
 * source と subscribe 実検出を組み合わせて出力文言を決める (DR-0007 決定10)。
 *
 * | source        | 実検出 | variant |
 * |---------------|--------|---------|
 * | startup       | 無     | start   |
 * | resume        | 無     | restart |
 * | clear/compact | 有     | running |
 * | 任意          | 表と食い違う | 実検出を優先 |
 *
 * 実検出を source より優先する (誤検知回避)。検出済みなら常に running、
 * 未検出なら source が startup のときだけ start、それ以外は restart (安全側)。
 */
export function decideSubscribeMessage(
  source: string,
  subscribeDetected: boolean
): SubscribeMessage {
  if (subscribeDetected) {
    return {
      variant: "running",
      text:
        "subscribe は稼働中です (claude の子孫プロセスに検出)。" +
        "再起動は不要です。",
    };
  }
  if (source === "startup") {
    return {
      variant: "start",
      text:
        "セッション開始直後に **Monitor ツールで** subscribe を persistent: true で起動してください。" +
        "subscribe は long-running blocking なので Bash ツールで叩くとハングします。",
    };
  }
  // resume / clear / compact / 未知の source で未検出 → 張り直しを促す
  return {
    variant: "restart",
    text:
      "⚠️ subscribe が稼働していません (claude の子孫プロセスに未検出)。" +
      "claude の resume 等で道連れに停止した可能性があります。" +
      "**Monitor ツールで** subscribe を必ず張り直してください。",
  };
}
