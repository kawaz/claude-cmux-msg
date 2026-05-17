import { describe, test, expect } from "bun:test";
import {
  normalizeTty,
  parseCmuxTree,
  findSurfaceByTty,
  type CmuxSurfaceEntry,
} from "./cmux-surface";

// 実機の `cmux tree` 出力 (DR-0007 検証時に採取)。surface 行は `tty=ttysNNN` を
// 持つものと持たないものが混在する。
const CMUX_TREE = `window window:1 [current] active
|__ workspace workspace:15 "org/repo/staging"
|   |__ pane pane:20 [focused]
|   |   |__ surface surface:23 [terminal] "task A" [selected] tty=ttys000
|   |__ pane pane:40
|       |__ surface surface:50 [terminal] "...path" [selected]
|__ workspace workspace:16 "org/repo/staging"
|   |__ pane pane:21 [focused]
|       |__ surface surface:24 [terminal] "task B" tty=ttys003
|       |__ surface surface:32 [terminal] "Claude Code" [selected] tty=ttys006
|__ workspace workspace:20 "kawaz/claude-cmux-msg/main"
    |__ pane pane:30 [focused]
        |__ surface surface:35 [terminal] "confirm" [selected] here tty=ttys008`;

describe("normalizeTty", () => {
  test("ttysNNN はそのまま", () => {
    expect(normalizeTty("ttys008")).toBe("ttys008");
  });
  test("/dev/ttys008 は basename 化", () => {
    expect(normalizeTty("/dev/ttys008")).toBe("ttys008");
  });
  test("ps 短縮表記 sNNN は tty 接頭辞を補う", () => {
    expect(normalizeTty("s008")).toBe("ttys008");
  });
  test("?? は null (controlling tty なし)", () => {
    expect(normalizeTty("??")).toBe(null);
  });
  test("? は null", () => {
    expect(normalizeTty("?")).toBe(null);
  });
  test("空文字は null", () => {
    expect(normalizeTty("")).toBe(null);
  });
  test("null は null", () => {
    expect(normalizeTty(null)).toBe(null);
  });
  test("undefined は null", () => {
    expect(normalizeTty(undefined)).toBe(null);
  });
  test("前後の空白は無視", () => {
    expect(normalizeTty("  ttys008  ")).toBe("ttys008");
  });
});

describe("parseCmuxTree", () => {
  test("surface 行を全部拾う", () => {
    const entries = parseCmuxTree(CMUX_TREE);
    expect(entries.map((e) => e.surfaceRef)).toEqual([
      "surface:23",
      "surface:50",
      "surface:24",
      "surface:32",
      "surface:35",
    ]);
  });

  test("tty= が付く surface は tty を持つ", () => {
    const entries = parseCmuxTree(CMUX_TREE);
    const s35 = entries.find((e) => e.surfaceRef === "surface:35");
    expect(s35!.tty).toBe("ttys008");
  });

  test("tty= が無い surface は tty=null", () => {
    const entries = parseCmuxTree(CMUX_TREE);
    const s50 = entries.find((e) => e.surfaceRef === "surface:50");
    expect(s50!.tty).toBe(null);
  });

  test("window / workspace / pane 行は surface として拾わない", () => {
    const entries = parseCmuxTree(CMUX_TREE);
    expect(entries).toHaveLength(5);
    expect(
      entries.every((e) => /^surface:\d+$/.test(e.surfaceRef))
    ).toBe(true);
  });

  test("空出力は空配列", () => {
    expect(parseCmuxTree("")).toEqual([]);
  });

  test("surface 参照を含まない行のみなら空配列", () => {
    expect(parseCmuxTree("window window:1\n  pane pane:2")).toEqual([]);
  });
});

describe("findSurfaceByTty", () => {
  const entries: CmuxSurfaceEntry[] = [
    { surfaceRef: "surface:23", tty: "ttys000" },
    { surfaceRef: "surface:50", tty: null },
    { surfaceRef: "surface:32", tty: "ttys006" },
    { surfaceRef: "surface:35", tty: "ttys008" },
  ];

  test("tty が一致する surface を 1 件引く", () => {
    expect(findSurfaceByTty(entries, "ttys008")).toEqual({
      kind: "found",
      surfaceRef: "surface:35",
    });
  });

  test("ps 短縮表記の tty でも一致させる", () => {
    expect(findSurfaceByTty(entries, "s006")).toEqual({
      kind: "found",
      surfaceRef: "surface:32",
    });
  });

  test("/dev/ 付きの tty でも一致させる", () => {
    expect(findSurfaceByTty(entries, "/dev/ttys000")).toEqual({
      kind: "found",
      surfaceRef: "surface:23",
    });
  });

  test("一致する surface が無ければ no_surface (tmux 入れ子 / SSH 等)", () => {
    expect(findSurfaceByTty(entries, "ttys999")).toEqual({
      kind: "no_surface",
    });
  });

  test("tty が ?? なら no_surface", () => {
    expect(findSurfaceByTty(entries, "??")).toEqual({ kind: "no_surface" });
  });

  test("tty が null なら no_surface", () => {
    expect(findSurfaceByTty(entries, null)).toEqual({ kind: "no_surface" });
  });

  test("tty=null の surface には tty 一致でヒットしない", () => {
    // entries に tty:null の surface:50 がある。null 同士でマッチさせない。
    expect(findSurfaceByTty(entries, "")).toEqual({ kind: "no_surface" });
  });

  test("同一 tty を持つ surface が複数なら ambiguous", () => {
    const dup: CmuxSurfaceEntry[] = [
      { surfaceRef: "surface:1", tty: "ttys008" },
      { surfaceRef: "surface:2", tty: "ttys008" },
    ];
    expect(findSurfaceByTty(dup, "ttys008")).toEqual({
      kind: "ambiguous",
      surfaceRefs: ["surface:1", "surface:2"],
    });
  });
});

describe("parseCmuxTree + findSurfaceByTty (結合)", () => {
  test("実 cmux tree 出力から claude の tty で surface を逆引きする", () => {
    const entries = parseCmuxTree(CMUX_TREE);
    expect(findSurfaceByTty(entries, "ttys008")).toEqual({
      kind: "found",
      surfaceRef: "surface:35",
    });
  });

  test("tty を持たない claude (ヘッドレス) は no_surface に落ちる", () => {
    const entries = parseCmuxTree(CMUX_TREE);
    expect(findSurfaceByTty(entries, "??")).toEqual({ kind: "no_surface" });
  });
});
