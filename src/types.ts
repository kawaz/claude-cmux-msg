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
  /**
   * 1 回の broadcast コマンドで生成される共通 ID。
   * 同じ broadcast から派生した N 件のメッセージは同じ broadcast_id を持つ。
   * 受信側はこの ID で「同じ broadcast の一部」を peer 横断で同定できる。
   */
  broadcast_id?: string;
}

/**
 * セッションの遷移状態 (DR-0004)。
 *
 * - `idle`: SessionStart 直後 / Stop / StopFailure 後 (ユーザ入力待ち)
 * - `running`: UserPromptSubmit 後 (推論中・ツール実行中)
 * - `awaiting_permission`: PermissionRequest (ユーザの許可待ち)
 * - `stopped`: SessionEnd (プロセス終了)
 */
export type SessionState =
  | "idle"
  | "running"
  | "awaiting_permission"
  | "stopped";

/**
 * セッションディレクトリの meta.json 形式 (DR-0004)。
 *
 * - `init_at` は dir 初回作成時点で固定。resume では維持する
 * - `last_started_at` は SessionStart hook で毎回更新 (resume 含む)
 * - `state` / `state_changed_at` は各 hook で transitionState() を呼んで更新する
 * - `tags` は spawn 時の CMUXMSG_TAGS env から渡される (`,` 区切り)。未指定なら `[]`
 *
 * `undefined` のフィールドは `JSON.stringify` で省かれるため optional。
 */
export interface PeerMeta {
  session_id: string;
  parent_session_id?: string;
  worker_name?: string;
  /** Claude アカウントの ~/.claude (CLAUDE_CONFIG_DIR 解決後の絶対パス) */
  claude_home: string;
  workspace_id: string;
  tab_id?: string;
  surface_id?: string;
  surface_ref?: string;
  /** SessionStart hook 時点の cwd (claude プロセスの cwd) */
  cwd: string;
  /** cwd から walk up して見つけた .git or .jj の親 dir。なければ未設定 */
  repo_root?: string;
  /** spawn 時 CMUXMSG_TAGS env で渡されたタグの配列 (空配列を含む) */
  tags: string[];
  state: SessionState;
  state_changed_at: string;
  /** 不変。初回 init 時の時刻 */
  init_at: string;
  /** SessionStart で毎回更新 (resume 含む) */
  last_started_at: string;
  /** SessionEnd で書く。resume されると次の SessionStart で更新せず維持 */
  last_ended_at?: string;
  shell_pid: number;
}
