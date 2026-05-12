#!/usr/bin/env bun
/**
 * SessionEnd フック (DR-0004): プロセス終了。state=stopped + last_ended_at 記録。
 *
 * 「resume 前提で stopped」(idle ではない) という命名は kawaz の指摘:
 * 実際には CC は再開されることが多く、ended より stopped のほうが実態に合う。
 */
import { runStateHook } from "../lib/state-hook";

runStateHook("stopped")
  .catch(() => {})
  .finally(() => process.exit(0));
