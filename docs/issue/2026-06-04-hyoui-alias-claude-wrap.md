# `alias claude='hyoui run -- claude'` 常時 hyoui 経由起動構想

提起日: 2026-06-04 (DR-0008 検証中の議論にて kawaz から)

## 背景

DR-0008 で `claude agents --json` を peer 発見の主経路に格上げした。`agents.status === "idle"` 条件で `tell` の安全境界 (= ユーザ入力 active 状態 = file 内部の `"shell"` も含めて) は **粗くは**カバーできる。

ただし **ユーザがプロンプト欄に何文字打ち中か** の検出は `agents --json` レベルでは不能。具体的には:

- ユーザがキーボード入力モード (file.status="shell") に入っている = active prompt buffer を持つ状態
- そこに cmux signal で外から paste すると **既存入力文字に被さって混ざる**
- agents API は "shell" / "busy" の両方を `"busy"` に丸めて返すので、ある程度は弾けるが、**「shell かつ buffer 空」(= 受付モードだが何も打ってない、tell して安全) と「shell かつ buffer に文字あり」(= 打ち中、tell すると混ざる) を区別できない**

これは画面 (= screen buffer) を読まないと判定不能。具体的には TUI のプロンプト領域 (`────...─` で囲まれた `❯` 行) の中身を見て、`❯` の後ろが空かどうかを確認する。

## 構想

```
alias claude='hyoui run -- claude'
```

を kawaz の shell 環境にデフォルトで仕込み、**常時 claude を hyoui (= 外部駆動 PTY wrapper) 配下で起動**する。これにより:

- どの claude プロセスも hyoui session を持つ = 後から外部から screen 取得 / 入力制御可能
- `agents --json` で sid → pid を取得して、その pid に紐付く hyoui session 経由で screen buffer を読める
- cmux-msg は `tell` 前に **「`❯` 行の中身が空かどうか」** を screen 解析でチェック → 空なら送る、空でなければ deny
- `cmux send` の代替として hyoui の PTY 直接書き込みで input 注入 → cmux signal 不要、workspace 跨ぎ問題 (= [[cmux-msg-tell-screen-to-hyoui-migration]] memory の動機) と同時解決

## 期待される安全境界 (= 3 段)

```
1. agents --json で peer 発見 + status 確認
   - kind === "interactive"
   - status === "idle"
   - entries.length === 1 (= not ambiguous)
2. hyoui で screen buffer 取得 + プロンプト空チェック
   - ❯ 行の後ろが空白のみ
3. hyoui の PTY に行送り込み (= cmux signal 廃止)
```

これで cmux-msg の `tell` が「LLM 推論中」「permission 待ち」「ユーザがプロンプト active モード」「ユーザがプロンプトに打ち中」の 4 状態を全部独立に検出して deny できる。

## 検討事項

### 1. spawn 子 / subagent / workflow runtime の扱い

`alias` は kawaz が shell から `claude` を打ったときにだけ効く。以下の経路で起動される claude は素の `claude` バイナリ呼び出しになる可能性:

- cmux-msg の `spawn` (= `claude --session-id <uuid> ...` を直接呼ぶ)
- workflow runtime が背後で `claude` を呼ぶ
- 各種ラッパースクリプト

これらも hyoui 配下にするには、cmux-msg `spawn` 実装側で **明示的に `hyoui run -- claude ...` を呼ぶ**ように書き換える必要がある。subagent は親 claude 内部の bun runtime なので原理的に独立 claude プロセスを起動しない (= agents --json に出ない、検証済) ため対象外。

### 2. パフォーマンスとオーバーヘッド

hyoui PTY wrapper を全 claude に被せる効果:
- 起動時間: PTY allocation + wrap setup の追加コスト
- ランタイム: PTY 経由 IO の overhead (= 通常 claude 直 IO より僅かに遅い)
- メモリ: hyoui session ごとに screen buffer 保持

要計測。日常用途で kawaz 体感に影響しない範囲か確認が要る。

### 3. hyoui の安定性と依存

hyoui 自身がまだ開発中 (= kawaz/hyoui)。常用に耐える安定性か、起動失敗時のフォールバック (= 素の claude にフォールバック) をどう設計するか。

### 4. cmux との相互作用

cmux pane 内で `claude` を打つと alias が効く → `hyoui run -- claude` が走る。hyoui の PTY と cmux の PTY のネストが起きる可能性。確認が要る。

### 5. CLAUDE_CONFIG_DIR 環境ごとの alias 管理

個人面 / 業務面 (~/.claude-personal / ~/.claude-emeradaco) の境界で alias の有効範囲をどう揃えるか。両方 hyoui 経由で良いか。

### 6. screen 解析の TUI 依存

`❯` 行の枠 (= `─` で囲まれた特定行) は claude TUI の現在の見た目に依存する。claude UI 変更で枠が変わると検出ロジックが壊れる。

mitigation 案:
- TUI の version 別検出 (= claude --version で枠仕様を切替)
- 諦めて「screen の末尾行が prompt 行」と仮定する単純化

## 関連

- [DR-0008](../decisions/DR-0008-agents-json-peer-discovery.md) — agents 経由 peer 発見 (本構想の前提)
- [findings/2026-06-04-claude-agents-json-observations.md](../findings/2026-06-04-claude-agents-json-observations.md) — file.status "shell" 発見 (本構想の動機)
- [journal/2026-06-04-claude-agents-json-investigation.md](../journal/2026-06-04-claude-agents-json-investigation.md) — 検証経緯
- memory: `cmux-msg-tell-screen-to-hyoui-migration` — workspace 跨ぎ問題の hyoui 移行方針 (本構想の前提)
- kawaz/hyoui — 外部駆動 PTY wrapper (= 本構想の wrap 担当)

## 次のアクション

- hyoui の現状 (= 機能 / 安定性 / API) を確認、最低限必要な機能 (= attach、screen 取得、input 送信) があるか
- 検討事項 1-6 を解消したら DR-0009 として起票候補
- 実装着手前に kawaz と再合意
