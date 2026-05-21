import { describe, test, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pickStableCwd } from "./paths";

describe("pickStableCwd", () => {
  const origBase = process.env.CMUXMSG_BASE;
  afterEach(() => {
    if (origBase === undefined) delete process.env.CMUXMSG_BASE;
    else process.env.CMUXMSG_BASE = origBase;
  });

  test("CMUXMSG_BASE が存在する dir ならそれを返す", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmuxmsg-paths-"));
    try {
      process.env.CMUXMSG_BASE = tmp;
      expect(pickStableCwd()).toBe(tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("CMUXMSG_BASE が存在しない場合は home にフォールバック", () => {
    process.env.CMUXMSG_BASE = path.join(
      os.tmpdir(),
      `cmuxmsg-nonexistent-${Date.now()}`
    );
    expect(pickStableCwd()).toBe(os.homedir());
  });
});
