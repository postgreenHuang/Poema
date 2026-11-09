import { invoke } from "@tauri-apps/api/core";
import type { Library } from "./storage";
import { syncSnapshot } from "./storage";

export interface SyncReadResult { snapshots: unknown[]; skipped: number }

export async function readSyncSnapshots(folder: string): Promise<SyncReadResult> {
  return invoke<SyncReadResult>("read_sync_snapshots", { folder });
}

export async function writeSyncSnapshot(folder: string, deviceId: string, library: Library) {
  return invoke<void>("write_sync_snapshot", { folder, deviceId, payload: syncSnapshot(library) });
}
