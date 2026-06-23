import { invoke } from "@tauri-apps/api/core";

export interface GitFile {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
  untracked: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  files: GitFile[];
  upstream: boolean;
  ahead: number;
  behind: number;
}

export interface GitBranches {
  current: string;
  branches: string[];
}

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
  parents: string[];
}

export function gitStatus(cwd: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { cwd });
}

export function gitStage(cwd: string, path: string): Promise<void> {
  return invoke("git_stage", { cwd, path });
}

export function gitUnstage(cwd: string, path: string): Promise<void> {
  return invoke("git_unstage", { cwd, path });
}

export function gitCommit(cwd: string, message: string): Promise<string> {
  return invoke<string>("git_commit", { cwd, message });
}

export function gitInit(cwd: string): Promise<void> {
  return invoke("git_init", { cwd });
}

export function gitDiff(cwd: string, path: string, staged: boolean): Promise<string> {
  return invoke<string>("git_diff", { cwd, path, staged });
}

export function gitBranches(cwd: string): Promise<GitBranches> {
  return invoke<GitBranches>("git_branches", { cwd });
}

export function gitSwitch(cwd: string, branch: string): Promise<void> {
  return invoke("git_switch", { cwd, branch });
}

export function gitCreateBranch(cwd: string, name: string): Promise<void> {
  return invoke("git_create_branch", { cwd, name });
}

export function gitPull(cwd: string): Promise<string> {
  return invoke<string>("git_pull", { cwd });
}

export function gitPush(cwd: string): Promise<string> {
  return invoke<string>("git_push", { cwd });
}

export function gitLog(cwd: string, limit = 30): Promise<GitCommit[]> {
  return invoke<GitCommit[]>("git_log", { cwd, limit });
}

export interface GitBlameLine {
  line: number;
  short: string;
  author: string;
  summary: string;
}

export function gitBlame(cwd: string, path: string): Promise<GitBlameLine[]> {
  return invoke<GitBlameLine[]>("git_blame", { cwd, path });
}

export function gitRemoteUrl(cwd: string): Promise<string> {
  return invoke<string>("git_remote_url", { cwd });
}
