import { describe, test, expect } from "bun:test";
import { forceTakeover } from "./force-takeover";

function deps(opts: {
  initialAlive: boolean;
  dieAfterTermMs?: number; // SIGTERM 後この時間で死ぬ。undefined なら SIGKILL で死ぬ
  surviveKill?: boolean; // SIGKILL でも死なない (= 病的シナリオ)
}) {
  let alive = opts.initialAlive;
  let termAt: number | null = null;
  let killedAt: number | null = null;
  let now = 0;
  const sleep = async (ms: number): Promise<void> => {
    now += ms;
    if (
      termAt !== null &&
      opts.dieAfterTermMs !== undefined &&
      now - termAt >= opts.dieAfterTermMs
    ) {
      alive = false;
    }
    if (killedAt !== null && !opts.surviveKill) {
      alive = false;
    }
  };
  return {
    kill: (_pid: number, signal: "SIGTERM" | "SIGKILL"): boolean => {
      if (signal === "SIGTERM") termAt = now;
      if (signal === "SIGKILL") killedAt = now;
      return true;
    },
    isAlive: (_pid: number): boolean => alive,
    sleep,
    log: () => ({ termAt, killedAt }),
  };
}

describe("forceTakeover", () => {
  test("初期状態 dead なら already-dead", async () => {
    const d = deps({ initialAlive: false });
    const r = await forceTakeover({ pid: 1234, kill: d.kill, isAlive: d.isAlive, sleep: d.sleep });
    expect(r.kind).toBe("already-dead");
    expect(d.log().termAt).toBeNull();
  });

  test("SIGTERM grace 内に exit すれば exited-on-term", async () => {
    const d = deps({ initialAlive: true, dieAfterTermMs: 300 });
    const r = await forceTakeover({
      pid: 1234,
      graceMs: 5000,
      pollIntervalMs: 100,
      kill: d.kill,
      isAlive: d.isAlive,
      sleep: d.sleep,
    });
    expect(r.kind).toBe("exited-on-term");
    expect(d.log().killedAt).toBeNull();
  });

  test("SIGTERM grace 経過後も alive なら SIGKILL → killed", async () => {
    const d = deps({ initialAlive: true, dieAfterTermMs: undefined });
    const r = await forceTakeover({
      pid: 1234,
      graceMs: 500,
      pollIntervalMs: 100,
      kill: d.kill,
      isAlive: d.isAlive,
      sleep: d.sleep,
    });
    expect(r.kind).toBe("killed");
    expect(d.log().killedAt).not.toBeNull();
  });

  test("SIGKILL でも死なない病的シナリオ → still-alive-after-kill", async () => {
    const d = deps({ initialAlive: true, dieAfterTermMs: undefined, surviveKill: true });
    const r = await forceTakeover({
      pid: 1234,
      graceMs: 200,
      pollIntervalMs: 100,
      kill: d.kill,
      isAlive: d.isAlive,
      sleep: d.sleep,
    });
    expect(r.kind).toBe("still-alive-after-kill");
  });
});
