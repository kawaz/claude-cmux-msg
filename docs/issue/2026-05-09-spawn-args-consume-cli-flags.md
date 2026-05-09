# `cmux-msg spawn <FLAG>` が CLI フラグを name として消費して意図せぬ session を立ち上げる

## 症状

`cmux-msg spawn` の引数解析が「最初の引数を `name` として無条件に解釈する」ため、ヘルプ表示のつもりで打った `--help` などが新しいセッションの name になってしまう。

具体例 (報告者が遭遇):

```bash
$ cmux-msg spawn --help
警告: Claude起動の signal を受信できず (30秒タイムアウト)
spawn完了: id=3de92a7f-f700-4369-9330-dcaafca753c1 name=--help color=red
```

`--help` を name とした session が立ち上がってしまう。さらに別 issue (`2026-05-09-spawn-claude-not-launching.md`) の症状と組み合わさって `cmux-msg stop <uuid>` も「meta.json なし」エラーで効かないため、誤起動を片付けるのが面倒。

引数なしで実行した場合も同様で、自動採番の name で session が立ち上がる:

```bash
$ cmux-msg spawn
警告: Claude起動の signal を受信できず (30秒タイムアウト)
spawn完了: id=65fad0b2-... name=worker-9 color=red
```

ユーザは「使い方を確認しよう」「コマンドの存在確認だけしよう」というつもりだったのが、副作用で session を起こす形になる。

## 期待

1. `cmux-msg spawn --help` (`-h` も) はヘルプ表示のみ。session を起こさない
2. CLI フラグ (`--cwd`, `--args`, `--help`, `--version` 等) として既知のものは name として誤消費されない (= name は最初の non-option 引数)
3. 引数なし `cmux-msg spawn` をどう扱うかは設計判断:
   - 案 A: 自動 name で起動 (現挙動)
   - 案 B: ヘルプ表示 (副作用なし、`--cwd` 等の必須情報が無いので明示要求)
   - 案 C: `cmux-msg spawn` 単体は禁止しエラー (誤発火を防ぐ)
   報告者の好みは **案 B または C** (副作用を起こさないのが安全)

## 影響

- 試しに使い始めた利用者が、コマンドの感触を確かめる過程で意図せぬ session を残す
- AI エージェントが `--help` をうっかり打つと意図せぬ子 CC を起こす (実例あり)
- 起こしてしまった session が `meta.json なし` エラー側 (別 issue) に重なると stop も効かず、廃棄に手間がかかる

## 提案

- 標準的な CLI 引数パース (例: `flag` パッケージ、`cobra`、`urfave/cli` 等) を使う
- name は positional 引数として `flag.Args()[0]` で取る、`-` で始まるものは name 候補から除外
- `--help` / `-h` / `--version` は最優先で処理して return

報告者: 親 CC (session_id: `718c6cc3-b154-4de5-9cbe-cccd6dcfa407`) — 2026-05-09 に bump-semver 実装の子 spawn 時に遭遇
