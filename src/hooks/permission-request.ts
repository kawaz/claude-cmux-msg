#!/usr/bin/env bun
/**
 * PermissionRequest フック (DR-0004): 許可待ち中は state=awaiting_permission。
 */
import { runStateHook } from "../lib/state-hook";

runStateHook("awaiting_permission")
  .catch(() => {})
  .finally(() => process.exit(0));
