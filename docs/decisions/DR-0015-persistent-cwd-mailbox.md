# DR-0015: 永続宛先 (cwd / ws / repo / label) の inbox を sid 宛と並列に持つ (sid 揮発性への対応)

- Status: Proposed
- Date: 2026-06-16
- Refines: [DR-0004](DR-0004-session-as-primary-key.md) (sid 主体は維持しつつ、並列軸として永続宛先を追加)
- Refines: [DR-0005](DR-0005-claude-home-default-wall.md) (永続宛先も home 壁の対象)
- Depends on: [DR-0016](DR-0016-status-store-sqlite.md) (本 DR の物理実装は DR-0016 の SQLite ハイブリッドに委譲)
- Related: [DR-0012](DR-0012-event-driven-subscribe.md) (event-driven subscribe が永続宛先 inbox も watch)

## 背景

DR-0004 で「メッセージングの主体 = session_id (sid)」と決めた。これは「特定セッション宛」モデルとして綺麗だが、**sid は揮発性が高い**:

- ユーザが `/clear` / `/compact` でセッションをリセットする
- コンテキストが溢れて新しい session-id で起動し直す
- タスク完了で session を閉じ、後で同じプロジェクトに別 session で復帰する

実運用では「**特定の役割を担う claude は時間と共に新陳代謝する**」のが普通で、送信側が「最新の相手 sid」を毎回追うのは現実的でない。
さらに **alive な claude がゼロ** のタイミング (離席、夜間 idle) に送られた msg は、現在の sid 宛モデルでは死んだ sid 宛 inbox に滞留して誰も拾わない。

実観測 (2026-06-16):

- `cmux-msg peers --all` で `kawaz/hyoui/main` cwd の alive peer が 2 件、`exp1781575967-1..5` のような実験バッチ系 hyoui session が default namespace に 10+ 並ぶ
- どれが「本物の hyoui 開発担当」か label 不在では特定不能 (= hyoui label 要望の起票根拠と同根)

## 決定

### 1. 識別子モデル: sid 主体は維持、4 軸 + label を**並列 primitive** として追加

DR-0004 の「sid 主体」を覆さない。sid 宛は依然として「特定セッション宛 (= 個人宛、文脈共有済の人宛)」。
cwd / ws / repo / label 宛は「**役割宛 (= 何らかのスコープに住んでる誰か宛)**」として並列に動作。

軸の包含関係: **sid ⊂ cwd ⊂ ws ⊂ repo** (= ピンポイント → 一番広い)。label は直交軸。

| 宛先軸 | 意図 | 永続性 | 範囲 | 用途例 |
|---|---|---|---|---|
| sid (既存) | 特定の "個体" 宛 | 揮発 (新陳代謝で死ぬ) | 1 session | 「文脈共有済のあの話」 |
| **cwd** (新規) | 作業ディレクトリにいる誰か | やや永続 | `process.cwd()` 単位 | 「`crates/hyoui-cli/` で作業中の誰か」 |
| **ws** (新規) | workspace / worktree にいる誰か | 中 (出たり消えたり) | git worktree root or jj workspace root | 「`hyoui/main/` で作業中の誰か」「`hyoui/wip-x/` の作業者」 |
| **repo** (新規) | リポジトリ全体の誰か | 永続 (リポ寿命) | git common-dir の親 (bare 親) | 「`kawaz/hyoui` の誰でも」 |
| **label** (新規、直交軸) | ラベル付き役割 | 任意 | label-name で索引 | 「`role=maintainer` 持ち」 |

**ws 軸の必要性** (= 単純な「cwd vs repo」だと足りない理由):

kawaz の運用 (= git bare + worktree、jj 環境では jj workspace):

```
~/.local/share/repos/github.com/kawaz/hyoui/
  .git/                # bare
  main/                # 長寿 worktree (= main branch)
  wip-feature-x/       # 一時 worktree (= 作業中)
  pr1234-feature-y/    # 一時 worktree (= 出たり消えたり)
```

- `repo` は永続 (= bare の親)、`ws` は worktree 寿命 (= 機能完了で消える)
- `cwd` は ws 内の subdir (= `main/crates/foo/`)
- 「main worktree にいる誰か」と「pr1234 worktree にいる誰か」を区別したい場面は普通にある
- repo 宛だと両方混ざる、cwd 宛だと subdir 単位になりすぎる → ws が中間粒度として要る

### 2. label vs tag の決着: label 一本に統一

包含関係: `tag ⊆ label` (tag = `k=v` 構造はラベル名の慣習、本質は単一文字列ラベル)。
本リポでは **label** の語で統一する (= hyoui への要望と用語整合)。`app=ccmsg` のような構造化は「ラベル名の慣習」として呼出側で表現すればよく、primitive としては単一文字列のラベル。

### 3. label 名の文字制約: `[a-zA-Z0-9_=]+`

- `=` を許容して `app=ccmsg`, `role=maintainer` 等の慣習を有効化
- `:` は session/protocol セパレータ慣習と衝突するため不採用
- `.` / `-` も filesystem 自体では path 安全だが、シンプルさ優先で当面外す (= 必要になれば後で広げる)
- 長さ上限: 64 文字 (実装簡素化)

### 4. 受信モデル: 各 claude は「自分が属する軸」の box を全部 watch

各 claude の subscribe は以下を並列で watch:

1. sid 宛 box (= 個人専用、競合なし)
2. cwd 宛 box (= `cwd-hash` で索引)
3. ws 宛 box (= `ws-hash` で索引)
4. repo 宛 box (= `repo-hash` で索引)
5. label 宛 box × 自分が持つ label の数 (= `label-name` で索引)

共有 box (cwd / ws / repo / label) は **複数 alive claude が同一 box を見ている可能性** がある:

- 取得競合は **取得者勝ち** (= queue semantics)
- 二重消化なし、競合制御の物理実装は DR-0016 (SQLite transaction)

### 5. 送信モデル

```bash
# sid 宛 (既存) — 最ピンポイント
ccmsg send <sid> < msg.md

# cwd 宛 (新規) — 作業ディレクトリ単位
ccmsg send --cwd <path> < msg.md        # path を正規化して cwd-hash 索引で配送
ccmsg send --cwd .                      # 現在の cwd

# ws 宛 (新規) — worktree/workspace 単位
ccmsg send --ws <path> < msg.md         # path から ws root を解決して ws-hash 索引で配送
ccmsg send --ws .                       # 現在の ws (= cwd から git worktree root を遡る)

# repo 宛 (新規) — リポジトリ全体
ccmsg send --repo <repo-root> < msg.md  # git common-dir を正規化

# label 宛 (新規、直交軸)
ccmsg send --label app=ccmsg < msg.md
```

宛先指定の排他: `<sid>` / `--cwd` / `--ws` / `--repo` / `--label` のいずれか **1 つ**を指定 (= 1 通 1 宛先)。`--text` は本文指定の別 axis (DR-0014)。

**送信側の選択ガイドライン** (= ピンポイント順):

- `<sid>`: 「あの個人と話す」(文脈共有済)
- `--cwd`: 「あの作業ディレクトリで作業中の誰か」(= subdir 単位の依頼)
- `--ws`: 「あの worktree で作業中の誰か」(= `main` / `wip-x` を区別したいとき)
- `--repo`: 「リポジトリ全体の誰でも」(= worktree がバラバラでも届く)
- `--label`: 「役割を持つ誰か」(= 直交軸、`role=maintainer` 等)

### 6. cwd / ws / repo の正規化 + 検出

3 軸とも正規化済パスの **SHA-256 prefix (16 char)** で索引化。共通の正規化:

- `path.resolve` → `fs.realpathSync` (シンボリックリンク追従) → 末尾 `/` 剥がし

**各軸の検出ロジック**:

- **cwd**: `process.cwd()` を正規化したパスそのもの
- **ws**: cwd から git worktree root を遡る:
  - 第一候補: `git rev-parse --show-toplevel` (= git worktree root)
  - jj 環境: jj は worktree という概念は持たないので **`git rev-parse --show-toplevel` で十分** (= jj は git bare + workspace 構造の上に乗るため、git の worktree 検出が機能する)
  - **fallback**: git/jj 配下でない場合は cwd と同一にする (= ws == cwd)
- **repo**: cwd から git common-dir の親:
  - `git rev-parse --git-common-dir` の親ディレクトリ (= bare の場合は bare の親、非 bare は worktree の親と同じ)
  - **fallback**: git 配下でない場合は **未設定** (= repo 宛は使えない)

例:

| 起動コマンド | cwd | ws | repo |
|---|---|---|---|
| `cd kawaz/hyoui/main/crates/hyoui-cli && claude` | `<...>/main/crates/hyoui-cli` | `<...>/main` | `<...>/kawaz/hyoui` |
| `cd kawaz/hyoui/wip-feature-x && claude` | `<...>/wip-feature-x` | `<...>/wip-feature-x` | `<...>/kawaz/hyoui` |
| `cd /tmp && claude` | `/tmp` | `/tmp` (= fallback) | (= 未設定) |

つまり同 repo 別 worktree (`main` と `wip-feature-x`) は **repo 宛で合流、ws 宛では分離**。これが kawaz の運用 (= main は長寿、wip-* は出たり消える) と整合。

### 7. broadcast との分離 (混同しない)

| primitive | 配信先 | 永続性 | semantics |
|---|---|---|---|
| **broadcast** (既存) | 現時点で alive な peer 全員 (fan-out) | 揮発 | 「告知」「一斉通達」 |
| **cwd / ws / repo / label 宛 send** (新規) | 共有 box に 1 通 → alive な誰か 1 人が消化 | 永続 (alive ゼロでも未来の claude が拾う) | 「役割宛キュー」 |

両者は別 primitive。broadcast を queue semantics に変えない。

### 8. cross-home 境界 (DR-0005 補強)

- cwd / ws / repo / label 宛も home 壁の対象 (= `--ignore-cross-home` 不在時は別 home 宛を warning)
- ホーム間 isolation の実装詳細は DR-0016 (DB の home 列で分離)

### 9. 物理実装は DR-0016 に委譲

本 DR は **論理 semantics** (= 4 軸並列宛先、queue 取得者勝ち) のみを規定する。
共有 box の物理保存方法、軸索引、競合制御の具体は DR-0016 (SQLite ハイブリッド) で定義する。

## 不採用

- **sid 宛箱の引き継ぎ (= 新 sid が古い sid の inbox を吸収)**: 「特定の個人宛」semantics を壊す。新 sid は別人とみなすのが筋。sid 宛揮発性の解は cwd / ws / repo / label 宛の永続軸で持つ。
- **broadcast を queue semantics に変える**: 既存の「fan-out 告知」用途と矛盾。別 primitive として並べる。
- **agmsg 風の (team, agent_name) ペアモデル**: human-friendly だが、本リポは sid 主体 (DR-0004) を維持。label 軸が「役割名」相当を担う。
- **tag の語を使う**: tag は label の特殊形 (`k=v` 構造) なので包含的に label が正。tag を別 primitive にすると重複定義になる。
- **`:` を label 文字に許す**: 主理由は **`=` の方が `app=ccmsg` のような構造化として慣習整合**である点 (GitHub label / Docker label-schema / Kubernetes label の `k=v` 表記)。副次理由として:
  - Windows ファイルシステムで `:` は予約文字 (drive letter `C:` / NTFS Alternate Data Stream `file.txt:stream`)。本リポは現状 macOS/Linux のみ対応だが、DR-0016 (SQLite hybrid) 前に label-name を path 化していた旧設計では non-portable だった (= DR-0016 で DB 列格納に変更したので path には出ないが、portability の保険として残す)
  - `<sid>:<role>` 風の識別子セパレータ慣習との将来衝突予約

## 影響範囲

### Schema 影響 (DR-0016 に委譲)

物理構造の詳細は DR-0016 を参照。本 DR は論理 schema のみ定義:

- session: `sid`, `cwd-hash`, `repo-hash`, `labels (set of string)`, `home`, `state`
- message: `id`, `from_sid`, `target_kind (sid|cwd|repo|label)`, `target_value`, `body_ref (file path)`, `created_at`, `consumed_by (sid|null)`

### コード

- `src/lib/scope-hash.ts` 新規: cwd / ws / repo の正規化 + SHA-256 prefix、ws 軸の検出 (git rev-parse --show-toplevel)
- `src/lib/label.ts` 新規: label 文字制約バリデーション
- `src/commands/send.ts`: `--cwd` / `--repo` / `--label` flag 追加 (排他)
- `src/commands/subscribe.ts`: 複数軸の watch + 取得者勝ち (具体実装は DR-0016 で SQLite 経由)
- `src/lib/inbox.ts` / `src/lib/message.ts`: 受信箱の種類 (sid / cwd / ws / repo / label) を msg メタに記録

### Hook

- `src/hooks/session-start.ts`: cwd / ws / repo / labels を解決して session row に書く (具体は DR-0016)

### tests

- `cwd-hash` の正規化テスト (symlink / 末尾 / 相対パス)
- label 文字制約テスト
- 取得者勝ちテスト (並行 subscribe で 1 つだけ消化、DR-0016 連動)

## 段階的移行

1. **DR-0016 land** (= SQLite hybrid 物理実装) を先に
2. 本 DR の `cwd-hash` / `label` 正規化 + send `--cwd` / `--repo` / `--label` 実装
3. subscribe の複数軸 watch + 取得者勝ち (DR-0016 transaction)
4. history / peers の表示更新 (= 受信箱の種類を出す)
5. 1.0.0 bump 群 (DR-0009 〜 DR-0014 と統合)

## 関連

- DR-0004 (sid 主体): 維持。本 DR は並列軸を追加するのであって主体を覆さない
- DR-0005 (home 壁): 維持、cwd / ws / repo / label 宛も home 壁の対象
- DR-0012 (event-driven subscribe): 本 DR の subscribe 拡張が watcher 基盤上に乗る
- DR-0014 (本文 stdin 標準化): 同 commit 系列で land、`--cwd` / `--repo` / `--label` と `--text` を直交軸として整理
- DR-0016 (SQLite hybrid): 本 DR の物理実装
- hyoui label 要望 (`kawaz/hyoui/main/docs/issue/2026-06-16-feature-session-labels.md`): cmux-msg の label 軸と概念合流
