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
