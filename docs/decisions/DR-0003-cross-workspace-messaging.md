# DR-0003: workspace 横断のメッセージング

- Status: Accepted
- Date: 2026-05-11
- Related: [docs/issue/2026-05-11-cross-workspace-messaging.md] (起票元、解決後 delete)

## 背景

`cmux-msg send/tell/screen` は宛先 session_id を取るが、`peerDir()` が自 workspace
配下 (`<CMUXMSG_BASE>/<myWs>/<sid>/`) しか向かない実装になっていた。
別 workspace で動く Claude セッション同士の連携 (例: バックエンド実装担当と UI 試験
担当を別 workspace に置く運用) が `meta.json なし` で蹴られていた。

emeradaco/antenna PR #2032 で実際にこのユースケースが発生し、GitHub PR コメント
中継で運用回避した。同様の運用は他にもありそう。

## 決定

`peerDir(sid)` を **2 段解決** に変更する:

1. **自 workspace 優先**: `<base>/<myWs>/<sid>/` を先に試す (同一 ws 内通信は今まで通り)
2. **全 workspace 走査 fallback**: 見つからなければ `<base>/*/<sid>/` を走査して
   最初にヒットした workspace 配下を返す
3. 見つからなければ自 ws 配下のパスを返し、呼び出し側 (sendMessage 等) の
   `existsSync` チェックで「宛先が見つかりません」エラーを出す (既存挙動と同じ)

session_id (UUID v4) は cmux-messages 配下で workspace 横断的に一意な前提なので、
走査結果は曖昧にならない。`tell` / `screen` も `peerDir()` 経由 (`peer-refs.ts`)
なので同じ修正で自動的に cross-workspace 対応する。

`peers` コマンドには `--all-workspaces` (alias: `--global`) フラグを追加し、
全 workspace のピアを `ws=` 列付きで一覧表示できるようにする。

`broadcast` のデフォルト挙動は同一 workspace に閉じたまま変更しない (誤送信防止)。

## 代替案と不採用理由

- **案 B: `--workspace <id>` 明示フラグ** — UUID 一意性で曖昧さは生じないため、
  ユーザに workspace_id を調べさせる UX 悪化のメリットがない。不採用。
- **案 C: peers を `<ws>/<sid>` 形式で扱う / send もこの形式の宛先を受ける** —
  session_id だけで識別子を完結できる UUID 設計を壊す。不採用。
- **`<base>/by-session/<sid> → <ws>` index** — 状態の真実 (`<ws>/<sid>/` ディレクトリ
  の存在) を二重化する。workspace 数は実用上高々 10〜20 で走査コストは無視できる。
  必要になったら後付け可能。Phase 1 では入れない。
- **`CMUXMSG_ALLOW_CROSS_WORKSPACE=1` のオプトイン化** — `~/.local/share/cmux-messages/`
  は単一ユーザ内、同一ホストで動くプロセス間の連携を意図する設計。追加のセキュリティ
  境界は不要。デフォルト ON で進める。

## 互換性

- 同一 workspace 内通信の挙動は完全に非破壊 (Step 1 で従来パスに到達するため)
- ホスト跨ぎは想定外 (`$CMUXMSG_BASE` の範囲内のみ)
- `sendMessage` の `sent/` hardlink は **送信者の workspace 配下** (`<myWs>/<mySid>/sent/`)
  → 別 ws の inbox との hardlink がクロス FS にまたがる環境 (mac の APFS volume 分割等)
  では既存の警告 fallback で「sent/ への hardlink 失敗」を stderr 出力して送信は成功
  扱いで続行 (現状の挙動を維持)

## 今後の発展

- Phase 2 で常駐ルータ (cmux-msgd) を導入する場合、本 DR の `peerDir()` 走査は
  ルータ in-memory レジストリへの問い合わせで O(1) 化される (走査は fallback として残る)
- 詳細は `docs/research/` 等で別途検討