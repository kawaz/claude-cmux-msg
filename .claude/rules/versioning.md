# バージョン管理ルール

プラグインの機能（コード、skills, hooks など）を修正して push する際は:

1. `.claude-plugin/plugin.json` と `.claude-plugin/marketplace.json` の version を同期更新（`just bump-version` で 3 ファイル一括）
2. `claude plugin validate .` を実行して検証に通ること
3. push は `just push` を使う（バージョン一致・bump チェックを自動実行）
4. docs のみの変更は bump 不要。`check-version-bumped` が product code の差分なしを検知して自動スキップする
