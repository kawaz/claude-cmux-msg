import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { setupLayoutDocs } from "./layout-docs";

let workDir: string;
let pluginRoot: string;
let msgBase: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-docs-test-"));
  pluginRoot = path.join(workDir, "plugin");
  msgBase = path.join(workDir, "msg-base");

  // ダミープラグインの docs/layout/ を用意
  const sourceDir = path.join(pluginRoot, "docs", "layout");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "layout-root.md"), "# root v1");
  fs.writeFileSync(path.join(sourceDir, "layout-workspace.md"), "# ws v1");
  fs.writeFileSync(path.join(sourceDir, "layout-session.md"), "# session v1");

  fs.mkdirSync(msgBase, { recursive: true });
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const WS = "8118E1E4-8C3A-453E-AFF3-29BA0F514DA2";
const SID = "f695cacc-14c6-4983-94af-d3eeb1d6649a";

describe("setupLayoutDocs", () => {
  test("3階層の README.md と .docs/v<version>/, .docs/latest を作る", () => {
    fs.mkdirSync(path.join(msgBase, WS, SID), { recursive: true });

    setupLayoutDocs({
      msgBase,
      pluginRoot,
      workspaceId: WS,
      sessionId: SID,
      version: "0.8.0",
    });

    // .docs/v0.8.0/ に layout-*.md がコピーされている
    expect(
      fs.readFileSync(path.join(msgBase, ".docs", "v0.8.0", "layout-root.md"), "utf-8")
    ).toBe("# root v1");

    // .docs/latest が v0.8.0 を指す
    expect(fs.readlinkSync(path.join(msgBase, ".docs", "latest"))).toBe("v0.8.0");

    // 各階層に README.md (symlink) ができている
    const rootReadme = path.join(msgBase, "README.md");
    const wsReadme = path.join(msgBase, WS, "README.md");
    const sidReadme = path.join(msgBase, WS, SID, "README.md");

    expect(fs.lstatSync(rootReadme).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(wsReadme).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(sidReadme).isSymbolicLink()).toBe(true);

    // 内容が辿れる（symlink → .docs/latest/layout-root.md → .docs/v0.8.0/layout-root.md）
    expect(fs.readFileSync(rootReadme, "utf-8")).toBe("# root v1");
    expect(fs.readFileSync(wsReadme, "utf-8")).toBe("# ws v1");
    expect(fs.readFileSync(sidReadme, "utf-8")).toBe("# session v1");
  });

  test("冪等: 2回呼んでも同じ状態", () => {
    fs.mkdirSync(path.join(msgBase, WS, SID), { recursive: true });

    setupLayoutDocs({
      msgBase, pluginRoot, workspaceId: WS, sessionId: SID, version: "0.8.0",
    });
    const firstStat = fs.lstatSync(path.join(msgBase, "README.md"));

    setupLayoutDocs({
      msgBase, pluginRoot, workspaceId: WS, sessionId: SID, version: "0.8.0",
    });
    const secondStat = fs.lstatSync(path.join(msgBase, "README.md"));

    // symlink は同じ inode のまま (recreate されていない)
    expect(secondStat.ino).toBe(firstStat.ino);
  });

  test("version bump: latest が新バージョンに付け替わる", () => {
    fs.mkdirSync(path.join(msgBase, WS, SID), { recursive: true });

    setupLayoutDocs({
      msgBase, pluginRoot, workspaceId: WS, sessionId: SID, version: "0.8.0",
    });
    expect(fs.readlinkSync(path.join(msgBase, ".docs", "latest"))).toBe("v0.8.0");

    // plugin 側を更新
    fs.writeFileSync(path.join(pluginRoot, "docs", "layout", "layout-root.md"), "# root v2");

    setupLayoutDocs({
      msgBase, pluginRoot, workspaceId: WS, sessionId: SID, version: "0.9.0",
    });

    // latest が v0.9.0 に切り替わる
    expect(fs.readlinkSync(path.join(msgBase, ".docs", "latest"))).toBe("v0.9.0");
    // 各階層の README.md は latest 経由で新内容を返す
    expect(
      fs.readFileSync(path.join(msgBase, "README.md"), "utf-8")
    ).toBe("# root v2");
    // 旧バージョンも残っている
    expect(fs.existsSync(path.join(msgBase, ".docs", "v0.8.0"))).toBe(true);
  });

  test("plugin 内に docs/layout/ がなければ no-op", () => {
    const emptyPlugin = path.join(workDir, "empty-plugin");
    fs.mkdirSync(emptyPlugin, { recursive: true });
    fs.mkdirSync(path.join(msgBase, WS, SID), { recursive: true });

    setupLayoutDocs({
      msgBase,
      pluginRoot: emptyPlugin,
      workspaceId: WS,
      sessionId: SID,
      version: "0.8.0",
    });

    // 何も作られない
    expect(fs.existsSync(path.join(msgBase, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(msgBase, ".docs"))).toBe(false);
  });

  test("既存 regular file の README.md は触らない（ユーザのファイルを保護）", () => {
    fs.mkdirSync(path.join(msgBase, WS, SID), { recursive: true });
    const userReadme = path.join(msgBase, "README.md");
    fs.writeFileSync(userReadme, "user own content");

    setupLayoutDocs({
      msgBase, pluginRoot, workspaceId: WS, sessionId: SID, version: "0.8.0",
    });

    // ユーザの regular file はそのまま
    expect(fs.lstatSync(userReadme).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(userReadme, "utf-8")).toBe("user own content");

    // ws 階層の symlink は作られている (上書きされてない場所には影響しない)
    expect(fs.lstatSync(path.join(msgBase, WS, "README.md")).isSymbolicLink()).toBe(true);
  });
});
