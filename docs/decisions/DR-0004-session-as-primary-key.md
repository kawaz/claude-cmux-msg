# DR-0004: メッセージングの主体を session_id 一意に整理する

- Status: Accepted
- Date: 2026-05-12
- Supersedes: [DR-0003](DR-0003-cross-workspace-messaging.md) (cross-workspace messaging。alive 走査の暫定対応)
- Refines: [DR-0001](DR-0001-session-id-identifier.md) (識別子一本化の前提を時間軸まで含めて再定義)

## 背景

DR-0003 で「session_id は workspace 横断的に一意」を前提に `peerDir(sid)` を全 ws 走査
fallback で解決する暫定実装を入れた。実際の運用で以下が判明:

- **同じ session_id が複数 workspace 配下に dir を持つ** ことが日常的に起きる
  (resume で別 ws 環境に持ち越し、SessionStart hook が新 ws 配下に init、旧 ws の dir は dead で残置)
- alive な実体は通常 1 つだが、ゾンビ dir に誤配送するリスクが構造上残る
- DR-0003 の前提 (session_id が dir 名で workspace 横断的に一意) は**ファイル構造の
  時間軸では崩れている**

並行して以下の指摘 / 観察が積み上がった:

- `surface_id` は **時間軸で使い回される** (ctrl-z サスペンド + 新 cc 起動、同タブで cd
  + 別 cc 起動、resume で別 surface 等)。surface → sid の逆引きは時間依存で当てにならない
- 同じ cwd / 同じ repo で複数セッションが並走するのは普通 (context 汚染避けで 2nd cc 等)
- ユーザは同一マシン上で **複数の Claude アカウント** (例: `~/.claude` と `~/.claude-work`)
  を `CLAUDE_CONFIG_DIR` で使い分ける。これらは情報セキュリティ的に「壁が一応ある」
- 「同じグループ」の定義はユースケースによって変わる: claude_home / workspace / cwd /
  repo / 任意タグ など複数軸ある

## 決定

### 1. **session_id (sid) をメッセージングの一意な主体とする**

- 受信箱・送信履歴・状態・メタデータすべて sid を主キーに整理する
- ws / surface は sid に時間的に紐付くメタ情報。sid の identity には含めない

### 2. **データレイアウトを sid 一意に変更**

```
<CMUXMSG_BASE>/
  <sid>/
    inbox/  accepted/  archive/  sent/  tmp/
    meta.json
    pid
  by-surface/<surface_id>             ← 自セッションの sid 解決 fallback (env 不能時)
```

旧 `<base>/<ws>/<sid>/` 階層は廃止。sid が ws を移動しても dir は同じ。ゾンビ問題は
構造的に発生しない。

### 3. **meta.json schema を拡張**

```json
{
  "session_id": "<uuid>",
  "parent_session_id": "<uuid|null>",
  "worker_name": "<name|null>",
  "claude_home": "<abs path>",
  "workspace_id": "<cmux ws>",
  "cwd": "<abs path>",
  "repo_root": "<abs path|null>",
  "surface_ref": "surface:N",
  "tags": [],
  "state": "idle|running|awaiting_permission|stopped",
  "state_changed_at": "<iso>",
  "init_at": "<iso, 不変>",
  "last_started_at": "<iso>",
  "last_ended_at": "<iso|null>"
}
```

- グルーピング軸は **全て meta.json のフィールド** として持つ
- ディレクトリ階層には反映しない (filter で対応する)
- 各フィールドは SessionStart hook で **現在値で上書き** (resume 時の動きを追従する)

### 4. **状態トラッキング**

hook で state を遷移管理する:

| state | 遷移 hook |
|---|---|
| `idle` | SessionStart, Stop, StopFailure |
| `running` | UserPromptSubmit |
| `awaiting_permission` | PermissionRequest |
| `stopped` | SessionEnd |

### 5. **コマンド別の安全境界**

| コマンド | fg 必須 | state=idle 必須 | 理由 |
|---|---|---|---|
| `send <sid>` | ❌ | ❌ | inbox 配送は永続、いつでも OK |
| `tell <sid>` | ✅ | ✅ | bg/running 中は別 sid に誤書き込みや入力吸い込み |
| `screen <sid>` | ✅ | ❌ | bg/suspended は別 sid の画面を誤読 |
| `broadcast` | ❌ | ❌ | 軸明示必須 (デフォルト全送信を禁止) |

fg 判定は `ps -o stat= -p <pid>` の `+` フラグで判定。bg/suspended は **`--force`
なしで無条件拒否** (「そこにいないとわかってる場所への読み書きは意味なし問題のみ」)。

### 6. **グルーピング filter (`--by <axis>`)**

```bash
cmux-msg peers --by home                  # claude_home 一致
cmux-msg peers --by ws                    # workspace_id 一致
cmux-msg peers --by cwd                   # cwd 一致
cmux-msg peers --by repo                  # repo_root 一致
cmux-msg peers --by tag:<name>            # 指定タグを持つ
cmux-msg peers --by home --by ws          # AND 結合 (許容)
cmux-msg peers --all                      # 全 alive peer (明示)
cmux-msg peers                            # ← help 表示 (デフォルト動作なし)

cmux-msg broadcast --by ws <msg>          # 同様。軸なしはエラー
cmux-msg broadcast --all <msg>            # 全送信 (明示)
cmux-msg broadcast <msg>                  # ← エラー
```

### 7. **fg/bg 判定は動的に問い合わせる (meta に持たない)**

`ps -o stat= -p <pid>` で都度判定する。meta に保存しても古くなる。

### 8. **自セッション sid 解決**

優先順:
1. `CLAUDE_CODE_SESSION_ID` env (Claude Code 2.x で Bash 子プロセスに提供される)
2. `CMUXMSG_SESSION_ID` env (将来 CLAUDE_ENV_FILE が機能した時の互換)
3. `<base>/by-surface/<CMUX_SURFACE_ID>` lookup (env 不能時の fallback)

surface ベースの逆引きは fallback に降格。

## 代替案と不採用理由

- **alive 走査 fallback で当面回避 (DR-0003 のロジック維持)**: ゾンビ dir に誤配送する
  リスクを残し続ける。実体に合わないモデルで進めると技術的負債が積もる
- **base 階層を `${claude_home}/cmux-messages/` に分けて完全隔離**: 同一 OS user で
  pgrp は同じなので OS レベルでは隔離されない。「壁が一応」のセマンティクスには合うが、
  共有 base + meta.json filter のほうが横断ユースケース (例: 別アカウントの監視) も可能。
  Phase 1 では共有 base + filter で進め、必要なら後で追加可能
- **複数 alive で ambiguous エラー**: 多重 resume は運用上稀でユーザがすぐ片方終了する。
  最新 init_at でタイブレークするだけで十分

## 互換性 / migration

**C 案 (旧捨て、新構造で再構築)** を採用。

- 旧 `<base>/<ws>/<sid>/` 配下は新 version では読まれない
- 既存 inbox / sent / archive 履歴は失われる
- ユーザ (kawaz) は dogfood 前提で承諾済み
- 自動移行スクリプトは作らない (バージョン上げて再 init で完結)

旧 dir を残したい場合は `cmux-msg gc` で明示削除するか、ユーザが手動で扱う。

## 影響範囲

実装変更:
- `src/lib/paths.ts` / `src/config.ts`: `peerDir()`, `myDir()`, `wsDir()` の見直し (wsDir は廃止)
- `src/commands/init.ts` / `src/hooks/session-start.ts`: meta.json schema 拡張、claude_home / cwd / repo_root / state の記録
- 新規 hook 実装: UserPromptSubmit, Stop, StopFailure, PermissionRequest, SessionEnd
- `src/lib/peer.ts`: listPeers の引数を base に変更 (ws 階層なし)、fg/state 判定 helper 追加
- `src/lib/peer-refs.ts`: resolvePeerSurfaceRef は新 peerDir 経由で自動的に追従
- `src/commands/send.ts`: 変更小 (sid 直接配送)
- `src/commands/tell.ts`: fg + state ガード追加
- `src/commands/screen.ts`: fg ガード追加
- `src/commands/peers.ts`: `--by <axis>` / `--all` フラグ実装、軸なしは help
- `src/commands/broadcast.ts`: 軸必須化、`--by` / `--all`
- `src/commands/gc.ts`: 旧 ws 構造の掃除拡張 or 削除
- 全 test 書き換え (workDir/WS/SID → workDir/SID)
- SKILL.md / README 全面更新

## 関連

- 起点 issue: `docs/issue/2026-05-11-cross-workspace-messaging.md` (DR-0003 で参照、削除済み)
- DR-0001: 識別子を sid に一本化 → 本 DR で「sid は時間軸でも一意」まで踏み込んで再定義
- DR-0003: cross-workspace messaging (alive 走査の暫定実装) → 本 DR で superseded
