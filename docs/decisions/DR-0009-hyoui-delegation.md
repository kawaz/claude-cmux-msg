# DR-0009: surface 操作系 (tell / screen / spawn / stop) を hyoui に委譲

- Status: Proposed
- Date: 2026-06-16
- Supersedes: [DR-0007](DR-0007-resume-resilient-session-identity.md) (tell 安全境界の根拠が hyoui 側に移譲、tty→surface 逆引きが不要に)
- Related: [DR-0004](DR-0004-session-as-primary-key.md) (sid 主体), [DR-0010](DR-0010-drop-cmux-environment-requirement.md) (cmux 環境必須を全廃), [DR-0011](DR-0011-drop-tell-command.md) (input-guard 縮退)
- hyoui 参照: hyoui DR-0013 (screen state 正本管理), DR-0018 (namespace), DR-0020 (self-session / HYOUI_SESSION_ID)

## 背景

kawaz は本日 (2026-06-16) cmux 使用を停止し ghostty + hyoui (透明 PTY companion) に運用を切替えた。理由は cmux が claude を勝手にラップする挙動など制御性の問題。

cmux-msg は cmux 前提で tell (キー注入) / screen (画面取得) / spawn (新規 claude 起動) / stop (kill) を実装してきたが、これらは cmux 廃止に伴い別 host に乗せ替える必要がある。
hyoui は `claude --session-id <uuid>` を PTY で possess し、外側から `input` / `screen` / `kill` / `list` / `lock` を提供する CLI を持つ。cmux-msg の surface 操作系を hyoui に委譲することで、

- tell の TOCTOU / fg 判定の責務を hyoui の state-based wait + auto-lock に移譲できる
- sid → 操作対象が hyoui session selector で 1:1 (= surface 逆引き不要、DR-0007 の核心が解消)
- AI agent から claude TUI への自動操作で実機練習でメッセージング経路は問題なく動作 (cmux-msg send → 子の inbox 着弾を実機確認、2026-06-16)

## 決定

### 1. 機能マッピング

| cmux-msg コマンド | 旧 (cmux) | 新 (hyoui) |
|---|---|---|
| `tell <sid> <text>` | cmux surface 逆引き → `cmux send` + `send-key Return` | **廃止** (DR-0011)。hyoui input の構文・実践は dogfood 不足で今後変わる見込みなので、中途半端な依存を持たず一旦忘れる |
| `screen <sid>` | `cmux read-screen <surface>` | `hyoui screen dump <sid>` (snapshot --format=json は hyoui 側未配線、当面 dump の ANSI を使う) |
| `spawn [name]` | `cmux new-split` + `cmux send claude --session-id ...` + 起動完了待ち | `hyoui run --detached --session=<uuid> -- claude --session-id <uuid> [args]` |
| `stop <sid>` | `cmux close-surface` | `hyoui kill <sid>` |

### 2. uuid を hyoui session selector と claude `--session-id` の両方に同じ値で渡す

spawn 時に親が `crypto.randomUUID()` で UUID を採番し、

```bash
hyoui run --detached --session="$UUID" -- \
  claude --session-id "$UUID" --dangerously-skip-permissions [args]
```

hyoui の session 名と claude 内部 session_id を同じ値に揃えることで、後から `hyoui screen dump <UUID>` / `hyoui kill <UUID>` で操作対象が一意確定する。

### 3. hyoui namespace は使わない (= default namespace に直接置く)

cmux-msg 起動の claude を `hyoui list` で他用途と区別する必要は実用上薄い (= 同じ kawaz の作業のなかで区別する意味が無い)。
代わりに、将来 hyoui に **session への複数 label 付与** (= 単一文字列の複数タグ) が入れば、それで `app=ccmsg` のようにマーキングする。

- 練習セッション (2026-06-16) で `--namespace=cmuxmsg-test` を試したが、namespace は 1 軸の隔離で、cmux-msg 起動 claude を他用途とリストレベルで分離するほどの必然性は無いと判断
- label 要望は hyoui 側に起票: `kawaz/hyoui/main/docs/issue/2026-06-16-feature-session-labels.md`

### 4. 廃止される機能

- spawn 後の自動 prompt 注入 (`/color` / `/rename` / "inbox を確認してください"): 役目を終えたので廃止 (Q1 確定、2026-06-16)
- screen による Claude Code remote URL 文字列マッチ (`pollRemoteUrl`): 当面 `hyoui screen dump` の ANSI strip + 同じ regex で代替、hyoui `screen snapshot --format=json` 配線後にそちらへ移行

## 採用 (= 当初不採用としていたが方針転換)

- **tell を完全廃止する**: 当初は「スラッシュコマンド (`/exit`, `/compact`) が send で代替不能だから限定維持」と書いたが、kawaz 確認で **「中途半端に古いものを残す必要はない、ちゃんと忘れる」「hyoui input の構文・実践は dogfood 不足で今後変わる」** を踏まえて完全廃止に変更。
  - cmux-msg は subscribe / send / read のメッセージング router に純化
  - 将来 hyoui input が安定し、かつスラッシュコマンド注入の需要が確認されたら、その時点で改めて DR を立てて再導入を検討
  - 詳細は [DR-0011](DR-0011-drop-tell-command.md) (= tell コマンド + tell-guard.ts 全削除)

## 不採用

- **cmux / hyoui の両 backend を抽象化して driver で切替**: cmux はもう使わないため抽象化のコストが見合わない (hyoui-era-purification.md の議論結果と整合)。backend 抽象は将来別 host (kitty / wezterm 等) への対応で必要になれば改めて検討。
- **uuid と hyoui session 名を分離する**: 別値にすると操作のたびに対応表が要る (= DR-0007 で苦労した tty→sid 逆引きと同じ問題が再発)。揃えるのが筋。
- **hyoui namespace `cmuxmsg` で隔離する**: 1 軸の隔離は cmux-msg 起動 claude を他用途と区別するほどの必然性がない (= 同じ kawaz の作業のなかで隔離する意味が薄い)。将来 hyoui に複数 label が入ったら `app=ccmsg` 相当のマーキングだけ付ける運用を検討。

## hyoui 側の既知 issue / 要望

- **`hyoui screen snapshot --format=json` 未配線**: 当面 `screen dump` の ANSI strip で代替
- **`hyoui input` で text + key:Enter の 1-invocation 連続実行が動かない**: 2026-06-16 実機検証で発見、hyoui 側に issue 起票済 (`kawaz/hyoui/main/docs/issue/2026-06-16-bug-input-text-key-enter-not-sent.md`)。**本 DR で tell を完全廃止したため、cmux-msg 側ではブロッカーではない**
- **session への複数 label 付与 (要望)**: 単一軸 namespace でなく、`app=ccmsg` のような複数 label 付与が hyoui session で可能になれば `hyoui list --label app=ccmsg` で絞れる。`kawaz/hyoui/main/docs/issue/2026-06-16-feature-session-labels.md` で起票

## 影響範囲

### 削除されるファイル

- `src/lib/cmux.ts` / `cmux.test.ts`
- `src/lib/cmux-surface.ts` / `cmux-surface.test.ts`
- `src/lib/peer-refs.ts` / `peer-refs.test.ts`
- `src/commands/tell.ts` (DR-0011 で tell コマンド廃止)
- `src/lib/tell-guard.ts` / `tell-guard.test.ts` (DR-0011 で全削除)

### 書き換えられるコマンド

- `src/commands/screen.ts`: `cmuxReadScreen` を `hyoui screen dump` に置換
- `src/commands/spawn.ts`: `cmuxNewSplit` / `cmuxSend` 系を `hyoui run` に置換 (CMUX_* env 継承削除、自動 prompt 注入削除、namespace 指定なし)
- `src/commands/stop.ts`: `cmuxCloseSurface` を `hyoui kill` に置換

## 段階的移行

1. **A 並行ドリフト** (任意): `hyoui run --detached -- claude` ラッパースクリプトを PATH 先頭に配置し、既存 claude セッションが自然消滅、新規が hyoui 配下に入る数日のドリフト期間を作る (issue 2026-06-12-hyoui-era-purification.md L21-24 で kawaz 言及済)。
2. **B 削除**: DR-0010 と同 PR で cmux 系ファイル削除、`requireCmux()` / `CMUX_*` env 削除。
3. **C 書換**: `commands/{tell,screen,spawn,stop}.ts` を hyoui CLI 呼出に書換。
4. **D DR-0011 入力 guard 縮退**: `tell-guard.ts` → `input-guard.ts` に薄化。
5. **E 1.0.0 bump** (DR-0013 / DR-0014 と統合)。

## 関連 issue / docs

- `docs/issue/2026-06-12-hyoui-era-purification.md`: 本 DR + DR-0010 で母体 issue の主要部分を解決
- `docs/issue/2026-05-09-spawn-claude-not-launching.md` 他 cmux 起動失敗系: DR-0010 で削除
- hyoui `docs/issue/2026-06-16-bug-input-text-key-enter-not-sent.md`: tell 実装時の hyoui 側課題
