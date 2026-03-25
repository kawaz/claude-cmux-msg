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

export interface PeerMeta {
  surface_id: string;
  workspace_id: string;
  tab_id: string;
  init_at: string;
  shell_pid: number;
}
