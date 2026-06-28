import { describe, test, expect } from "bun:test";
import {
  checkLockHolderSignature,
  getPidLstart,
} from "./pid-signature";

describe("checkLockHolderSignature", () => {
  test("holder dead は stale", () => {
    expect(
      checkLockHolderSignature({
        heldByAlive: false,
        heldByLstart: null,
        recordedLstart: "Sat Jun 28 14:00:00 2026",
      }),
    ).toBe("stale");
  });

  test("recordedLstart 不在 (旧 row) は unverified", () => {
    expect(
      checkLockHolderSignature({
        heldByAlive: true,
        heldByLstart: "Sat Jun 28 14:00:00 2026",
        recordedLstart: null,
      }),
    ).toBe("unverified");
  });

  test("alive + lstart 一致は same", () => {
    expect(
      checkLockHolderSignature({
        heldByAlive: true,
        heldByLstart: "Sat Jun 28 14:00:00 2026",
        recordedLstart: "Sat Jun 28 14:00:00 2026",
      }),
    ).toBe("same");
  });

  test("alive + lstart 不一致は stale (PID 再利用)", () => {
    expect(
      checkLockHolderSignature({
        heldByAlive: true,
        heldByLstart: "Sat Jun 28 18:00:00 2026",
        recordedLstart: "Sat Jun 28 14:00:00 2026",
      }),
    ).toBe("stale");
  });

  test("alive + 現 lstart 取得失敗は same (安全側)", () => {
    expect(
      checkLockHolderSignature({
        heldByAlive: true,
        heldByLstart: null,
        recordedLstart: "Sat Jun 28 14:00:00 2026",
      }),
    ).toBe("same");
  });
});

describe("getPidLstart (integration)", () => {
  test("自分の PID で lstart 取得できる", () => {
    const r = getPidLstart(process.pid);
    expect(r).not.toBeNull();
    // 末尾 4 桁が西暦と推定 (LC_ALL=C 想定: 'Sat Jun 28 ... 2026')
    expect(r!.length).toBeGreaterThan(10);
  });

  test("存在しない PID は null", () => {
    const r = getPidLstart(2_147_483_646); // ほぼ存在しない巨大 PID
    expect(r).toBeNull();
  });

  test("不正値は null", () => {
    expect(getPidLstart(0)).toBeNull();
    expect(getPidLstart(-1)).toBeNull();
    expect(getPidLstart(1.5)).toBeNull();
  });
});
