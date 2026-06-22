# DR-0018: notify の lifecycle (TTL 12 分 + catch-up window 60 秒)

- Status: Accepted (2026-06-23)
- Date: 2026-06-23
- Related: DR-0012 (event-driven subscribe), DR-0017 (notify payload schema), issue 2026-06-22-notify-subcommand-and-self-flag

## 背景

`notify` は軽量通知 = 即時指示 / 即時 alert が主用途。本文は陳腐化が速い (= 数分後には
古い)。subscribe stream に古い notify が大量流入すると、subscribe 再起動時に
「数時間前の "Monitor で `just watch` を起動して" が今頃届く」事故になり、AI が
コンテキスト不在で誤実行する。

一方、subscribe 再起動の正常タイムラグ (= 数秒 〜 数十秒) で発生した notify は
救済したい (catch-up)。

両者を両立する: **短い TTL + subscribe 起動時刻ベース emit + 短い catch-up window**。

## 決定

### 1. notify inbox file の TTL: 12 分 (固定)

- 範囲: 10-15 分 (issue 内議論済み) の中央値
- 12 分を超過した notify file は **subscribe が遭遇した時点で unlink** (lazy cleanup)
- gc コマンドからも同条件で削除可能 (将来追加検討、必須ではない)
- TTL の根拠: notify は即時指示前提、5 分以上前の指示は context 切り替わりリスクが高い。
  10 分は短すぎ / 15 分は長すぎる体感 (= push 完了通知の妥当な猶予幅)
- 設定で長期化させる選択肢は当面提供しない (= 長期通知が欲しいなら `send` を使う、軸分離)

### 2. subscribe stream emit 戦略

| notify 到着タイミング (file created_at) | subscribe stream emit | inbox file 保管 |
|---|---|---|
| subscribe 起動時刻 **以降** | emit (通常経路) | TTL までは残る |
| 起動時刻 **直前 N 秒以内** (catch-up window) | emit (タイムラグ救済) | TTL までは残る |
| それより古い (catch-up window 外) | **emit しない** | TTL までは残る (history で参照可) |
| TTL 超過 | emit しない | **unlink** (lazy) |

- catch-up window: **60 秒 (固定)**。実運用で調整したい場面が出たら次の breaking で
  オプション化を検討するが、現時点は YAGNI で expose しない (= CLI 表面を綺麗に保つ)
- 既存 send 経路 (= type != notify の file) は本制約の対象外 (= watermark ベースの既存挙動)

### 3. 実装ポイント

- subscribe 起動時に `subscribeStartedAt` を記録 (= 起動時刻、monotonic ではなく wall clock)
- inbox rescan 時、notify file (frontmatter type=notify) について:
  1. `created_at < subscribeStartedAt - 60s` → emit skip
  2. `now - created_at > TTL` → emit skip + unlink (lazy cleanup)
  3. それ以外 → 通常 emit (text 同梱、DR-0017)
- send 系 file は既存ロジックそのまま (= type != notify は TTL/catch-up 適用外)
- catch-up window は定数 `NOTIFY_CATCH_UP_SECONDS = 60` で固定 (= CLI 表面に
  expose しない、運用要件が出てから expose 判断)

### 4. history / read には残す

- TTL 内であれば `cmux-msg history` / `read <filename>` で notify file は読める
- subscribe stream に流れなかった古い notify も file が残っていれば追跡可能
- TTL 超過後は file 自体が消えるので history からも消える (= 軽量通知の性質に沿う)

## 不採用

- **TTL を設定可能にする**: 短期通知が本質なので可変にすると軸がぶれる。「長期通知が欲しい」
  という要求が出たら、それは `send` の用途。`notify` は短期固定。
- **catch-up window を 5 分等に長く取る**: 5 分前の指示は context が変わっている可能性大。
  60 秒は「subscribe 再起動の正常タイムラグ」を吸収する最小値で、それ以上は誤実行リスクが
  TTL 設計と矛盾する。
- **TTL 超過 file の即時 unlink (cron / background sweep)**: subscribe rescan 時の
  lazy cleanup で十分。常駐 sweeper を追加すると複雑性が増す。
- **broadcast-style notify (= 軸宛 notify)**: 初版では `--to <sid>` と `--self` のみ。
  軸宛 (e.g. `--to repo:foo`) は仕様確定後に拡張可能だが、初期スコープ外。
- **TTL を file ベースでなく DB で管理**: 既存 inbox レイアウト (file + frontmatter) と
  揃えるほうが history / accept / read 互換性で得が多い。

## 影響範囲

- `src/commands/subscribe.ts`: subscribeStartedAt 記録、rescan で notify TTL / catch-up
  フィルタリングと unlink
- `src/lib/inbox.ts`: InboxMessage に created_at parse (既存にもあるはずだが notify
  判定用にアクセスしやすく)
- `src/lib/subscribe.ts`: diffInbox に notify フィルタリング委譲 or subscribe.ts 側で前処理
- `src/commands/notify.ts` (新規): TTL 自体は subscribe 側で enforce するので送信時は
  記録不要。frontmatter に type=notify を立てるだけ
- tests: subscribe の catch-up / TTL フィルタリング、unlink 動作
- skills/cmux-msg/SKILL.md: notify lifecycle 説明追加

## 補足: なぜ TTL を 12 分にしたか

- 5 分: cache miss 体感の境界 (Anthropic prompt cache TTL と一致は偶然)。短すぎる
- 10 分: 短期 push 完了通知としては OK だが `just watch` 起動など遅れた処理に厳しい
- 12 分: AI が他作業に没頭していても 1 回 user prompt サイクル (= 数分) を挟んで気付ける
  最大幅、かつ "古い指示の誤実行" を起こすほど長くない
- 15 分: ぎりぎり許容範囲だが、長すぎる感
- 30 分以上: notify ではなく send 領域 (= 長文 / 永続記録向け)
