/**
 * メッセージファイルのフロントマター形式。
 *
 * 受信側で frontmatter に追記される (read_at / response_at / archive_at) ため、
 * 全フィールドが optional 寄り。最小限 from / to / type / created_at は必ず存在。
 */
export interface MessageMeta {
  from: string;
  to: string;
  type: "request" | "response" | "broadcast";
  priority: "normal" | "urgent";
  created_at: string;
  in_reply_to?: string;
  read_at?: string;
  response_at?: string;
  archive_at?: string;
}

/**
 * セッションディレクトリの meta.json 形式。
 *
 * `init.ts:initWorkspace` が書き込む。`undefined` のフィールドは
 * `JSON.stringify` で省かれるため optional。
 */
export interface PeerMeta {
  session_id: string;
  workspace_id: string;
  tab_id: string;
  surface_id?: string;
  init_at: string;
  shell_pid: number;
  worker_name?: string;
  parent_session_id?: string;
  surface_ref?: string;
}
