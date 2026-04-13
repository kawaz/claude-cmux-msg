/**
 * UUID → surface:N マッピング管理
 *
 * cmux-msg のユーザ I/F は UUID 一本だが、cmux API は surface:N を要求するため、
 * 内部で UUID から cmux 内部参照を逆引きする。
 */
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { wsDir } from "../config";
import { UUID_PATTERN } from "./validate";

const REFS_FILE = "surface-refs.json";

function refsPath(): string {
  return path.join(wsDir(), REFS_FILE);
}

function writeRefsAtomic(refs: Record<string, string>): void {
  const p = refsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(refs, null, 2));
  fs.renameSync(tmp, p);
}

function readRefs(): Record<string, string> {
  try {
    const raw: Record<string, string> = JSON.parse(
      fs.readFileSync(refsPath(), "utf-8")
    );
    const keys = Object.keys(raw);
    if (keys.length > 0 && keys.every((k) => /^surface:\d+$/.test(k))) {
      // 旧形式（surface:N → UUID）を新形式に変換し、永続化して以降のチェックを不要に
      const migrated: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        migrated[v] = k;
      }
      try {
        writeRefsAtomic(migrated);
      } catch {
        // 書き戻し失敗時もメモリ上の変換結果は返す
      }
      return migrated;
    }
    return raw;
  } catch {
    return {};
  }
}

/** UUID → surface:N を保存 */
export function saveSurfaceRef(uuid: string, ref: string): void {
  const refs = readRefs();
  refs[uuid] = ref;
  writeRefsAtomic(refs);
}

/**
 * UUID から cmux 内部参照（surface:N）を逆引きする。
 * cmux API（cmuxSend, cmuxCloseSurface 等）に渡すために必要。
 */
export function resolveCmuxRef(uuid: string): string {
  if (!UUID_PATTERN.test(uuid)) {
    throw new Error(`UUID 形式ではありません: ${uuid}`);
  }
  const refs = readRefs();
  const ref = refs[uuid];
  if (!ref) {
    throw new Error(
      `UUID ${uuid} に対応する cmux ref が未登録です。cmux-msg peers で確認してください。`
    );
  }
  return ref;
}

/**
 * cmux 内部参照（surface:N）から UUID を逆引きする。
 * spawn 完了時にワーカーの UUID を特定するために使用。
 */
export function findUuidByRef(ref: string): string | null {
  const refs = readRefs();
  for (const [uuid, r] of Object.entries(refs)) {
    if (r === ref) return uuid;
  }
  return null;
}
