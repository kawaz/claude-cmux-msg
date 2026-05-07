import { describe, test, expect } from "bun:test";
import {
  validateSessionId,
  validateName,
  validateFilename,
  isSessionId,
  UUID_PATTERN,
  SURFACE_REF_PATTERN,
} from "./validate";

describe("UUID_PATTERN", () => {
  test("有効な UUID v4 にマッチ", () => {
    expect(UUID_PATTERN.test("1D033978-ACF7-479B-B355-160EC85217B1")).toBe(true);
    expect(UUID_PATTERN.test("1d033978-acf7-479b-b355-160ec85217b1")).toBe(true);
  });

  test("不正な形式は拒否", () => {
    expect(UUID_PATTERN.test("surface:1")).toBe(false);
    expect(UUID_PATTERN.test("not-a-uuid")).toBe(false);
    expect(UUID_PATTERN.test("1D033978-ACF7-479B-B355")).toBe(false);
    expect(UUID_PATTERN.test("")).toBe(false);
    // 長すぎる
    expect(
      UUID_PATTERN.test("1D033978-ACF7-479B-B355-160EC85217B1-extra")
    ).toBe(false);
  });
});

describe("SURFACE_REF_PATTERN", () => {
  test("surface:N 形式にマッチ", () => {
    expect(SURFACE_REF_PATTERN.test("surface:0")).toBe(true);
    expect(SURFACE_REF_PATTERN.test("surface:42")).toBe(true);
    expect(SURFACE_REF_PATTERN.test("surface:9999")).toBe(true);
  });

  test("不正な形式は拒否", () => {
    expect(SURFACE_REF_PATTERN.test("surface:")).toBe(false);
    expect(SURFACE_REF_PATTERN.test("surface:abc")).toBe(false);
    expect(SURFACE_REF_PATTERN.test("Surface:1")).toBe(false);
    expect(SURFACE_REF_PATTERN.test(" surface:1")).toBe(false);
  });
});

describe("validateSessionId", () => {
  test("UUID は通る", () => {
    expect(() =>
      validateSessionId("1D033978-ACF7-479B-B355-160EC85217B1")
    ).not.toThrow();
  });

  test("surface:N は拒否", () => {
    expect(() => validateSessionId("surface:1")).toThrow(/UUID 形式/);
  });

  test("空文字列は拒否", () => {
    expect(() => validateSessionId("")).toThrow();
  });

  test("ランダム文字列は拒否", () => {
    expect(() => validateSessionId("foo-bar")).toThrow();
  });
});

describe("isSessionId", () => {
  test("UUID 形式は true", () => {
    expect(isSessionId("1D033978-ACF7-479B-B355-160EC85217B1")).toBe(true);
    expect(isSessionId("f695cacc-14c6-4983-94af-d3eeb1d6649a")).toBe(true);
  });

  test("インデックスディレクトリ名は false", () => {
    expect(isSessionId("by-surface")).toBe(false);
    expect(isSessionId("broadcast")).toBe(false);
    expect(isSessionId("by-name")).toBe(false);
  });

  test("内部状態ファイル名は false", () => {
    expect(isSessionId(".last-worker-surface")).toBe(false);
    expect(isSessionId("tmp")).toBe(false);
  });

  test("空文字列は false", () => {
    expect(isSessionId("")).toBe(false);
  });
});

describe("shellSingleQuote", () => {
  test("単純な文字列は単引用符で囲む", () => {
    const { shellSingleQuote } = require("./validate");
    expect(shellSingleQuote("foo")).toBe("'foo'");
    expect(shellSingleQuote("worker-1")).toBe("'worker-1'");
  });

  test("単引用符を含む文字列は escape", () => {
    const { shellSingleQuote } = require("./validate");
    expect(shellSingleQuote("a'b")).toBe(`'a'\\''b'`);
  });

  test("空文字列も処理可能", () => {
    const { shellSingleQuote } = require("./validate");
    expect(shellSingleQuote("")).toBe("''");
  });

  test("シェル特殊文字も無害化される", () => {
    const { shellSingleQuote } = require("./validate");
    expect(shellSingleQuote("$(rm -rf /)")).toBe("'$(rm -rf /)'");
    expect(shellSingleQuote("`rm`")).toBe("'`rm`'");
    expect(shellSingleQuote(";rm -rf /;")).toBe("';rm -rf /;'");
  });
});

describe("validateName", () => {
  test("英数字 + _ - は通る", () => {
    expect(() => validateName("worker-1")).not.toThrow();
    expect(() => validateName("task_a")).not.toThrow();
    expect(() => validateName("Alice2")).not.toThrow();
    expect(() => validateName("a_b-c-1")).not.toThrow();
  });

  test("日本語・記号・空白を拒否 (ホワイトリスト)", () => {
    expect(() => validateName("ワーカーA")).toThrow();
    expect(() => validateName("worker A")).toThrow();
    expect(() => validateName("a;b")).toThrow();
    expect(() => validateName("a&b")).toThrow();
    expect(() => validateName("a|b")).toThrow();
    expect(() => validateName("a`b")).toThrow();
    expect(() => validateName("a$b")).toThrow();
    expect(() => validateName("a(b)")).toThrow();
    expect(() => validateName("a{b}")).toThrow();
    expect(() => validateName("a'b")).toThrow();
    expect(() => validateName('a"b')).toThrow();
    expect(() => validateName("a\nb")).toThrow();
    expect(() => validateName("a/b")).toThrow();
    expect(() => validateName("a..b")).toThrow();
    expect(() => validateName("a*b")).toThrow();
  });

  test("空文字列は拒否", () => {
    expect(() => validateName("")).toThrow();
  });
});

describe("validateFilename", () => {
  test("通常のファイル名は通る", () => {
    expect(() =>
      validateFilename("20260413T123045-abcd1234.md")
    ).not.toThrow();
  });

  test("パストラバーサルを拒否", () => {
    expect(() => validateFilename("../etc/passwd")).toThrow();
    expect(() => validateFilename("foo/bar")).toThrow();
    expect(() => validateFilename("..")).toThrow();
  });

  test("ヌル文字を拒否", () => {
    expect(() => validateFilename("foo\0.md")).toThrow();
  });

  test("空文字列は拒否", () => {
    expect(() => validateFilename("")).toThrow();
  });
});
