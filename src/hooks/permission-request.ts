#!/usr/bin/env bun
/**
 * PermissionRequest フック (DR-0004): 許可待ち中は state=awaiting_permission。
 *
 * tell の許可条件 (state ∈ {idle, awaiting_permission}) でこの状態も許される:
 * 「Yes/No 等の即時入力を流したい」ユースケースに対応するため。
 */
import { runStateHook } from "../lib/state-hook";

runStateHook("awaiting_permission")
  .catch(() => {})
  .finally(() => process.exit(0));
