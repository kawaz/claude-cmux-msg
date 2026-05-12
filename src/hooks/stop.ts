#!/usr/bin/env bun
/**
 * Stop フック (DR-0004): claude が応答完了したタイミングで state=idle に戻す。
 */
import { runStateHook } from "../lib/state-hook";

runStateHook("idle")
  .catch(() => {})
  .finally(() => process.exit(0));
