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
  delete require.cache[require.resolve("./session-index")];
  delete require.cache[require.resolve("../config")];
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

const SURFACE_A = "D973B7F8-47F9-4617-A1AE-81E99473E8B8";
const SESSION_A = "5f08fa2f-494d-4f27-b87e-64ca785da57c";
const SESSION_B = "11111111-2222-3333-4444-555555555555";

describe("by-surface index", () => {
  test("write → read で同じ session_id が返る", async () => {
    const { writeBySurfaceIndex, readBySurfaceIndex } = await import(
      "./session-index"
    );
    writeBySurfaceIndex(SURFACE_A, SESSION_A);
    expect(readBySurfaceIndex(SURFACE_A)).toBe(SESSION_A);
  });

  test("未登録 surface は null", async () => {
    const { readBySurfaceIndex } = await import("./session-index");
    expect(readBySurfaceIndex(SURFACE_A)).toBeNull();
  });

  test("上書きで最新が反映される", async () => {
    const { writeBySurfaceIndex, readBySurfaceIndex } = await import(
      "./session-index"
    );
    writeBySurfaceIndex(SURFACE_A, SESSION_A);
    writeBySurfaceIndex(SURFACE_A, SESSION_B);
    expect(readBySurfaceIndex(SURFACE_A)).toBe(SESSION_B);
  });

  test("書き込みファイルは by-surface/<surface_id> パス", async () => {
    const { writeBySurfaceIndex } = await import("./session-index");
    writeBySurfaceIndex(SURFACE_A, SESSION_A);
    const expected = path.join(tmpBase, "by-surface", SURFACE_A);
    expect(fs.existsSync(expected)).toBe(true);
    expect(fs.readFileSync(expected, "utf-8").trim()).toBe(SESSION_A);
  });

  test("壊れた内容（UUID 形式でない）は null 扱い", async () => {
    fs.mkdirSync(path.join(tmpBase, "by-surface"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpBase, "by-surface", SURFACE_A),
      "not-a-uuid\n"
    );
    const { readBySurfaceIndex } = await import("./session-index");
    expect(readBySurfaceIndex(SURFACE_A)).toBeNull();
  });

  test("空ファイルは null", async () => {
    fs.mkdirSync(path.join(tmpBase, "by-surface"), { recursive: true });
    fs.writeFileSync(path.join(tmpBase, "by-surface", SURFACE_A), "");
    const { readBySurfaceIndex } = await import("./session-index");
    expect(readBySurfaceIndex(SURFACE_A)).toBeNull();
  });
});
