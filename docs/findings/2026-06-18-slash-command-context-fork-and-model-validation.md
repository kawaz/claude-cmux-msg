# 2026-06-18 slash command の context: fork + model 切替の実機検証

cmux-msg の user slash command (= `/cmux-msg:list` 等の薄い bash 橋渡し) を最軽量モデルで動かしたいモチベーションから、Claude Code v2.1.181 + kawaz の Max plan で skill/command の `model` field と `context: fork` field の実機挙動を検証した記録。

## 判明した事実

### 0. **opus は単純 bash 橋渡しで「無駄なハイエフォート思考」を発動して遅い、haiku は straight execution で早い**

検証 `test-opus` / `test-opus-pinned` (= `date` 1 つ実行して 1 行宣言するだけ) で、opus 系は実行に **~9 秒** かかっていた。kawaz 観察によると「無駄にハイエフォートな思考をするせい」。

これは `effort` field の仕様と整合:
- opus 系は effort=high (default、xhigh on Opus 4.7) → 単純 task でも extended thinking する
- haiku は effort 非対応 (公式 docs: "Models not listed here do not support effort") → straight execution、即応

つまり cmux-msg の薄い bash 橋渡しでは:
- haiku: 早い + 安い + thinking なし
- opus: 遅い (9s) + 高い + 無駄な reasoning

→ 軽量 task ほど haiku の有効性が高い。`context: fork` + `model: haiku` の組み合わせが採算最適。

### 1. `commands/<name>.md` でも `context: fork` + `agent` が動く

公式の `claude-plugin-reference` (`reference/commands.md` §3 field 表) には `context` / `agent` が **未掲載**だが、実機で動作する。

- 検証 v0.30.10 で `commands/test-sonnet.md` に `model: sonnet` + `context: fork` + `agent: general-purpose` を設定 → メイン session が opus-4-7[1m] で 1M context を使用中の状態で `/cmux-msg:test-sonnet` を叩いて、API Error なく動作した
- `context: fork` 無しの同 command (v0.30.9) では同じ状態で `API Error: Usage credits required for 1M context` で失敗していた → fork が有効化されたことで fresh context の subagent に切り替わったと判明

reference 上は `context` / `agent` は **skill 固有 field** として `skills.md §9` に記載されているが、reference §1 で「commands は runtime 上は skills と同一機構」と説明されている通り、commands でも有効と実証された。

### 2. メイン session の context size が、`model` 切替時の挙動に直結する

`context: fork` を付けない (= 親 context を引き継ぐ) 状態では、メイン session の context 使用量が target model の context window を超えると command 実行時に失敗する。

| `model` 指定 | メイン 1M 使用中での挙動 |
|---|---|
| `haiku` | ✗ `Context limit reached` (haiku に 1M alias なし、200K のみ) |
| `sonnet` (alias) | ✗ `API Error: Usage credits required for 1M context` (sonnet[1m] は Max plan でも credit 課金、200K 推測で送って 1M context を含んだリクエストになる) |
| `sonnet[1m]` | ⚠ 動くが usage credit が課金される |
| `opus` (alias) | ✓ OK (Max plan auto 1M upgrade) |
| `claude-opus-4-*` (full name) | ✓ OK (auto 1M upgrade は full name でも効く、docs の「`[1m]` suffix が必要」記述は API レベルの話) |

### 3. `sonnet` で context limit に達した後、メイン session が「Context limit reached」状態に陥り、継続不能になる事故あり

検証中に `/cmux-msg:test-sonnet` (= context: fork 未設定の状態) を叩いて API Error が返った後、メイン session 自体が `/model` 切替も含めて全リクエストで `Context limit reached` を返すようになった。`/clear` も効かず、claude session 終了 + `/resume` で復旧した。

→ slash command の model 切替で安全策を取らないと、メイン session 自体が事故 (= 復旧コスト) を起こす。

### 4. 解の組み合わせ

slash command で「メイン session の context size に依存せず安全に最軽量で動かす」設定:

```yaml
---
disable-model-invocation: true
model: haiku                   # 最軽量、200K で十分
context: fork                  # 親 context 非継承、fresh context で実行
agent: general-purpose         # subagent type
---
```

これで:
- メイン session が 1M context 使用中でも安全 (= fork 後の subagent は fresh)
- haiku で最軽量実行 (= 1 コマンド叩いて結果返す用途には十分)
- API Error / context limit reached の事故ゼロ
- 軽量化と安全性の両立

## 実用的な示唆 / ベストプラクティス

### 公開済 plugin の user slash command (= bash 橋渡し系) の推奨 frontmatter

```yaml
---
description: <一行説明>
argument-hint: <pattern>       # 任意
disable-model-invocation: true # AI listing から hidden、user-only
model: haiku                   # 最軽量
context: fork                  # 親 context 非継承 (= 必須、これが無いと事故る)
agent: general-purpose         # subagent type
---
```

### やってはいけないこと

- **`context: fork` を付けずに `model` を切替える**: メイン session の context が target model の context window を超えると確実に事故る (= 軽量モデルほど危険)
- **`model: sonnet`** を context: fork 無しで指定: Max plan でも credit 課金扱いになり API Error
- **メイン session に opus-4-7[1m] 等 1M 使用設定で slash command を試験する**: 失敗時のメイン session 復旧コストが大きい (= 別 session / fresh shell で試験すべき)

### upstream (= claude-plugin-reference) への反映候補

- `commands.md` §3 field 表に `context` / `agent` を追加 (= 実機で動作確認済)
- `skills.md` §9 / `commands.md` に「`context: fork` 無しの `model` 切替はメイン session の context size に応じて失敗する」を [実機検証済] として追記
- 特に `sonnet` alias は Max plan で auto 1M upgrade されない (= credit 課金) ので、`context: fork` 無しで指定するのは事実上危険、を強調

## 検証の詳細

### 環境

- OS: macOS Darwin 25.5.0 (Apple Silicon)
- Claude Code: v2.1.181
- Plan: Max
- cmux-msg version: 0.30.5 〜 0.30.10
- メイン session: opus-4-7[1m] (= Opus 4.7 with 1M context、context 使用量 ~81%)

### マトリクス検証

各 model 指定での `context: fork` の有無による挙動を、メイン session が opus-4-7[1m] / 1M context 81% 使用中の状態で実測。

| 検証 command | model | context: fork | 結果 | 備考 |
|---|---|---|---|---|
| `_test-sonnet` → `test-sonnet` | `sonnet` | なし (v0.30.9) | ✗ `API Error: Usage credits required for 1M context` | 失敗後メイン session 不安定化 |
| `test-sonnet` | `sonnet` | あり (v0.30.10) | ✓ 動作、結果返却 | fork 有効化で API Error 解消 |
| `test-sonnet-1m` | `sonnet[1m]` | なし (v0.30.7) | ✓ 動作 (= 課金あり) | usage credit 課金 |
| `test-opus` | `opus` (alias) | なし (v0.30.8) | ✓ 動作 | Max plan auto 1M upgrade |
| `test-opus-pinned` | `claude-opus-4-8` (full name) | なし (v0.30.8) | ✓ 動作 | full name でも auto 1M upgrade される |
| `list/read/peers/history/whoami/thread` | `sonnet[1m]` | なし (v0.30.6) | ✓ 動作 (= 課金あり) | 当時の cmux-msg 設定 |
| `list/read/peers/history/whoami/thread` | `haiku` | あり (v0.30.11) | ✓ 採用予定 | fork + haiku で context size 無関係 + 最軽量 |

### 関連: `_` prefix の補完挙動

検証 command を `_test-*` で作成したところ、`/cmux-msg:` までの補完候補に出てこない (= 先頭からの曖昧検索から hidden) が、`/cmux-msg:_` まで打てば候補に出る、と判明。

→ **公開済 plugin で「ユーザに普通には見せたくないが明示的に検索すれば叩ける hidden 試験 command」のベスプラ命名規約**として有用 (= `disable-model-invocation: true` と組み合わせれば AI からもユーザ補完からも見えない、明示的に叩ける隠し command が作れる)。

ただし、検証用途で kawaz が補完で見つけたい場合は `test-` prefix の方が UX 良い (= 補完で `/cmux-msg:test-` で見つかる)。本検証では検証用途のため後者を採用。

## 関連

- 起点: 2026-06-17 「ユーザ invocable な skill は単にコマンドを実行する橋渡し、haiku で十分なはず、確認してみて」
- 公式 docs (= 検証根拠):
  - https://code.claude.com/docs/en/skills.md (frontmatter reference)
  - https://code.claude.com/docs/en/commands.md
  - https://code.claude.com/docs/en/model-config.md (= model aliases / pinning / auto 1M upgrade)
- reference: `claude-plugin-reference` v0.2.16 の `skills.md` §6 (invocation 制御) / §9 (context: fork) / `commands.md` §3 (field 表に context/agent 未掲載 = upstream 改善材料)
- 次手: cmux-msg の 6 user commands に `context: fork` + `model: haiku` を適用 (v0.30.11 land 予定)
