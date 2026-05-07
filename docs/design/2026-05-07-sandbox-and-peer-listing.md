# DR: 子CCサンドボックス境界と peer 列挙の整理

**日付**: 2026-05-07
**関連バージョン**: 0.7.0 予定
**前提**: 0.6.0（session_id 解決を by-surface index 化）

## 背景

0.6.0 で親子 CC 間の試験 (alice/bob による往復通信) を実施したところ、設計上は
正しく動くはずの場面で 3 種類の現象が観測された。

1. **`cmux-msg reply` が EPERM**
   bob が alice からのメッセージに reply しようとしたところ、
   `EPERM: open '/Users/kawaz/.local/share/cmux-messages/<ws>/<bob_sid>/inbox/<file>'`
   で失敗。bob 自身の inbox 配下のファイルへの書き込み拒否。

2. **`cmux-msg subscribe` が子CC内で動作しない**
   bob 起動直後の subscribe がハングまたは早期終了し、bob は fs polling に
   フォールバックした。

3. **`cmux-msg peers` の出力にゴミ・dead 蓄積**
   `by-surface` インデックスディレクトリが peer 行として表示される。
   過去の dead セッションが永続的に列挙され続ける。

## 課題分析

### 1. 子CC のサンドボックス境界と信頼モデル

Claude Code は `--dangerously-skip-permissions` を付けても、子プロセスへの
サンドボックス（cwd 配下以外への書き込み禁止）が掛かる。
`spawn.ts` は子の起動コマンドに `--dangerously-skip-permissions` のみで
追加ディレクトリを宣言していないため、子CCは `~/.local/share/cmux-messages/...`
への書き込みを拒否する。

これにより:
- `acceptMessage` の `fs.writeFileSync(src)` (lib/message.ts:141) → EPERM
- `replyMessage` 経由の同じ書き換え → EPERM
- `sendMessage` の `fs.writeFileSync(tmpFile)` → EPERM
- `cmuxSignal` 経由の `cmux send-signal` 自体は cwd 不問で通る場合がある
  （cmux 側のソケット通信のため）

**`reply` の所有権境界の設計は正しい**（bob は自分のディレクトリしか触らず、
alice への返信は `sendMessage` 経由で alice/inbox/ に新規ファイル配送）。
問題は「自分のディレクトリですら cwd 外なら書けない」という Claude Code 側の
制約。

#### 信頼モデル（脅威モデル）

`--add-dir` で workspace 配下を許可することは、**「同一 workspace 内の全 peer
は相互に信頼可能なモデル」を採用する**ことを意味する。具体的には:

- 子CC は、cmux-msg コマンドを介さず `fs` を直接叩けば、他 peer の
  `inbox/`, `accepted/`, `archive/`, `tmp/` を任意に読み書きできる
- これは cmux-msg の **コード境界** ではなく、**信頼境界** で守られる前提

採用根拠:

- cmux-msg は **個人開発者が自身のラップトップ上で複数の Claude Code
  セッションを協調動作させる** ための仕組み。全セッションは同一ユーザーが
  同一目的のために起動している
- workspace を分けている時点で「異なる作業」として cmux 側で隔離済み。
  クロスworkspaceの通信もそもそも提供しない
- 子CC が悪意あるコードを実行する可能性は、Claude Code 自体の信頼性
  (LLM の出力 + 実行ポリシー) に既に依存している。cmux-msg だけが追加で
  サンドボックスを掛けても全体の防御線にならない
- 強い隔離を実装するなら別経路（後述）が必要だが、本DRのスコープでは過剰

非採用案: **子CC は自分のディレクトリしか書けない sandbox + outbox/delivery
モデル**

- `--add-dir <MSG_BASE>/<workspace>/<child_session_id>` だけを許可
- 子は自分の `outbox/` にメッセージを書く
- 信頼できる配送主体（親 or daemon）が outbox を peer の inbox に転送

このモデルは将来検討する価値があるが、現状の simplicity を失う。本DRでは
信頼モデルを明文化する選択を採る。

#### 解決策

`claude` の `--add-dir <directories...>` オプションを使う。
spawn の起動コマンドに `--add-dir ${MSG_BASE}/<workspace>` を追加し、
子CC のサンドボックスに workspace 配下を明示的に許可する。

```
claude --session-id <uuid> --add-dir <MSG_BASE>/<workspace> --plugin-dir <root> ...
```

採用: `--add-dir ${path.join(MSG_BASE, getWorkspaceId())}`

`MSG_BASE` 全体（クロスワークスペース）は許可しない。workspace 単位の
信頼境界を維持する。

### 2. peer 列挙の境界

`wsDir()` は workspace のメッセージディレクトリ。直下には複数種のエントリが
混在する:

| 種別 | 例 | peer か |
|---|---|---|
| セッションディレクトリ | `f695cacc-14c6-...` | yes |
| ブロードキャスト擬似peer | `broadcast` | no（既に除外済み） |
| インデックス | `by-surface/` | no（**未除外**） |
| 内部状態 | `.last-worker-surface` | no（dotfile、`isDirectory()` で除外される） |

#### 解決策

「セッションディレクトリ」の判別を **UUID v4 形式** にする。これにより
将来追加されるインデックス類（例えば `by-name/`, `by-tab/`）も一律で除外できる。

```typescript
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

このパターンを `peers` だけでなく `spawn` の peer count（行 94）でも利用する。
重複を避けるため `lib/session-index.ts` か `lib/peer-refs.ts` 付近に
`isSessionId(name: string): boolean` を export する。

### 3. dead セッションの蓄積

`peers` が dead を含めて全件列挙する現状仕様は、過去のセッションを忘れた
ときの調査には便利だが、通常運用ではノイズ。

#### 解決策

- `peers` 既定: alive のみ
- `peers --all`: dead も含む全件
- 別途 GC は本DR では実装しない（破壊的なので別 issue で慎重に検討）

### 4. subscribe の動作確認

調査の結果、subscribe の実装は `cmux wait-for cmux-msg:<session_id>` 待ちの
ループで、ファイルシステム監視ではない。子CC で動かないのは以下の可能性:

- 子CC の cwd / sandbox から `cmux` バイナリ自体は呼べる（tell/screen は通る
  ことから確認済）
- ただし `cmux wait-for` は long-running blocking call。Claude Code の Bash
  ツール内でフォアグラウンド実行するとハング扱いになる
- 子の bob が「サンドボックスでは動かない」と判断した根拠は弱く、実際には
  Monitor + バックグラウンド実行で動く可能性が高い

#### 検証方針（本DRでブロッカー）

subscribe は spawned worker の通知駆動運用の根幹であり、これが壊れていると
試験全体が成立しない。本DR の実装と同時に、以下を**実機で検証**する。

1. 0.7.0 ビルドで alice/bob を spawn
2. bob 側で `Monitor` + `cmux-msg subscribe` を起動
3. alice → bob へ送信
4. bob が「行 = 新着メッセージ filename」を stdout で受け取れるか確認

**期待動作**:
- 各 send が `cmux send-signal cmux-msg:<recipient>` を発行
- bob の subscribe が `cmux wait-for` で受信 → `listInbox()` を回して新着 1 件分の JSONL を出力
- Monitor のイベントとして bob 側に通知

**検証で動かなければ**:
- `cmux wait-for` 自体の動作を `cmux` 側で確認（CLAUDE_PLUGIN_ROOT/PATH 解決問題か、cmux ソケット接続問題か）
- session-start.ts の spawned-worker 向け案内文に subscribe 起動例を改善

検証結果は本DRの末尾に追記する。検証で動作不能と確定した場合、本DRから
0.7.0 リリースを保留し、subscribe の修正を 0.7.0 のスコープに含める。

### 5. type 既定値（保留）

`request | response | broadcast` の 3 種固定。情報通知（完了報告など）に
`request` を使うのは違和感があるが、受信側の解釈は自由（type を見て分類して
ない）なので緊急性は低い。本DRのスコープ外。将来 `notice`/`info` の追加を
検討する。

## 実装変更

### `src/lib/session-index.ts` または新規 `lib/session-id.ts`

```typescript
export const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(name: string): boolean {
  return SESSION_ID_PATTERN.test(name);
}
```

### `src/commands/peers.ts`

- 列挙時に `isSessionId(sid)` でフィルタ
- 既定で alive のみ表示、`--all` で dead も含む
- ヘルプ追加

### `src/commands/spawn.ts`

- `claude` 起動コマンドに `--add-dir <MSG_BASE>/<workspace_id>` を追加
- peerCount の計算でも `isSessionId` でフィルタ（`broadcast` 除外の代わり）

### `src/cli.ts` / ヘルプ

- `peers [--all]` にヘルプ更新

### バージョン

- 0.7.0（後方互換あり、機能追加と挙動既定変更）

## 影響範囲

- 既存 spawn 済みの子CC は再 spawn しない限り旧挙動（EPERM）。0.7.0 リリース後の新規 spawn から sandbox 拡張が効く
- `peers` 既定変更により、CI スクリプト等で dead を期待しているケースがあれば `--all` 追加が必要（個人プロジェクトのため影響軽微）

## 検証結果（2026-05-07 実機テスト）

ローカルビルド (`bin/cmux-msg`) を直接呼び出し、alice2/bob2 を spawn → 春の
キャッチコピーを題材に往復通信を実施。前回試験 (alice/bob) で出た問題が
解消したことを確認:

| 項目 | 前回 (0.6.0) | 今回 (0.7.0 修正後) |
|---|---|---|
| `cmux-msg reply` の EPERM | 発生 | **解消** |
| `cmux-msg send` の EPERM | 発生（の可能性） | **解消** |
| 子CC で `subscribe` (Monitor 経由) | 諦めて fs polling へフォールバック | **正常動作** |
| `cmux-msg peers` に `by-surface` 混入 | あり | **解消** |
| `cmux-msg peers` に dead 蓄積 | あり | **既定で非表示**, `--all` で全件 |

bob2 の screen ログから抜粋:

```
⏺ Monitor(cmux-msg inbox 監視 (bob2))
  ⎿  Monitor started · task bevl4dllp · persistent
⏺ Bash(cmux-msg reply 20260507T115118-5572e0e5.md "...")
  ⎿  返信送信 & アーカイブ完了
⏺ Bash(cmux-msg send 9c082e35-... "評価完了")
  ⎿  送信完了: 20260507T115137-85d726e6.md
⏺ cmux-msg reply でのEPERMエラーは確認されませんでした
```

実際の `claude` 起動コマンドラインに `--add-dir
"/Users/kawaz/.local/share/cmux-messages/8118E1E4-..."` が含まれていることを
spawn 時の screen で確認済み。

**結論**: 0.7.0 のスコープで解決済み。subscribe をブロッカー扱いから外し、
リリースへ進む。

## 不採用案

- **plugin.json に sandbox 設定を書く**: Claude Code plugin の宣言で
  permissions/additionalDirectories を書けるか不明。`--add-dir` で確実に通る
  ことが分かったため採用。plugin manifest 側の宣言に切り替えるべきと判明したら
  別 DR
- **GC コマンド**: dead セッションのディレクトリ削除は破壊的。inbox に未読が
  残っていれば「accept されないまま消える」リスクがある。設計余地が多いため
  別途検討
- **cwd 配下に MSG_BASE を移す**: cmux-msg は session 単位なので cwd 非依存
  にする方が筋がいい。cwd 配下に置くと多 workspace で衝突する
