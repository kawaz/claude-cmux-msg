# DR-0015: 永続宛先 (cwd / repo / tag) の inbox を sid 宛と並列に持つ (sid 揮発性への対応)

- Status: Proposed
- Date: 2026-06-16
- Refines: [DR-0004](DR-0004-session-as-primary-key.md) (sid 主体は維持しつつ、並列軸として永続宛先を追加)
- Refines: [DR-0005](DR-0005-claude-home-default-wall.md) (永続宛先も home 壁の対象)
- Related: [DR-0012](DR-0012-event-driven-subscribe.md) (event-driven subscribe が永続宛先 inbox も watch)

## 背景

DR-0004 で「メッセージングの主体 = session_id (sid)」と決めた。これは「特定のセッション (= 特定の個体) と話す」モデルとしては綺麗だが、**sid は揮発性が高い**:

- ユーザが `/clear` / `/compact` でセッションをリセットする
- コンテキストが溢れて新しい session-id で起動し直す
- タスク完了で session を閉じ、後で同じプロジェクトに別 session で復帰する

つまり実運用では「**特定の役割を担う claude は時間と共に新陳代謝する**」のが普通で、送信側が「いつでも最新の相手 sid」を追いかけるのは現実的でない。

加えて、**alive な claude がゼロ**のタイミング (= 別タスクに離席、夜間 idle 等) に送られた msg は、現在の sid 宛モデルでは「死んだ sid 宛の inbox」に滞留して誰も拾わない。

実観測:

- 2026-06-16 練習セッションで `cmux-msg peers --all` を打つと `kawaz/hyoui/main` cwd の alive peer が 2 件、`exp1781575967-1..5` のような実験バッチ系の hyoui session が default namespace に 10+ 並ぶ。どれが「本物の hyoui 開発担当」か特定不能 (= label の必要性、kawaz/hyoui の `2026-06-16-feature-session-labels.md` 起票根拠)。
- 同様の問題が「誰に送ればいい？」の場面でも発生。sid を特定できないなら **"hyoui プロジェクトの誰か" に送って alive な claude が拾う** semantics が要る。

## 決定

### 1. 識別子モデル: sid 主体は維持、cwd / repo / tag の永続軸を**並列 primitive** として追加

DR-0004 の「sid 主体」を覆さない。sid 宛は依然として「特定セッション宛 (= 個人宛、文脈共有済の人宛)」。
cwd / repo / tag 宛は「**役割宛 (= プロジェクトに住んでる誰か宛)**」として並列に動作。

| 宛先軸 | 意図 | 揮発性 | 用途例 |
|---|---|---|---|
| sid 宛 (既存) | 特定の "個体" 宛 | 揮発 (新陳代謝で死ぬ) | 「文脈共有済のあの話」 |
| cwd 宛 (新規) | "プロジェクトに住んでる誰か" 宛 | 永続 (新 sid が引き継ぐ) | 「hyoui プロジェクト宛」 |
| repo 宛 (新規) | "リポジトリ全体の誰か" 宛 | 永続 (worktree 横断) | 「hyoui repo 何処かの作業者」 |
| tag 宛 (新規) | "ラベル付き役割" 宛 | 永続 (任意ラベル) | 「ccmsg-maintainer label 持ち」 |

### 2. 物理構造

```
<base>/
  <sid>/                          # 既存 (sid 宛)
    inbox/                        # 個人宛
    accepted/ sent/ tmp/ meta.json
  by-cwd/<cwd-hash>/              # 新規 (cwd 宛)
    inbox/                        # 役割宛、共有 box (queue 的)
    accepted/                     # 引き取り後ログ
    meta.json                     # last_consumer_sid 等
  by-repo/<repo-hash>/            # 新規 (repo 宛)
    inbox/ accepted/ meta.json
  by-tag/<tag-name>/              # 新規 (tag 宛)
    inbox/ accepted/ meta.json
```

`cwd-hash` / `repo-hash` は **正規化済パスの SHA-256 prefix (16 char)**。正規化は:

- `path.resolve` で絶対パスに
- シンボリックリンク追従 (`fs.realpathSync`)
- 末尾 `/` を剥がす

worktree は別 cwd として別 box (kawaz の `git-workflow.md` 運用と整合)。同 repo 別 worktree は `by-repo/` で合流する。

`tag-name` は ASCII 安全な文字列 (識別子と同じ制約 = `[a-zA-Z0-9_:-]+`)。kawaz が hyoui に要望した label と概念合流させ、本リポ内では「tag」呼称で統一。

### 3. 受信モデル: subscribe が複数 inbox を watch + ln atomic で取得者勝ち

各 claude の subscribe は以下を並列で watch:

1. `<base>/<my_sid>/inbox/` (sid 宛、個人専用)
2. `<base>/by-cwd/<my_cwd_hash>/inbox/` (cwd 宛、共有)
3. `<base>/by-repo/<my_repo_hash>/inbox/` (repo 宛、共有)
4. `<base>/by-tag/<tag>/inbox/` × 自分が持つ tag の数 (共有)

sid 宛は専用 box なので競合なし、即消化。
共有 box (cwd / repo / tag 宛) は **複数 alive claude が同じ box を見ている可能性**があるため、**hard link atomic で取得者勝ち**:

```
1. watcher event: by-cwd/<hash>/inbox/msg-XXX.md が出現
2. ln by-cwd/<hash>/inbox/msg-XXX.md <my_sid>/inbox/msg-XXX.md  # atomic
3a. 成功 (= 自分が取った): subscribe に流す + by-cwd/<hash>/accepted/ へ rename (履歴用)
3b. 失敗 (EEXIST): 他の claude が先に取った、skip
```

`ln` は POSIX atomic、複数 watcher が同時発火しても 1 つだけが成功する。
acceped/ に moved した時点で次の watcher event はトリガされないので二重消化なし。

### 4. 送信モデル

```bash
# sid 宛 (既存)
ccmsg send <sid> < msg.md

# cwd 宛 (新規)
ccmsg send --cwd <path> < msg.md          # path を正規化して by-cwd/<hash>/inbox/ に書く
ccmsg send --cwd .                        # 現在の cwd

# repo 宛 (新規)
ccmsg send --repo <repo-root> < msg.md    # git common-dir を正規化

# tag 宛 (新規)
ccmsg send --tag ccmsg-maintainer < msg.md
```

宛先指定の排他: `<sid>` / `--cwd` / `--repo` / `--tag` のいずれか **1 つ**を指定 (= 1 通 1 宛先)。`--text` は別 axis (本文指定、DR-0014)。

### 5. broadcast との分離

| primitive | 配信先 | 永続性 | semantics |
|---|---|---|---|
| **broadcast** (既存) | 現時点で alive な peer 全員 (= fan-out) | 揮発 (現在の alive 集合への一回切り) | 「告知」「一斉通達」 |
| **cwd / repo / tag 宛 send** (新規) | 共有 box に 1 通 → alive な誰か 1 人が消化 | 永続 (alive ゼロでも未来の claude が拾う) | 「役割宛キュー」「誰か 1 人やって」 |

両者は別 primitive。broadcast を cwd / repo / tag 宛と混同しない (= broadcast は queue semantics ではない)。

### 6. cross-home 境界 (DR-0005 補強)

- cwd / repo / tag 宛も home 壁の対象 (= `--ignore-cross-home` 不在時は別 home の宛先送信を warning)
- `~/.local/share/ccmsg/by-cwd/` は home ローカルなので構造的に他 home と分離されている
- `--all-homes` (broadcast の `--all` 相当) を cwd / repo / tag 宛 send に提供するかは別議論 (= 通常はホーム壁内で完結する想定、不採用)

### 7. peers / history の表示

- `peers --by cwd` は alive な peer を cwd でグルーピング (既存)
- `history` は sid / cwd / repo / tag のどの inbox を経由した msg かを表示 (= 既存 history の path 表示に軸を加える)

### 8. meta.json の cwd / repo / tag 反映

SessionStart hook が meta.json に書く情報:

- `cwd` (既存) → cwd-hash を導出
- `repo` (既存 = `git rev-parse --git-common-dir`) → repo-hash を導出
- `tags` (既存 `CMUXMSG_TAGS=<csv>` から) → tag-name 群を導出
- `<base>/by-cwd/<hash>/meta.json` には逆引き (= どの sid 群が今 alive か) を**書かない**: ファイル更新の race を避けるため、必要なら subscribe 起動時に動的に解決

## 不採用

- **sid 宛箱の引き継ぎ (= 新 sid が古い sid の inbox を吸収)**: 「特定の個人宛」セマンティクスを壊す。新 sid は別人とみなすのが筋。sid 宛揮発性の解は cwd / repo / tag 宛で持つ。
- **broadcast を queue semantics に変える**: 既存の「fan-out 告知」用途と矛盾する。別 primitive として並べる。
- **agmsg 風の (team, agent_name) ペアモデル**: human-friendly だが、本リポは sid 主体 (DR-0004) を維持。tag 軸が「役割名」相当を担う。
- **共有 box から `mv` で取得 (= rename atomic)**: `mv` は同一 filesystem なら atomic だが、subscribe の watch 対象から `mv` で消えた場合に `IN_MOVED_FROM` / `rename` event の意味が複雑化する。`ln` で「コピーを取って取得者勝ちを判定」する方が semantic がシンプル。
- **共有 box への重複配送 (= alive 全員の sid 宛に複製)**: 「誰か 1 人がやればよい」semantics が壊れる、全員が同じ作業を走らせるリスク。queue 的に「取った者勝ち」が筋。

## 影響範囲

### 新規ファイル / ディレクトリ

- `<base>/by-cwd/<cwd-hash>/{inbox,accepted}/`
- `<base>/by-repo/<repo-hash>/{inbox,accepted}/`
- `<base>/by-tag/<tag-name>/{inbox,accepted}/`

### コード

- `src/lib/paths.ts`: `byCwdInbox(cwdHash)` / `byRepoInbox(repoHash)` / `byTagInbox(tagName)` ヘルパ
- `src/lib/cwd-hash.ts` 新規: cwd / repo の正規化 + SHA-256 prefix
- `src/commands/send.ts`: `--cwd` / `--repo` / `--tag` flag 追加 (排他、`<sid>` positional との同時指定エラー)
- `src/commands/subscribe.ts`: 複数 inbox を並列 watch、ln atomic で取得者勝ち
- `src/lib/subscribe.ts`: 共有 box からの「取得試行 → 成功した分だけ emit」ロジック
- `src/lib/inbox.ts` / `src/lib/message.ts`: 受信箱の種類 (sid / cwd / repo / tag) を msg メタに記録

### Hook

- `src/hooks/session-start.ts`: cwd / repo / tag を解決して meta.json に書く (既存) + `<base>/by-cwd/<hash>/` 等のディレクトリを初期化

### tests

- `cwd-hash` の正規化テスト (symlink / 末尾 / 相対パス)
- `ln` atomic 取得テスト (並行 watcher で 1 つだけ成功)
- 共有 box の subscribe 統合テスト

## 段階的移行

1. **DR-0015 単独 PR**: 物理構造 + paths.ts ヘルパ + cwd-hash 正規化 + tests
2. **send `--cwd` / `--repo` / `--tag` 実装**: 新コマンドフラグ、エラー処理
3. **subscribe の共有 box watch + ln atomic 取得**: DR-0012 (event-driven) の上に乗せる
4. **history / peers 表示更新**: 受信元 inbox の種類を表示
5. **1.0.0 bump 群に統合**: DR-0009 〜 DR-0014 と同じ breaking タイミング

## 関連

- DR-0004 (sid 主体): 維持。本 DR は **並列軸を追加** するのであって主体を覆さない
- DR-0005 (home 壁): 維持、cwd / repo / tag 宛も home 壁の対象
- DR-0012 (event-driven subscribe): 本 DR の subscribe 拡張が DR-0012 の watcher 基盤上に乗る
- DR-0014 (本文 stdin 標準化): 同 commit 系列で land、`--cwd` / `--repo` / `--tag` と `--text` を直交軸として整理
- agmsg の (team, agent_name) 概念とは tag 軸で部分的に合流するが、本リポは sid 主体 + 永続軸の並列モデルを維持
- hyoui DR-0018 (namespace) / hyoui label 要望: tag 軸の運用と概念的に並行 (= 各システムが「役割マーキング」を持つ動き)
