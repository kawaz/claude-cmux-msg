# `claude agents --json` の挙動と cmux-msg への含意

調査日: 2026-06-04。kawaz が `claude agents --json` の存在を発見し、cmux-msg の peer 発見 / 状態管理 にどう使えるかを実機並列実験で確認した確定事実。

## 判明した事実

### 1. 出力スキーマ [実測]

各 entry は以下の形:

```json
{
  "pid": 41018,
  "cwd": "/Users/kawaz/.local/share/repos/github.com/kawaz/claude-cmux-msg/main",
  "kind": "interactive",
  "startedAt": 1780555759969,
  "sessionId": "76256bc8-2a62-4e00-bb4c-e58299ce0b59",
  "status": "idle" | "busy" | "waiting",
  "waitingFor": null | "permission prompt"
}
```

- `startedAt` は epoch ms (機械可読 / 数値比較可能。`ps` の `lstart` のような localized format parse 不要)
- `kind` は今回の観測範囲では `"interactive"` のみ。`-p` / `--print` 系の非対話起動が含まれるかは未確認

### 2. CLAUDE_CONFIG_DIR 範囲に閉じる (cross-home 分離) [実測]

個人面 (`CLAUDE_CONFIG_DIR=~/.claude-personal`) で `claude agents --json` を叩いた結果 7 件、同時に host 上で業務面 (`~/.claude-emeradaco`) の 4 件の claude が `ps -axww` で見えているが、**業務面 claude は `agents --json` 出力に含まれない**。

含意: cross-home の peer 発見には **各 home ごとに `CLAUDE_CONFIG_DIR=<dir> claude agents --json` を回す** 必要がある。cmux-msg に `claude_config_dirs` 設定を持つ理由づけ。

### 3. subagent / workflow runtime は agents に現れない [実測]

`general-purpose` subagent を Agent tool で background 起動して、走行中に `agents --json` を確認 → subagent 由来のエントリは増えない。親 claude (pid 41018) の子孫を `pgrep -P 41018` で見ると subagent は `bun run ...` の子 process として走っており、独立 `claude --session-id ...` プロセスではない。

含意: cmux-msg の peer 概念 (= 独立 sid を持つ claude プロセス) と agents が返す集合が **完全に一致**。subagent や workflow runtime を peer として誤検出する事故が原理的に起きない。

### 4. 同 sid 多重をマージせず両方返す [実測]

`--resume <uuid>` を 2 つ別ターミナルで起動した状態:

```json
{ "pid": 16923, "startedAt": 1780557872573, "status": "idle", "sessionId": "cb787472-..." }
{ "pid": 17948, "startedAt": 1780557887717, "status": "busy", "sessionId": "cb787472-..." }
```

含意: `entries.filter(e => e.sessionId === sid).length` で ambiguous 検出可能。`startedAt` の差分で DR-0007 の `concurrent_resume` (差あり) / `unexpected` (同時) を判別できる。lstart parse 不要。

### 5. `--session-id <uuid>` は唯一性が claude 側で保証 [仕様確認]

`claude --session-id <uuid>`:
- 新規セッション作成、起動側が UUID を指定するだけ
- 既存 sid 流用は `already in use` エラーで拒否
- 重複起動も同様にエラー

含意: ambiguous (= 同 sid 多重) の発生源は **`--resume` / `-c` 系のみ**。cmux-msg の `spawn` (= `--session-id` で起動) の経路では原理的に ambiguous が発生しない。

### 6. `-c` (continue) も agents 上で resume と同じ扱い [実測]

`claude -c` を別ターミナルで 2 回起動 + `--resume <uuid>` を 1 回起動 → 全 3 件が同じ `sessionId` で `agents --json` に出現:

```
pid 83904  -c              startedAt 16:49:49
pid 84680  -c              startedAt 16:50:00
pid 85629  --resume cb...  startedAt 16:50:11
```

### 7. `status` は app inference state のみ (bg/fg/suspended は含まれない) [実測]

新規 claude を起動して同ターミナルで Ctrl-Z → 別ターミナルで状態確認:

| 状況 | `agents.status` | `ps PGID==TPGID` | `ps STAT` |
|---|---|---|---|
| fg (controlling tty 握り) | `idle` | true | `S+` |
| Ctrl-Z (suspended) | `idle` | false | `T` |
| bg (Ctrl-Z で停止のまま) | `idle` | false | `T` |

**`agents.status` は 3 ケースとも `idle`**。process group / signal level の状態を 1 bit も反映しない。

含意: bg / suspended の判定は **`ps -p <pid> -o pgid,tpgid,stat` が唯一の真実源**。DR-0007 の「fail-closed fg 判定」の論拠が実機で確定的に補強された。

### 8. agents.status と meta.state に 1-2 秒の遅延窓 [実測]

並行 resume 中の `pid 85629` で 1 turn 処理を観察:

```
[16:56:01]  85629: idle → busy   meta: idle → running   (UserPromptSubmit hook fire)
[16:56:05]  jsonl +5KB (assistant 応答 + tool_use)
[16:56:07]  meta: running → idle                          (Stop hook fire = app 内部完了)
[16:56:08]  85629: busy → idle                            (agents 後追い、1秒遅れ)
```

含意: meta は hook 同期で先に idle、agents は後追い。`tell` 直前の安全境界は **両方 idle** を要件にすべき (= AND 結合)。片方だけ信用すると false positive (= busy peer に送信) のリスク。

### 9. ps argv 照合は `-c` 起動 claude を 100% 見落とす [実測]

3 件並列状態 (`-c` x2 + `--resume` x1) で:

```
ps -axww 全プロセスから argv 内 sid 文字列マッチ:
  pid 85629 (--resume cb787472-...) のみ 1 件ヒット

claude agents --json で同 sid フィルタ:
  pid 83904, 84680, 85629 の 3 件
```

`-c` で起動した claude は **argv に sid 値を持たない** (フラグ `-c` のみ)。DR-0007 の `lib/session-proc.ts:lookupSidProcess` は `--session-id` / `--resume` の直後トークン照合のため、**`-c` 起動分を素通り**してしまう。**既存実装の検出穴を実機で確定**。

### 10. 並列 resume は jsonl size 減少を引き起こす [実測]

同 sid の `pid 84680` と `pid 85629` が同時 busy 状態で、両者が同じ jsonl (`~/.claude-personal/projects/.../cb787472-....jsonl`) に書き込む:

```
17:01:05  size=199916  user tool_result (tool_use_id 01Gx...)
17:01:07  size=199149  user tool_result (tool_use_id 01Kv...)   ← -767 byte
17:01:11  size=202688  user tool_result (tool_use_id 01EN...)
```

size 単調増加が崩れた = **過去行が短い行で上書き** されたか **truncate + rewrite** が起きている。並列書き込み時には `bridge-session` / `last-prompt` / `mode` / `permission-mode` の境界マーカー行が多数追記されるが、それでも size 減少が観測された。

含意: **並列 resume = 履歴破損のリスクが実在**。DR-0007 の ambiguous 恒久 deny を緩和 (= 「片方なら送る」) する案は永久に成立しない。

### 11. resume で pid が変わる [実測]

このセッション (sid `76256bc8`) も検証中の resume で pid 41018 → 55712 に変わった。同様に `cb787472` も resume / -c で起動するたびに新 pid (16923/17948 → 終了後 72261 → 83904/84680/85629) が割り当てられた。

含意: pid を sid と紐付ける固定識別子にしてはいけない (DR-0007 で既決定、本検証で補強)。

### 12. agents から消える = dead 確定 [実測]

`cb787472` の 16923 + 17948 を両方終了 → `agents --json` 出力から完全に消失 (件数 5 → 4)。一方 `~/.local/share/cmux-messages/cb787472-.../meta.json` は残り、`state: "stopped"`, `last_ended_at: "2026-06-04T16:45:23+09:00"` が記録された状態で生き残る。

含意: dead 検出が **「agents に sid 不在」** で成立。`meta.last_ended_at != null` + `agents 不在` が確定 dead 条件。meta dir 残存は gc で掃除 (DR-0004 で対応済み)。

### 13. SessionStart で meta の last_ended_at が null にリセットされる [実測]

resume 復帰の meta.json 遷移:

```
停止時: state="stopped", last_ended_at="2026-06-04T16:45:23+09:00"
復帰後: state="idle",   last_ended_at=null,  last_started_at="2026-06-04T16:46:37+09:00"
```

含意: meta だけで「現役 / 停止」を判断する場合 `last_ended_at == null` が現役の必要条件。agents との二段照合 (= state とのクロスチェック) でより確実な判定。

## 実用的な示唆

### peer 発見の主経路を agents に格上げ (DR-0008 へ)

| 旧 (DR-0007 実装) | 新 (DR-0008 提案) |
|---|---|
| `ps -axww` 全プロセス走査 + argv 照合 | `claude agents --json` で sid → pid 一括解決 |
| `--session-id` / `--resume` の argv 照合のみ (`-c` 見逃し) | `-c` も含めて完全捕捉 |
| `lstart` を localized format で parse | `startedAt` の epoch ms 数値比較 |
| 1 sid 確認に全プロセス走査 | sid フィルタ 1 回 |

### ps の役割を「pid 確定後の詳細確認専用」に降格

`agents --json` で sid → pid を解決した後、`ps -p <pid> -o pgid,tpgid,stat,lstart,tty` で 1 プロセス分だけ詳細取得。これは DR-0007 の `recheckPidProcess` と同形。

| 取れる情報 | 取得元 |
|---|---|
| `(sid, pid, cwd, startedAt, app status, kind)` | `claude agents --json` |
| `(pgid, tpgid, STAT, lstart, tty)` | `ps -p <pid>` |
| `tty → cmux surface 逆引き` | `cmux tree` |

### `tell` 安全境界の AND 結合

- `agents` の sid 一致が 1 件のみ (= not ambiguous)
- その pid を `ps -p <pid>` で確認: `pgid == tpgid` (fg) かつ `STAT` が `S` or `R` (suspended / zombie / unresponsive でない)
- `agents.status == "idle"` (meta.state 単独で信用しない)
- `meta.state == "idle"` (agents と二段照合 / 遅延窓対策)
- 改行・制御文字なし 1 行のみ

### ambiguous 恒久 deny の補強

並列 resume で jsonl size 減少 = 履歴破損の実観測 (#10) により、ambiguous は緩和不可。DR-0007 の恒久 deny 判断を実機で完全裏付け。

### `claude_config_dirs` 設定の導入 (cross-home)

cross-home (DR-0005) と peer 発見を協調させるため cmux-msg に config を新設、`claude_config_dirs: string[]` を持つ。未指定時は `CLAUDE_CONFIG_DIR` 指定なしの `agents --json` 1 発 = 現挙動互換。

## 検証マトリクス (要約)

| 検証項目 | 結果 | 含意 |
|---|---|---|
| 出力スキーマ | `pid, cwd, kind, startedAt, sessionId, status, waitingFor` | DR-0008 で参照 |
| cross-home 分離 | ✅ CLAUDE_CONFIG_DIR 範囲に閉じる | `claude_config_dirs` 設定必須 |
| subagent 排除 | ✅ 親 claude の子 bun は出ない | peer 概念と完全一致 |
| ambiguous 保持 | ✅ 同 sid 多件をマージせず返す | DR-0007 ロジックそのまま乗る |
| `-c` 起動補足 | ✅ agents は捕捉、ps argv は見逃す | **既存実装の bug fix** |
| bg/fg 検知 | ❌ status に含まれない | `ps -p <pid>` 必須 |
| meta vs agents 遅延 | ❌ 1-2 秒の窓あり | 二段 AND 必須 |
| 並列書き込み害 | ✅ jsonl size 減少を実観測 | ambiguous 恒久 deny |
| pid 不変性 | ❌ resume ごとに新 pid | pid を識別子にしない (既決定補強) |
| dead 検知 | ✅ agents 不在で確定 | meta dir gc は既決定 |

## 関連

- [DR-0001](../decisions/DR-0001-session-id-identifier.md) — session_id 一本化
- [DR-0004](../decisions/DR-0004-session-as-primary-key.md) — sid を主体に整理
- [DR-0005](../decisions/DR-0005-claude-home-default-wall.md) — claude_home 壁
- [DR-0007](../decisions/DR-0007-resume-resilient-session-identity.md) — resume 耐性 (本 findings で論拠補強)
- [DR-0008](../decisions/DR-0008-agents-json-peer-discovery.md) — agents 経由 peer 発見への格上げ + 設定ファイル導入
- [journal/2026-06-04-claude-agents-json-investigation.md](../journal/2026-06-04-claude-agents-json-investigation.md) — 発見と検証の経緯
