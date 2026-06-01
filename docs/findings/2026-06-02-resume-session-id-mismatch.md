# resume / 同ペイン再起動で CLAUDE_CODE_SESSION_ID が変わり inbox が分裂する

調査日: 2026-06-02。別リポ作業 (gh-monitor) 用に開いていた cmux-msg session を resume / 再起動した際に subscribe が `inbox 未初期化` で落ちた事象から、env 値を実測して判明した確定事実。

## 判明した事実

### 1. resume / 同ペイン再起動後、2 つの session_id env が食い違う [実測]

```
CLAUDE_CODE_SESSION_ID=eeeafa1f-aa1c-41a3-b8fc-c5a67c3d20f4   (新)
CMUXMSG_SESSION_ID=49bba385-2c23-44c3-91f5-90f65284210a       (旧)
CMUX_SURFACE_ID=9633BA9A-8AD0-4BA5-A03B-E43E10E7D2DA
```

- `CMUXMSG_SESSION_ID` = cmux が surface (ペイン) に注入した値。ペインに固定され安定
- `CLAUDE_CODE_SESSION_ID` = Claude Code 起動ごとの値。**今回の起動で新 UUID に変わっていた**

### 2. cmux-msg の解決順は CLAUDE_CODE_SESSION_ID 最優先 → 新 ID に解決 [CLAUDE.md 記載 + whoami 実測]

CLAUDE.md の session_id 解決順:
1. `$CLAUDE_CODE_SESSION_ID` env (最優先)
2. `$CMUXMSG_SESSION_ID` env (互換)
3. `<base>/by-surface/<CMUX_SURFACE_ID>` lookup file

このため `whoami` は新 ID `eeeafa1f` に解決:

```
session_id: eeeafa1f-aa1c-41a3-b8fc-c5a67c3d20f4
cwd:        (no meta — SessionStart hook 未実行?)
dir:        /Users/kawaz/.local/share/cmux-messages/eeeafa1f-aa1c-41a3-b8fc-c5a67c3d20f4
```

新 ID の inbox dir は未初期化 → `subscribe` が `エラー: inboxが未初期化です` で exit 1。

### 3. SessionStart hook は旧 ID で「初期化済み」と報告 = hook と解決の食い違い [実測]

同セッションの SessionStart hook 出力:

```
[cmux-msg] 初期化済み (session_id: 49bba385-2c23-41b8-...)
```

hook は旧 `49bba385` を見て「初期化済み」、一方コマンド実行時の解決は新 `eeeafa1f` で「未初期化」。**hook が見る ID とコマンドが解決する ID が一致していない**。

### 4. DR-0001 の前提と食い違う [DR-0001 line 134-136]

[DR-0001](../decisions/DR-0001-session-id-identifier.md) は:

> resume (`claude --resume <session_id>` または `-c` 等) でも session_id は ... resume 前と同一

を前提にしている。しかし実機の `CLAUDE_CODE_SESSION_ID` は今回の起動で別 UUID に変わった。DR-0001 line 22 の「同ペインで連続起動すると別 ID」に該当する経路 (= resume ではなく同ペインでの新規起動) を踏んだ可能性が高い。

いずれにせよ、**`CLAUDE_CODE_SESSION_ID` 最優先解決 + 起動ごとに ID 変化** の組み合わせで、同じペイン (= ユーザ視点では「同じ会話の続き」) なのに別 inbox に解決され、過去の peer 関係 / 受信メッセージから切り離される。

## 影響

- 旧 ID `49bba385` 宛に送られたメッセージ (= 他セッションが知っている宛先) が新 ID では受信できない
- subscribe が落ちる (= 新 ID inbox 未初期化)
- peer から見た宛先 ID が会話継続で変わる (= send/tell の宛先が古くなる)

## 未確定 (= 設計判断、本 findings では決めない)

- **正しい挙動はどちらか**: (a) 起動ごとに別会話として別 inbox を持つべき / (b) ペイン安定 ID (`CMUXMSG_SESSION_ID` or by-surface) を優先して会話継続性を保つべき
- 解決順で `CLAUDE_CODE_SESSION_ID` を最優先にしている設計意図と、ペイン継続性のどちらを取るか
- これは DR-0001 / DR-0004 (session-as-primary-key) の中核に関わるため、issue / DR 検討が要る

## 関連

- [DR-0001](../decisions/DR-0001-session-id-identifier.md) — session_id を通信単位にする決定 (line 134-136 で resume 同一性を前提)
- [DR-0004](../decisions/DR-0004-session-as-primary-key.md) — session を主鍵にする決定
- [DR-0007](../decisions/DR-0007-resume-resilient-session-identity.md) — resume 耐性 (ただし tty 不変鍵による tell 安全境界が対象、inbox 主鍵とは別軸)
- [2026-06-02-subscribe-double-launch-prevention.md](../issue/2026-06-02-subscribe-double-launch-prevention.md) — subscribe の別 issue (= double-launch、本件とは別問題だが subscribe 起動経路で隣接)
