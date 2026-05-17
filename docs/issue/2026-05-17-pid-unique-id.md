# PID の同一性判定を proc_bsdinfo.pbi_uniqueid で厳密化する案

報告者: kawaz (2026-05-17)。本 issue は提案の記録であり、現時点では着手しない。

## 背景

`cmux-msg` は peer の生存判定で「PID が alive か」だけでなく「同一プロセスか」
も確認する必要がある。OS は PID を使い回すため、PID 単独だと別プロセスを
誤って同一 peer の alive と判定してしまう (実機で dead な peer に broadcast が
届いた事例あり、`src/lib/peer.ts` 冒頭コメント参照)。

現状の対策: `src/lib/peer.ts` が `ps -o lstart=` で取得したプロセス起動時刻を
pid と併記して pid ファイルに書き、読み取り時に「pid alive かつ lstart 一致」
で同一性を保証している。

## 提案

PID の生存・同一性判定を macOS の `proc_bsdinfo.pbi_uniqueid` で厳密化する。

`pbi_uniqueid` は kernel が各プロセスに単調増加で振る 64bit の unique process
ID。PID と違い使い回されないため、PID 再利用に完全耐性がある。pid と
`pbi_uniqueid` のペアを記録すれば「同一プロセスか」を厳密に判定できる。

## 評価

- **メリット**: 同一性判定が厳密。`lstart` は秒精度なので、同一秒内に PID が
  使い回された場合は理論上すり抜ける余地があるが、`pbi_uniqueid` ならその穴も塞ぐ。
- **デメリット**:
  - `pbi_uniqueid` の取得には `bun:ffi` で libproc の `proc_pidinfo()` を直接
    呼ぶ必要がある。`ps` のような標準 CLI では取れない。
  - libproc は macOS 専用 API。現状の `ps -o lstart=` は mac/Linux 両対応だが、
    `pbi_uniqueid` に切り替えると macOS 専用実装になる (cmux 自体が macOS
    前提なので致命的ではないが、移植性は下がる)。
  - 現状の lstart 併記でも実用上の実害は出ていない。秒精度ですり抜けるのは
    「同一秒内の PID 再利用」という極めて稀なケースのみ。

## 結論

**今は見送り、ROADMAP 候補とする**。現状の `ps -o lstart=` 併記方式で実用上の
実害がなく、`pbi_uniqueid` 化は `bun:ffi` 導入と macOS 専用化のコストに見合う
リターンが今はない。秒精度すり抜けが実際に問題化したら再検討する。

## 関連

- `src/lib/peer.ts`: 現状の pid + lstart 併記による同一性判定の実装
- `docs/decisions/DR-0004-session-as-primary-key.md`: pid ファイルの新形式
  (旧形式 = PID 1 行のみを dead 扱い) を定めた DR
