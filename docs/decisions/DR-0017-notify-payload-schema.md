# DR-0017: notify subcommand の payload schema (event_type 並列 + text 同梱)

- Status: Accepted (2026-06-23)
- Date: 2026-06-23
- Related: DR-0012 (event-driven subscribe), DR-0014 (stdin body 標準化), issue 2026-06-22-notify-subcommand-and-self-flag

## 背景

cmux-msg に軽量通知の `notify` subcommand を追加するにあたり、subscribe stream
emit payload の schema 拡張方針を決める必要がある。

既存の subscribe stream payload (`src/commands/subscribe.ts::emit`):

```json
{
  "filename": "...",
  "from": "<sid>",
  "priority": "normal|urgent",
  "type": "request|response|broadcast",
  "created_at": "...",
  "in_reply_to": "..."
}
```

`type` は **message semantic** (request/response/broadcast) を担う。`notify` は
これとは異なる **transport / event semantic** (= 1 段で本文込みの軽量通知) なので、
既存 `type` 列挙に並列追加すると「semantic 軸が混在する」schema 退化が起きる。

議論メモ (issue 内 2026-06-22 セッション) の 3 案:

| 案 | 内容 | 評価 |
|---|---|---|
| A | `event_type` (`send`/`notify`) と `message_type` (既存 type を改名 / 維持) を分離 | 軸が綺麗。既存 `type` を残せば後方互換 |
| B | `schema_version` を導入 | バージョン管理は重い。本件規模では over-engineering |
| C | `notify` を message_type の一種として追加 | 簡素だが将来の semantic 衝突リスク |

## 決定

### 1. event_type を新規追加、既存 type は維持 (案 A 派生)

subscribe stream payload に **新フィールド `event_type`** を追加する:

| event_type 値 | 意味 | 既存 type フィールド | 追加 text フィールド |
|---|---|---|---|
| `send` (デフォルト) | 既存の send 経路 (本文は read で取る) | `request`/`response`/`broadcast` (既存と同じ) | 含めない |
| `notify` | 軽量通知 (本文を inline で同梱) | `notify` (固定値) | 必ず含める |

emit 後の payload 例:

```json
// 既存 send (event_type 未指定 = send と同義、後方互換保証)
{
  "filename": "...",
  "event_type": "send",
  "from": "<sid>",
  "priority": "normal",
  "type": "request",
  "created_at": "...",
  "in_reply_to": null
}

// notify (text 同梱)
{
  "filename": "...",
  "event_type": "notify",
  "from": "<sid>",
  "priority": "normal",
  "type": "notify",
  "created_at": "...",
  "in_reply_to": null,
  "text": "Monitor で `just watch` を起動して"
}
```

### 2. 既存 consumer は壊さない

- 既存の subscribe 読み手は新しい `event_type` フィールドを無視するだけで動作継続
- `event_type` が無い payload は `send` として扱う (= 後方互換)
- 既存の `type` フィールドはそのまま維持。message semantic を担う

### 3. inbox file (frontmatter) も同様に拡張

`type: notify` を frontmatter に持たせる (既存の `request|response|broadcast`
列挙に並列追加)。本文は body にそのまま入る (= send と同じレイアウト)。
これにより既存 send インフラ (sender.ts, inbox.ts, history.ts) を再利用できる。

### 4. text フィールドのサイズ上限

- subscribe stream の text フィールドに含める本文は **64 KiB 上限** (実装側で truncate)
- 上限を超えた場合は `text` 末尾に `...(truncated)` を付け、full body は inbox file から read 可能
- 軽量通知の用途では 64 KiB は十分すぎる余裕 (実運用は 100 文字程度の指示が想定)

## 不採用

- **schema_version 導入 (案 B)**: 1 ファイルの 1 行 JSONL に version 列を持つのは過剰。
  事後の breaking change は別 DR で個別判断する。
- **type 値に `notify` を直接追加 (案 C)**: message_type と event_type の semantic 軸が
  混ざる。将来「notify response」「notify broadcast」が必要になった時に分離できなくなる。
- **`type` を `message_type` に rename**: rename は breaking change。既存読み手 (テスト
  含む) を全更新するコストに見合うほどの設計改善ではない。`type` の含意が「message_type」
  なのは README / SKILL に明記すれば足りる。
- **body を file ではなく DB sessions に持つ**: notify でも file レイアウトを揃えることで、
  既存の history / accept / dismiss / archive 経路をそのまま使える。codex 指摘の D2
  「監査・履歴モデル外し」を回避する効果もある。

## 影響範囲

- `src/lib/sender.ts`: notify 経路で frontmatter type=notify を許容
- `src/commands/subscribe.ts::emit`: event_type / text フィールドを payload に追加
- `src/lib/inbox.ts` の `InboxMessage` 型: event_type / type=notify サポート
- 新規 `src/commands/notify.ts`: notify 専用送信ロジック
- skills/cmux-msg/SKILL.md: payload schema 記述更新
- 既存テスト: send 経路は payload に event_type='send' が乗ることを確認

## 補足: なぜ event_type を分離するか

`type` は message_type (request/response/broadcast = どんな意図のメッセージか)、
`event_type` は transport mode (send=本文後追い / notify=本文同梱 / 将来 broadcast
event 等) を分ける。**何を伝えるか** と **どう伝えるか** は別軸で表現するのが
schema として綺麗で、subscribe 読み手が「届いたら即実行か read してから判断か」を
event_type だけで分岐できる (= AI rule の組み立てが楽)。
