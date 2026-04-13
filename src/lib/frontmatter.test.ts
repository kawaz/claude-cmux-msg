import { describe, test, expect } from "bun:test";
import {
  parseFrontmatter,
  serializeFrontmatter,
  insertFrontmatterField,
} from "./frontmatter";

describe("parseFrontmatter", () => {
  test("frontmatter なしのテキストはそのまま body", () => {
    const result = parseFrontmatter("hello world");
    expect(result.meta).toEqual({});
    expect(result.body).toBe("hello world");
  });

  test("基本的な frontmatter をパース", () => {
    const input = "---\nfrom: a\nto: b\n---\nhello";
    const result = parseFrontmatter(input);
    expect(result.meta).toEqual({ from: "a", to: "b" });
    expect(result.body).toBe("hello");
  });

  test("body 先頭の空行1つを除去", () => {
    const input = "---\nkey: value\n---\n\nbody text";
    const result = parseFrontmatter(input);
    expect(result.body).toBe("body text");
  });

  test("値にコロンが含まれる場合は最初の : で分割", () => {
    const input = "---\nurl: https://example.com\n---\nbody";
    const result = parseFrontmatter(input);
    expect(result.meta.url).toBe("https://example.com");
  });

  test("終了 --- がない場合は body 全体を返す", () => {
    const input = "---\nkey: value\nbody without close";
    const result = parseFrontmatter(input);
    expect(result.meta).toEqual({});
    expect(result.body).toBe(input);
  });

  test("空の frontmatter", () => {
    const input = "---\n---\nbody";
    const result = parseFrontmatter(input);
    expect(result.meta).toEqual({});
    expect(result.body).toBe("body");
  });

  test("複数行 body", () => {
    const input = "---\nk: v\n---\nline1\nline2\nline3";
    const result = parseFrontmatter(input);
    expect(result.body).toBe("line1\nline2\nline3");
  });
});

describe("serializeFrontmatter", () => {
  test("基本的なシリアライズ", () => {
    const result = serializeFrontmatter({ from: "a", to: "b" }, "hello");
    expect(result).toBe("---\nfrom: a\nto: b\n---\n\nhello");
  });

  test("undefined 値は除外される", () => {
    const result = serializeFrontmatter(
      { from: "a", to: undefined, type: "request" },
      "body"
    );
    expect(result).toBe("---\nfrom: a\ntype: request\n---\n\nbody");
  });

  test("空の meta", () => {
    const result = serializeFrontmatter({}, "body");
    expect(result).toBe("---\n---\n\nbody");
  });

  test("ラウンドトリップ（serialize → parse で同じ meta）", () => {
    const original = { from: "a", to: "b", type: "request" };
    const serialized = serializeFrontmatter(original, "body");
    const parsed = parseFrontmatter(serialized);
    expect(parsed.meta).toEqual(original);
    expect(parsed.body).toBe("body");
  });
});

describe("insertFrontmatterField", () => {
  test("新規フィールドを終了 --- の直前に追加", () => {
    const input = "---\nfrom: a\n---\nbody";
    const result = insertFrontmatterField(input, { read_at: "2026-01-01" });
    expect(result).toBe("---\nfrom: a\nread_at: 2026-01-01\n---\nbody");
  });

  test("既存フィールドの値を更新", () => {
    const input = "---\nfrom: a\nread_at: old\n---\nbody";
    const result = insertFrontmatterField(input, { read_at: "new" });
    expect(result).toBe("---\nfrom: a\nread_at: new\n---\nbody");
  });

  test("複数フィールドを同時に追加", () => {
    const input = "---\nfrom: a\n---\nbody";
    const result = insertFrontmatterField(input, {
      read_at: "t1",
      archive_at: "t2",
    });
    expect(result).toBe(
      "---\nfrom: a\nread_at: t1\narchive_at: t2\n---\nbody"
    );
  });

  test("frontmatter なしのテキストは無変更", () => {
    const input = "no frontmatter here";
    const result = insertFrontmatterField(input, { k: "v" });
    expect(result).toBe(input);
  });

  test("既存フィールド更新と新規追加の混在", () => {
    const input = "---\nkey1: old\n---\nbody";
    const result = insertFrontmatterField(input, {
      key1: "new",
      key2: "added",
    });
    expect(result).toBe("---\nkey1: new\nkey2: added\n---\nbody");
  });
});
