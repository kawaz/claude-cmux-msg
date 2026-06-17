/**
 * DR-0015 §5: label 動的操作 (add / remove / list)。
 *
 * 自セッションに label を貼ったり剥がしたりする。カンマ区切りで一発複数操作可。
 * 文字制約 [a-zA-Z0-9_=]+、長さ上限 64 (label-parser.ts)。
 *
 * label の使い方:
 *   ccmsg label add team-A,team-B,role=tester
 *   ccmsg label remove team-A,team-B
 *   ccmsg label list
 *
 * 動作前提: SessionStart hook で DB sessions row が upsert されていること。
 * 未初期化なら使い方を案内する。
 */
import { openDb } from "../lib/db";
import {
  addLabels as dbAddLabels,
  removeLabels as dbRemoveLabels,
  listLabels as dbListLabels,
  getSession,
} from "../lib/session-status";
import { parseLabels, InvalidLabelError } from "../lib/label-parser";
import { requireSessionId, getSessionId } from "../config";
import { UsageError } from "../lib/errors";

const USAGE = `使い方:
  ccmsg label add <name>[,<name>...]      # カンマ区切りで複数同時貼り
  ccmsg label remove <name>[,<name>...]   # カンマ区切りで複数同時剥がし
  ccmsg label list                        # 自セッションの label 一覧

label 文字制約: [a-zA-Z0-9_=]+、長さ上限 64
例:
  ccmsg label add test-team-A
  ccmsg label add team_a,team_b,role=tester
  ccmsg label remove team_a,team_b`;

export async function cmdLabel(args: string[]): Promise<void> {
  requireSessionId();

  const subcmd = args[0];
  if (!subcmd) throw new UsageError(USAGE);

  const db = openDb();
  try {
    const mySid = getSessionId();
    const session = getSession(db, mySid);
    if (!session) {
      throw new UsageError(
        "DB に自セッションが見つかりません。SessionStart hook が走っていません。\n" +
          "(DR-0016: sessions テーブルは SessionStart hook で upsert される)",
      );
    }

    if (subcmd === "list") {
      const labels = dbListLabels(db, mySid);
      if (labels.length === 0) {
        console.log("(labels なし)");
        return;
      }
      for (const l of labels) console.log(l);
      return;
    }

    if (subcmd === "add" || subcmd === "remove") {
      const arg = args[1];
      if (!arg) {
        throw new UsageError(
          `label ${subcmd} には引数が必要です (カンマ区切り可)\n\n${USAGE}`,
        );
      }
      let labels: string[];
      try {
        labels = parseLabels(arg);
      } catch (e) {
        if (e instanceof InvalidLabelError) {
          throw new UsageError(`${e.message}\n\n${USAGE}`);
        }
        throw e;
      }
      if (labels.length === 0) {
        console.log("(変更なし: 空入力)");
        return;
      }
      if (subcmd === "add") {
        dbAddLabels(db, mySid, labels);
        console.log(`追加: ${labels.join(", ")}`);
      } else {
        dbRemoveLabels(db, mySid, labels);
        console.log(`削除: ${labels.join(", ")}`);
      }
      return;
    }

    throw new UsageError(`不明なサブコマンド: ${subcmd}\n\n${USAGE}`);
  } finally {
    db.close();
  }
}
