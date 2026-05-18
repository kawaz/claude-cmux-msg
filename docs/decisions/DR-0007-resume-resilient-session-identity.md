# DR-0007: resume 耐性のあるセッション同定 (tty を不変の鍵にした tell 安全境界)

- Status: Accepted
- Date: 2026-05-17 (改訂: 2026-05-18 マルチペルソナレビュー 2 巡 + codex レビュー + 実機検証を反映、同日 Accepted)
- Supersedes: [DR-0006](DR-0006-fg-detection-claude-pid.md) (fg 判定方式を全面的に置き換え)
- Refines: [DR-0004](DR-0004-session-as-primary-key.md) (§7 fg/bg 判定 / §5 tell・screen の安全境界)
- Related: [DR-0005](DR-0005-claude-home-default-wall.md) (cross-home 方針), docs/issue/2026-05-17-process-info-tool.md, docs/issue/2026-05-17-spawn-cleanup-design.md
- Evidence: docs/findings/2026-05-18-session-identity-evidence.md

## 用語: tell と send の違い

- **`tell <sid> <text>`**: 対象セッションの cmux surface (ターミナルペイン) に
  **キー入力として `<text>` + Return を流し込む**操作。ユーザのキー入力の
  エミュレーション。受け手が claude なら指示プロンプト、シェルならコマンドと
  して実行される。`/exit` 等のスラッシュコマンドは tell でしか送れない。
- **`send <sid> <text>`**: inbox にメッセージファイルを永続配送するエージェント
  間コミュニケーション。tell の代替ではない (スラッシュコマンドや tty 操作は
  send では効かない)。

本 DR は `tell` (および画面読み取りの `screen`) の安全確認方式を定義する。
誤った相手にキー入力を注入すると、別 claude への誤指示や、シェルへの危険
コマンド流し込みが起きるため。

## 背景

DR-0006 で fg 判定対象を `CMUX_CLAUDE_PID` 起点に切り替え claude 本体 pid を
`meta.json` に固定記録する方式にした。その後の調査・マルチペルソナレビュー
(2 巡) ・codex レビュー・実機検証で複数の欠陥が判明した。

1. **`CMUX_CLAUDE_PID` は spawn 子に無い**。cmux は自分が起動した claude にのみ
   この env を渡す。spawn は cmux pane のシェルへ `claude` コマンドを手動送信
   する方式なので env が設定されない。
2. **pid 固定記録は resume で陳腐化する**。claude は cmux/OS 更新やクラッシュで
   終了し別 pid で再開される。
3. **surface と sid は 1対n、かつ sid は surface/workspace を移動する**。DR-0004
   line 22 が既に「sid が ws を移動する (resume で別 surface 等)、surface→sid の
   逆引きは時間依存で当てにならない」と記録している。`meta.json` に固定記録した
   `surface_ref` は移動で陳腐化する。**pid に対して「固定記録を真実源にしない」
   とした論理を `surface_ref` にも適用しなければならない**。
4. **`+` (STAT の foreground フラグ) は controlling tty 非依存**。別 surface
   (別 tty) の claude も各々 `+` を持つ。`+` 単独では「tell 先 surface の前面が
   対象 claude」を保証しない。

## 実験とエビデンス

詳細は docs/findings/2026-05-18-session-identity-evidence.md。要点:

- 全 claude プロセスが argv に `--session-id <UUID>` を持つ (cmux 起動・spawn
  経由問わず)。`ps -axww` のコマンドライン照合で sid→PID が一意に引ける。
- `ps -axww` は argv を切り詰めない (1545 文字を完全出力)。argv 切り詰め懸念は
  反証された。
- `+` ⟺ `PGID == TPGID`。
- claude は 1 プロセス = 1 controlling tty。cmux surface も固有 tty を持つ
  (`cmux tree` の `tty=`)。**claude の controlling tty (`ps -o tty`) を鍵に
  surface を逆引きできる**。
- subscribe (Monitor 起動) は親 claude の子孫プロセスツリーに居る (反証された
  double-fork 懸念。ただし harness 実装依存である点は前提として残す)。
- bg/fg 検出 hook は Claude Code に存在しない。

## 設計の核心: tty を不変の鍵にする

`tell` の安全性は「対象 sid の claude が、いま tell 先の surface の前面に居る」
ことの確認に尽きる。これを **claude の controlling tty を不変の鍵**にして組む。

claude プロセスの controlling tty (pty) は、プロセスが生きている限り不変。cmux
が surface を別 pane / 別 workspace へ移動しても、その surface が抱える pty は
維持される。よって:

```
sid → ps 照合で claude プロセス → claude の controlling tty (ps -o tty)
    → その tty を抱える cmux surface (cmux に動的に逆引き)
```

このチェーンで送り先 surface を**毎回動的に決める**。`meta.json` の固定記録
`surface_ref` は使わない (sid 移動で陳腐化するため)。tty から claude と surface
の両方を引くので「送り先 surface == 対象 claude の居る surface」は定義上保証
され、別途の突合照合が不要になる。

## 決定

### 1. sid→claude プロセスは `ps` のコマンドライン 2 条件照合で引く

`ps -axww -o pid,ppid,pgid,tpgid,stat,tty,lstart,command` の各行に対し、以下を
**独立に AND** 判定:

- argv[0] (パス) の末尾要素が `claude`
- argv に `--session-id` または `--resume` フラグがあり、その**直後トークン**が
  対象 UUID である (フラグの引数値であること)

**ヒット数はマッチした「プロセス (行) 数」で数える** (1 行内に `--session-id` と
`--resume` が両方出ても 1 プロセス 1 ヒット)。`ps command` は argv 境界を保持
しない表示文字列なので「直後トークン」判定はベストエフォートだが、正規の cmux/
spawn 起動の argv は固定形で `--settings` JSON 内に `--session-id` 文字列を含ま
ないことを実機確認済み。曖昧さは決定5 の「ヒット数ちょうど 1」要件と fail-closed
で吸収する。

### 2. tell 先 surface は claude の tty から動的に逆引きする

1. 決定1 で対象 sid の claude プロセスと、その `tty` / `pgid` / `tpgid` / `stat`
   を得る
2. claude の `tty` を抱える cmux surface を cmux に問い合わせて引く
   (`cmux tree` の `tty=` 等)
3. その surface を tell / screen の送り先とする

`meta.json` の `surface_ref` は送り先解決に**使わない**。`surface_ref` フィールド
は spawn 子への初期値受け渡し (env `CMUXMSG_SURFACE_REF`) の用途にとどめ、参考
情報に降格する。

### 3. fg 判定は claude の `pgid == tpgid`

決定1 で得た claude の `pgid == tpgid` なら、その claude は自分の controlling
tty の foreground process group に居る。決定2 で surface を claude の tty から
引いているので「対象 claude が tell 先 surface の前面に居る」が成立する。
`+` フラグ単独では判定しない (controlling tty 非依存のため)。

### 4. STAT による状態判定

決定1 で得た `stat` の 1 文字目と修飾フラグを独立に見る:

- `T` を含む → suspended (Ctrl-Z 等)、tell 拒否
- 1 文字目 `Z` → ゾンビ、dead 扱い
- 1 文字目 `U` / `D` → uninterruptible sleep、応答不能の可能性、tell 拒否

### 5. tell / screen の安全境界 (DR-0004 §5 を Refine)

DR-0004 §5 は `tell` に `state=idle` 必須、`screen` に state 制約なしを定めて
いた。本 DR はこれを次に**改める** (Refine):

**`tell` の許可条件** (全て満たすこと):

- 決定1 の sid 照合が**ちょうど 1 件** (プロセス数)
- 決定2 で送り先 cmux surface が引けた
- 決定3 の fg 条件 (`pgid==tpgid`) を満たす
- 決定4 で suspended / zombie / 応答不能でない
- `meta.state` が `idle` (DR-0004 は `idle` のみ。`awaiting_permission` は
  **含めない** — パーミッションプロンプト表示中に tell するとテキスト先頭が
  許可選択として消費される危険があるため。DR-0006 改訂前案の
  `awaiting_permission` 許可は撤回する)
- `<text>` に改行・制御文字を含まない (含む場合は複数コマンドの即時実行に
  なるため拒否。1 行のみ許可)

**`screen` の許可条件**: 決定2 で surface が引け、決定3〜4 で fg かつ非
suspended/zombie であること。**`state` は問わない** (画面読み取りは running 中
こそ有用なため。DR-0004 §5 の「screen は state 制約なし」を維持)。

満たさない場合は**拒否理由を区別して返す**:

| 理由コード | 状況 |
|---|---|
| `not_found` | sid 照合 0 件 (プロセス不在 / dead) |
| `cross_home` | 対象が別 claude_home。meta が別 base で読めず state 不明 (下記 決定9) |
| `ambiguous_concurrent_resume` | 照合 2 件以上、並行 resume 起因 (lstart 差で判別) |
| `ambiguous_unexpected` | 照合 2 件以上、想定外 (誤マッチ疑い、改修検討対象) |
| `no_cmux_surface` | claude の tty に対応する cmux surface が無い (tmux 入れ子 / SSH 越し / ヘッドレス pty 等) |
| `background` | `pgid≠tpgid` |
| `suspended` / `dead` / `unresponsive` | STAT 判定 (決定4) |
| `busy` | `state` が `idle` でない (tell のみ) |
| `check_failed` | `ps` / cmux 問い合わせの失敗 (下記 決定8) |

`ambiguous_*` は衝突した pid 群と各 lstart を併記し、運用者が「どちらが新しいか /
古い方を kill する」と判断できる情報を返す。`ambiguous_unexpected` のみ改修検討
を促す (並行 resume はユーザ操作の正常結果なので改修提案を出さない)。

### 6. TOCTOU 残存リスクと緩和

決定1〜5 の照合と実際の `cmuxSend`+`Return` の間には時間窓があり、その間に対象が
Ctrl-Z / 終了 / resume 入れ替わりしうる。`tell` がキー入力注入である以上、
照合を精密化しても**ゼロにできない構造的窓**である。

最悪ケース: 再照合通過直後に対象 claude が Ctrl-Z され、同 surface のシェルが
前面に出た瞬間に `<text>` がシェルコマンドとして実行される。決定5 の「改行を
含まない 1 行のみ」制約により、最悪でも 1 コマンドの誤実行に被害を限定する。

緩和:

- **send 直前に再照合**する。初回照合で pid が確定済みなので、再照合は
  `ps -p <pid> -o pgid,tpgid,tty,stat,lstart` の pid 指定照会 (argv パース不要、
  軽量・確実) + lstart 一致で「同一プロセスが条件を保ち続けている」ことを確認
- **再照合が `check_failed` になったら送信中止** (fail-closed)。初回が通って
  いても、再照合で `ps` が失敗したら送らない
- 残る窓は既知リスクとして本 DR に明記。根本解決は cmux 側の atomic 送信 API
  (「surface の fg pgrp が pid X のときだけ paste」) であり、別 issue で要望する

dogfood (個人マシン・単一ユーザ) の脅威モデルでは最小化された窓を許容する。

### 7. `last_observed_pid` は連続性検出専用、`(pid, start_time)` ペアで記録

`meta.json` に `last_observed_pid` を `(pid, start_time)` ペアで記録する
(DR-0006 の `claude_pid` を改名・構造変更)。

- 用途は**プロセス連続性の検出のみ**。tell の許可判定 (決定5) には一切使わない。
  許可判定の真実源は決定1〜3 の `ps` + cmux 動的照合
- pid 単独は OS の pid 再利用で誤判定するため起動時刻とのペアで持つ
- 更新は `src/lib/state.ts` の `transitionState()` に統合。全 state hook が meta
  を書くたびに更新される
- 書き込み側 (hook) は自分の sid (hook input JSON の `session_id`) で `ps` を
  sid 照合し、自分の claude pid を得る (ppid 遡りは使わない)

### 8. `ps` / cmux 問い合わせ失敗は fail-closed

`ps` の異常終了・タイムアウト・パース失敗、および決定2 の cmux への
tty→surface 逆引きの失敗・タイムアウトは、すべて判定不能 (`check_failed`) と
して **tell を拒否**する。「0 行 / 空応答」を「dead」と同一視しない。

`ps` のタイムアウトは 5 秒、リトライ 1 回を初期値とする。`check_failed` が短時間
に連続 N 回 (初期値 3) 続いたら、ユーザへ「fg 判定系が継続的に失敗している」
旨を明示エスカレーションする (慢性故障で全 tell が無言で死ぬのを防ぐ)。

### 9. cross-home の扱い (DR-0005 に従う)

対象 sid が別 claude_home の場合、その `meta.json` は別 base ディレクトリに
あり `readMetaBySid` で読めない。これを `not_found` に丸めず `cross_home` として
区別する。

DR-0005 は cross-home を **warning とし block しない**方針。tell もこれに従う:

- 新設計では tell の中核 (決定1〜4: claude 特定・tty・surface 逆引き・fg) は
  `ps` + cmux のみで成立し、対象の `meta.json` を読まずに動く。よって cross-home
  でも tell の動線自体は通る
- ただし `state` (決定5 の `idle` チェック) は対象 meta から読むため cross-home
  では取得できず state 不明になる
- cross-home の tell は **warning を出した上で、`--ignore-cross-home` フラグで
  明示的に続行**できる (state 不明のリスクを承知の上)。`--force` は意図が曖昧
  なため採らない (tell.ts 既存コメントの「`--force` は設けない」方針とも整合)

### 10. subscribe (Monitor) の resume 再起動チェック

SessionStart hook が「決定1 で引いた自分の claude PID の子孫プロセスツリーに
`subscribe` プロセスが居るか」を `ps` で確認し、`source` と実検出を組み合わせて
AI に文言を出す:

| source | subscribe 実検出 | hook の文言 |
|---|---|---|
| `startup` | 無 | 「subscribe を Monitor で起動して」 |
| `resume` | 無 (claude 入れ替わりで死亡) | 「⚠️ subscribe は停止。必ず張り直して」 |
| `clear`/`compact` | 有 (claude 継続で生存) | 「subscribe 稼働中、再起動不要」 |
| 任意 | 実検出が表と食い違う | 実検出を優先 |

subscribe が claude の子孫ツリーに居ることは実機確認済みだが、これは claude
harness のプロセス起動モデルに依存する。harness が将来 setsid / double-fork で
デタッチする実装に変えればこの前提は崩れる (前提として注記)。

### 11. プロセス情報取得を 1 関数に集約

「sid → プロセス情報」を 1 関数に閉じ込め、`stat` のパース (決定3〜4) も関数内で
行い**正規化済みフィールド**を返す。`stat` 生文字列を呼び出し側に撒かない。

```
type SidProcessLookup =
  | { kind: "found"; pid: number; tty: string; pgid: number; tpgid: number;
      startTime: string; isForeground: boolean;
      runState: "running" | "suspended" | "zombie" | "unresponsive" }
  | { kind: "not_found" }
  | { kind: "ambiguous"; procs: { pid: number; startTime: string }[] }
  | { kind: "check_failed"; error: string };
```

当面 `ps -axww` 実装で十分 (実機で argv 切り詰めが起きないことを確認済み)。
将来 process-info-tool (issue 起票済み) へ差し替え可能な構造にしておくが優先度
は低い。

## 並行 resume / meta 競合の扱い

- 同一 sid に `claude --resume` を別 surface で複数回行うと、一時的に同一 sid の
  claude が複数存在しうる (稀なユーザ操作)。決定1 の照合が複数件 → 決定5 で
  `ambiguous_concurrent_resume` 拒否。これは**恒久的な安全弁**であり「収束を待つ
  戦略」ではない。両方が生き続ける場合、その sid は片方を手動 kill するまで tell
  不能になる。拒否時に衝突 pid + lstart を提示して回復を促す (決定5)。
- `src/lib/state.ts` の `updateMeta` は tmp+rename で個々の書き込みは atomic だが
  read-modify-write 競合は守らない。並行 resume で複数 hook が同一 meta を更新
  すると、`state` だけでなく `surface_ref` 等**全フィールドが lost-update し
  うる**。本 DR の設計では tell の安全性は `ps` + cmux の動的照合 (決定1〜3) が
  真実源で、`meta.json` の固定記録 (`surface_ref` 含む) を送り先解決に使わない
  ため、meta 競合の影響は「`state` 由来の `busy` 判定の取りこぼし」程度に限定
  される。厳密な排他 (flock) は別 issue 候補。

## 観測性

`tell` / `screen` の拒否イベント (タイムスタンプ・対象 sid・理由コード・関連
pid) をログに記録する。`ambiguous_*` / `check_failed` の発生頻度を後から追える
ようにし、「並行 resume は稀」「`check_failed` は散発」という前提が実態と合って
いるかを検証可能にする。

## 制約 (現バージョンで対象外)

- **tmux / screen 入れ子、SSH 越しの claude**: controlling tty が cmux surface
  の tty でなく入れ子端末の pty になり、決定2 の tty→surface 逆引きで cmux
  surface が見つからない (`no_cmux_surface`)。これらの claude は tell 対象外と
  する。事故にはならない (安全側に拒否) が機能制約。
- **ヘッドレス pty 起動**: 「pty を与えて `xxx -- cmd args` でヘッドレス化する
  コマンド」が別途検討されている。この場合 claude は pty を持つが cmux surface
  に紐づかない。`no_cmux_surface` を専用理由コードとして分けておくことで、将来
  ヘッドレス claude への代替送信経路を設計する余地を残す。

## 代替案と不採用理由

- **bg/fg hook で `state` 能動更新**: hook 不在 (実機確認)、不可能。
- **`+` フラグ単独で fg 判定 (DR-0006)**: controlling tty 非依存で別 surface の
  claude を誤判定。
- **`meta.json` の `surface_ref` 固定記録で送り先を決める**: sid の surface
  移動で陳腐化 (DR-0004 line 22 が既に「surface↔sid は時間依存」と記録)。tty を
  鍵にした動的逆引きに置き換える。
- **pid を完全廃止し sid 照合のみ**: resume のプロセス入れ替わりの連続性検出が
  できない。`last_observed_pid` を補助情報として残す。
- **`CMUX_CLAUDE_PID` 単独 (DR-0006)**: spawn 子に env が無い。
- **`process.ppid` 遡りで hook が自分の claude を特定**: シェルの exec 最適化
  依存で不安定。hook は自分の sid を知っているので sid 照合で代替。
- **cross-home で `send` に誘導**: tell (tty 入力) と send (メッセージ配送) は
  性質が異なり send は代替にならない。`--ignore-cross-home` で tell 続行に誘導。

## 互換性

- `meta.json` の `claude_pid` (DR-0006) を `last_observed_pid` に改名し
  `(pid, start_time)` ペア構造にする。tell.ts / screen.ts は判定に meta の pid を
  使わなくなる (決定5 は `ps`+cmux 照合のみ) ので旧 `claude_pid` / `shell_pid` は
  読み捨てる。
- `surface_ref` フィールドは残すが送り先解決には使わない (参考情報)。
- DR-0006 の fg 修正 (0.28.1 で push 済み) は本 DR の方式へ作り直す。
- kawaz の dogfood 範囲なので破壊的変更は許容。

## 影響範囲

- `src/lib/`: 「sid → プロセス情報」を引く新関数 (決定1・11)、claude の tty →
  cmux surface を逆引きする新関数 (決定2)
- `src/lib/peer-refs.ts`: `resolvePeerSurfaceRef` を「meta の surface_ref を読む」
  から「tty 逆引き」に作り直す
- `src/commands/tell.ts` / `screen.ts`: 安全境界を決定2〜9 に置換、send 直前
  再照合 (決定6)、拒否理由の区別、`--ignore-cross-home` フラグ追加 (tell)
- `src/commands/stop.ts`: `resolvePeerSurfaceRef` 経由なので tty 逆引きに追従
- `src/lib/state.ts`: `transitionState()` に `last_observed_pid` 更新を統合
- `src/commands/init.ts` / `src/types.ts`: `claude_pid` → `last_observed_pid`
- `src/hooks/session-start.ts`: subscribe 生存チェックと source 別文言 (決定10)
- `src/lib/peer.ts`: alive 判定を `ps` 照合へ寄せる
- 拒否イベントのログ出力経路

## 未解決 / 別 issue

- **cmux への atomic 送信 API 要望** (決定6): TOCTOU 窓の根本解決。別 issue 起票。
- **`updateMeta` の flock 排他**: 並行 resume の lost-update 厳密対策。優先度低
  (真実源が `ps`+cmux のため影響限定的)。
- **ヘッドレス pty claude への送信経路** (制約節): `no_cmux_surface` の claude
  への代替送信。ヘッドレス化コマンドの設計と合わせて将来検討。
- spawn signal タイムアウト (hook 内同期ビルド) は本 DR と独立。`bin` を廃止し
  bun 実行に一本化する方針で別途対応。

## 関連

- DR-0006: 本 DR が supersede
- DR-0005: cross-home 方針 (warning / 非 block)
- DR-0004 §5 §7 / line 22: tell・screen の安全境界、sid の surface 移動
- docs/findings/2026-05-18-session-identity-evidence.md: 実機検証エビデンス
- docs/issue/2026-05-17-process-info-tool.md: ps の堅牢化 (将来差し替え)
- docs/journal/2026-05-17-*.md, 2026-05-18-*.md: 実験とレビューの記録
