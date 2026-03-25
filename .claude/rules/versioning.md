# バージョン管理ルール

プラグインの機能（コード、バンドル、skills, hooks など）を修正して push する際は:

1. `.claude-plugin/plugin.json` と `.claude-plugin/marketplace.json` の version を同期更新
2. `claude plugin validate .` を実行して検証に通ること
3. push は `just push` を使う（バージョン一致・バンドル最新・bump チェックを自動実行）
4. バージョン bump 不要な変更（docs のみ等）の場合は `just push-without-bump`
