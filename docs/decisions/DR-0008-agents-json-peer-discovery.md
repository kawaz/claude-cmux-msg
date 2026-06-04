# DR-0008: peer 発見を `claude agents --json` 経由に格上げ + 設定ファイル導入

Status: Proposed
Date: 2026-06-04
Supersedes: なし (DR-0007 の実装基盤を切り替えるが、外部仕様は同一)

## Context

DR-0004 で session_id を主体に整理、DR-0007 で「resume 耐性のあるセッション同定 (tty を不変の鍵にした tell 安全境界)」を確定した。その後 2026-06-04 に kawaz が `claude agents --json` で取れる情報を発見、実機並列検証 ([findings/2026-06-04-claude-agents-json-observations.md](../findings/2026-06-04-claude-agents-json-observations.md)) で現状実装の限界が明確化した。

特に重要な実機観察 (findings 該当番号):

1. **`lib/session-proc.ts:lookupSidProcess` は `-c` (continue) 起動 claude を 100% 見落とす** (#9) — argv に sid を持たない `claude -c` を `--session-id` / `--resume` の直後トークン照合だけでは捕捉できない
2. **`claude agents --json` は CLAUDE_CONFIG_DIR 範囲に閉じる** (#2) — cross-home (DR-0005) で peer を発見するには各 home を回す必要があるが、現実装は cross-home の peer 発見経路を持たない
3. **`agents.status` は app inference state のみ (idle/busy/waiting)** (#7) — bg / fg / suspended は反映されない。`ps -p <pid>` の `pgid/tpgid/STAT` でしか判定できない (DR-0007 の論拠を実機補強)
4. **同 sid 多重はマージされず両方返る** (#4) — `startedAt` の epoch ms 差で `concurrent_resume` / `unexpected` の判別が agents 経由でも完全に成立
5. **並列 resume で jsonl size 減少を実観測** (#10) — 同 sid 並列書き込みによる履歴破損のリスクが実在。ambiguous 恒久 deny の論拠補強
6. **subagent / workflow runtime は agents に現れない** (#3) — agents の返す集合 = cmux-msg の「peer」概念と完全一致、誤検出の余地がない
7. **`--session-id <uuid>` は claude 側で唯一性保証** (#5) — ambiguous の発生源は `--resume` / `-c` 系のみ。`spawn` (`--session-id` で起動) では原理的に発生しない

## Decision

### 1. peer 発見の主経路を `claude agents --json` に格上げ

`lib/session-proc.ts:lookupSidProcess` を `agents --json` 呼び出しベースに rewrite:

```ts
export async function lookupSidProcess(sid: string): Promise<SidProcessLookup> {
  const agents = await fetchAgents();           // claude agents --json
  const entries = agents.filter((a) => a.sessionId === sid);

  if (entries.length === 0) return { kind: "not_found" };

  if (entries.length === 1) {
    const { pid, startedAt } = entries[0];
    const detail = await psDetail(pid);         // ps -p <pid> で bg/fg/STAT/lstart 取得
    if (detail.kind === "missing") return { kind: "not_found" };
    return {
      kind: "found",
      pid,
      tty: detail.tty,
      pgid: detail.pgid,
      tpgid: detail.tpgid,
      startTime: detail.lstart,
      isForeground: detail.pgid === detail.tpgid,
      runState: parseRunState(detail.stat),
    };
  }

  // entries.length >= 2 → ambiguous
  const ts = entries.map((e) => e.startedAt).sort();
  const dt = ts[ts.length - 1] - ts[0];
  return {
    kind: "ambiguous",
    procs: entries.map((e) => ({ pid: e.pid, startTime: epochToLstart(e.startedAt) })),
    reason: dt > AMBIGUOUS_DT_THRESHOLD_MS ? "concurrent_resume" : "unexpected",
  };
}
```

### 2. `ps -axww` 全プロセス走査は廃止、`ps -p <pid>` のみ残す

argv 照合ループ (現 `lib/session-proc.ts:138-159`) は廃止。`ps` は `agents --json` で確定した pid 単体に対する `ps -p <pid> -o pgid,tpgid,stat,lstart,tty` 詳細取得専用に降格。これは DR-0007 の `recheckPidProcess` と同形。

### 3. ambiguous の判定ロジックは維持 (恒久 deny)

`agents` の `entries.length >= 2` で deny は変えない。DR-0007 の `ambiguous_concurrent_resume` / `ambiguous_unexpected` 分類も維持 (実装は argv 照合 → agents 経由に切替えるが、外部仕様 / deny-log フォーマットは同一)。

並列 resume = jsonl 履歴破損が実機実証された (finding #10) ため、緩和案 (= 「片方なら送る」) は永久に検討しない。

### 4. cmux-msg 設定ファイル導入

新規 `config.json` の reader を `src/config.ts` に追加。schema (初版):

```ts
interface CmuxMsgConfig {
  claude_config_dirs?: string[];  // 探索する claude home の list (絶対パス or ~ 展開可)
}
```

探索位置 (env override 優先):
- `$CMUXMSG_CONFIG` env で明示指定 (絶対パス)
- `${XDG_CONFIG_HOME:-$HOME/.config}/cmux-msg/config.json`

`claude_config_dirs` 未指定時: 内部的に `[undefined]` 扱い = 現行通り「呼び出し時の `CLAUDE_CONFIG_DIR` で `agents --json` 1 発」。**完全な後方互換**。

`claude_config_dirs` 指定時: 各 entry を `CLAUDE_CONFIG_DIR=<dir> claude agents --json` で叩いて peer 一覧をマージ。各 agent entry に「呼び出し時の home」を attach して cross-home 識別子として保持。

### 5. `tell` の二段照合 (agents.status AND meta.state)

`tell-guard.ts` の安全境界に **`agents.status == "idle"` AND `meta.state == "idle"`** を要件追加。finding #8 で 1-2 秒の遅延窓を実観測したため、片方だけ信用すると false positive (= busy の peer に送信) のリスク。両方一致のみ通す。

### 6. status クロスチェックで hook 落ち検知

`agents.status` と `meta.state` が大きく乖離 (= meta=running なのに agents=idle が n 秒以上続く / その逆) した場合、hook 落ちの可能性として deny-log に記録 (DR-0007 の deny-log と同経路)。改修判断材料にする。閾値の具体値は実装時に決める (= ROADMAP 化)。

## Alternatives (検討して不採用)

### A. `ps argv` 走査の継続

不採用理由: `-c` 起動 claude を 100% 見落とす実装穴 (finding #9) を放置できない。`agents --json` への置換が **既存バグ fix も兼ねる**。

### B. agents を完全に真実源にして ps を捨てる

不採用理由: bg / fg / suspended は `agents.status` に反映されない (finding #7)。`tell` 安全境界に bg / suspended 弾きが要る以上、`ps -p <pid>` の単一プロセス確認は外せない。

### C. 設定ファイルではなく env var で cross-home リストを渡す

不採用理由: 複数値の env var は CSV エスケープが面倒、可搬性が低い。設定ファイルなら JSON で素直に書ける。env override (`$CMUXMSG_CONFIG`) は残すので柔軟性は担保。

### D. 設定ファイル位置を `<CMUXMSG_BASE>/config.json` にする

不採用理由: data ディレクトリと設定が混じる。`$XDG_CONFIG_HOME/cmux-msg/config.json` の方が標準的で、データと設定が物理的に分離する。

### E. 設定ファイル位置を `<CLAUDE_CONFIG_DIR>/cmux-msg.json` にする

不採用理由: 「個人面の設定に業務面の home も見ろ」と書く循環参照感がある。XDG 配置の方が「OS user に対して 1 個の cmux-msg config」として自然。

## Consequences

### 改修対象 (実装フェーズ)

- `src/lib/agents.ts` 新規追加 — `claude agents --json` を呼び実行、`AgentEntry[]` を返す
- `src/lib/session-proc.ts:lookupSidProcess` rewrite — argv 走査 → agents 呼び出しベース
- `src/lib/session-proc.ts:recheckPidProcess` 維持 — `ps -p <pid>` で bg/fg/STAT 確認
- `src/config.ts` config reader 追加 — `getConfig(): CmuxMsgConfig`
- `src/lib/peer.ts:listPeers` rewrite — agents 経由で sid 一覧取得 + `claude_config_dirs` 全 home 横断
- `src/lib/tell-guard.ts` — `agents.status` と `meta.state` の AND 結合追加
- 既存テスト (`session-proc.test.ts`, `tell-guard.test.ts`, `peer.test.ts`) の差分対応

### 副次効果

- **`-c` 起動 claude が peer 発見できるようになる** (= 既存 bug fix)
- cross-home の peer 発見が config 経由で可能になる (DR-0005 と協調強化)
- `ps -axww` 全走査廃止でコスト低下 (期待値、要 benchmark)
- ambiguous 検出ロジックが `startedAt` 数値比較で簡素化 (`lstart` parse 不要)
- subagent / workflow runtime の誤検出が原理的に発生しない (kind="interactive" + agents が独立 claude のみ返す保証)

### 残課題 (本 DR では決めない)

- `agents --json` の呼び出しコストが `ps -axww` より速いか / 遅いかは未測定。実装後に benchmark を取って必要なら最適化 (キャッシュ等) を別 DR で決める
- `status` クロスチェックの「乖離検知閾値」(秒数) は実装時に決める
- `claude_config_dirs` の各 entry を逐次実行 / 並列実行のどちらにするか (=`Promise.all` で並列、エラー時は home 単位で skip + warning する想定)
- `kind` enum の値 (バイナリ解析で `["interactive","bg","daemon","daemon-worker"]` を確認済)、peer 候補は `kind === "interactive"` のみ。daemon / bg / daemon-worker の `tell` 経路は別 DR で検討
- `agents.status === "idle"` 条件は **LLM 推論中** に加え **ユーザがプロンプト受付モード (= 内部 status `"shell"`、agents 公開時は `"busy"` に丸め込み)** も自動的に弾く二重効果を持つ。ただし「`shell` モードで buffer 空 vs 文字入力済」の区別は本 DR の安全境界では取れない (= `agents` レベルに無い情報)。プロンプト欄の **実バッファ文字数チェック** による更に細かい安全境界は [issue/2026-06-04-hyoui-alias-claude-wrap.md](../issue/2026-06-04-hyoui-alias-claude-wrap.md) で別途検討 (= `alias claude='hyoui run -- claude'` 常時 hyoui 配下起動 + screen 解析方式)

## 関連

- [DR-0001](DR-0001-session-id-identifier.md) — session_id 一本化
- [DR-0004](DR-0004-session-as-primary-key.md) — sid を主体に整理
- [DR-0005](DR-0005-claude-home-default-wall.md) — claude_home 壁 (cross-home warning)
- [DR-0007](DR-0007-resume-resilient-session-identity.md) — resume 耐性、tty / pgid / tpgid による fg 判定 (本 DR で実装基盤を agents 経由に切替えるが、外部仕様は同一)
- [findings/2026-06-04-claude-agents-json-observations.md](../findings/2026-06-04-claude-agents-json-observations.md) — 本 DR の判断根拠となる実機検証
- [journal/2026-06-04-claude-agents-json-investigation.md](../journal/2026-06-04-claude-agents-json-investigation.md) — 発見と検証の経緯
