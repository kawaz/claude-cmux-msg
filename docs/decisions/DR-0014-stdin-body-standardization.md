# DR-0014: send / reply / broadcast の本文入力を stdin に統一

- Status: Accepted (2026-06-17, kawaz 一括承認)
- Date: 2026-06-16
- Related: cli-design-preferences (ロングオプション基本、補完前提), AI agent の Markdown / バックティック親和性

## 背景

`cmux-msg send <sid> <body>` / `reply <filename> <body>` / `broadcast --by <axis> <body>` は本文を positional 引数で受けてきた。実利用上、

- **メッセージ本文は AI agent 間の長文 Markdown が大多数**。一言メッセージは稀。
- AI agent (Claude / Codex 等) は本文中にバックティック ` ``` `, `$(...)`, `${var}` を自然に書き込み、**shell の double quote 内では command substitution として解釈されて事故になる**。本リポにも push-guard 系の hook (`bash-backtick-check.sh`) があり、double quote 内のバックティックを検知して送信を止める。
- 結果として AI agent は毎回 heredoc (`"$(cat <<'EOF' ... EOF\n)"`) に逃がす必要があり、CLI の表面が AI agent の現実に合っていない。
- 同じ問題は本リポ内の練習セッション (2026-06-16) でも実証された (= heredoc に書き換えてから送信し直す手間)。

`gh pr create --body-file -` / `git commit -F -` / `mail` など、本文を長文化する CLI は stdin / `--body-file` 経由が定石。本リポも同じ方針に揃える。

## 決定

### 1. 本文入力は stdin 標準化

```
cmux-msg send <sid>                     # 本文は stdin (主用途)
cmux-msg send <sid> --text "<msg>"      # 一言オプション (明示)
cmux-msg reply <filename>               # 同上
cmux-msg reply <filename> --text "<msg>"
cmux-msg broadcast --by <axis>          # 同上
cmux-msg broadcast --by <axis> --text "<msg>"
```

### 2. positional 本文は受け付けない (usage error)

- 旧 `cmux-msg send <sid> "本文"` は **usage error**。`--text` を使うか stdin で送る。
- ambiguity (positional vs --text vs stdin の優先順位の議論) を構造的に排除。

### 3. stdin が tty かつ `--text` 未指定なら usage 表示

- 黙って待たない (= 人間が誤って打って固まるのを防ぐ)。
- `cmux-msg send <sid> < file.md` / `echo body | cmux-msg send <sid>` / `cmux-msg send <sid> <<<"短文"` のいずれかの形を強制。

### 4. `--text` の仕様

- ロングオプションのみ。ショートは追加しない (cli-design-preferences 準拠)。
- 値は 1 引数。`--text=...` も `--text ...` も両方許容 (一般的な long opt 仕様)。
- 一言用途 (= ack, ok, retry など短文) を想定。
- 改行を含めたい場合は stdin を使う。`--text` で `$'\n'` を渡すのは可能だが推奨しない (= AI agent には stdin を案内する)。

## 不採用

- **positional 本文の互換維持 (deprecation 警告経由の段階廃止)**: 本リポは `design-priority.md` に従い、後方互換を理由に設計を歪めない。0.x の breaking 許容期間中に切るのが筋。同様の breaking を抱える DR-0009 / DR-0010 と同じ 1.0.0 bump 群に乗せる。
- **`--body-file <path>`**: stdin 経由で `cmux-msg send <sid> < file.md` と書けるので、追加 flag は冗長。
- **`-` を明示する形 (`cmux-msg send <sid> -`)**: stdin が標準入力経由なのを明示的にする慣習だが、`--text` 未指定 = stdin の規約が明確なので不要。
- **本文 markdown frontmatter (`---\ntitle: ...\n---`) を受ける**: cmux-msg の本文は frontmatter を持たない (= 保存時のメタ情報は別レイヤ)。stdin で frontmatter 風の中身を渡されても本文として扱う。混乱を避けるため frontmatter parse は行わない。

## 影響範囲

- `src/commands/send.ts` / `reply.ts` / `broadcast.ts` の引数 parser
- `src/cli.ts` のサブコマンド HELP (本文位置を `<sid>` から `[--text <msg>]` または stdin に書き換え)
- `src/hooks/session-start.ts` の prompt hint (`cmux-msg reply <file> "結果"` を `cmux-msg reply <file> --text "結果"` または stdin 形式に書き換え)
- README / SKILL.md の例
- 既存テスト (positional 本文を `--text` または stdin に書き換え)

## 移行プラン

- 1 PR で 3 コマンドを同時に切替 (中途半端な互換維持は混乱の元)
- 同 PR で hook prompt / README / SKILL.md / tests を全て追従
- 0.x の minor bump で land (1.0.0 bump 前に消化、`design-priority.md` 準拠)
- DR-0009 (cmux 廃止) と独立に進行可能

## 補足: AI agent 親和性

stdin 経由は AI agent にとって以下の利点:

- 本文中のバックティック / `$(...)` / `\` を escape せずそのまま送れる
- 長文 Markdown が CLI 引数長制限に引っかからない
- 一時ファイル経由 (`cat msg.md | cmux-msg send <sid>`) で送信内容を後から確認できる
- 失敗時の再送 (`cmux-msg send <sid> < msg.md`) が同じコマンドで再現可能
- AI agent が `Write` ツールで一時ファイル作成 → `Bash` で送信、というパターンが既に dominant (= 本リポ内の練習セッションで実証済)
