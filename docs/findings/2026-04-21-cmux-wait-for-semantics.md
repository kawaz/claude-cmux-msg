# cmux wait-for の挙動検証 (2026-04-21)

cmux CLI の `wait-for` サブコマンドの挙動を実機検証した結果。subscribe コマンド設計の前提。

## 判明した事実

### シグナルは edge 通知（カウンタではない）
- `cmux wait-for -S <name>` を連続 N 回発射しても、受信側の `cmux wait-for <name>` は 1 回しか即抜けない
- 2 回目以降の wait は次の edge までブロック
- → 複数メッセージが連続投函された場合、1 edge に畳まれる。**受信側は signal に依存せず inbox を全スキャンする必要がある**

### 未 wait 時の signal は queue される
- signal を先に発射して、後から wait-for すると即抜け (exit 0)
- ただし上記の通り「edge 1 つ」として畳まれる
- → wait-for ループの外で発射された signal は取りこぼされない

### exit code と stderr
| 状況 | exit | stderr |
|---|---|---|
| signal 受信 | 0 | (なし、stdout に `OK`) |
| timeout | 1 | `Error: wait-for timed out waiting for '<name>'` |
| socket 接続失敗等 | 1 | `Error: Failed to connect to socket ...` 等の別メッセージ |
| `--timeout 0` / 負数 | 1 | timeout 扱いで即 exit |

→ exit code だけでは timeout と socket エラーを区別できない。stderr に `timed out` を含むかで判定する (`src/lib/cmux.ts::interpretWaitForResult`)。

### timeout の実用レンジ
- `--timeout 86400` (1 日) は問題なく動作。途中 signal で即抜け可能
- `--timeout 999999999` も起動は通るが実測せず
- subscribe では 3600 秒 (1 時間) を採用。タイムアウトしても差分スキャンだけ走らせて再度 wait-for に戻るのでコストほぼゼロ

## 実用的な示唆

- 「signal = 何かが起きた合図」としてのみ扱い、内容の数や種類は inbox ファイルで確認する設計にする
- `cmux wait-for` の exit != 0 を一律「シグナル未受信」とみなすと socket エラー時にハマる (過去バグの実例: v0.2.5 の watch 修正)
- subscribe の wait-for ループは「長め timeout + タイムアウトでも再スキャン」の組み合わせが堅牢

## 検証の詳細

### シグナル畳み込みテスト

```bash
cmux wait-for -S multi; cmux wait-for -S multi; cmux wait-for -S multi
time cmux wait-for multi --timeout 2  # → 0.09s で exit 0 (1 件目)
time cmux wait-for multi --timeout 2  # → 2.09s で exit 1 timeout (残り吸われず)
```

3 発射 → 1 回目の wait が即抜け、2 回目以降は timeout。signal は最後の状態のみ記録する edge 型。

### queue テスト

```bash
cmux wait-for -S test-queue-xyz  # 先に発射
sleep 0.5
time cmux wait-for test-queue-xyz --timeout 3  # → 0.09s で exit 0
```

発射時点で wait していなくても、後から wait すれば即抜ける。

### timeout 最大値テスト

```bash
cmux wait-for btest --timeout 86400 &
sleep 1
cmux wait-for -S btest
# → 1.1s で exit 0、正常動作
```
