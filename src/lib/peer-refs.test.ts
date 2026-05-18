import { describe, test, expect } from "bun:test";
import { resolvePeerSurface, resolvePeerSurfaceRef } from "./peer-refs";

// peer-refs は DR-0007 決定2 で tty 逆引き方式になった。proc / surface の
// lookup は `ps` / `cmux` の副作用を持つため、ここでは副作用に到達する前の
// 入力検証 (UUID 形式) のみを検証する。proc / surface の判定ロジック自体は
// session-proc.test.ts / cmux-surface.test.ts / tell-guard.test.ts で網羅済み。

describe("resolvePeerSurface", () => {
  test("UUID 形式でなければ reject する", async () => {
    await expect(resolvePeerSurface("surface:1")).rejects.toThrow(/UUID/);
  });
});

describe("resolvePeerSurfaceRef", () => {
  test("UUID 形式でなければ reject する", async () => {
    await expect(resolvePeerSurfaceRef("not-a-uuid")).rejects.toThrow(/UUID/);
  });
});
