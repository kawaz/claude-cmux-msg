# DR: 識別子を claude session UUID に一本化

**日付**: 2026-04-23
**関連バージョン**: 0.4.0 (破壊的変更)
**直前バージョン**: 0.3.x 系（CMUX_SURFACE_ID ベース）

## 決定

cmux-msg の通信単位を **claude session UUID**（`claude --session-id <uuid>` で採番）に
変更した。`CMUX_SURFACE_ID`（cmux 由来のペイン UUID）は使わない。

## 背景

0.3.x 以前は `CMUX_SURFACE_ID` を全コマンドの識別子として使っていた。これは
cmux がペイン単位に採番する UUID で、SessionStart hook 時点で env に入っている
ため「すぐ使える」という理由で選ばれていた。

ただし以下の不整合があった:

1. **概念の単位が違う**
   - cmux surface = **ペイン** (bash / vim / claude が同居し得る)
   - claude session = **会話** (resume で同じ ID 復活、同ペインで連続起動すると別 ID)
   - cmux-msg の通信単位は「会話」のはずで、ペイン単位で扱うのは抽象度がズレる

2. **spawn の race condition**
   - 親が `cmux new-split` → ペイン作成 → surface UUID が確定
   - 親が子 claude を起動 → 子の SessionStart hook が走る → hook が
     `surface-refs.json` に `<uuid> → surface:N` を書き込む
   - 親は子の起動を待ってから `findUuidByRef` で逆引き、UUID 未書き込みの瞬間に
     読むと「UUID 未確定」になるため、`spawn.ts` に「稀なケース」のフォールバック
     パスが必要だった
   - これは race の痕跡

3. **同ペイン連続起動の誤配送**
   - ユーザが `Ctrl+C Ctrl+C → claude` を同じペインで繰り返すと、2 つ目の claude
     が 1 つ目と同じ CMUX_SURFACE_ID を持つ
   - 結果、1 つ目向けだった inbox に 2 つ目がアクセスしてしまう

## 変更内容

### 識別子

- **session_id**: `claude --session-id <uuid>` で採番される UUID v4。cmux-msg の全
  通信単位 (inbox ディレクトリ、signal 名、frontmatter の from/to) に使用
- **surface_ref** (`surface:N`): cmux 画面操作 (tell / screen / stop) 用の内部参照
  のみ。ユーザ I/F には出さない

### spawn フロー

```
親:
1. crypto.randomUUID() で子の session_id を先行生成
2. cmux new-split でペイン作成 → surface_ref 取得
3. `claude --session-id <生成UUID> ...` で起動
   env: CMUXMSG_PARENT_SESSION_ID, CMUXMSG_WORKER_NAME, CMUXMSG_SURFACE_REF
4. ✨ 子の起動完了を待たず、生成した UUID をそのまま `id=<uuid>` として return
   （逆引き polling なし、race なし）

子（SessionStart hook）:
1. hook input JSON の session_id を読む（親が生成した UUID と一致）
2. process.env.CMUXMSG_SESSION_ID を設定
3. <ws>/<session_id>/ に init + meta.json 書き出し
4. CLAUDE_ENV_FILE に `export CMUXMSG_SESSION_ID=<session_id>` を追記
   → 以降の子シェルで env 経由で取れる
```

### peer の surface_ref 解決

tell / screen / stop では相手ペインの surface_ref が要る。0.3.x 以前は共有
`surface-refs.json` に全ピアの `<uuid> → surface:N` をマップしていた。

0.4.0 ではこれを廃止し、**各セッションが自分の meta.json に自分の surface_ref を
書く** 方式に変更。

```
~/.local/share/cmux-messages/
  <workspace_id>/
    <session_id>/
      meta.json    # { session_id, surface_ref, worker_name?, parent_session_id? }
      inbox/ accepted/ archive/ tmp/ pid
```

他セッションの surface_ref が必要なら peer の meta.json を直接読む
(`resolvePeerSurfaceRef`)。

## 検討した代替案

### 代替 A: surface-refs.json を session_id 版で維持

共有マップファイルを `session-refs.json` に改名して同じ構造で維持する案。

**不採用**:
- 書き込み競合の防止が必要（現行は tmp + rename で atomic にしていたが、
  共有ファイルは単一障害点）
- 情報が二重管理（meta.json にも同じ surface_ref がある）
- 各セッションが自己情報を自分のディレクトリに置くほうが分散的で単純

### 代替 B: session_id とは別に独自 UUID を採番して claude とは無関係に管理

**不採用**:
- 識別子が 2 つになり、resume 時の対応付けが破綻する
  (`claude --resume <session_id>` で session は戻るが独自 UUID は別管理)
- `--session-id` を claude に渡せる以上、それを共通キーにするほうが単純

### 代替 C: 0.3.x 互換のための移行レイヤーを残す

**不採用**:
- ユーザが 1 人で、0.3.x 以前のメッセージデータを保持する必要がない
- 互換レイヤーはコード上のノイズになり、次の設計判断を鈍らせる

## トレードオフ

### 得たもの

- spawn の race condition 解消（逆引き polling 削除）
- 意味論的整合（通信単位 = 会話単位）
- 同ペイン連続起動の誤配送解消
- resume 時に同じ inbox に戻れる（別ペインで `--resume` しても OK）

### 失ったもの

- 0.3.x 以前のメッセージデータとの互換性（捨てる前提で OK）
- `CMUX_SURFACE_ID` だけあれば動く簡便さ（今は SessionStart hook 経由で
  CMUXMSG_SESSION_ID を CLAUDE_ENV_FILE に export する 1 段経由が必要）

## 実装上の注意

- SessionStart hook が `CMUXMSG_SESSION_ID` を export する前のシェル
  （hook 自体の子プロセス）は env を参照できない。hook 自体が init を呼ぶため
  `process.env.CMUXMSG_SESSION_ID = sessionId` を hook 内で手動設定してから
  `initWorkspace` を呼ぶ
- `claude --session-id <uuid>` は UUID v4 フォーマットを要求する。
  `crypto.randomUUID()` は小文字の v4 を返すのでそのまま使える
- resume (`claude --resume <session_id>` または `-c` 等) でも session_id は
  維持される → 同じ inbox に戻れる（検証済み: hook input の session_id が
  resume 前と同一）

## 補遺: 0.6.0 で env 伝播から file lookup に切替

0.5.x までは「SessionStart hook が `$CLAUDE_ENV_FILE` に
`export CMUXMSG_SESSION_ID=<uuid>` を追記し、以降の Bash ツールがそれを継承する」
設計だったが、実機検証で **そもそも Bash ツールに env が反映されない** ことが判明。

調査結果:
- claude-code Issue #15840 で「SessionStart hook の `CLAUDE_ENV_FILE` が空文字で
  渡される」と既知バグ報告されており、しかも **「not planned」でクローズ** されていた
- つまり SessionStart からの env 伝播は claude-code 側で動かない仕様

代替: **surface_id → session_id の lookup file** を `<ws>/by-surface/<surface_id>` に
書き、cmux-msg コマンドは `CMUX_SURFACE_ID` (cmux 本体が必ず設定する) を起点に
file lookup で session_id を解決する。

```
解決順序:
1. env CMUXMSG_SESSION_ID (将来 Issue #15840 が直った場合 / 手動設定用)
2. by-surface/<CMUX_SURFACE_ID> ファイル lookup (現状の主経路)
3. なし → エラー
```

得失:
- (+) claude-code 側のバグに依存しない
- (+) resume / 別 Bash ツール呼び出しで env が消えても動く
- (−) 同じ surface で claude を 2 つ同時起動すると by-surface index が後勝ちで上書き
  される（実用上稀。spawn は別 surface を作るので発生しない）
