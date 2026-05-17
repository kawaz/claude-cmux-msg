# 2026-05-17 fg 判定バグ修正 (shell_pid → claude_pid)

`cmux-msg tell` / `screen` の fg 判定が誤って self への tell を reject する
バグ (issue 2026-05-14) を修正した。DR-0006 で設計判断を記録。

## 経緯

issue 2026-05-14 で「fg pane に居る claude セッションへの self-tell が
`foreground にない` で reject される」が報告されていた。原因調査の過程で
fg 判定の対象 pid 選定がそもそも間違っていることが判明した。

## ハマり所 → 解決策

### ハマり所 1: 0.28.0 では再現しにくい

fg 判定対象だった `meta.shell_pid` は `init.ts` で `process.ppid || process.pid`
から記録される。0.28.0 の実環境では、シェルの exec 最適化により `claude` 本体が
`bun`/`cmux-msg` を直接 exec し、`process.ppid` がたまたま claude 本体 pid に
なっていた。claude 本体は cmux pane の fg pgrp に属するので `ps -o stat=` に
`+` が付き、判定が偶然通っていた。

→ つまり「動いているように見えるが、シェルの exec 最適化に依存した脆い前提」
だった。最適化が効かない環境 (claude が `bash -c` を挟む) では `process.ppid`
が中間 bash サブプロセスを指す。bash サブプロセスは fg pgrp に属さず `+` が
付かないため、fg に居る self への tell が誤 reject される。issue で報告された
のはこちらの環境。

### ハマり所 2: 何を判定対象にすべきか

`process.ppid` を遡って claude 本体を特定する案も浮かんだが、プロセスツリー
構造の推測になり脆い。

→ **`CMUX_CLAUDE_PID` env の発見が決め手**。cmux は claude プロセス本体の pid
を `CMUX_CLAUDE_PID` 環境変数で子プロセスに明示提供している。推測ではなく
cmux が断言している値を使えば一発で正しい対象が取れる。

## 修正内容

### `src/commands/init.ts`

`resolveClaudePid()` を新設。解決順:

1. `CMUX_CLAUDE_PID` env (最優先)
2. NaN / 空文字 / 非数値なら `process.ppid || process.pid` にフォールバック

```ts
export function resolveClaudePid(): number {
  return (
    parseInt(process.env.CMUX_CLAUDE_PID ?? "", 10) ||
    (process.ppid || process.pid)
  );
}
```

`parseInt("", 10)` / `parseInt("not-a-number", 10)` はいずれも `NaN` を返し、
`NaN || x` は `x` に落ちるので、空文字・非数値も自然にフォールバックされる。

### `src/types.ts`

`PeerMeta.shell_pid` を `claude_pid` にリネーム。フィールド名と意味 (claude
本体 pid) を一致させる。

### `src/commands/tell.ts` / `screen.ts`

旧形式 meta.json (0.28.0 以前の `shell_pid`) 互換のため
`meta.claude_pid ?? meta.shell_pid` のフォールバック付きで参照。一度 init が
走れば新フィールドに書き換わるので、過渡的な救済として軽量に持つ。

## 学び

- **「動いている」が「正しい」とは限らない**: 0.28.0 で偶然 fg 判定が通っていた
  のはシェルの exec 最適化頼みの偶然。テスト環境では再現せず、issue が無ければ
  脆い前提のまま気づけなかった。
- **推測より明示**: プロセスツリーから claude 本体を推測するより、cmux が
  `CMUX_CLAUDE_PID` で渡してくれる事実を使うほうが堅牢。環境が提供する明示的な
  情報を先に探すべきだった。
- **alive 判定の対象も揃える**: fg 判定だけでなく pid ファイル (alive 判定) の
  対象も claude 本体 pid に揃えた。「セッション = claude 本体プロセス」という
  モデルを判定対象でも一貫させる。
