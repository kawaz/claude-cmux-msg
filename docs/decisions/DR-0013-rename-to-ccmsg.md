# DR-0013: パッケージ / コマンド / env の cmux- prefix を ccmsg に統一

- Status: Proposed
- Date: 2026-06-16
- Related: [DR-0009](DR-0009-hyoui-delegation.md) / [DR-0010](DR-0010-drop-cmux-environment-requirement.md) (cmux 廃止系)

## 背景

`cmux-msg` の `cmux-` 接頭辞は cmux (libghosttyベース terminal multiplexer) 前提だった名残。本リポは cmux 全廃 (DR-0009 / DR-0010) で cmux 概念から完全に独立する。名称に cmux- が残ったままでは:

- 新規ユーザに「cmux 専用」という誤解を与える
- env 名 (`CMUXMSG_*`) / cli 名 / plugin 名 / `~/.local/share/cmux-messages` ベースパスのすべてに「機能と無関係な歴史的名称」が残る (`no-historical-noise.md` 違反)
- 既存 issue `2026-06-12-hyoui-era-purification.md` でも改名 TODO として明示済

新名称は `ccmsg` (= Claude Code Messaging の略)。発音可能、3 字種の英小文字のみで補完しやすい。

## 決定

### 1. 名称マッピング

| 旧 | 新 |
|---|---|
| パッケージ名 `cmux-msg` | `ccmsg` |
| `bin/cmux-msg` | `bin/ccmsg` |
| plugin name (plugin.json / marketplace.json の `name`) | `ccmsg` |
| `CMUXMSG_SESSION_ID` env | `CCMSG_SESSION_ID` |
| `CMUXMSG_BASE` env | `CCMSG_BASE` |
| `CMUXMSG_PARENT_SESSION_ID` env | `CCMSG_PARENT_SESSION_ID` |
| `CMUXMSG_WORKER_NAME` env | `CCMSG_WORKER_NAME` |
| `CMUXMSG_PRIORITY` env | `CCMSG_PRIORITY` |
| `CMUXMSG_TAGS` env | `CCMSG_TAGS` |
| デフォルトベースパス `~/.local/share/cmux-messages` | `~/.local/share/ccmsg` |

### 2. 旧 env を 1 メジャー (1.x の間) 互換読み

- 旧 `CMUXMSG_*` env が立っていれば warning を出して新 `CCMSG_*` として扱う
- 2.0 で警告→削除 (DR-0014 と同じ 1.0.0 bump 時点では maintain、2.0 までに完全廃止)
- ベースパス: 既定値読みは新パスに変更。旧パス (`~/.local/share/cmux-messages`) が存在し新パスが無い場合は warning を出して旧パスを使う (= 既存データを引き継ぐ、削除を強制しない)

### 3. ハードコード文字列の追従

- `src/lib/subscribe-watch.ts:73-74` の `isSubscribeCommand` 判定で `cmux-msg` / `cli.ts` をハードコードしている箇所を `ccmsg` / `cli.ts` に更新
- 漏れると subscribe 二重起動防止が壊れる重要箇所なのでテストで確認

### 4. docs / README / SKILL.md / DR 本文の置換方針

- DR 本文中の歴史的経緯としての `cmux-msg` 言及は残す (= 過去の事実、`no-historical-noise.md` の例外: 「意図的な誤判断 record」相当)
- 新規 DR から `ccmsg` を使う
- README / SKILL.md / cli HELP は本文ごと `ccmsg` に置換 (= 最新読者にとって混乱の元)

## 不採用

- **`cmux-msg` のまま据え置き**: 名称負債を将来に持ち越す。`design-priority.md` (後方互換より設計優先) に反する。
- **`cmsg`** (3 字): 過度に短く、検索性が悪い (一般語 / 既存プロジェクト名と衝突しやすい)。
- **`claude-code-msg`** / **`cc-msg`**: 冗長 / 既存 plugin 命名規約と整合しにくい。`ccmsg` は kawaz の他リポ (`claude-cmux-msg`, `claude-rules-personal`, etc.) と並べた時にも 1 単語で見分けやすい。
- **`hyoui-msg`**: hyoui 依存を名称に固定するのは将来別 host (kitty / wezterm 等) に対応した時に困る。host 中立の名称が望ましい。
- **env alias を持たず breaking 一発**: 練習セッションなど既存運用が即死するため、1 メジャー alias は許容。

## 影響範囲

### 必須置換

- `package.json` の `name`
- `.claude-plugin/plugin.json` / `marketplace.json` の `name`
- `bin/cmux-msg` → `bin/ccmsg` (rename + 旧名は alias 1 メジャー保持)
- `src/cli.ts` の HELP / コマンド名
- `src/config.ts` / `src/lib/paths.ts` の env 名と base path
- `src/lib/subscribe-watch.ts:73-74` のハードコード文字列
- README / README-ja / SKILL.md / cli HELP

### Hook prompt の追従

- `src/hooks/session-start.ts` の自動 prompt に含まれる `cmux-msg` 言及を `ccmsg` に
- DR-0014 の hint 例 (`cmux-msg reply <file> --text "結果"`) も `ccmsg reply ...` に

### 関連 plugin / リポへの波及

- `kawaz/cmuxmsg-rules` 等の派生リポがあれば追従 (= 本セッションでは未確認、要調査)
- 個人 rule (`claude-rules-personal/for-me/rules/`) で `cmux-msg` 言及があれば追従

## 段階的移行

1. DR-0014 / DR-0009 / DR-0010 / DR-0011 と同 1.0.0 bump 群に統合
2. 旧 env / 旧 base path の互換ロジックを実装し、warning を出しつつ 1 メジャー保持
3. 1.0.0 land 後、本リポ自体の clone 先名は `claude-cmux-msg` のまま (= GitHub repo rename は別判断、本 DR の射程外)
4. 2.0.0 bump 時に env alias / base path alias を完全削除

## 関連

- `docs/issue/2026-06-12-hyoui-era-purification.md`: 改名 TODO を本 DR で sublimation
- `no-historical-noise.md`: 歴史的接頭辞を残さない原則
- `design-priority.md`: 後方互換より設計優先 (env alias 1 メジャーは「移行期間」であって「永続互換」ではない)
