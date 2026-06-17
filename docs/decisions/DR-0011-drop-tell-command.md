# DR-0011: tell コマンド廃止 + tell-guard 全削除 (中途半端に古いものを残さない)

- Status: Accepted (2026-06-17, kawaz 一括承認)
- Date: 2026-06-16
- Supersedes parts of: [DR-0007](DR-0007-resume-resilient-session-identity.md) (tell 安全境界の責務、tell 廃止に伴い消滅)
- Related: [DR-0009](DR-0009-hyoui-delegation.md) (hyoui 委譲、tell 完全廃止を確定), [DR-0010](DR-0010-drop-cmux-environment-requirement.md) (cmux 環境必須全廃)

## 背景

旧 `tell <sid> <text>` は cmux surface へのキー注入 (= スラッシュコマンド `/exit`, `/compact` などを送るための tty 入力エミュレーション) を実装してきた。`src/lib/tell-guard.ts` は安全境界として:

- proc lookup (= `ps -axww` で argv の `--session-id <uuid>` を照合)
- state 確認 (`idle` / `awaiting_permission` のみ許可)
- tty → `surface:N` 逆引き
- 注入直前の再照合 (TOCTOU 緩和)
- cross-home wall (DR-0005)
- 制御文字 / multi-line 拒否

を実装している。

DR-0009 で tell の hyoui 委譲 (`hyoui input` 経由) を検討していたが、kawaz 確認で:

- **「中途半端に古いものを残す必要はない、ちゃんと忘れる」**
- **「hyoui input の構文・実践はまだ dogfood 足りてないので今後変わる」**

を踏まえて、tell を維持するメリット (= スラッシュコマンド注入の限定使用) が、hyoui input の不安定な構文に依存する技術的負債を上回らないと判断。**完全廃止**に転換。

## 決定

### 1. `tell` コマンドの完全廃止

- `src/commands/tell.ts` 削除
- `src/cli.ts` の `tell` サブコマンド登録削除
- README / SKILL.md / hook prompt から tell 言及を削除

### 2. `tell-guard.ts` の完全削除

- `src/lib/tell-guard.ts` 削除
- `src/lib/tell-guard.test.ts` 削除
- screen も hyoui screen dump 委譲 (read-only、注入なし) なので guard 不要
- spawn / stop は外側プロセス起動・終了で安全境界を要さない

### 3. cmux-msg は subscribe / send / read のメッセージング router に純化

残るコマンド体系:

- ライフサイクル: `spawn` / `stop` / `gc`
- メッセージング: `init` / `whoami` / `peers` / `send` / `broadcast` / `list` / `read` / `accept` / `dismiss` / `reply` / `subscribe` / `history` / `thread`
- 読み取り系: `screen` (hyoui screen dump 委譲、注入なし)

`tell` を完全に消すことで、cmux-msg の責務範囲が「ファイル受信箱経由のメッセージング + プロセスライフサイクル + 画面読み取り」に純化される。

### 4. 復活条件

将来 tell 相当の機能 (= スラッシュコマンド注入 / TUI キー入力エミュレーション) を再導入する場合は、

- hyoui input の構文・semantics が安定 (= hyoui v1.x など) する
- スラッシュコマンド注入の具体ユースケースが kawaz の運用で複数回発生し、毎回手動で `hyoui input` を叩くのが煩雑

の両方を満たしてから、新規 DR で復活を検討する。本 DR の決定により tell コマンドは現時点では完全に消える。

## 不採用

- **`tell` を `--experimental` フラグ付きで残す**: 「中途半端に古いものを残さない」方針に反する。実験的機能としてのフラグも持たない。
- **`tell` を hyoui input の thin wrapper として再実装**: hyoui input の構文が dogfood 不足で変わる前提なので、wrapper が追随する手間が見合わない。必要になったら直接 hyoui CLI を叩くワンライナーで足りる (= kawaz 自身が `hyoui input <sid> ...` を打てばよい)。
- **`tell-guard.ts` の logic を `input-guard.ts` に rename して保持**: tell が無いなら guard も無くてよい。screen / spawn / stop は guard 不要。

## 影響範囲

### 削除されるファイル (DR-0009 と連動)

- `src/commands/tell.ts`
- `src/lib/tell-guard.ts` / `tell-guard.test.ts`

### 更新が必要なファイル

- `src/cli.ts`: `tell` サブコマンド登録削除、HELP から tell 行削除
- `src/hooks/session-start.ts`: prompt の tell 言及 (もしあれば) 削除
- `src/commands/screen.ts`: guard を呼ばないように更新 (cross-home warning だけ別途実装、簡素化)
- README / README-ja / SKILL.md: tell の説明全削除
- 関連テスト: tell-guard 経由のテストを delete

## 段階的移行

DR-0009 / DR-0010 と同 PR で land。breaking 群として 1.0.0 bump (DR-0014 / DR-0013 と統合)。

## 関連

- DR-0007 §5/§6 で言及した tell 安全境界は本 DR で「責務そのものが消滅」する形で解消
- hyoui 既知 issue `2026-06-16-bug-input-text-key-enter-not-sent.md` は本 DR の前提 (= cmux-msg は hyoui input に依存しない) により cmux-msg 側のブロッカーではなくなる
