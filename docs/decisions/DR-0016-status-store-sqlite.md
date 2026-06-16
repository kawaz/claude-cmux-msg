# DR-0016: session status / 軸索引 / queue 状態を SQLite に集約 (メッセージ本体は file のまま)

- Status: Proposed
- Date: 2026-06-16
- Refines: [DR-0004](DR-0004-session-as-primary-key.md) (sid 主体の状態管理を file 分散から DB 集約に)
- Depended by: [DR-0015](DR-0015-persistent-cwd-mailbox.md) (永続宛先の物理実装、軸索引と queue 状態)
- Related: [DR-0012](DR-0012-event-driven-subscribe.md) (watermark / lock を DB に集約), agmsg `init-db.sh:20` / `lib/storage.sh:60-61` (WAL + busy_timeout パターン借用)

## 背景

cmux-msg は当初から file system 直接管理 (= `<base>/<sid>/inbox/*.md` + `meta.json`) を採用してきた。これは:

- grep / less / ls で人間が直接読める
- atomic rename パターンが OS 保証で扱える
- 依存追加なし

という強みがあり、メッセージ本体には今後も適している。

しかし DR-0015 で永続宛先 (cwd / ws / repo / label) を導入する設計を進める中で、kawaz から **「by-xx をファイルで管理すると、プロセスのステータスを複数ファイルの参照であちこちで扱うことになる。実態は一つなのだから」** という指摘を受けた。

確かに以下が file 分散管理だと辛い:

- session の state (sid → state / labels / cwd / ws / repo / last-seen) を `<sid>/meta.json` に書くと、軸からの逆引き (= 「`cwd=X` の alive session 全部」) で全 meta を walk する羽目になる
- queue 状態 (= cwd 宛 msg の取得済 / 未取得) を file flag で表すと race / 中途半端な状態が出やすい
- subscribe の watermark / 二重起動防止 lock を file で持つと、複数 process からの並行 update で原子性確保が面倒
- 死んだ session の判定が分散している (= 各 meta.json + PID 生存 + state の組合せ)

「実態は一つ」原則に従い、**状態管理 (= status / 軸索引 / queue / watermark / lock) を SQLite に集約**する。
メッセージ本体 (= `*.md`) は引き続き file で持つ (= 人間 grep 性 + atomic rename 利点を捨てない)。

## 決定

### 1. ハイブリッド設計: 状態は DB、メッセージ本体は file

```
<base>/
  ccmsg.db                       # SQLite (= 単一の真実源)
  <sid>/                         # 個人専用 (= sid 宛のみ)
    inbox/*.md
    sent/*.md
    accepted/*.md
    archive/*.md
  msg/<msg-id>.md                # 共有メッセージ本体
                                 # (cwd/ws/repo/label 宛は DB の queue が ref を持つ)
```

### 2. SQLite を選ぶ理由

- **Bun 標準の `bun:sqlite` を使えば依存追加ゼロ**
- WAL + busy_timeout で multi-process 並行アクセス可 (= agmsg 借用パターン)
- 軸索引 (cwd / ws / repo / label) が index で速い
- transaction で取得者勝ちが綺麗 (= ln atomic より明確な semantics)
- 死んだ session の GC が一箇所 (= sessions テーブルの cleanup)
- agmsg / SQLite の文化的知見を流用できる

### 3. スキーマ (案)

```sql
-- セッション = 真実源 (sid に関する全状態)
CREATE TABLE sessions (
  sid          TEXT PRIMARY KEY,         -- claude session_id (UUID)
  home         TEXT NOT NULL,            -- claude_home (DR-0005 home 壁)
  cwd          TEXT NOT NULL,            -- 正規化済 cwd (process.cwd 由来)
  cwd_hash     TEXT NOT NULL,            -- SHA-256 prefix (16 char) for index
  ws           TEXT,                     -- 正規化済 ws (= git/jj worktree root、nullable: 非 git 配下)
  ws_hash      TEXT,                     -- ws-hash (nullable: 非 git 配下)
  repo         TEXT,                     -- 正規化済 repo root (= git common-dir parent、nullable: 非 git 配下)
  repo_hash    TEXT,                     -- repo-hash (nullable: 非 git 配下)
  state        TEXT NOT NULL,            -- idle | running | awaiting_permission | stopped
  pid          INTEGER NOT NULL,         -- claude 本体 PID
  started_at   INTEGER NOT NULL,         -- epoch ms
  last_seen    INTEGER NOT NULL,         -- epoch ms (hook 更新)
  meta_json    TEXT                      -- 拡張属性 (将来枠)
);
CREATE INDEX idx_sessions_cwd ON sessions(cwd_hash, state);
CREATE INDEX idx_sessions_ws ON sessions(ws_hash, state);
CREATE INDEX idx_sessions_repo ON sessions(repo_hash, state);
CREATE INDEX idx_sessions_home ON sessions(home, state);

-- ラベル (= 軸索引のひとつ、n:n)
CREATE TABLE session_labels (
  sid    TEXT NOT NULL REFERENCES sessions(sid) ON DELETE CASCADE,
  label  TEXT NOT NULL,                  -- [a-zA-Z0-9_=]+
  PRIMARY KEY (sid, label)
);
CREATE INDEX idx_labels_label ON session_labels(label);

-- メッセージ (= 配送 queue、本体は file)
CREATE TABLE messages (
  msg_id        TEXT PRIMARY KEY,        -- ULID or timestamp + random
  from_sid      TEXT,                    -- nullable (システム送信)
  target_kind   TEXT NOT NULL,           -- sid | cwd | ws | repo | label
  target_value  TEXT NOT NULL,           -- sid / cwd_hash / repo_hash / label
  body_path     TEXT NOT NULL,           -- file path (= <base>/msg/<msg-id>.md or sid/inbox/...)
  priority      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,        -- epoch ms
  consumed_by   TEXT,                    -- sid (NULL = 未取得)
  consumed_at   INTEGER                  -- epoch ms (NULL = 未取得)
);
CREATE INDEX idx_messages_target ON messages(target_kind, target_value, consumed_by);
CREATE INDEX idx_messages_from ON messages(from_sid);

-- subscribe 状態 (= watermark + 二重起動 lock)
CREATE TABLE subscribers (
  sid           TEXT PRIMARY KEY REFERENCES sessions(sid) ON DELETE CASCADE,
  watermark_id  TEXT,                    -- 最後に emit した msg_id
  lock_pid      INTEGER,                 -- subscribe プロセス PID
  lock_at       INTEGER                  -- epoch ms
);
```

### 4. 取得者勝ち (queue semantics) を transaction で

共有 box から msg を取る claude は:

```sql
BEGIN IMMEDIATE;
UPDATE messages
SET consumed_by = :my_sid, consumed_at = :now
WHERE msg_id = :id AND consumed_by IS NULL;
-- ↑ 影響行数が 1 なら取った、0 なら他に先取された
COMMIT;
```

行数で勝敗が分かる。`BEGIN IMMEDIATE` で書込ロックを早期取得して race を最小化。

### 5. WAL + busy_timeout (agmsg 借用)

`bun:sqlite` を開いた直後に:

```ts
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");
db.exec("PRAGMA synchronous=NORMAL");
```

WAL で同時 read / 単一 writer、busy_timeout で書込競合を 5s まで待機。
agmsg `lib/storage.sh:60-61` 借用 (= `.timeout` dot-command で stdout 汚染を避けるパターンは TS 側では不要、API で直接渡す)。

### 6. subscribe の watermark + 二重起動防止 を DB に集約

DR-0012 で「ln atomic + file watermark」と書いた部分を DB に置き換え:

```sql
-- 二重起動防止
UPDATE subscribers
SET lock_pid = :my_pid, lock_at = :now
WHERE sid = :my_sid
  AND (lock_pid IS NULL OR lock_pid NOT IN (SELECT pid FROM /* live pids */));
-- 1 行更新で取得成功、0 行で他プロセス保持中
```

stale lock は「PID が今 OS に存在しない」で判定 (PID 再利用は started_at 比較で防御)。

watermark:

```sql
UPDATE subscribers SET watermark_id = :last_emitted_id WHERE sid = :my_sid;
```

DR-0012 を本 DR で **物理実装的に refine**。

### 7. メッセージ本体は file のまま (理由)

- 人間 grep / less 性 (kawaz の従来思想)
- atomic rename パターンは file system のまま
- `<base>/msg/*.md` + `<sid>/inbox/*.md` の二系統で持つ (sid 宛は専用 dir、共有宛は `<base>/msg/` に置いて DB row が ref)
- DB に本体を入れると `vacuum / corruption / migration` のリスクが messaging 本体まで波及する (= 障害時の手動復旧難易度が上がる)

### 8. 死んだ session の GC

定期 GC ジョブ (cron / 手動) が以下を実行:

```sql
DELETE FROM sessions
WHERE pid NOT IN (SELECT pid FROM /* live pids via ps */)
  OR last_seen < (:now - :ttl);
-- ON DELETE CASCADE で session_labels / subscribers が連動削除
```

### 9. file event との接続 (DR-0012 との合流)

Bun fs.watch (DR-0012) は依然として **新規 file の検知** に使う:

1. file watcher が `<base>/msg/<id>.md` の出現を検知
2. DB から該当 msg_id の row を select
3. 自分が `target_kind/value` に該当するか判定
4. 該当すれば transaction で取得試行 (上記 4.)

DB だけで polling すると CPU を食う、file watcher で event 駆動を維持する。

## 不採用

- **メッセージ本体まで SQLite に格納**: 障害時復旧が困難、人間 grep 性が消える。本体は file。
- **SQLite ではなく LMDB / RocksDB / 独自 KV**: native binding 依存が増える。`bun:sqlite` は Bun 標準で依存ゼロ。
- **JSON file (例 `<base>/status.json`) に集約**: 並行書込で破損リスク (atomic rename しても全体上書きは部分更新と相性悪い)、軸索引が線形検索になる。
- **PostgreSQL / 外部 daemon DB**: 完全に過剰、cmux-msg は single user / single host 前提。
- **agmsg のスキーマをそのまま借用**: agmsg は cross-vendor / team-agent モデルで本リポと識別モデルが違う。WAL / busy_timeout / lock パターンは借りるが、テーブル構造は独自。
- **DR-0012 の ln atomic / file watermark をそのまま残す**: 状態管理を二重化する (DB と file の両方)。DR-0012 の物理パートを本 DR で置き換え (Refines)。

## 影響範囲

### 新規ファイル

- `src/lib/db.ts`: bun:sqlite の open + PRAGMA 設定 + migration
- `src/lib/db-schema.sql`: 上記スキーマ
- `src/lib/session-status.ts`: sessions テーブルの CRUD
- `src/lib/message-queue.ts`: messages テーブルの CRUD (取得者勝ち含む)
- `src/lib/subscriber-state.ts`: subscribers テーブル (watermark + lock)
- `src/lib/db.test.ts` 等の test

### 書き換え

- `src/hooks/session-start.ts`: meta.json 書込 → sessions row insert/update
- `src/hooks/{stop,session-end,permission-request,user-prompt-submit,stop-failure}.ts`: state 更新を DB transaction に
- `src/commands/peers.ts`: meta.json 走査 → DB query
- `src/commands/whoami.ts`: meta.json read → DB query
- `src/commands/subscribe.ts`: file watch + DB queue (DR-0012 の物理パート置き換え)
- `src/commands/send.ts`: 配送先解決 + messages row insert
- `src/commands/list.ts` / `read.ts` / `accept.ts` / `dismiss.ts` / `reply.ts`: DB との同期

### 削除

- `<base>/<sid>/meta.json` 自体は廃止 (= 全部 DB)
  - 既存データのマイグレーション scripts は 1.0.0 移行時に提供

### Migration 戦略

1.0.0 bump 時に 1 回の migration:

1. 既存 `<base>/<sid>/meta.json` を全部 walk
2. DB に sessions row として insert
3. 既存 inbox/sent/accepted/archive の `*.md` はそのまま (sid 宛は専用 dir 維持)
4. 共有宛 (cwd/ws/repo/label) は 1.0.0 以降の新規 msg から DB queue に乗る (= 既存 msg は sid 宛 only と解釈)

## 段階的移行

1. 本 DR と DR-0015 を同 PR で land (= 物理 + 論理の整合)
2. DR-0012 の watermark / lock 物理パートを本 DR で置き換え (= ln atomic 廃止、DB transaction へ)
3. test 整備 (= bun:sqlite WAL の並行アクセステスト、`docs/findings/` に記録)
4. 1.0.0 bump 群 (DR-0009 〜 DR-0014 / DR-0015 / DR-0016 統合)

## 実機検証の宿題

- bun:sqlite の WAL 動作 (= multi-process subscribe + send + hook 同時実行で deadlock しないか)
- busy_timeout の妥当値 (5s で十分か、過大か)
- migration scripts (旧 meta.json → DB) の正確性
- DB ファイル破損時の復旧手順 (= sessions の再構築は live PID walk で可能、messages は file から再構築困難なので backup 戦略)

これらは実装フェーズ初期に `docs/findings/2026-06-XX-bun-sqlite-concurrency.md` 等で検証してから決定。

## 関連

- DR-0004 (sid 主体): 維持、状態管理の物理を DB に集約 (主体は変えない)
- DR-0005 (home 壁): sessions.home 列で表現
- DR-0012 (event-driven subscribe): 本 DR が物理パート (watermark / lock) を refine
- DR-0015 (永続宛先): 本 DR が物理実装を提供
- agmsg の WAL / busy_timeout / actas lock: パターン借用 (テーブル構造は独自)
