import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const TEST_WORKSPACE = "test-workspace-uuid";
let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-msg-test-"));
  process.env.CMUXMSG_BASE = tmpBase;
  process.env.CMUX_WORKSPACE_ID = TEST_WORKSPACE;
  delete require.cache[require.resolve("./peer-refs")];
  delete require.cache[require.resolve("../config")];
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

const SID_A = "1d033978-acf7-479b-b355-160ec85217b1";

function writePeerMeta(sid: string, meta: Record<string, unknown>): void {
  const dir = path.join(tmpBase, sid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
}

describe("resolvePeerSurfaceRef", () => {
  test("peer の meta.json から surface_ref を返す", async () => {
    writePeerMeta(SID_A, { session_id: SID_A, surface_ref: "surface:42" });
    const { resolvePeerSurfaceRef } = await import("./peer-refs");
    expect(resolvePeerSurfaceRef(SID_A)).toBe("surface:42");
  });

  test("UUID 形式でなければエラー", async () => {
    const { resolvePeerSurfaceRef } = await import("./peer-refs");
    expect(() => resolvePeerSurfaceRef("surface:1")).toThrow(/UUID/);
  });

  test("未登録 session はエラー", async () => {
    const { resolvePeerSurfaceRef } = await import("./peer-refs");
    expect(() => resolvePeerSurfaceRef(SID_A)).toThrow(/見つかりません/);
  });

  test("meta.json に surface_ref が無い場合はエラー", async () => {
    writePeerMeta(SID_A, { session_id: SID_A });
    const { resolvePeerSurfaceRef } = await import("./peer-refs");
    expect(() => resolvePeerSurfaceRef(SID_A)).toThrow(/surface_ref/);
  });

  test("壊れた meta.json はエラー", async () => {
    const dir = path.join(tmpBase, SID_A);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), "not json");
    const { resolvePeerSurfaceRef } = await import("./peer-refs");
    expect(() => resolvePeerSurfaceRef(SID_A)).toThrow(/壊れ/);
  });
});
