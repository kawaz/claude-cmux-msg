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

  // ダミープラグインの docs/design/ を用意 (DR-0004: workspace 階層廃止で 2 ファイル)
  const sourceDir = path.join(pluginRoot, "docs", "design");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "data-layout-root.md"), "# root v1");
  fs.writeFileSync(path.join(sourceDir, "data-layout-session.md"), "# session v1");

  fs.mkdirSync(msgBase, { recursive: true });
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const SID = "f695cacc-14c6-4983-94af-d3eeb1d6649a";

describe("setupLayoutDocs", () => {
  test("root と session の README.md と .docs/v<version>/, .docs/latest を作る", () => {
    fs.mkdirSync(path.join(msgBase, SID), { recursive: true });

    setupLayoutDocs({
      msgBase,
      pluginRoot,
      sessionId: SID,
      version: "0.8.0",
    });

    // .docs/v0.8.0/ に layout-*.md がコピーされている
    expect(
      fs.readFileSync(path.join(msgBase, ".docs", "v0.8.0", "data-layout-root.md"), "utf-8")
    ).toBe("# root v1");

    // .docs/latest が v0.8.0 を指す
    expect(fs.readlinkSync(path.join(msgBase, ".docs", "latest"))).toBe("v0.8.0");

    // root と session の README.md (symlink) ができている
    const rootReadme = path.join(msgBase, "README.md");
    const sidReadme = path.join(msgBase, SID, "README.md");

    expect(fs.lstatSync(rootReadme).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(sidReadme).isSymbolicLink()).toBe(true);

    // 内容が辿れる
    expect(fs.readFileSync(rootReadme, "utf-8")).toBe("# root v1");
    expect(fs.readFileSync(sidReadme, "utf-8")).toBe("# session v1");
  });

  test("冪等: 2回呼んでも同じ状態", () => {
    fs.mkdirSync(path.join(msgBase, SID), { recursive: true });

    setupLayoutDocs({ msgBase, pluginRoot, sessionId: SID, version: "0.8.0" });
    const firstStat = fs.lstatSync(path.join(msgBase, "README.md"));

    setupLayoutDocs({ msgBase, pluginRoot, sessionId: SID, version: "0.8.0" });
    const secondStat = fs.lstatSync(path.join(msgBase, "README.md"));

    // symlink は同じ inode のまま (recreate されていない)
    expect(secondStat.ino).toBe(firstStat.ino);
  });

  test("version bump: latest が新バージョンに付け替わる", () => {
    fs.mkdirSync(path.join(msgBase, SID), { recursive: true });

    setupLayoutDocs({ msgBase, pluginRoot, sessionId: SID, version: "0.8.0" });
    expect(fs.readlinkSync(path.join(msgBase, ".docs", "latest"))).toBe("v0.8.0");

    // plugin 側を更新
    fs.writeFileSync(path.join(pluginRoot, "docs", "design", "data-layout-root.md"), "# root v2");

    setupLayoutDocs({ msgBase, pluginRoot, sessionId: SID, version: "0.9.0" });

    // latest が v0.9.0 に切り替わる
    expect(fs.readlinkSync(path.join(msgBase, ".docs", "latest"))).toBe("v0.9.0");
    // 各階層の README.md は latest 経由で新内容を返す
    expect(
      fs.readFileSync(path.join(msgBase, "README.md"), "utf-8")
    ).toBe("# root v2");
    // 旧バージョンも残っている
    expect(fs.existsSync(path.join(msgBase, ".docs", "v0.8.0"))).toBe(true);
  });

  test("plugin 内に docs/design/ がなければ no-op", () => {
    const emptyPlugin = path.join(workDir, "empty-plugin");
    fs.mkdirSync(emptyPlugin, { recursive: true });
    fs.mkdirSync(path.join(msgBase, SID), { recursive: true });

    setupLayoutDocs({
      msgBase,
      pluginRoot: emptyPlugin,
      sessionId: SID,
      version: "0.8.0",
    });

    // 何も作られない
    expect(fs.existsSync(path.join(msgBase, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(msgBase, ".docs"))).toBe(false);
  });

  test("同 version で plugin の layout content が変わったら再コピー (content hash)", () => {
    fs.mkdirSync(path.join(msgBase, SID), { recursive: true });

    setupLayoutDocs({ msgBase, pluginRoot, sessionId: SID, version: "0.8.0" });
    expect(
      fs.readFileSync(path.join(msgBase, "README.md"), "utf-8")
    ).toBe("# root v1");

    // plugin 内 data-layout-root.md を更新 (version は据え置き)
    fs.writeFileSync(
      path.join(pluginRoot, "docs", "design", "data-layout-root.md"),
      "# root v1-updated"
    );

    setupLayoutDocs({ msgBase, pluginRoot, sessionId: SID, version: "0.8.0" });
    // .docs/v0.8.0/ の内容も更新されている
    expect(
      fs.readFileSync(path.join(msgBase, "README.md"), "utf-8")
    ).toBe("# root v1-updated");
  });

  test("既存 regular file の README.md は触らない（ユーザのファイルを保護）", () => {
    fs.mkdirSync(path.join(msgBase, SID), { recursive: true });
    const userReadme = path.join(msgBase, "README.md");
    fs.writeFileSync(userReadme, "user own content");

    setupLayoutDocs({ msgBase, pluginRoot, sessionId: SID, version: "0.8.0" });

    // ユーザの regular file はそのまま
    expect(fs.lstatSync(userReadme).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(userReadme, "utf-8")).toBe("user own content");

    // session 階層の symlink は作られている
    expect(fs.lstatSync(path.join(msgBase, SID, "README.md")).isSymbolicLink()).toBe(true);
  });
});
