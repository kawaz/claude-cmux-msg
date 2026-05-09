# SessionStart hook で /rename / /color が cmux-msg 側に伝わらない

## 症状

親 CC が Claude Code セッション内で `/rename commander-on-jjworktree` や `/color red` を実行しても、`cmux-msg peers` の出力には反映されない:

```
$ cmux-msg peers
177cf86e-...  alive  name=cmux-msg-impl       ← spawn 時の name のまま
626f95c0-...  alive  name=bump-semver-impl    ← spawn 時の name のまま
718c6cc3-...  alive (self)                    ← rename 後も「(self)」のみ、name/color 表示なし
```

self の name は spawn 時に自分が CC として起動した時点では Claude 側の rename がまだなので、cmux-msg はその情報を持っていない。/rename 実行後も meta.json に伝わらない。

## 期待

- `/rename` 実行時に cmux-msg の meta.json (name フィールド) を更新する
- `/color` 実行時に cmux-msg の meta.json (color フィールド) を更新する
- self の peers 表示にも name/color を載せる

## 実装案

a. **PostToolUse hook (StatusLine 系)**: Claude Code 自体は /rename / /color を内部処理するが、これに対する hook が標準で出ていない可能性。設定で StatusLine トリガが取れれば cmux-msg meta を更新する hook script を仕掛ける
b. **定期同期**: SessionStart 時 + 一定間隔で `claude --get-session-info` 的 API があれば取得、cmux-msg meta を更新
c. **screen 経由で間接取得**: `cmux-msg screen` の出力にステータスバー (color, name 含む) があるはずなので、それを定期パースして meta に反映 (heuristic)

## 優先度

低。実害は「peers の表示が古い」だけで通信機能には影響なし。ただし複数子 CC を運用する commander 的な使い方では「どれが何の作業中か」を peers で把握できると便利なので、改善余地あり。

## 関連

- 既存 issue 群 (spawn / inbox / remote-url / send) と同じ系統 (cmux-msg のメタ管理改善)

報告者: 親 CC `718c6cc3-b154-4de5-9cbe-cccd6dcfa407` (commander-on-jjworktree)、2026-05-09 14:30 頃に実証
