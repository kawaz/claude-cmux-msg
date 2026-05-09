# spawn が Claude 起動 signal を受信できず、session が永続化されない

## 症状

`cmux-msg spawn` を実行すると、表面上は「spawn完了」のログが出るが:

1. `cmux-msg spawn` 実行時に警告: `警告: Claude起動の signal を受信できず (30秒タイムアウト)`
2. 警告の後、`spawn完了: id=<uuid> name=<name> color=<color>` は出力される
3. しかし `cmux-msg peers` に新しい peer が現れない（self のみ）
4. `cmux-msg peers --all` の dead リストにも当該 uuid が現れない
5. `cmux-msg screen <uuid>` でエラー: `エラー: session <uuid> が見つかりません (meta.json なし)`
6. `cmux-msg stop <uuid>` も同じエラーで失敗

つまり、spawn は「成功した風に見える」が、session ディレクトリ (meta.json 含む) が永続化されていない。

## 環境

- cmux-msg バージョン: 0.24.0 (`/Users/kawaz/.claude/plugins/cache/cmux-msg/cmux-msg/0.24.0/bin/cmux-msg`)
- cmux 環境変数:
  - `CMUX_BUNDLE_ID=com.cmuxterm.app`
  - `CMUX_SURFACE_ID=3A6CA23A-4D51-49CB-A805-3B0663F7991E`
  - `CMUX_WORKSPACE_ID=E61D87CD-F7F4-49BA-BAD2-22472CBF1A13`
  - `CMUX_PORT=9360`
- 親 CC 側: `cmux-msg whoami` は正常応答（self が `dc98e878-b08b-4d7b-bdb9-a131a87c682d`）
- 親 CC 側: `cmux-msg peers` は self は alive と表示、dead 78 件も認識

## 再現手順

```bash
cmux-msg spawn csa-pr1 --cwd /Users/kawaz/.local/share/repos/github.com/kawaz/claude-session-analysis/main
# → 警告: Claude起動の signal を受信できず (30秒タイムアウト)
# → spawn完了: id=66df8728-219d-4272-9943-f1a418ce675b name=csa-pr1 color=green

sleep 30
cmux-msg peers
# → self のみ表示、66df8728-... は出てこない

cmux-msg screen 66df8728-219d-4272-9943-f1a418ce675b
# → エラー: session 66df8728-219d-4272-9943-f1a418ce675b が見つかりません (meta.json なし)
```

複数回 spawn を試したが（少なくとも 3 回）、毎回同じ症状。

## 期待動作

- spawn が成功した場合、新しい peer が `cmux-msg peers` で alive 扱いになる
- `cmux-msg tell <uuid> <message>` で初期ブリーフィングを送れる
- `cmux-msg screen <uuid>` で pane の内容を確認できる

## 推測される原因（未調査）

- spawn 時に Claude プロセスが起動しない / 起動 signal が届かない
- meta.json の生成タイミングが Claude 起動 signal と紐付いている可能性（signal 待ちタイムアウト後に作られないなど）
- リファクタ進行中のため、過渡的な不整合の可能性（kawaz より「昨日 cmux-msg 側で大規模リファクタ中」とのコメントあり、この issue は再現性確認のための報告）

## 影響

- 親 CC から子 CC を spawn して並行作業を分担するワークフローが完全に動かない
- 緊急度は低い（リファクタ中につき）。ただし作業フローへの影響として記録は残しておきたい

## 関連

- 親 CC が試みた目的: kawaz/idea-storage の DR-0008 関連で、kawaz/claude-session-analysis 側の改修を並列で進める子 CC を立ち上げようとしていた
- 結果として idea-storage 側の `docs/issue/` に依頼を起票し、後日 CSA 側で手動着手する形に切り替えた

## 暫定対応 (2026-05-09)

cmux-msg-impl ワーカーが防御的改善を実施 (issue は維持):

- `docs/runbooks/spawn-troubleshooting.md` を新規作成 (切り分け手順をまとめた)
- spawn の signal タイムアウト警告メッセージに「peers --all / gc / runbook」へのヒントを追加
- session-start.ts の `main().catch` でエラー詳細を stderr に流すように変更 (デバッグ容易化)

再現条件の特定にはまだ至っていない。再現したらこの issue と runbook 双方に追記する。
