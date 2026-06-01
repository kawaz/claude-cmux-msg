# subscribe double-launch prevention 設計レビュー

レビュー対象: [docs/issue/2026-06-02-subscribe-double-launch-prevention.md](../issue/2026-06-02-subscribe-double-launch-prevention.md)

レビュー実施: 2026-06-02、別 Claude セッション (= 起票元は claude-plugin-reference 議論の 2908afb1、本レビューは 49bba385) + codex (gpt-5.3) による設計レビュー。

## 総評

設計の方向性 (pidfile + alive チェック + 起動元 Claude PID 監視 + 先勝ち + zombie 自動掃除) は **本筋として妥当**。ただし **FATAL 2 件 / MAJOR 3 件のギャップ**が確認できたため、**実装着手前にこれらを issue 本文へ反映する必要**がある。

## 判定一覧

| # | 論点 | 判定 | 重要度 |
|---|---|---|---|
| 1 | 起動時の race condition (atomic locking 不在) | **FATAL GAP** | 必須 |
| 2 | watchdog の `ps` 失敗時挙動 (= fail-open 必要) | CONCERN | MAJOR |
| 3 | `--observe` モードと inbox 二重消費 | OK (実害なし) | MINOR (明記推奨) |
| 4 | `CMUX_CLAUDE_PID` 未設定時のフォールバック未定義 | **FATAL GAP** | MAJOR |
| 5 | SIGKILL での trap cleanup 不発時の所有者確認 | CONCERN | MAJOR |
| 6 | 代替案 A/B/C 否定理由 | OK | MINOR |
| 7 | path 設計 (= 直下 prefix vs subdir) | CONCERN | MINOR |
| 8 | 全体の重大ギャップ / 流用先記述の正確性 | **FATAL GAP** | 必須 |

## 各論点の詳細

### #1 FATAL: 起動時の race condition

設計案は「pidfile exists → 読む → 書く」を順に行うだけで、check と write の間に atomic な claim 機構が無い。**同時起動 2 プロセスが両方「pidfile なし」を観測して両方が subscribe loop に入る** ケースが残る。

現行 `src/commands/subscribe.ts:61-87` は各プロセスが独立に `listInbox()` → emit するため、二重通知がそのまま発生する。

**Fix**: check+write 全体を atomic に行うロック機構が必須。

候補:
- `fs.openSync(path, 'wx')` (= POSIX `O_EXCL`、bun/Node 共通) で create を atomic 化
- `flock(2)` で advisory lock + read/write を排他化 (= ファイル削除タイミングも含めた整合性が必要なら)
- 既存ロック機構 (state-hook / paths など) があればそれを流用

### #2 MAJOR: watchdog の `ps` 失敗時挙動

設計案は 5-10s 毎に `pid_alive` が false なら即 exit としているが、`ps` 失敗 (transient な OS 状態) と本当に dead を区別する仕様がない。

現行 `src/lib/peer.ts:42-54` 既に `check_failed` を **alive 扱い**にして誤 dead 判定を避けている (= fail-open 方式)。subscribe watchdog にも同方針を適用すべき。

**Fix**: `not_found` と `check_failed` を分離。`check_failed` は N 回連続失敗 (例: 3 回) で exit、もしくは fail-open 維持。

実装: `lookupSidProcess(sid)` の戻り値 `{kind: "found" | "not_found" | "ambiguous" | "check_failed"}` (= [src/lib/session-proc.ts:38-43](../../src/lib/session-proc.ts)) をそのまま利用。

### #3 OK: observe と inbox 二重消費 (実害なし、ただし明記推奨)

**実装確認結果**: 現行 subscribe は inbox を消費しない。`listInbox()` は読むだけ ([src/lib/inbox.ts:27-58](../../src/lib/inbox.ts))、`diffInbox()` もプロセス内 Set の差分だけ ([src/lib/subscribe.ts:10-16](../../src/lib/subscribe.ts))。

したがって observe モードと排他モードを併用しても **ファイル削除衝突は起きない**。ただし両者とも JSONL を出すと、Claude / 人間それぞれに二重通知が届く意図的挙動になる。

**Fix**: 設計案に「observe は strictly read-only / 手動デバッグ用、Monitor 経由起動には使わない」と明記する。

### #4 FATAL: `CMUX_CLAUDE_PID` 未設定時のフォールバック未定義

設計案は `claude_pid = $CMUX_CLAUDE_PID` を前提としているが、未設定時の挙動が定義されていない。

しかも [DR-0007](../decisions/DR-0007-resume-resilient-session-identity.md) は **spawn 子では `CMUX_CLAUDE_PID` が無い**と記録している。実機運用で未設定ケースが普通に発生する。

**Fix**: 未設定時のフォールバック明記:

1. `getSessionId()` で sid を得て ([src/config.ts:26-37](../../src/config.ts))
2. `lookupSidProcess(sid)` で一意に claude pid/startTime を解決 ([src/lib/session-proc.ts:298-332](../../src/lib/session-proc.ts))
3. 解決不能 / ambiguous なら exclusive 起動は **拒否**し、`--observe` を案内する

### #5 MAJOR: trap cleanup の所有者確認

SIGKILL で trap 不発の場合、stale pidfile は次回起動時の alive check で回収できる (= 案の方針通り)。

ただし設計案の `trap "rm pidfile" EXIT` は **無条件 unlink**。これだと:
- subscribe A が起動 → pidfile 書く → SIGKILL される
- subscribe B が起動 → pidfile を見て A 死亡を確認 → 自分の pidfile に上書き
- A が trap で deferred shutdown する場合 (=実際には SIGKILL でなく SIGTERM のケース等) → **B の pidfile を消してしまう** edge case

**Fix**: trap で unlink する前に pidfile 内容を読み、`{sub_pid, sub_lstart}` が自分と一致する場合だけ unlink する。

### #6 OK: 代替案 A/B/C 否定理由

- 案 A (後勝ち kill): Monitor 状態を乱す → 否定妥当
- 案 B (warn-only): LLM が無視する問題が本 issue の問題提起そのもの → 否定妥当
- 案 C (`session_id × claude_pid` キー): 同 session 内の古い subscribe 残存問題が再発 → 否定妥当

ただし **`claude_pid` は pidfile 内に診断情報として保持する価値**がある (= ロックキーには使わないが、レコードには残す)。これは既に案文の `{sub_pid, sub_lstart, claude_pid, claude_lstart}` 構造で満たされている。

### #7 MINOR: path 設計

`~/.local/state/cmux-msg/subscribe.<session_id>.pid` (直下 prefix) vs `~/.local/state/cmux-msg/subscribe/<session_id>.pid` (subdir)。

UUID 前提なら衝突しにくく実装も簡単な直下方式で十分。ただし将来 lock file / tmp file / 破損退避 / metadata を同名前空間に閉じ込めるなら **subdir 方式**の方が保守しやすい。

**Fix (推奨)**: subdir 化 (`subscribe/<sid>.pid`)。これにより `subscribe/<sid>.lock` `subscribe/<sid>.tmp` 等の派生ファイルを同階層で扱える。

### #8 FATAL: 流用先記述の不正確性 (= peer.ts pidfile 廃止済)

設計案 line 127-128 で **「pidfile 機構は peer 管理で既にある (= 流用)」**としているが、**現行 `src/lib/peer.ts:10-12` は pidfile+lstart 方式を廃止済み**。

**Fix**: 流用先を `session-proc.ts` (の `lookupSidProcess` + `parsePsOutput`) に変更。新規 pidfile 管理は subscribe 専用に新たに書く必要がある。新規実装は薄いが「peer の機構流用」ではなく「session-proc の pid/lstart 照合を内部利用する新規 pidfile 管理」と書き直すこと。

## 着手前 TODO

1. issue 本文 (= `docs/issue/2026-06-02-subscribe-double-launch-prevention.md`) を以下方向で更新:
   - 起動時 atomic locking 必須を明記、機構候補 (`O_EXCL` / `flock`) を併記
   - `CMUX_CLAUDE_PID` 未設定時のフォールバック (= `lookupSidProcess(sid)` 経路) を明記
   - watchdog の `check_failed` 扱いを fail-open に変更
   - trap cleanup を所有者確認付き unlink に変更
   - `--observe` を strictly read-only / 手動デバッグ用と明記
   - 流用先記述を peer.ts → session-proc.ts に訂正
   - path を subdir 方式に変更
2. 上記反映後に DR 化を判断 (= 構造変更を伴う設計判断なので DR-0008 候補)
3. 実装着手

## 関連

- 元 issue: [2026-06-02-subscribe-double-launch-prevention.md](../issue/2026-06-02-subscribe-double-launch-prevention.md)
- [DR-0007](../decisions/DR-0007-resume-resilient-session-identity.md) — session identity 機構 (= spawn 子で `CMUX_CLAUDE_PID` 不在のケースが書かれている)
- [src/lib/session-proc.ts](../../src/lib/session-proc.ts) — pid/lstart 照合 (= 新規 pidfile 管理が内部利用すべき)
- [src/lib/peer.ts](../../src/lib/peer.ts) — pidfile+lstart 方式を廃止済 (= 設計案の「流用先」記述は不正確)
