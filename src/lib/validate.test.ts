import { describe, test, expect } from "bun:test";
import {
  validateSessionId,
  validateName,
  validateFilename,
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

describe("validateName", () => {
  test("通常の名前は通る", () => {
    expect(() => validateName("worker-1")).not.toThrow();
    expect(() => validateName("task_a")).not.toThrow();
    expect(() => validateName("ワーカーA")).not.toThrow();
  });

  test("シェル特殊文字を拒否", () => {
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
