# DR-0008: cmux 依存境界の分離 (messaging は session_id のみ、surface 操作のみ cmux 必須)

- Status: Accepted
- Date: 2026-06-12
- Refines: [DR-0004](DR-0004-session-as-primary-key.md) (sid-unique inbox により messaging が workspace 非依存になった帰結を実行ガードに反映)
- Related: 2026-06-12 の issue 報告「cmux 非所属の background job から send が拒否される」を本 DR で解決 (issue ファイルは解決時削除済み)

## 背景

DR-0004 で受信箱を `<base>/<sid>/` に sid 直接化し、配送経路から workspace 階層を
廃止した。これにより **messaging (送受信) は workspace_id を一切参照しない**実装に
なっている。にもかかわらず、全コマンドが共通ガード `requireCmux()`
(= `CMUX_WORKSPACE_ID` 非空チェック) を通っていた。

cmux なしでも Claude Code セッションが立つ運用 (background job / TTY なし / cmux
surface 非所属) が一般化し、そうしたセッションから `cmux-msg send` 等を実行すると
`CMUX_WORKSPACE_ID` 未設定で不当に拒否される。実機では `CMUX_WORKSPACE_ID` に
placeholder を export するだけで init / whoami / send が正常動作し、cmux pane 上の
相手へ配送できることが確認された。つまりガードだけが邪魔をしていた。

## 決定

### 1. ガードを 2 種類に分離する

- **`requireSessionId()`**: session_id が解決できることのみを要求する。
  messaging 系コマンド共通ガード。`CMUX_WORKSPACE_ID` は見ない。
- **`requireCmux()`**: `CMUX_WORKSPACE_ID` 非空 + session_id 解決を要求する。
  cmux surface の直接操作系のみで使う。

### 2. コマンドのガード割り当て

| 分類 | コマンド | ガード |
|---|---|---|
| messaging (cmux 不要) | init, send, list, read, reply, dismiss, accept, thread, history, broadcast, whoami, subscribe, gc, peers | `requireSessionId()` |
| cmux surface 直接操作 (cmux 必須) | tell, screen, spawn, stop | `requireCmux()` |

surface 操作系 (tell = キー入力注入、screen = 画面読み取り、spawn = pane 起動、
stop = pane 終了) は cmux pane を直接叩くため `CMUX_WORKSPACE_ID` を前提として
維持する。

### 3. workspace_id は meta.json の任意フィールドに格下げ

init は `CMUX_WORKSPACE_ID` が空でも成功する。`meta.json` の `workspace_id` は
空文字で記録する (`PeerMeta.workspace_id: string` のまま、スキーマ変更なし)。
whoami / peers の verbose 表示は元々 `workspace_id` が falsy なら出さない実装なので
空文字は自然に非表示になる。

### 4. peers の grouping は空 workspace_id を許容

workspace_id が空の peer も一覧に出す。`--by ws` では空 ws 同士
(`"" === ""`) が同一グループになるが、これは許容する (cmux 環境外セッション群を
まとめて扱える方が自然)。

## ガードの実装形 (throw 化)

旧 `requireCmux()` は `console.error` + `process.exit(1)` で即終了していた。新しい
`requireSessionId()` / `requireCmux()` は `GuardError` を throw し、cli.ts の
トップレベル catch が `UsageError` と同様に「エラー:」プレフィックスを足さず
そのまま表示する。テスト可能性のための変更で、ユーザに見える文言は変えない。

## 代替案と不採用理由

- **`requireCmux()` を「session_id 解決のみ」に一本化緩和**: surface 操作系
  (tell/screen/spawn/stop) は cmux 環境を本当に必要とするため、緩和すると cmux
  非所属セッションで「surface が無い」runtime エラーに後段で落ちる。入口で
  区別したほうが拒否理由が明確。よってガード分離 (案 2) を採用。
- **placeholder workspace_id の export を運用で回避**: コードを直さず env で逃げる
  のは恒久対処にならない (= ガードの設計欠陥が残る)。

## 影響範囲

- `src/config.ts`: `requireSessionId()` 追加、`requireCmux()` を `GuardError`
  throw に変更
- `src/lib/errors.ts`: `GuardError` 追加
- `src/cli.ts`: トップレベル catch で `GuardError` をプレフィックスなし表示
- messaging 系 14 コマンド: `requireCmux()` → `requireSessionId()`
- tests: config ガード分離 / init の空 workspace_id 記録

## 関連

- DR-0004: sid 一意化 (messaging が workspace 非依存になった出発点)
