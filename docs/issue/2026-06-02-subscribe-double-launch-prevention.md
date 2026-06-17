# `cmux-msg subscribe` の2重起動防止 (= 通知重複対策)

- Status: Will be sublimated after DR-0012 land (subscribe を SQLite lock + Bun fs.watch + watermark で解決)

報告者: kawaz (2026-06-02)。claude-plugin-reference リポでの議論から起票。

## 背景: 何が起きるか

`cmux-msg subscribe` を Claude Code の Monitor ツールで起動する運用で、
**同 `CMUXMSG_SESSION_ID` (= 同 Claude セッション) から複数の subscribe が
立ち上がってしまう** ケースが頻発する:

- ユーザが「他セッションからの声かけを受け付けるため subscribe 起動して」と指示
- 受けた Claude は既存 subscribe が居るかを確認せず、素直に新規 Monitor 起動
- 結果、同一 session_id の inbox を 2 プロセスが listen → **メッセージ 1 件あたり通知 2 件**
- ユーザは「2 重に来たので 1 件は無視」を毎回手作業

発生経路:

- (a) SessionStart 直後に Claude が起動 → ユーザが再指示 → 記憶があれば弾けるが、忘れたら 2 重
- (b) `/clear` や context 圧縮で起動記憶が消失 → 再指示で 2 重起動
- (c) Monitor task が clean に終わらず subscribe プロセスが zombie で残存 → 再起動で 2 重

(a)(b) は LLM 側の記憶に依存する解決を採ると確実性が低い (= 「アホちん」が直らない)。
**cmux-msg 側で機械的に弾く仕組みが望ましい**。

## 提案: pidfile + alive チェック + 起動元 Claude 監視

### キー設計

- pidfile path: `~/.local/state/cmux-msg/subscribe.<session_id>.pid` (= session_id 単位で 1 つ)
- `session_id × claude_pid` のように細かく切らない。同 session で claude が再起動した時に
  古い subscribe が消えずに残る (= 2 重起動再発) ため逆効果

### 起動時のロジック (先勝ち = 既存 alive なら自分 exit)

```
sub_pid = $$
claude_pid = $CMUX_CLAUDE_PID
sid       = $CMUXMSG_SESSION_ID

if pidfile exists:
  prev = read(pidfile)  # {sub_pid, sub_lstart, claude_pid, claude_lstart}
  if pid_alive(prev.sub_pid, prev.sub_lstart):  # 同一性判定は lstart 併記方式 (DR-005)
    if pid_alive(prev.claude_pid, prev.claude_lstart):
      # 正当な既存 subscribe あり → 自分は静かに exit
      log "既に subscribe 起動中 (pid=...), exit 0"
      exit 0
    else:
      # 既存 subscribe は alive だが起動元 Claude が死亡 = zombie
      # → SIGTERM して take-over
      kill prev.sub_pid
      wait_for_exit(prev.sub_pid)
  # else: 既存 sub_pid 死亡 → そのまま take-over

# pidfile を自分で更新
write(pidfile, {sub_pid, sub_lstart, claude_pid, claude_lstart})
trap "rm pidfile" EXIT
start_subscribe_loop()
```

### ループ中の起動元監視 (= 自動掃除)

```
every N seconds (5-10s):
  if not pid_alive($CMUX_CLAUDE_PID, claude_lstart):
    log "起動元 Claude 死亡, exit"
    exit 0  # trap で pidfile も削除される
```

これにより:
- 同 session_id での 2 重起動 = 弾く (= 先勝ち、新規起動側が exit)
- zombie subscriber (= 起動元 Claude が落ちて残ったプロセス) = 自動掃除
- hang した既存 subscribe = 起動元 Claude が死んでれば次の起動時に take-over される

### 同一性判定

pid 単独だと OS の pid 使い回しで誤判定するので、既存の `src/lib/peer.ts` の
`ps -o lstart=` 併記方式を流用 (= [[2026-05-17-pid-unique-id]] と同方針)。

## 利用可能な環境変数 (= 実機確認済)

cmux 側から subscribe プロセスに以下が export されている (今回実機で確認):

| 変数 | 値の例 | 用途 |
|------|--------|------|
| `CMUXMSG_SESSION_ID` | UUID | pidfile キー |
| `CLAUDE_CODE_SESSION_ID` | 同上 | 互換 |
| `CMUX_CLAUDE_PID` | `1690` | 起動元 Claude の pid、生死監視に使う |
| `CMUX_AGENT_LAUNCH_KIND` | `claude` | 起動元種別 (codex 等もありうる) |
| `CMUX_AGENT_LAUNCH_EXECUTABLE` | `/Users/kawaz/.local/bin/claude` | 起動元 binary path |

`CMUX_CLAUDE_PID` が直接渡されてるので、PPID チェーンを辿る必要なし。

## 検討した代替案 (= 不採用)

### 案 A: 後勝ち take-over (= 既存を kill して新規が引き継ぐ)

- 利点: hang した既存を確実に救済できる
- 欠点: 正常運用中の subscribe を不要に kill する。Monitor task が一旦完了通知を
  出して再起動するので、Claude 側の状態管理が混乱する可能性

### 案 B: 警告のみ (= "2 重起動されてるのでどちらか停止して" と stdout に出す)

- 利点: 実装が最も簡単
- 欠点: Claude が無視する / 誤判断する確率高い (= 報告者の問題提起そのもの)。
  ユーザの手作業 (= 「1 件無視」) を機械化しないと意味がない

### 案 C: `session_id × claude_pid` キーで細かく識別

- 利点: 別プロセスからの起動を区別できる
- 欠点: 同 session で Claude 再起動時に古い subscribe が消えず 2 重化が再発。
  この issue が解決したい問題そのものを引き起こす

## 例外運用: 観察モード

デバッグ目的で kawaz が手動で `cmux-msg subscribe` を叩いて観察したいケース:
- `--observe` (or `--no-takeover`) flag: pidfile を読まず・書かず・既存も殺さず subscribe
- 普段の Claude Monitor 経由起動は default の排他モードで OK

## 関連

- [[2026-05-17-pid-unique-id]] — pid 同一性判定の lstart 併記方式 (流用先)
- [[2026-05-17-spawn-cleanup-design]] — プロセスライフサイクル管理の既存設計
- DR-0005 (claude_home 境界) — pidfile の置き場所は home 単位で良い

## 実装着手判断

- 影響範囲: `src/lib/` 配下の subscribe 起動経路 (= `cli.ts` の subscribe コマンド分岐)
- pidfile 機構は peer 管理で既に実装あるはず (= 流用) → 新規実装は薄い
- 優先度: ユーザの手作業 (= 通知 1 件無視) を毎回発生させてるので体感的にはそれなりに高い
