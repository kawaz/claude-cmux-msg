---
title: spawn した子 CC / surface のクリーンアップ設計
status: discarded
category: design
created: 2026-05-17T00:00:00+09:00
last_read:
open_entered: 2026-05-17T00:00:00+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered: 2026-06-19T10:00:00+09:00
resolved_entered:
discard_reason: ["dr/DR-0009"]
pending_reason:
close_reason:
blocked_by:
origin: 自リポ TODO
---

# spawn した子 CC / surface のクリーンアップ設計

`cmux-msg spawn` は子 CC 用に cmux surface を作り、その中の shell に
`claude` 起動コマンドを送る。この「surface + shell + claude プロセス」の
ライフサイクル終了時のクリーンアップが設計されていない。

## 背景

fg 判定バグ調査 (2026-05-17) の過程で、テスト用に spawn した子 CC の
surface が複数放置された。手動で `cmux close-surface` して掃除したが、
本来「誰がいつ片付けるか」が決まっているべき。

## 検討すべき論点

1. **誰がいつクリーンアップするか**
   - `cmux-msg stop <sid>` は claude を終了させるが、surface と shell は残るのか
   - `cmux-msg gc` は dead session の dir を消すが、surface は対象外
   - 子 CC が自然終了 (SessionEnd) したとき、空になった surface を誰が閉じるか

2. **claude だけ終了して shell + surface が残るケース**
   - spawn は `cmux send` で `claude ...` コマンドを shell に流す方式。
     claude が終了すると shell プロンプトに戻り、surface は残る
   - 残った空 surface はリソースを食い、`peers` 等の一覧も汚す

3. **クリーンアップ時に claude が fg だった場合の扱い**
   - 子 CC がまだ作業中 (fg) のとき、誤って surface を閉じると作業が失われる
   - fg/state を確認してから閉じる安全境界が要る (tell の安全境界と同じ問題)

4. **claude 起動を `exec` で行うべきか**
   - 現状は shell の子プロセスとして claude を起動 → claude 終了後に shell が残る
   - `exec claude ...` で起動すれば claude が shell プロセスを置き換え、
     claude 終了 = surface のプロセス消滅となり、surface 側で「空になった」を
     検出して自動クローズしやすい
   - 一方 exec すると claude 異常終了時に shell に戻れず surface が即死する

## 関連

- fg 判定バグ調査 (DR-0006 周辺、2026-05-17 の journal)
- `cmux-msg stop` / `cmux-msg gc` の現仕様

報告者: kawaz (2026-05-17、fg 判定バグ調査セッション内)。本 issue は
論点整理のための起票であり、当該セッションでは着手しない。
