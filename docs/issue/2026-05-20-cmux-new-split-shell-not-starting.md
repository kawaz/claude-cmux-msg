# cmux 0.64.5 の `new-split` で新 pane のシェルが自動起動しない

- Status: Will be sublimated after DR-0009/0010 land (cmux 全廃で消失)

`cmux-msg spawn` の signal タイムアウトの**さらに別の真因**として、cmux 本体の
`new-split` で作った新 pane のシェルが自動起動しなくなっていることが判明した。

## 観察 (2026-05-20、cmux 0.64.5)

```
$ cmux new-split up --workspace workspace:20
OK surface:85 workspace:20
$ sleep 8 && cmux top --workspace workspace:20 --processes | grep surface:85
   0.0%       0 B     0    └── surface surface:85 [terminal] "Terminal" [selected]
$ cmux read-screen --surface surface:85
Error: internal_error: ERROR: Terminal surface not found
```

- 8 秒経ってもプロセス 0
- タイトルは初期値 `"Terminal"` のまま (シェルプロンプトに変わらない)
- `read-screen` も「surface not found」エラー (tty 割り当て前)

過去の検証 (cmux 旧バージョン、~2026-05-17) では `new-split` 後 5 秒程度で shell
プロセスが立ち上がりプロンプトも表示されていた。今回 0.64.5 で**シェルが起動
しないか、起動が著しく遅延する**回帰が起きている。

## cmux-msg への影響

`spawn` は `cmux new-split` で新 pane を作り、その shell に `claude` 起動コマンドを
`cmux send` で送る方式 (DR-0004 / spawn.ts)。シェルが起動しないと:

1. `cmux send` が空打ちされる (受信側のシェルが居ない)
2. claude プロセスが起動しない
3. 子の SessionStart hook が走らない → signal も meta.json も無い
4. 親の `cmux wait-for` が 30 秒タイムアウト

これは cmux-msg 側の bin 廃止 / env 明示渡し / `cmuxWaitSurfaceReady` 追加では
解決できない。**cmuxWaitSurfaceReady も timeout で抜ける** (シェルが永遠に来ない
ため)。

## 追加検証 (2026-05-20)

実機で 2 つの手動検証を行った:

1. **`cmux new-split up --focus true`** → 6 秒後にプロンプト表示、shell 起動 ✅
2. **`cmux new-split up`** (focus 指定なし、ユーザが対象 workspace を active 表示中)
   → 6 秒後にプロンプト表示、shell 起動 ✅

つまり「workspace が user active 状態」なら focus を奪わなくても shell は起動
する。これは理想的な動作 (ユーザの作業 pane を妨げない)。

**ところが** `cmux-msg spawn` 経由 (cmuxWaitSurfaceReady で 10 秒ポーリング) で
同じ条件 (workspace active、focus なし) を試すと **shell が永遠に ready に
ならず timeout する**。spawn コマンド側からは同じ `cmux new-split up` を発行
しているはずなのに、手動直叩きとの再現性に差がある。原因は cmux app 側の
active/起動判定の何かと推定されるが、cmux-msg からは特定困難。

## 回避策の候補

1. **`--focus true` は採用しない**: 複数エージェントが不規則タイミングで spawn
   する状況下で focus を奪うとユーザの作業を中断するため不採用 (ユーザ方針)。
2. **手動 new-split との挙動差を cmux 側に問い合わせ**: 同じ CLI 引数の発行で
   shell 起動有無が変わる再現条件を上流に報告。
3. **cmux 本体に `new-split --command` 等を要望**: pane 起動時に直接コマンドを
   指定できれば、シェル起動を待たず claude を直接走らせられる (`new-workspace`
   には `--command` がある)。
4. **shell ready 検出のロバスト化**: `cmuxWaitSurfaceReady` の判定基準
   (`isSurfaceSettled`) や timeout 値 / ポーリング間隔の見直し。ただし shell
   自体が起動しないなら無効。

## 関連

- DR-0007 / task #13: `cmuxWaitSurfaceReady` を spawn に追加 (正しい方向だが、
  shell ready 自体が来ないため timeout)
- docs/issue/2026-05-20-spawn-env-inheritance.md: 別レイヤーの問題 (env 継承)
- docs/issue/2026-05-17-spawn-cleanup-design.md: surface クリーンアップ
- docs/issue/2026-05-18-cmux-atomic-send-api.md: TOCTOU 根本解決の atomic 送信
- 旧 issue 2026-05-09-spawn-claude-not-launching.md: 当初の spawn バグ

報告者: kawaz (2026-05-20、v0.28.4 実機動作確認中に判明)。回避策 1 (`--focus true`)
は実機検証で容易に確認できる。
