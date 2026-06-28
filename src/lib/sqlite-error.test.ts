import { describe, test, expect } from "bun:test";
import { isSqliteBusyError } from "./sqlite-error";

describe("isSqliteBusyError", () => {
  test("SQLITE_BUSY を true", () => {
    expect(isSqliteBusyError({ code: "SQLITE_BUSY" })).toBe(true);
  });
  test("SQLITE_BUSY_SNAPSHOT を true", () => {
    expect(isSqliteBusyError({ code: "SQLITE_BUSY_SNAPSHOT" })).toBe(true);
  });
  test("SQLITE_BUSY_TIMEOUT を true", () => {
    expect(isSqliteBusyError({ code: "SQLITE_BUSY_TIMEOUT" })).toBe(true);
  });
  test("SQLITE_LOCKED を true", () => {
    expect(isSqliteBusyError({ code: "SQLITE_LOCKED" })).toBe(true);
  });
  test("SQLITE_LOCKED_SHAREDCACHE を true", () => {
    expect(isSqliteBusyError({ code: "SQLITE_LOCKED_SHAREDCACHE" })).toBe(true);
  });
  test("他の SQLite error は false", () => {
    expect(isSqliteBusyError({ code: "SQLITE_CORRUPT" })).toBe(false);
    expect(isSqliteBusyError({ code: "SQLITE_NOTFOUND" })).toBe(false);
  });
  test("Error インスタンス (code 無し) は false", () => {
    expect(isSqliteBusyError(new Error("boom"))).toBe(false);
  });
  test("string / null / undefined は false", () => {
    expect(isSqliteBusyError("SQLITE_BUSY")).toBe(false);
    expect(isSqliteBusyError(null)).toBe(false);
    expect(isSqliteBusyError(undefined)).toBe(false);
  });
  test("code が文字列以外なら false", () => {
    expect(isSqliteBusyError({ code: 5 })).toBe(false);
  });
});
