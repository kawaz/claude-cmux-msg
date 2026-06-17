# 2026-06-17 bun:sqlite WAL + queue 並行アクセス実機検証

DR-0016 (session status / 軸索引 / queue 状態を SQLite に集約) の前提として、Bun 標準の `bun:sqlite` で WAL モード + queue semantics (= 取った者勝ち) が multi-process 並行で integrity を保てるかを実機で確認。

## 判明した事実

- **`bun:sqlite` で `PRAGMA journal_mode=WAL` / `busy_timeout=5000` / `synchronous=NORMAL` が正常に効く**。設定後の `PRAGMA` 読み出しで `wal` / `5000` / `1` を確認。
- **5 worker / 100 件 / 並行 UPDATE で重複ゼロ、漏れゼロ**。`BEGIN IMMEDIATE` を含む transaction で `UPDATE ... WHERE consumed_by IS NULL` パターンが atomic に動作。
- **100 件分配が 33ms で完了**。実用上のスループットは十分。
- 各 worker の取得件数は偏る (42 / 24 / 22 / 12 / 0)。subprocess 起動の遅延差で先発 worker が大量に取得することがある (= 健全な race semantics、queue としては正しい)。
- DR-0016 のスキーマ草案 (`messages.consumed_by` の lazy update + transaction) は本検証パターンと整合し、**そのまま実装に進める**。

## 実用的な示唆 / ベストプラクティス

- **採用 PRAGMA**: `journal_mode=WAL` + `busy_timeout=5000` + `synchronous=NORMAL` を DB open 直後に exec する。agmsg `lib/storage.sh:60-61` パターンと整合。
- **取得 transaction の pattern**:
  ```ts
  const trySteal = db.transaction((msgId, mySid) => {
    const r = db.prepare(
      "UPDATE messages SET consumed_by=?, consumed_at=? WHERE msg_id=? AND consumed_by IS NULL"
    ).run(mySid, Date.now(), msgId);
    return r.changes;  // 1 なら取った、0 なら他が先取
  });
  ```
- **busy_timeout の妥当値**: 本検証では 5000ms で安定動作。短すぎると WAL の checkpoint 中に SQLITE_BUSY を返しがち。5000ms は agmsg 採用値と一致。
- **subprocess 起動の遅延差で worker 間の取得件数は偏る**: 実装上の問題ではないが、運用上「fair な分配」を期待するなら別途調整 (= cmux-msg subscribe では各 alive peer がリアルタイムに event 駆動で動くので偏りは出にくい)。

## 検証の詳細

### 環境

- OS: macOS Darwin 25.5.0 (Apple Silicon)
- Bun: 1.3.13
- `bun:sqlite` (= Bun 標準、依存追加なし)
- 検証 dir: `/tmp/ccmsg-sqlite-test{,-t2}/`

### T1: WAL + busy_timeout の PRAGMA 効果

期待: WAL mode に切替後、`PRAGMA journal_mode` で `wal`、`PRAGMA busy_timeout` で `5000` を取得できる。INSERT + SELECT が正常動作。

結果:

| 設定 | 値 |
|---|---|
| `journal_mode` | `wal` |
| `busy_timeout` | `5000` |
| `synchronous` | `1` (= NORMAL) |
| INSERT 5 件 + SELECT | **PASS** |

### T2: 並行 queue 取得 (5 worker × 100 件)

setup: `messages` テーブルに 100 行 (`consumed_by IS NULL`) を作成。
worker: 5 つの subprocess を `bun spawn` で起動。各 worker は `id=1..100` を順に試行、`db.transaction` 内で `UPDATE WHERE consumed_by IS NULL` を打ち、影響行数 (= changes) が 1 なら取得成功とカウント。
検証:
- 各 worker の取得件数の合計 = 100 (= 漏れなし)
- `consumed_by IS NULL` の残り = 0 (= 全件消化)
- `consumed_by` でグルーピングした件数の合計 = 100 (= 重複なし)

結果:

| metric | 値 |
|---|---|
| elapsed_ms | **33** |
| total_won_sum | **100** (期待 100) |
| db unconsumed | **0** |
| db total rows | 100 |
| 各 worker 取得 | 42 / 24 / 22 / 12 / 0 |
| 重複取得 | **0** |
| **integrity** | **PASS** |

worker-4 が 0 件なのは subprocess 起動の遅延で先発 worker が全部取り終わっていたため。queue としては正しい挙動 (= 取った者勝ち、後発は何も取れない)。

### 未実施 (優先度・実施タイミング)

- **T3 (subscribe 統合)**: Bun fs.watch event を起点に DB transaction を発火する一連の流れを実機で。`docs/findings/2026-06-16-file-watcher-comparison.md` の watcher と本 transaction の結合点。実装フェーズ初期に。
- **T4 (writer 1 + reader N の長時間並行)**: 24h 実走、deadlock / SQLITE_BUSY の蓄積を観察。**優先度: 中**。
- **T5 (Linux inotify 環境)**: 本検証は macOS のみ。CI Ubuntu で T1/T2 再実行。**優先度: 中**、CI 組み込みが筋。
- **T6 (DB 破損時の復旧)**: WAL の破損ケース、`.recover` コマンドの動作、sessions の再構築 (live PID walk から)。**優先度: 低** (= 平時の運用では発生しない)。

### 検証スクリプト

scratch dir: `/Users/kawaz/.claude-personal/jobs/aa39f05c/tmp/sqlite-test/` (job 終了時に削除)

- `t1-wal-basic.mjs`: WAL + busy_timeout の PRAGMA 確認 + INSERT/SELECT 基本動作
- `t2-queue-race.mjs`: 5 worker subprocess × 100 件並行取得 integrity 確認

いずれも `bun <script>` で再実行可能。

### 関連

- 借用: agmsg `lib/storage.sh:60-61` (PRAGMA dot-command 経由の WAL 設定)、`actas-lock.sh` 系の取得競合パターン
- 連携: `docs/findings/2026-06-16-file-watcher-comparison.md` の Bun fs.watch との結合 (= event 駆動の起点 + DB transaction の取得)
- 次手: DR-0016 (Accepted) の実装フェーズ、subscribe + queue 取得の e2e
