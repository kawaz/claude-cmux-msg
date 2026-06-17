# DR-0015: 永続宛先 (cwd / ws / repo / label) の inbox を sid 宛と並列に持つ (sid 揮発性への対応)

- Status: Accepted (2026-06-17, kawaz 一括承認)
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
| **label** (新規、直交軸) | ラベル付き役割 / 動的参加 | 任意 (**動的に貼り剥がし可**) | label-name で索引 | 「`role=maintainer` 持ち」「`test-team-A` 参加中」 |

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

**共有 box (cwd / ws / repo / label) は queue semantics**:

- 1 通の msg は alive 全 peer のうち 1 人だけが消化 (= 取った者勝ち)
- 二重消化なし、競合制御の物理実装は DR-0016 (SQLite transaction)
- 取得時に frontmatter / DB から `also_received_by` (= 他 alive peer の sid リスト) を見て「他に N 人見ていた」を hint として把握可能
- broadcast (= 全員に届ける) が要るなら明示の `ccmsg broadcast --by axis` (既存) を使う。queue と broadcast は別 primitive

### 5. 送信モデル: レール = sid / repo / label、ws / cwd は補助

**レール (= `--help` の中心、kawaz 実運用の頻用形)**:

```bash
ccmsg send <sid> < msg.md             # sid 宛 (ピンポイント、文脈共有済の相手)
ccmsg send --repo <root> < msg.md     # repo 宛 (「hyoui に投げといて」のようなグループ化)
ccmsg send --label <name> < msg.md    # label 宛 (役割: role=maintainer 等)

# --text 短文形式
ccmsg send <sid> --text "ok"
ccmsg send --repo <root> --text "ok"
```

sid を知っている場合は sid 宛、知らない / コピペが面倒な場合は repo 宛で「あのリポの誰か」に届ける、というのが主用途。sid が dead なら自動で ws → repo → cwd に fallback する (§10)、送信者は chain を意識する必要なし。

**label の動的操作 (= ad hoc なグループ形成)**:

```bash
ccmsg label add test-team-A                # 自セッションが「テストチーム A」参加
ccmsg label add team-A,team-B,role=tester  # カンマ区切りで一発複数貼り
ccmsg label remove team-A,team-B           # カンマ区切りで一発複数剥がし
ccmsg label list                           # 現在の自セッション labels 一覧
ccmsg send --label test-team-A < msg       # チーム全員の中で取った者勝ち (= queue)
```

`,` は label 文字制約 `[a-zA-Z0-9_=]+` に含めていないため、**コマンドの区切り文字として安全に使える**。`label add/remove` で複数 label を 1 invocation で操作可能。
`ccmsg send --label` は 1 つの label に絞って配送 (= 「複数 label のいずれかを持つ peer」OR 配送のような複雑 semantics は持たない、シンプル単一指定)。

label は静的な役割 (`role=maintainer`) だけでなく、**特定の作業中に動的に参加する集まり** (テストチーム / 障害対応チーム / リファクタリング作業中の peer 群) を表現するためにも使う。SessionStart hook の `CCMSG_LABELS` env で初期 label を入れることもできるが、`label add/remove` で session 寿命中いつでも変更可能。

**補助 flag (`--help-full` 等の詳細表示でのみ露出)**:

| flag | 用途 | 想定頻度 |
|---|---|---|
| `--ws <path>` | repo 内で複数 ws (main / wip-x) を区別したいとき | 低-中 |
| `--cwd <path>` | subdir 単位の依頼 (稀)、repo 不在時の最後の砦 | 低 |

宛先排他: `<sid>` / `--cwd` / `--ws` / `--repo` / `--label` のいずれか **1 つ**。同時指定は usage error。`--text` は本文指定の別 axis (DR-0014)。

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

### 10. 自動 fallback chain (送信者が意識しない)

sid 宛で送ったとき、その sid が dead なら ccmsg が自動でフォールバック:

1. sid 宛 box に送信を試行 (= まずは sid 直接)
2. sid alive → 完了
3. sid dead → DB の旧 sid row から ws / repo / cwd を引いて chain 起動:
   - sid.ws_hash が解決可能 → **ws box に queue 1 通**
   - ws 解決不能 → sid.repo_hash → **repo box に queue 1 通**
   - repo 解決不能 (= 非 git 配下で起動された旧 sid) → sid.cwd_hash → **cwd box に queue 1 通** (最後の砦)
   - 全部失敗 → 送信エラー (= 最低限の通知、ユーザ判断)
4. 軸宛 box には **1 通だけ** 書く (= kawaz 確認「構造的に 1 通で良い」、複製しない)
5. 該当軸の alive 全 peer が同 box を watch、取った者勝ち
6. 取得時に frontmatter / DB の `also_received_by` で「他に N 人」hint を伝達

送信完了時の表示 (= 利用者へのフィードバック):

```
送信完了: 20260616T120000-abc.md → <sid>                                # sid alive 時
送信完了 (fallback ws): 20260616T120000-abc.md → <ws-hash> (alive peers: 2)  # fallback 時
```

**fallback chain は broadcast には適用しない**: 既存 `ccmsg broadcast --by axis` は配って終わり (= 重複読み回避)。

### 11. frontmatter 自動 fill (送信者揮発への備え)

メッセージ file の YAML frontmatter は ccmsg が自動で埋める。**agent が触るのは本文だけ** (DR-0014 stdin 標準化と整合)。

```yaml
---
id: 20260616T120000-c2f5b1bc          # msg-id (timestamp + random)

from:
  sid: <sender-sid>                   # CLAUDE_CODE_SESSION_ID / DB sessions row
  ws: <sender-ws-hash>                # DB sessions.ws_hash
  repo: <sender-repo-hash>            # DB sessions.repo_hash
  cwd: <sender-cwd-hash>              # DB sessions.cwd_hash
  labels: [<label1>, <label2>]        # DB session_labels
  home: <sender-claude-home>          # DR-0005 home 壁の表示用

to:
  kind: sid | cwd | ws | repo | label  # 受信箱の種類
  value: <hash | sid | label-name>

sent_at: 2026-06-16T12:00:00Z

# 任意 (該当時のみ)
in_reply_to: <msg-id>                  # reply の場合
also_received_by: [<sid_B>, <sid_C>]   # 共有 box 配信時の他 alive (= queue hint)
original_target_sid: <sid_A>           # fallback で来た場合の元宛先
priority: normal | urgent              # CCMSG_PRIORITY env から
---

本文 (agent が stdin で書く部分)
```

**自動 fill の境界**:
- agent が手書きするのは **本文のみ**。frontmatter を agent が書く経路は塞ぐ (= 偽装防止、誤記防止)
- frontmatter 全項目は ccmsg が DB から引いて埋める

**送信者揮発への対応** (kawaz 提案):
- 送信元 sid が後で死んでも、`from.ws` / `from.repo` が frontmatter に残っているため受信側が「同じ役割の peer」に reply できる
- `ccmsg reply <filename>` の自動 fallback: from.sid → from.ws → from.repo → from.cwd (= 送信側 §10 と同じ chain)
- 受信側 agent も chain を意識する必要なし (= 「reply するだけ」で適切に届く)

**DB との同期**:
- 真実源は DB (`messages` row)
- frontmatter は file レベルの自己記述コピー
- 書き込みは ccmsg が atomic (= file `tmp → rename` + DB insert を同 transaction で)
- file が手動編集されても DB row は変わらない (= 整合は DB が prevail)
- 人間 / agent が grep / less で読む分には frontmatter 自己完結で十分

### 12. CLI レール表示原則 (= 過剰な誘導を避ける、ただしレールは実運用に即して広めに取る)

kawaz 確認:
- 「あくまで所見はレールに乗った使い方を推奨して選択肢自体を見せないほうが良い」「必要最低限の箇所で簡潔に」
- ただし `--repo` / `--label` は **実運用で頻用** (= 「hyoui に投げといて」「テストチーム宛」)、これらを補助に回すと逆にレールから外れる

**`--help` の中心 (= 主要な使い方を網羅)**:

```
ccmsg send <sid> < msg              # ピンポイント (文脈共有済)
ccmsg send --repo <root> < msg      # リポ宛 (sid 不要、グループ化)
ccmsg send --label <name> < msg     # 役割 / ad hoc チーム宛
ccmsg label add <name>              # 自セッションに label 付与
ccmsg label remove <name>           # label 剥がし
ccmsg label list                    # 自セッションの label 一覧
```

**`--help-full` で出す補助**:

- `--ws <path>` / `--cwd <path>` (= worktree / subdir の細かい粒度区別、稀)
- 細かい diagnostic flags (= `--dry-run` 等の将来枠)

**エラー誘導は最小限**:

- sid 不明 / typo: 「`ccmsg peers` で alive 一覧」だけ (= 1 行)
- fallback 自動発動時: 完了 message に「送信完了 (fallback ws): ...」と 1 行通知 (= 誘導ではなく事実通知)
- レール外の使い方 (`--ws` / `--cwd`) は docs / README に書く (= 必要な人は読む)

**`--help-full` 分割の判断**:

- `send` サブコマンドのレールに `<sid>` / `--repo` / `--label` の 3 つが乗ったため、補助 (`--ws` / `--cwd`) を `--help-full` に分けて見せ過ぎを防ぐ
- 他サブコマンドは options が少ないので `--help-full` は不要、必要になった時点で追加

## 不採用

- **default semantics を broadcast にする**: cmux-msg の本質は agent ↔ agent の task 依頼。queue (= 1 人だけ消化) が自然な default。「全員に届けたい」場合は明示の `ccmsg broadcast --by axis` (既存) を使う。両者は別 primitive。
- **共有 box の msg を複数複製して各 alive peer の sid box に配る**: kawaz 確認「構造的に 1 通で良い、複製が大量にあってもしゃーない」。1 通を共有 box に置き、alive 全 peer が同 box を watch、取った者勝ち。
- **broadcast に fallback chain を付ける**: broadcast は dispatch (= 配って終わり)。fallback すると「同じ内容を大量の box で読む」事故。broadcast は fallback 対象外。
- **送信者が fallback chain を意識して明示指定する**: kawaz 確認「利用側に煩わしい複雑な指定は不要」。sid 宛で送るだけで自動 chain、利用者は意識不要。
- **agent が frontmatter を手書きできるようにする**: 偽装防止、誤記防止のため frontmatter は ccmsg 自動 fill のみ。agent が触るのは本文だけ (DR-0014 stdin と整合)。
- **sid 宛箱の引き継ぎ (= 新 sid が古い sid の inbox を吸収)**: 「特定の個人宛」semantics を壊す。新 sid は別人とみなすのが筋。sid 宛揮発性の解は ws / repo / cwd 宛の永続軸 + 自動 fallback で持つ。
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
