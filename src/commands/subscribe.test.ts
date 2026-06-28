import { describe, test, expect } from "bun:test";
import { parseSubscribeArgs } from "./subscribe";
import { UsageError } from "../lib/errors";

describe("parseSubscribeArgs", () => {
  test("引数なしは force=false", () => {
    expect(parseSubscribeArgs([])).toEqual({ force: false });
  });
  test("--force を認識", () => {
    expect(parseSubscribeArgs(["--force"])).toEqual({ force: true });
  });
  test("不明なオプションは UsageError", () => {
    expect(() => parseSubscribeArgs(["--bogus"])).toThrow(UsageError);
  });
  test("positional 引数は UsageError", () => {
    expect(() => parseSubscribeArgs(["foo"])).toThrow(UsageError);
  });
});
