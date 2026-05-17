# 2026-05-17 subscribe 起動中の終了挙動と background-work 警告

`cmux-msg subscribe` を Monitor ツール (persistent) で起動した状態でセッションを
終了するときの挙動を実測した。

## 背景

SKILL.md の推奨どおり subscribe を Monitor (`persistent: true`) で起動すると、
そのプロセスは Claude Code harness の追跡対象 background work になる。
このためセッション終了時に `Background work is running / Exit anyway / Stay`
プロンプトが出る。「これを hook で自動承認・抑止できないか」が発端。

## ハマり所 → 結論

**hook では終了プロンプトを消せない**:

- settings.json に「background work があっても警告せず終了」する設定は存在しない
- SessionEnd hook は cleanup 専用で exit code / JSON 出力が無視される。UI を操作できない
- そもそも SessionEnd hook はユーザが終了を確定した「後」に発火するのでプロンプトより遅い
- hook (シェルコマンド) から Monitor ツールは起動できない (hook が呼べるのは Bash と
  MCP tools のみ、Claude Code ネイティブツールは不可)。resume 時の自動 subscribe も
  「SessionStart hook の system-reminder で AI に促す」半自動が限界

## 実測した終了方法ごとの挙動

| 終了方法 | background-work 警告 | プロセス終了 |
|---|---|---|
| Ctrl+C ×2 | **出る** (毎回) | 警告を承認すれば終了 |
| `/exit` (ローカル) | **出ない** | 終了する |
| `/exit` (remote-control 経由) | 出ない | claude プロセスごと終了 |

## 学び

- **`/exit` は background-work 警告を一切出さずに終了する**。Ctrl+C ×2 との明確な差。
  `/exit` は明示的終了コマンドなので harness が確認を省く設計と思われる
- **remote-control からも `/exit` でセッション (claude プロセス) を完全終了できる**。
  リモートで放置セッションを畳めるのは実用上大きい
- したがって「終了プロンプトを避けたい」の答えはシンプル: **Ctrl+C ×2 をやめて
  `/exit` を使う**。hook も設定変更も不要

## 根本的なトレードオフ (記録として)

subscribe の新着を AI が能動検知したいなら選択肢は2つで、両立しない:

- Monitor (persistent) で起動 → AI が stdout を見て能動検知できる / 終了プロンプトが出る
- hook で detached 起動 → 終了プロンプトは出ない / AI に出力が届かず能動検知できない

現状の SKILL.md の方針 (Monitor で起動) が能動検知を取った結果であり、終了プロンプトは
その仕様上の代償。`/exit` を使えば代償も実質ゼロになる。
