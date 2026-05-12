#!/usr/bin/env bun
/**
 * StopFailure フック (DR-0004): エラー停止時も state=idle に戻す。
 *
 * 失敗状態を別 state にする選択肢もあるが、ユーザ操作可能になる点では idle と
 * 同じなので統一する (tell の許可条件に合わせる)。
 */
import { runStateHook } from "../lib/state-hook";

runStateHook("idle")
  .catch(() => {})
  .finally(() => process.exit(0));
