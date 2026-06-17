# spawn が子 claude に CMUX_WORKSPACE_ID 等を継承できず hook が早期 exit する

- Status: Will be sublimated after DR-0009/0010 land (cmux 全廃で消失)

`cmux-msg spawn` の signal タイムアウトの真因は、bin 廃止 (DR-0007 task #3) で
仮定した「子 hook の同期ビルド」ではなく、**子 claude プロセスに `CMUX_WORKSPACE_ID`
が継承されておらず、子の SessionStart hook が cmux 環境チェックで早期 exit する**
ことだった。

## 発見の経緯

v0.28.2 (bin 廃止反映) を完全反映したセッションで `spawn` を実行し、子 surface
の画面に `CMUX_WORKSPACE_ID=unset` が表示されているのを観察した。
`src/hooks/session-start.ts` 冒頭:

```typescript
const workspaceId = process.env.CMUX_WORKSPACE_ID;
if (!workspaceId) { process.exit(0); }  // cmux 環境チェック失敗で即終了
```

子 claude の env に `CMUX_WORKSPACE_ID` が無いため hook がここで終了し:
- `initWorkspace` が走らない → 子 dir も `meta.json` も作られない
- `cmuxSignal` が呼ばれない → 親の `cmux wait-for` が 30 秒タイムアウト
- 結果として「signal タイムアウト + 子 dir 不在」が発生する

`bin/cmux-msg-bin` 不在による同期ビルドは「あれば追加で遅らせる要因」ではあったが、
今回の真因ではなかった。bin 廃止は依然として正しい設計だが、それだけでは spawn は
解消しない。

## 原因の所在

親 claude (このセッション) の env には `CMUX_WORKSPACE_ID=4A9E0D17...` が存在し、
Bash subprocess にも継承されている。しかし `cmux new-split` で作った子 pane の
シェル経由で起動した子 claude には `CMUX_WORKSPACE_ID` が伝わっていない。

cmux app の最近のアップデート等で `new-split` の env 継承挙動が変わった可能性が
高い。spawn は cmux pane に `claude` コマンドを文字列送信する方式 (`cmuxSend`)
なので、間に挟まる cmux pane シェルの env に依存している。

## 修正方針

`src/commands/spawn.ts` の `claudeCmd` 組み立てで、`CMUXMSG_*` を明示的に env で
渡しているのと同様に **`CMUX_WORKSPACE_ID` 等の子 hook が必要とする `CMUX_*`
変数を明示的に親プロセスから読んで渡す**。これにより cmux pane シェルの env 継承
に依存しなくなる。

必要な env 候補 (子 hook が使うもの):
- `CMUX_WORKSPACE_ID` (`session-start.ts` の cmux 環境チェック)
- `CMUX_SURFACE_ID` (`writeBySurfaceIndex` 用)
- `CMUX_TAB_ID`, `CMUX_BUNDLE_ID` 等 (parent claude が持っているもののうち子 hook が
  読むもの)
- `CMUX_CLAUDE_HOOK_CMUX_BIN` (cmux CLI へのパス)

`src/commands/spawn.ts` の `claudeCmd` 文字列組み立て箇所に、`CMUXMSG_PARENT_*` の
すぐ近くで `CMUX_WORKSPACE_ID=${shellSingleQuote(process.env.CMUX_WORKSPACE_ID ?? '')}`
等を追加する。spawn は cmux 環境からしか起動できない (`requireCmux()`) ので、
親 env にこれらが存在することは保証されている。

## 検証手順

修正後、トラスト済み cwd (`/tmp` 等) で `cmux-msg spawn` を実行し:
- 子 surface に `CMUX_WORKSPACE_ID` が継承されている
- 子の SessionStart hook が完走 (meta.json が作られる)
- `cmux wait-for` が 30 秒以内に signal を受信 (タイムアウト警告が出ない)
- `cmux-msg peers` に子 CC が alive で出る

を確認する。

## 関連

- DR-0007 / task #3: bin 廃止 (spawn signal タイムアウトの一因と推定したが主因では
  なかった。修正自体は正しい)
- 旧 issue 2026-05-09-spawn-claude-not-launching.md (解決済み扱いだが真因は本 issue)

報告者: kawaz (2026-05-20、v0.28.2 実機動作確認中に発覚)。修正は小さい (spawn.ts の
数行) ので近いうちに着手したい。
