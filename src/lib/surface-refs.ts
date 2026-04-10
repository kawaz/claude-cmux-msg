/**
 * surface:N → UUID マッピング管理
 */
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { wsDir } from "../config";
import { SURFACE_REF_PATTERN } from "./validate";

const REFS_FILE = "surface-refs.json";

function refsPath(): string {
  return path.join(wsDir(), REFS_FILE);
}

function readRefs(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(refsPath(), "utf-8"));
  } catch {
    return {};
  }
}

/** surface:N → UUID を保存（tmp + rename で原子的に書き込み） */
export function saveSurfaceRef(ref: string, uuid: string): void {
  const refs = readRefs();
  refs[ref] = uuid;
  const p = refsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(refs, null, 2));
  fs.renameSync(tmp, p);
}

/** surface:N を UUID に解決。UUID 形式ならそのまま返す。 */
export function resolveSurfaceId(id: string): string {
  if (!SURFACE_REF_PATTERN.test(id)) return id;

  const refs = readRefs();
  const uuid = refs[id];
  if (!uuid) {
    throw new Error(
      `surface ref ${id} が未登録です。cmux-msg peers で確認してください。`
    );
  }
  return uuid;
}
