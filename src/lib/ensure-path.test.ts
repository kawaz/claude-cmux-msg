import { describe, it, expect } from "bun:test";
import {
  decidePathAction,
  renderDecisionMessage,
  pickHomeBinCandidates,
} from "./ensure-path";

describe("decidePathAction", () => {
  const targetBin = "/cache/cmux-msg/0.31.0/bin/cmux-msg";

  it("PATH 上に cmux-msg が無ければ missing", () => {
    const d = decidePathAction({
      targetBin,
      pathBin: null,
      pathBinRealpath: null,
      pathBinIsSymlink: false,
    });
    expect(d).toEqual({ kind: "missing", targetBin });
  });

  it("PATH 上の realpath が target と一致なら ok", () => {
    const d = decidePathAction({
      targetBin,
      pathBin: "/home/u/bin/cmux-msg",
      pathBinRealpath: targetBin,
      pathBinIsSymlink: true,
    });
    expect(d).toEqual({ kind: "ok" });
  });

  it("symlink で realpath 不一致なら outdated-symlink", () => {
    const d = decidePathAction({
      targetBin,
      pathBin: "/home/u/bin/cmux-msg",
      pathBinRealpath: "/cache/cmux-msg/0.30.13/bin/cmux-msg",
      pathBinIsSymlink: true,
    });
    expect(d).toEqual({
      kind: "outdated-symlink",
      pathBin: "/home/u/bin/cmux-msg",
      targetBin,
    });
  });

  it("symlink でなく realpath 不一致なら mismatched-non-symlink", () => {
    const d = decidePathAction({
      targetBin,
      pathBin: "/home/u/bin/cmux-msg",
      pathBinRealpath: "/home/u/bin/cmux-msg",
      pathBinIsSymlink: false,
    });
    expect(d).toEqual({
      kind: "mismatched-non-symlink",
      pathBin: "/home/u/bin/cmux-msg",
      targetBin,
    });
  });
});

describe("renderDecisionMessage", () => {
  const targetBin = "/cache/cmux-msg/0.31.0/bin/cmux-msg";

  it("ok は null", () => {
    expect(renderDecisionMessage({ kind: "ok" }, [])).toBeNull();
  });

  it("missing は候補 dir を列挙する", () => {
    const msg = renderDecisionMessage(
      { kind: "missing", targetBin },
      ["/home/u/.local/bin", "/home/u/bin"],
    );
    expect(msg).toContain("PATH 上に");
    expect(msg).toContain("/home/u/.local/bin");
    expect(msg).toContain("/home/u/bin");
    expect(msg).toContain(targetBin);
  });

  it("missing で候補ゼロでも message が出る", () => {
    const msg = renderDecisionMessage({ kind: "missing", targetBin }, []);
    expect(msg).toContain("HOME 内の PATH 上 bin ディレクトリが見つかりません");
  });

  it("outdated-symlink は更新ログを出す", () => {
    const msg = renderDecisionMessage(
      {
        kind: "outdated-symlink",
        pathBin: "/home/u/bin/cmux-msg",
        targetBin,
      },
      [],
    );
    expect(msg).toContain("更新しました");
    expect(msg).toContain("/home/u/bin/cmux-msg");
    expect(msg).toContain(targetBin);
  });

  it("mismatched-non-symlink は手動置換を促す", () => {
    const msg = renderDecisionMessage(
      {
        kind: "mismatched-non-symlink",
        pathBin: "/home/u/bin/cmux-msg",
        targetBin,
      },
      [],
    );
    expect(msg).toContain("symlink ではない");
    expect(msg).toContain("/home/u/bin/cmux-msg");
    expect(msg).toContain(targetBin);
  });
});

describe("pickHomeBinCandidates", () => {
  const home = "/home/u";

  it("HOME 配下の dir のみ抽出 + 重複除去 + 順序保持", () => {
    const pathEnv = [
      "/usr/local/bin",
      "/home/u/.local/bin",
      "/home/other/bin",
      "/home/u/bin",
      "/home/u/.local/bin",
    ].join(":");
    const got = pickHomeBinCandidates(pathEnv, home, () => true);
    expect(got).toEqual(["/home/u/.local/bin", "/home/u/bin"]);
  });

  it("isUsableDir が false なら除外", () => {
    const pathEnv = "/home/u/.local/bin:/home/u/bin";
    const got = pickHomeBinCandidates(pathEnv, home, (p) =>
      p === "/home/u/bin",
    );
    expect(got).toEqual(["/home/u/bin"]);
  });

  it("空 PATH なら空配列", () => {
    expect(pickHomeBinCandidates("", home, () => true)).toEqual([]);
  });

  it("HOME ピッタリも候補に含める", () => {
    const got = pickHomeBinCandidates("/home/u", home, () => true);
    expect(got).toEqual(["/home/u"]);
  });
});
