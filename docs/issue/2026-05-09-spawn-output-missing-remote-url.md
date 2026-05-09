# `cmux-msg spawn` の出力にリモート URL が含まれず、screen で覗かないと取れない

## 症状

`cmux-msg spawn` 実行時、子 CC が `/remote-control` で発行する **`https://claude.ai/code/session_XXX...` の URL** が cmux-msg 側の出力に含まれない。

実際の出力:

```bash
$ cmux-msg spawn bump-semver-impl --cwd /Users/kawaz/.local/share/repos/github.com/kawaz/bump-semver/main
spawn完了: id=626f95c0-f076-419f-aac8-dd734e98e620 name=bump-semver-impl color=green
```

ここに表示されるのは UUID / name / color のみ。リモート URL は子 CC のターミナル画面 (`Code in CLI or at https://claude.ai/code/session_XXX`) にしか出ないため、

```bash
cmux-msg screen 626f95c0-f076-419f-aac8-dd734e98e620
```

で TUI 画面を文字列ダンプして該当行を探すという回りくどい手順を踏む必要がある (実例: 2026-05-09 報告者の親セッション)。

## 期待

`cmux-msg spawn` の出力に、子 CC のリモート操作 URL を含める。

```bash
$ cmux-msg spawn bump-semver-impl --cwd ...
spawn完了:
  id:     626f95c0-f076-419f-aac8-dd734e98e620
  name:   bump-semver-impl
  color:  green
  remote: https://claude.ai/code/session_01NYPVnDQNwS4JxBmMqHkjVH
  pane:   <tmux pane id?>
```

または `--json` フラグで構造化出力を提供:

```bash
$ cmux-msg spawn ... --json
{"id":"...","name":"...","color":"green","remote_url":"https://claude.ai/code/session_..."}
```

## なぜ必要か

ユーザがリモートで CC を操作するために URL が要る (今回の報告者ユースケース: 親 CC が子 CC を spawn し、ユーザに URL を伝えてリモート操作してもらう)。`screen` で覗くのは TUI 出力をパースする形になり、レイアウト変更で簡単に壊れる。

cmux-msg は子 CC を起動した張本人なので、Claude Code が `/remote-control` で発行した URL を受け取る経路を持てば直接出力できる。

## 実装案

- 子 CC 起動時に `--remote-control-url-callback <url>` のような hook を渡し、子から親 (cmux-msg) に URL を返す
- もしくは `cmux-msg whoami` を子側で打った結果を回収するチャネル
- もっと泥臭く: spawn 直後に screen を一定時間サンプリングして URL 行を抽出 (脆いので最終手段)

## 関連

- (新規) `2026-05-09-inbox-no-active-notification.md` (近接トピック: cmux-msg の出力でユーザが必要な情報が足りない)

報告者: 親 CC (session_id: `718c6cc3-b154-4de5-9cbe-cccd6dcfa407`) — 2026-05-09
