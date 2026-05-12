# DR-0005: claude_home 壁を実装に落とす (デフォルト軸 = home)

- Status: Accepted
- Date: 2026-05-12
- Refines: [DR-0004](DR-0004-session-as-primary-key.md) (軸なし挙動を変更)

## 背景

DR-0004 で「同一マシン上で `CLAUDE_CONFIG_DIR` を使い分けて複数 Claude アカウント
(例: 個人 `~/.claude` + 仕事 `~/.claude-work`) を運用する場合、情報セキュリティ的
な壁が一応ある」と書いたが、実装上の境界は何も無かった。共有 base に全 home の
peer が同居し、`peers` / `broadcast` で `--by home` を明示して初めて分離される。

DR-0004 では「軸なしは help (peers) / error (broadcast)」が決定された。これは
「グルーピングは多軸あるので明示しろ」の意図だったが、運用してみると:

- 普段の操作は同一 home 内で完結する (個人作業中は個人アカウントの peer に話す)
- 別 home に意図して送るのは稀
- 「軸なしで help」は毎回 `--by home` を打つ手間が増えるだけで、家庭的な配慮になる

つまり「壁が一応ある」を本気で実装するなら、デフォルトを `--by home` にして
**明示しない限り自 home 内に閉じる**のが筋。

## 決定

### 1. peers / broadcast の軸なしデフォルトを `--by home` 自動付与に変更

```bash
# 軸なし → 自動で --by home が付く (自 claude_home に閉じる)
cmux-msg peers                # = cmux-msg peers --by home
cmux-msg broadcast "hello"    # = cmux-msg broadcast --by home "hello"

# 明示的に壁を破る
cmux-msg peers --all
cmux-msg broadcast --all "hello"

# 軸を切り替え
cmux-msg peers --by ws        # claude_home を問わず ws 一致
cmux-msg peers --by home --by ws  # 従来通り AND 結合も可能
```

`--help` は `--help` / 引数フラグ無しでも別途取れるよう、サブコマンドのヘルプは
`--help` フラグで表示する形に統一。

### 2. send / tell / screen に cross-home warning (block しない)

```bash
# peer の claude_home が自分と違う場合、stderr に warning
cmux-msg send <peer-in-other-home> "msg"
# [warning] peer <sid> is in a different claude_home
#   peer: /Users/foo/.claude-work
#   self: /Users/foo/.claude
# 送信は実行される
```

block しない理由: send は sid を知ってる前提で送る意図的な操作。block すると
`--cross-home` のようなフラグが日常的に必要になり UX が悪化する (kawaz の指示)。
warning だけ出して気づける状態にすれば事故を防げる。

### 3. `--all` 心理的ハードルへの自衛

`--all` を癖で書くようになると壁が日常的に破られるリスクがある (DR-0004 で kawaz
が指摘済み)。対策はドキュメント側で「`--all` は別 home の peer も含む点を意識的に
使う」と注意喚起する。CLI 側で `--all` に確認プロンプトを出すのは UX 悪化なので
行わない。

## 代替案と不採用理由

- **send / tell に block ガード**: 「sid を知ってる = 意図的な操作」なので block は
  過剰防衛。`--cross-home` フラグが必要になると UX 悪化 (kawaz 確認済み)
- **base 階層を `${claude_home}/cmux-messages/` に分離 (DR-0004 で不採用済み)**:
  同 OS user で pgrp 同じなので OS レベル隔離不可。共有 base + filter デフォルト
  のほうが「他 home の peer も知ろうと思えば知れる」柔軟性を維持できる
- **デフォルト挙動を変えずヘルプで誘導**: 現状の軸なし = help/error が「壁の実装」
  になっていないので不採用

## 互換性

破壊的変更だが、kawaz の dogfood 範囲なので問題なし (Phase 2 系の互換性ガード
不要)。動作変更点:

- `cmux-msg peers` (軸なし): 旧は help 表示、新は自 home 内列挙
- `cmux-msg broadcast <msg>` (軸なし): 旧は error、新は自 home 内 broadcast

ヘルプは `cmux-msg peers --help` / `cmux-msg broadcast --help` で明示取得。

## 影響範囲

- `src/commands/peers.ts`: 軸なし時の help 終了を削除、`--by home` 自動付与
- `src/commands/broadcast.ts`: 軸なし時の error を削除、`--by home` 自動付与
- `src/commands/send.ts`: cross-home warning 追加
- `src/commands/tell.ts`: cross-home warning 追加 (state ガードの前に出す)
- `src/commands/screen.ts`: cross-home warning 追加 (peer 指定時のみ)
- `src/lib/meta.ts`: `warnIfCrossHome(peerMeta)` ヘルパ追加
- tests: 新デフォルト挙動 / cross-home warning のテスト追加
- docs: SKILL.md / README / cli.ts HELP / completions に反映

## 関連

- DR-0004: sid 一意化と軸明示の決定 (本 DR で軸なしデフォルトを上書き)
