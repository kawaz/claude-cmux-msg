---
title: launcher symlink 経由実行で "Module not found" エラー
status: open
category: bug
created: 2026-06-28T23:43:01+09:00
last_read: 2026-06-29T00:00:00+09:00
open_entered: 2026-06-28T23:43:01+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered:
discard_reason:
pending_reason:
close_reason:
blocked_by:
origin: kuu.mbt
---

# launcher symlink 経由実行で "Module not found" エラー

## 概要

`cmux-msg` launcher script を **symlink 経由で実行すると** "Module not found `/.../src/cli.ts`" で fail する。SessionStart hook が「PATH に通すために symlink を貼れ」と案内している (= 推奨パス) のに、推奨通り symlink を作ると壊れる。

## 背景

SessionStart hook が PATH 不在時に symlink 作成を案内している (`ln -s .../bin/cmux-msg ~/.local/bin/cmux-msg`)。
ユーザが推奨通りに従うと即 break する状態になっている。

**再現** (実機環境: macOS Darwin 25.5.0, bash 3.2 / zsh 5.9, cmux-msg v0.31.4):

```bash
# SessionStart hook の案内通りに symlink 作成
ln -s /Users/kawaz/.claude-personal/plugins/cache/cmux-msg/cmux-msg/0.31.4/bin/cmux-msg ~/.local/bin/cmux-msg

# symlink 経由で実行
cmux-msg
# → error: Module not found "/Users/kawaz/.local/bin/../src/cli.ts"
```

実体パスで実行すれば動く:
```bash
/Users/kawaz/.claude-personal/plugins/cache/cmux-msg/cmux-msg/0.31.4/bin/cmux-msg whoami
# → 正常
```

**Root cause**: `bin/cmux-msg` 内の `${BASH_SOURCE[0]}` が symlink 自身のパス (`/Users/kawaz/.local/bin/cmux-msg`) を返す。`cd "$(dirname ...)" && pwd` が **symlink を resolve せず symlink 親ディレクトリ** を返すため、`__src` が `/Users/kawaz/.local/src/cli.ts` (存在しない) になる。

**Fix 案 (推奨: 案 B)**:

```bash
__self="${BASH_SOURCE[0]}"
# macOS の readlink は -f がないので while loop で解決
while [ -L "$__self" ]; do
  __link="$(readlink "$__self")"
  case "$__link" in
    /*) __self="$__link" ;;
    *)  __self="$(dirname "$__self")/$__link" ;;
  esac
done
__here="$(cd "$(dirname "$__self")" && pwd)"
```

macOS BSD readlink は `-f` が無いので while loop が portable。依存追加なしで symlink 多段にも対応。

alias 経由 (= `alias cmux-msg=/.../bin/cmux-msg`) なら BASH_SOURCE が実体パスになるので動く (ワークアラウンド)。

## 受け入れ条件

- [ ] symlink 経由で `cmux-msg whoami` が正常動作する
- [ ] alias 経由・直接実体パスで叩く既存経路も引き続き動作する
- [ ] macOS bash 3.2 / linux bash 4+ / zsh で同じ挙動
