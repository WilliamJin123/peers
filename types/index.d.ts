export type Peer = {
  session: string
  name: string
  /** Its short id, `cc-2724`. */
  id?: string
  ticket?: string
  /** Its task's title, else its Claude Code session's title. */
  title?: string | null
  files: number
  shared: number
  last: number
  started?: number
  adds?: number
  dels?: number
  // The verbose band: what they last said their edits do, and the files we both changed.
  doing?: string
  sharedFiles?: string[]
}

// The /peers pane: what the `peers view` server answers (lib/view.mjs, lib/doc.mjs).
export type ViewRun = { t: '=' | '+' | '-'; s: string }
export type ViewLine = {
  k: '=' | '+' | '-' | '~'
  s: string
  a: string | null
  pre?: string
  runs?: ViewRun[]
  g?: number
  fence?: boolean
}
// t: the title of a change: the line its author wrote before the edit (said), else where it sits.
export type ViewHunk = {
  old: number
  new: number
  at: string
  t: string
  said: boolean
  // When its author said it: the edit's time. Only on a said title.
  when?: number
  a: string | null
  lines: { t: ' ' | '+' | '-'; s: string; a?: string | null }[]
}
export type ViewChange = { line: number; t: string; said: boolean; when?: number; a: string | null; adds: number; dels: number }
export type ViewFile = {
  rel: string
  authors: string[]
  isNew: boolean
  // A folder git lists as one path: a nested repo, a submodule, a linked folder.
  isDir?: boolean
  kind: 'add' | 'edit' | 'delete'
  count?: number
  mtime: number
  // The working file's length in lines; 0 when unknown (binary, too big, gone).
  size?: number
  adds: number
  dels: number
  titles: string[]
  changes: ViewChange[]
}
export type ViewSession = {
  id: string
  name: string
  // The claimed task's id; its name is that id.
  ticket?: string | null
  // Its task's title, else its Claude Code session's title.
  title: string | null
  doing: string | null
  started: number
  updated: number
  commitCount?: number
  // The last five, newest first.
  commits: { sha: string; at: number; files: number; t?: string }[]
}
export type ViewEvent = { kind: 'edit' | 'commit'; at: number; a: string; t: string; sha?: string; rels: string[] }
export type ViewRepo = { root: string; name: string; sessions: ViewSession[]; files: ViewFile[]; feed: ViewEvent[] }
// only/live: set when a filter asked for some repos: its words, and every live repo's name.
export type ViewIndex = { sig: string; repos: ViewRepo[]; error?: string; only?: string[]; live?: string[]; order?: string[] }
// The server's session order for colors (/api/order); empty when no server answered.
export type ViewOrder = { sig: string; order: string[] }
export type ViewFocus = { root: string; rel: string; mode: 'doc' | 'diff' } | null
export type ViewBody = {
  root: string
  rel: string
  mode: 'doc' | 'diff'
  mtime: number
  lines?: ViewLine[]
  hunks?: ViewHunk[]
} | null
// The pane's fold state: sessions open, files shut; flip holds the groups toggled away from that.
export type ViewFold = { flip: string[] }

declare module 'claude-code' {
  interface PluginState {
    peers: { peers: Peer[]; index: Shaped<ViewIndex>; focus: Shaped<ViewFocus>; body: Shaped<ViewBody>; fold: Shaped<ViewFold>; order: ViewOrder; help: boolean; wide: boolean; only: string[]; view: 'list' | 'boxes'; at: string; scrolled: Record<string, number> }
  }
}

// lib/rows.mjs: the one row model the pane and `peers tui` draw.
export type Span = { s: string; color?: string; bg?: string; bold?: boolean; dim?: boolean; strike?: boolean; under?: boolean; hit?: boolean }
export type Row = { key: string; spans: Span[]; press?: { fold: string } | { open: NonNullable<ViewFocus> }; indent?: number }

// The task board behind `peers ready | claim | commit | close` (lib/board.mjs). Built-ins: backlog, jira (acli, REST), github.
// A custom board: an .mjs whose default export is (config, who) => Board. Held to it at load (CONTRACT, fit): a needed method
// left out, or half a sweep, fails loud; `peers doctor` names each. Any method may return a Promise.
// holder: `<who>/<session name>`; an adapter changes only its own machine's (who).
export type BoardHeld = { id: string; title: string | null; holders: string[] | null; updated: number | null }
export type Board = {
  name: string
  // needed
  ready(): string | Promise<string>
  claim(id: string, holders?: string[]): { id?: string; title: string | null; others?: string[] } | Promise<{ id?: string; title: string | null; others?: string[] }>
  note(id: string, text: string): unknown
  close(id: string, reason: string): unknown
  // the sweep: all three or none. held: the board's In Progress; holders null when the board cannot tell.
  held?(): BoardHeld[] | Promise<BoardHeld[]>
  hold?(id: string, holders: string[]): unknown
  /** Lets go of this machine's holders (and `expire`: quiet ones of other machines). True: back in the queue. */
  release?(id: string, queue?: boolean, expire?: string[]): boolean | Promise<boolean>
  // given when left out
  /** False: the board's tool is not installed; calls do nothing. Default true. */
  on?(): boolean
  /** Unchecked items: close waits for them. Default []. */
  open?(id: string): string[] | Promise<string[]>
  openHint?(id: string): string
  /** How a session reads the task's text: a command or a pointer. Queue prompts and `peers next` print it. */
  viewHint?(id: string): string
  /** Column rules (config `lint`): one line per rule that tasks break. `peers sweep` prints them. Optional. */
  lint?(rules: { status: string; needs: string }[]): string[] | Promise<string[]>
  /** Who else holds it: other machines, other people. Default []. */
  others?(id: string): string[] | Promise<string[]>
  // more
  /** The id as the board writes it (`proj-7` -> `PROJ-7`). */
  key?(id: string): string
  /** True when the id is this board's (the sweep leaves the rest alone). */
  covers?(id: string): boolean
  /** The work queue: a task's id, title and status column (`peers queue add` checks To Do). */
  look?(id: string): { id: string; title: string | null; status: string | null } | null | Promise<{ id: string; title: string | null; status: string | null } | null>
  /** The work queue: set the task's queue labels (`queued`, `lane:*`, `pin:*`) to `labels`; [] clears them. */
  queue?(id: string, labels: string[]): unknown
  /** Tasks that wait on a person (config statuses.waiting): `peers waiting`, the view's Needs you. [] when unset. */
  waiting?(): { id: string; title: string | null }[] | Promise<{ id: string; title: string | null }[]>
  /** The board's status names (GitHub: labels): doctor checks config statuses against them. null: cannot list. */
  names?(): string[] | null | Promise<string[] | null>
}
