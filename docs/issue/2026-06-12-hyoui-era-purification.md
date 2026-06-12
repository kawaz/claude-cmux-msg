# hyoui 時代の cmux-msg 純化方針 (messaging + state 正本への縮小)

起票: 2026-06-12、kawaz との議論より。
status: blocked (blocked_by: hyoui の --namespace 実装の安定化)

## 背景

hyoui (kawaz 製セッション管理基盤) の成熟により、cmux-msg の cmux 固有機能は
全て hyoui 側に対応物ができる:

| cmux-msg | hyoui 対応物 | 備考 |
|---|---|---|
| tell (キー入力注入) | `hyoui input <sid> wait-idle:2s text:... key:Enter` | wait 構文 (screen 文字列マッチ + rect 指定) あり。tty lock (他アタッチセッションを一時 ro 化) でシーケンス全体をトランザクション化 — tell に無かった注入競合の保証 |
| screen (画面読み取り) | `hyoui screen` | |
| spawn / stop | hyoui のライフサイクル管理 | |
| workspace グルーピング | `--namespace NS` (実装中) | cmux ws 自体が不要になる見込み |

messaging コアは DR-0008 で既に cmux 非依存 (sid 直接) を達成済み。

運用面でも `claude` コマンドを `hyoui run -- claude` のラッパースクリプト
(PATH 先頭、alias は非対話経路をすり抜けるので不可) にすることで、
全セッションが最初から hyoui 管理下に入り「後から掴む」問題自体が消える。
セッションは作業単位で短命なので数日で収束する。

## 方針: cmux-msg は messaging + state 正本に純化する

surface 操作のラッパーとしての価値は「sid → meta.json → surface_ref 逆引き」
だけであり、hyoui は最初から sid 相当で直接操作できるためラップ層の存在意義が
残らない。backend 抽象化 (cmux/hyoui アダプタ) はせず、丸ごと捨てる方向。

### 残存価値 (純化後のコア)

- **messaging**: send/reply/list/subscribe/broadcast/peers/... (sid 直接)
- **state 正本**: hook ベースの state トラッキング (idle/running/awaiting_permission/stopped)
  は画面推定でなく Claude 自身の自己申告であり、screen 文字列マッチより確実。
  hyoui の `input wait:` 条件から使える形で公開すると連携が綺麗

## TODO (hyoui namespace 安定化後に着手)

- [ ] surface 操作系 (tell/screen/spawn/stop) の deprecation
      (help / エラーで hyoui へ誘導 → 後のバージョンで削除)
- [ ] peers のグルーピング軸に ns を接続 (meta.json 記録 or env 読み)、ws 軸の扱い整理
- [ ] state 正本を hyoui の wait 条件から使いやすい形で公開するか検討
- [ ] by-surface index (CLAUDE_ENV_FILE バグ回避) の要否再評価
      (CLAUDE_CODE_SESSION_ID が安定供給されるなら不要化)
- [ ] **リネーム: cmux-msg → ccmsg (候補)**。名前自体が cmux 前提なので純化に合わせて改名。
      作業: plugin uninstall/install、ルール系・ワークフロードキュメント系の
      cmux-msg 言及の洗い出しと書き換え。作業量は小 (一瞬の話) だが漏れチェックは必要
