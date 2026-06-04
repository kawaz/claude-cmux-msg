# `claude agents --json` 発見から DR-0008 起票までの経緯

調査日: 2026-06-04。kawaz が `claude agents --json` の存在に気付き、cmux-msg の peer 発見の主経路に格上げできるかを実機検証して DR-0008 を起票するまでの記録。

## 発端

kawaz の発言「`claude agents --json` これヤバイな」が起点。当初 AI 側は「セキュリティ的にヤバい」(= 他 Claude が peer 一覧から踏み台にする) と解釈したが、kawaz の意図は **「このプロジェクト (cmux-msg) でめちゃ使える」** という活用視点だった。

## 全体把握 (Explore agent)

kawaz から「ドキュメントとコード全部理解してから話せ」と一喝され、Explore subagent を起動して docs/ 全件 + src/ 構造 + DR 一覧 + skill 定義を網羅的に把握。特に DR-0004 (sid 一本化) と DR-0007 (resume 耐性 + `lookupSidProcess` の `ps argv` 照合実装) を理解の中心に置いた。

これにより、当初想定していた「`agents --json` を peer 発見に流用する」が:

- 単なる高速化アイデアではなく
- DR-0007 の実装基盤を切替える設計判断
- cross-home / ambiguous / bg-fg 判定 / 既存 `-c` 検出穴の見直しを伴う

という規模感だと認識を補正できた。

## 実機検証の流れ

### bg / suspended の検証 — `agents.status` は app state のみと判明

kawaz が「bg な claude 作ってみるね」と新 sid を起動。`agents --json` と `ps -p <pid>` を並べて比較:

```
fg (16:07):   agents=idle, ps PGID==TPGID, STAT=S+
suspended:    agents=idle, ps PGID!=TPGID, STAT=T   ← Ctrl-Z
bg:           agents=idle, ps PGID!=TPGID, STAT=T   ← 同じく停止
```

**`agents` は process group 状態を 1 bit も反映しない**。app の inference 状態だけ。これで DR-0007 の「fg 判定は `ps` が唯一の真実源」が実機実証された。

### subagent と Monitor の取り違え (kawaz 指摘)

検証中、親 claude (pid 41018) の子孫を `pgrep -P` で見ると `bun` process が出てきた。当初 subagent と推測したが、kawaz から「bun はあれじゃね？Monitor プロセスとかさ」と指摘。確認したら 42780/42782 は Monitor で起動した `cmux-msg subscribe` の子 bun。pid 91741 (bun, 既に死亡) が当時走行中の subagent 由来だった (寿命がほぼ一致)。

subagent / workflow runtime は **bun として親 claude 内部で走り、独立 `claude --session-id` プロセスではない** → `agents --json` に出ない、と確定。これは cmux-msg の peer 概念と完全一致しており、誤検出の余地がないという含意。

### 同 sid 並行 resume — agents は両方返す

kawaz が `cb787472-...` を `--resume` と `--session-id` 両方で起動した状態を作る (当初は両者の意味の差を明確化していなかった):

```
agents --json: 同 sid 2 件 (idle + busy) を両方返す、マージなし
ps argv:       同 sid 2 件、lstart 異なる
```

`startedAt` (epoch ms) の差分で DR-0007 の `concurrent_resume` / `unexpected` 判別が `agents` 経由でも完全に成立する、と確認。これで「DR-0007 の安全弁を agents 経由でも維持できる」見通しが立った。

### `--session-id` vs `--resume` / `-c` の論点整理

kawaz から「`--session-id` は所詮新規 ID を起動側が指定するだけ、ambiguous とは別レイヤ」と整理を入れられる。これで:

- `--session-id <uuid>`: 新規 sid 発行手段 (cmux-msg `spawn` の現実装)、既存 sid 流用は `already in use` エラー
- `--resume <uuid>` / `-c`: 既存 sid 履歴ロード、**ambiguous 発生源**

がクリアになった。`-c` で 2 つ + `--resume` で 1 つ起動した状態で:

```
agents --json:  cb787472 が 3 件 (-c x2 + --resume x1)
ps argv (sid):  pid 85629 (--resume) のみ
```

**`ps argv` は `-c` 起動を 100% 見落とす** ことが判明。`-c` は argv に uuid を持たないため。DR-0007 の `lookupSidProcess` の実装穴 (= 既存バグ) を実機で確定。これが DR-0008 の決定的根拠になった。

### Monitor 暴走 (stat -f の罠)

並列 resume 3 件の状態遷移を秒間隔で追う Monitor を立てたら、`stat -f '%z' file` が GNU stat 経由で `--file-system` 扱いされて壊れた出力で暴走。TaskStop で停止 → `/usr/bin/stat -f '%z'` 絶対パスで BSD stat を明示して立て直し。

教訓: macOS で `stat` の `-f` を使うときは BSD stat 絶対パスで呼ぶか、`wc -c` / Python に逃がす。Homebrew の coreutils が `stat` を上書きしているとハマる。

### ScheduleWakeup でフィボナッチ「1 で止まった」コント

kawaz が pid 85629 に「フィボナッチ数列を5まで、5ターンかけてループしながら1つずつ発言して」と入力。assistant 側は ScheduleWakeup で 60s 間隔の自己起動ループを組み、`1, 1, 2, 3, 5` を 5 ターンに分散させる解釈をした。kawaz の「1 で止まった」は実は 2 ターン目までしか進んでないことを「終わった」と読んだ結果。

意図せず観察データが取れた:
- 各サイクルで pid 85629 のみ `status: idle → busy → idle` (他 2 件は idle 据え置き)
- `meta.state` は Stop hook で先に idle に戻り、`agents.status` は 1 秒遅れて idle 反映
- これが finding #8 (= 二段照合の必要性) の原データ

### 並列 busy 観察 — jsonl size 減少を捉えた

kawaz が別 pid (= 84680) のターミナルに「ダジャレ 10 連 + 自己評価」を投入。これにより pid 84680 と pid 85629 が同時 busy になる窓ができ、jsonl への並列書き込みが発生:

```
17:01:05  size=199916  user tool_result A
17:01:07  size=199149  user tool_result B   ← 767 byte 減少!
17:01:11  size=202688  user tool_result C
```

単調増加が崩れた = 過去行の上書き or truncate + rewrite が起きている。**並列 resume = 履歴破損リスクが実在** することの実証。これが DR-0008 で ambiguous 恒久 deny を維持する論拠の最強根拠になった。

kawaz は「`--resume` で同時 2 進行は禁忌ってことだな」と結論。DR-0007 の deny ロジックが実機で完全裏付けされた瞬間。

### dead → resume 復帰の meta lifecycle

両プロセスを停止 → agents から完全消失 (件数 5 → 4)。meta.json は残存 (`state: "stopped"`, `last_ended_at` 記録)。1 つだけ resume で復帰させると:

```
state:           stopped → idle
last_started_at: 16:45:23 → 16:46:37
last_ended_at:   "16:45:23" → null  ← リセットされる
```

`last_ended_at` が null クリアされる挙動を発見。「current alive sid」の判定に `meta.last_ended_at == null` AND `agents に存在` の二段照合が使える。

## 整理

検証論点総まとめ:

| 論点 | 結果 | DR-0008 への影響 |
|---|---|---|
| cross-home 分離 | `agents` は CLAUDE_CONFIG_DIR 範囲のみ | `claude_config_dirs` 設定必要 |
| ambiguous 保持 | 同 sid 多件を両方返す、`startedAt` で分類可 | DR-0007 ロジックそのまま乗る |
| subagent 排除 | agents に subagent/workflow は出ない | peer 概念と一致 |
| `-c` 検出 | `ps argv` は見逃す、`agents` は捕捉 | **既存 bug fix** |
| bg/fg 判定 | `agents.status` は app state のみ | `ps -p <pid>` 必須 |
| 遅延窓 | meta.state と agents.status に 1-2 秒の差 | 二段 AND 必須 |
| 並列害 | jsonl size 減少 = 履歴破損 | ambiguous 恒久 deny の論拠 |
| resume の pid | resume ごとに新 pid | pid 不変識別子にしない (既決定補強) |
| dead 検知 | agents から消失で確定 | meta dir は gc 対象 (既決定) |

## ハマり所と教訓

1. **macOS の `stat -f`** は GNU stat が混入すると `--file-system` 扱いに化ける → `/usr/bin/stat -f '%z'` 絶対パス or `wc -c` で逃がす。`stat` 直叩きで Monitor が暴走したら即 `TaskStop`
2. **bun process は subagent / Monitor 起動の cmux-msg / その他** が混じる → pid だけで subagent 判定しない、コマンドラインまで見る
3. **`--session-id` と `--resume` / `-c` は別レイヤ** — ambiguous は `--resume` / `-c` 系だけが原因 (kawaz による論点整理が決定的)
4. **解釈違いコント (フィボナッチ ScheduleWakeup) は ScheduleWakeup loop の発見につながった** — 観測の好機。ループ動作中のターン境界に `bridge-session` / `last-prompt` / `mode` / `permission-mode` 等のメタ行が入る、という jsonl 構造の副次発見
5. **Monitor 設計の鉄則** — 1 秒 polling で `agents --json` を叩くのは並列セッション数が増えるとコスト的に重い。実運用では「変化検知」だけに絞り、フィルタミス時は即 TaskStop して立て直す

## 追加検証 — `waitingFor` と status enum

DR-0008 のドラフト後、kawaz から「`waitingFor` は enum か free-text か」「ユーザがプロンプト欄に打ち中の状態を区別できるか」の問いを受けて追加検証:

- 公式 CHANGELOG (v2.1.162) には「`claude agents --json` now includes `waitingFor` showing what a waiting session is blocked on (e.g. permission prompt)」とだけ — `e.g.` 文言で enum 完全列挙は不在
- `/Users/kawaz/.local/share/claude/versions/2.1.162` (Mach-O native build) を `strings` で解析:
  - `mgO=["interactive","bg","daemon","daemon-worker"]` ← kind enum
  - `BgO=["busy","shell","idle","waiting"]` ← status enum
  - `UgO(H) = BgO.includes(H) ? H : void 0` で normalize
  - `waitingFor` は `typeof z.waitingFor === "string" ? z.waitingFor : void 0` の **type check のみ、enum 制約なし**

3 sid (`a380833e` / `8fa5ce91` / `2122d183`) で「何も入力してない」「半角スペース 1 つ」「2 行入力中」の状態を作って比較したところ:

```
                file.status  agents.status
何も入力          shell         busy   ← マッピング
スペース 1 つ      idle          idle
2 行入力中        shell         busy   ← マッピング
```

`file.status === "shell"` が **「claude プロンプト受付モード = ユーザ入力 active 状態」** を表していて、`agents --json` は **`shell` を `busy` に丸めて公開している** ことが確定。`tell` 安全境界 `agents.status === "idle"` は LLM 推論中 + ユーザ入力 active を **両方自動的に弾く** 設計上の二重効果がある。

ただし `file.status === "shell"` 内部でも「buffer 空 vs 文字入力済」の区別は status 値には乗らない。kawaz から「`alias claude='hyoui run -- claude'` で常時 hyoui 配下起動 + screen 解析でプロンプト空チェック」の構想が提起され、[docs/issue/2026-06-04-hyoui-alias-claude-wrap.md](../issue/2026-06-04-hyoui-alias-claude-wrap.md) として独立 issue 起票。本 DR スコープからは外す。

## 成果物

- [findings/2026-06-04-claude-agents-json-observations.md](../findings/2026-06-04-claude-agents-json-observations.md) — 確定事実 13 件
- [DR-0008](../decisions/DR-0008-agents-json-peer-discovery.md) — peer 発見を agents 経由に格上げ + 設定ファイル導入
- [issue/2026-06-04-hyoui-alias-claude-wrap.md](../issue/2026-06-04-hyoui-alias-claude-wrap.md) — 常時 hyoui 配下起動構想 (将来 DR 候補)

## 関連

- [findings/2026-06-02-resume-session-id-mismatch.md](../findings/2026-06-02-resume-session-id-mismatch.md) — resume 周辺の別調査 (env 食い違い)
- [DR-0007](../decisions/DR-0007-resume-resilient-session-identity.md) — 本検証で論拠補強された tell 安全境界
