import { invoke } from "@tauri-apps/api/core";

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
  notConfigured: boolean;
}

export interface GithubUser {
  login: string;
  name: string;
  avatarUrl: string;
}

export type PollResult =
  | { status: "pending" }
  | { status: "slowDown" }
  | { status: "ok"; user: GithubUser }
  | { status: "error"; message: string };

export function githubDeviceStart(): Promise<DeviceCode> {
  return invoke<DeviceCode>("github_device_start");
}

export function githubDevicePoll(deviceCode: string): Promise<PollResult> {
  return invoke<PollResult>("github_device_poll", { deviceCode });
}

export function githubUser(): Promise<GithubUser | null> {
  return invoke<GithubUser | null>("github_user");
}

export function githubLogout(): Promise<void> {
  return invoke("github_logout");
}
