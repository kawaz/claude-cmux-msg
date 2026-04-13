import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// surface-refs は config.wsDir() に依存するので、CMUX_MSG_BASE と
// CMUX_WORKSPACE_ID を一時ディレクトリに差し替えてから import する必要がある。
// 動的 import を使うことで env 設定後にモジュールを読み込める。

const TEST_WORKSPACE = "test-workspace-uuid";
let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-msg-test-"));
  process.env.CMUX_MSG_BASE = tmpBase;
  process.env.CMUX_WORKSPACE_ID = TEST_WORKSPACE;
  // モジュールキャッシュを破棄して、env 反映状態で再ロード
  delete require.cache[require.resolve("./surface-refs")];
  delete require.cache[require.resolve("../config")];
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

const UUID_A = "1d033978-acf7-479b-b355-160ec85217b1";
const UUID_B = "77931c63-8f8e-46ec-858a-6956366fe34f";

describe("surface-refs ラウンドトリップ", () => {
  test("save → resolve で同じ ref が返る", async () => {
    const { saveSurfaceRef, resolveCmuxRef } = await import("./surface-refs");
    saveSurfaceRef(UUID_A, "surface:42");
    expect(resolveCmuxRef(UUID_A)).toBe("surface:42");
  });

  test("findUuidByRef で逆引き", async () => {
    const { saveSurfaceRef, findUuidByRef } = await import("./surface-refs");
    saveSurfaceRef(UUID_A, "surface:42");
    saveSurfaceRef(UUID_B, "surface:43");
    expect(findUuidByRef("surface:42")).toBe(UUID_A);
    expect(findUuidByRef("surface:43")).toBe(UUID_B);
    expect(findUuidByRef("surface:99")).toBeNull();
  });

  test("複数 save で全てのマッピングが保持", async () => {
    const { saveSurfaceRef, resolveCmuxRef } = await import("./surface-refs");
    saveSurfaceRef(UUID_A, "surface:1");
    saveSurfaceRef(UUID_B, "surface:2");
    expect(resolveCmuxRef(UUID_A)).toBe("surface:1");
    expect(resolveCmuxRef(UUID_B)).toBe("surface:2");
  });
});

describe("surface-refs エラー処理", () => {
  test("UUID 形式でなければ resolveCmuxRef はエラー", async () => {
    const { resolveCmuxRef } = await import("./surface-refs");
    expect(() => resolveCmuxRef("surface:1")).toThrow(/UUID/);
  });

  test("未登録 UUID は resolveCmuxRef でエラー", async () => {
    const { resolveCmuxRef } = await import("./surface-refs");
    expect(() => resolveCmuxRef(UUID_A)).toThrow(/未登録/);
  });
});

describe("旧形式マイグレーション", () => {
  test("surface:N → UUID 形式を読むと UUID → surface:N に変換される", async () => {
    // 旧形式ファイルを直接書き込み
    const wsDir = path.join(tmpBase, TEST_WORKSPACE);
    fs.mkdirSync(wsDir, { recursive: true });
    const refsPath = path.join(wsDir, "surface-refs.json");
    fs.writeFileSync(
      refsPath,
      JSON.stringify({ "surface:42": UUID_A, "surface:43": UUID_B })
    );

    const { resolveCmuxRef } = await import("./surface-refs");

    // 新形式として解釈できる
    expect(resolveCmuxRef(UUID_A)).toBe("surface:42");
    expect(resolveCmuxRef(UUID_B)).toBe("surface:43");

    // ファイルが新形式に書き戻されている
    const written = JSON.parse(fs.readFileSync(refsPath, "utf-8"));
    expect(written).toEqual({
      [UUID_A]: "surface:42",
      [UUID_B]: "surface:43",
    });
  });

  test("空ファイルの場合は空マッピング", async () => {
    const wsDir = path.join(tmpBase, TEST_WORKSPACE);
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, "surface-refs.json"), "{}");

    const { findUuidByRef } = await import("./surface-refs");
    expect(findUuidByRef("surface:1")).toBeNull();
  });

  test("壊れた JSON は空マッピングとして扱う", async () => {
    const wsDir = path.join(tmpBase, TEST_WORKSPACE);
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, "surface-refs.json"), "not json");

    const { findUuidByRef } = await import("./surface-refs");
    expect(findUuidByRef("surface:1")).toBeNull();
  });
});
