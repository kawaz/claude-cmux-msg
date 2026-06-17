import { describe, test, expect } from "bun:test";
import {
  validateLabel,
  parseLabels,
  InvalidLabelError,
  LABEL_MAX_LENGTH,
} from "./label-parser";

describe("validateLabel", () => {
  test("英数字のみ OK", () => {
    expect(() => validateLabel("team_a")).not.toThrow();
    expect(() => validateLabel("ROLE_42")).not.toThrow();
  });

  test("= を含む key=value 形式 OK", () => {
    expect(() => validateLabel("app=ccmsg")).not.toThrow();
    expect(() => validateLabel("role=tester")).not.toThrow();
  });

  test("空文字は InvalidLabelError", () => {
    expect(() => validateLabel("")).toThrow(InvalidLabelError);
  });

  test(`長さ ${LABEL_MAX_LENGTH + 1} 文字は InvalidLabelError`, () => {
    expect(() => validateLabel("a".repeat(LABEL_MAX_LENGTH + 1))).toThrow(
      InvalidLabelError,
    );
  });

  test(`長さ ${LABEL_MAX_LENGTH} 文字 ちょうど OK`, () => {
    expect(() => validateLabel("a".repeat(LABEL_MAX_LENGTH))).not.toThrow();
  });

  test("コロン (:) は不許可 (kawaz 確認、Windows 予約 + 慣習衝突)", () => {
    expect(() => validateLabel("app:ccmsg")).toThrow(InvalidLabelError);
  });

  test("ハイフン (-) / ドット (.) はシンプルさ優先で不許可", () => {
    expect(() => validateLabel("team-a")).toThrow(InvalidLabelError);
    expect(() => validateLabel("v1.0")).toThrow(InvalidLabelError);
  });

  test("カンマ (,) は不許可 (= 区切り文字専用)", () => {
    expect(() => validateLabel("a,b")).toThrow(InvalidLabelError);
  });

  test("空白を含むのは不許可", () => {
    expect(() => validateLabel("hello world")).toThrow(InvalidLabelError);
  });

  test("マルチバイト文字は不許可 (ASCII セーフ)", () => {
    expect(() => validateLabel("チーム")).toThrow(InvalidLabelError);
  });
});

describe("parseLabels", () => {
  test("単一", () => {
    expect(parseLabels("team_a")).toEqual(["team_a"]);
  });

  test("カンマ区切り複数", () => {
    expect(parseLabels("team_a,team_b,role=tester")).toEqual([
      "team_a",
      "team_b",
      "role=tester",
    ]);
  });

  test("前後 / 間の空白は trim", () => {
    expect(parseLabels("  team_a , team_b  ,role=tester ")).toEqual([
      "team_a",
      "team_b",
      "role=tester",
    ]);
  });

  test("空要素 (連続カンマ / 末尾カンマ) は無視", () => {
    expect(parseLabels(",team_a,,team_b,")).toEqual(["team_a", "team_b"]);
  });

  test("重複は除去 (= CLI 表示の混乱予防)", () => {
    expect(parseLabels("team_a,team_b,team_a")).toEqual(["team_a", "team_b"]);
  });

  test("1 要素でも不正なら InvalidLabelError", () => {
    expect(() => parseLabels("team_a,bad-label,team_b")).toThrow(
      InvalidLabelError,
    );
  });

  test("全部空 (= 空文字 or カンマだけ) は空配列", () => {
    expect(parseLabels("")).toEqual([]);
    expect(parseLabels(",,,")).toEqual([]);
    expect(parseLabels("  ")).toEqual([]);
  });
});
