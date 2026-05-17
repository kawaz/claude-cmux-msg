# DR-0006: fg 判定の対象 pid を CMUX_CLAUDE_PID に切り替える

- Status: Accepted
- Date: 2026-05-17
- Refines: [DR-0004](DR-0004-session-as-primary-key.md) (§7 fg/bg 判定の対象 pid を変更)
- Related: docs/issue/2026-05-14-fg-detection-from-ai-subprocess.md (起票元、解決後 delete)

## 背景

DR-0004 §7 で tell / screen の安全境界として「fg/bg 判定を動的に問い合わせる」
ことを決めた。実装 (`isProcessForeground()`) は `ps -o stat= -p <pid>` の `+`
フラグを見る。判定対象の pid は `meta.json` の `shell_pid` だった。

`shell_pid` は `init.ts` で `process.ppid || process.pid` から記録される。
init.ts は SessionStart hook 等から起動される cmux-msg プロセスであり、その
`process.ppid` が何を指すかは **フック実行時のシェルの挙動に依存する**:

- シェルの exec 最適化が効く環境では `claude` 本体が `bun`/`cmux-msg` を直接
  exec し、`process.ppid` が claude 本体 pid になる
- 最適化が効かない環境では `claude` が `bash -c "..."` を挟むため、`process.ppid`
  は中間 bash サブプロセスの pid になる

claude 本体プロセスは cmux pane の foreground process group に属するので
`ps -o stat=` に `+` が付く。しかし中間 bash サブプロセスは fg pgrp に属さず
`+` が付かない。結果、`shell_pid` がたまたま bash サブプロセスを指していると、
**fg に居る self への tell が「foreground にない」と誤って reject される**。

実害は issue (2026-05-14) で確認済み。AI が自セッションに `/reload-plugins`
等のスラッシュコマンドを self-tell して反映する経路、およびリモートクライアント
から claude を操作する経路が塞がれていた。

## 決定

### 1. 判定対象 pid を `CMUX_CLAUDE_PID` 起点に切り替える

cmux は claude プロセス本体の pid を `CMUX_CLAUDE_PID` 環境変数で claude の
子プロセスに明示提供している。`process.ppid` というプロセスツリー構造の推測に
頼らず、cmux が断言している pid を直接使う。

`init.ts` に `resolveClaudePid()` を新設し、解決順を以下にする:

1. `CMUX_CLAUDE_PID` env (最優先)
2. NaN / 空文字 / 非数値の場合は `process.ppid || process.pid` にフォールバック

これは fg/bg 判定だけでなく alive 判定 (`pid` ファイル) の対象 pid も同じく
claude 本体に揃える意味を持つ。alive / fg いずれも「セッション = claude 本体
プロセスが生きているか / 前面に居るか」を見たいので、対象は claude 本体が正しい。

### 2. `PeerMeta.shell_pid` を `claude_pid` にリネーム

フィールド名 `shell_pid` は「シェルの pid」を意味し、新しい解決方式 (claude
本体 pid) と意味が食い違う。`shell_pid` のままだと将来「なぜシェル pid なのに
claude 本体を指すのか」という混乱を生む。意味と名前を一致させるため `claude_pid`
にリネームする。

### 3. tell.ts / screen.ts は旧形式 meta.json 互換のフォールバックを持つ

リネーム前 (0.28.0 以前) に書かれた `meta.json` には `shell_pid` フィールドが
残っている。tell.ts / screen.ts は読み取り時に
`meta.claude_pid ?? meta.shell_pid` のフォールバックを持つ。

互換フォールバックを残す理由: meta.json は SessionStart で都度書き直されるが、
resume せず長期間生きているセッションの古い meta.json をその場で reject する
のは UX 上不親切。一度 init が走れば新フィールドに書き換わるので、フォールバック
は「次の init までの過渡的な救済」として軽量に持てばよい。重い migration は不要。

## 代替案と不採用理由

- **`ps -o tpgid,pgid` で controlling tty の fg pgrp 一致を見る**: 祖先プロセス
  を遡れば判定自体は可能だが、cmux が `CMUX_CLAUDE_PID` で claude 本体 pid を
  断言している以上、プロセスツリー走査は遠回り。cmux が提供する事実を使うのが筋。
- **`shell_pid` 名のまま中身だけ claude 本体 pid に変える**: 名前と意味が食い違い
  将来の混乱源になる。`design-priority.md` に従いリネームコストを払って正す。
- **旧形式 meta.json を即 dead 扱い**: pid ファイルの旧形式 (DR-0004 で 1 行のみ
  を dead 扱いにした件) と違い、`shell_pid` は値自体は有効な pid を持つ。捨てる
  必要はなく、フォールバックで救えるので reject は過剰。

## 互換性

- `meta.json` のフィールド名変更 (`shell_pid` → `claude_pid`) は破壊的だが、
  tell.ts / screen.ts のフォールバックで旧形式も読める。kawaz の dogfood 範囲
  なので問題なし。
- 0.28.0 では `shell_pid` がたまたま claude 本体 pid を指していた (シェルの
  exec 最適化が効いていた) ため、現バージョンでは表面化しにくかったが、exec
  最適化に依存する脆い前提だった。本 DR でその前提依存を解消する。

## 影響範囲

- `src/types.ts`: `PeerMeta.shell_pid` → `claude_pid` リネーム
- `src/commands/init.ts`: `resolveClaudePid()` 新設、meta.json / pid ファイルに claude_pid を記録
- `src/commands/tell.ts`: `claude_pid ?? shell_pid` フォールバックで fg 判定対象を取得
- `src/commands/screen.ts`: 同上
- tests: `init.test.ts` (resolveClaudePid)、`meta.test.ts` / `peer-filter.test.ts` のフィクスチャ更新

## 関連

- DR-0004 §7: fg/bg 判定を動的に問い合わせる決定 (本 DR で判定対象 pid を是正)
- docs/journal/2026-05-17-fg-detection-fix.md: 実装時のハマり所
