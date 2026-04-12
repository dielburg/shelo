import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  available: boolean;
  version: string;
  notes: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

let _checkTimer: ReturnType<typeof setInterval> | null = null;

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    return await invoke<UpdateInfo>("check_for_update");
  } catch (e) {
    console.error("Update check failed:", e);
    return { available: false, version: "", notes: "" };
  }
}

export async function downloadAndInstall(
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  let downloaded = 0;

  const unlisten = await listen<{ downloaded: number; total: number | null }>(
    "update-download-progress",
    (event) => {
      const { downloaded: chunk, total } = event.payload;
      if (total === 0 && chunk === 0) {
        onProgress?.({ downloaded, total: downloaded });
        return;
      }
      if (chunk === 0 && total != null) {
        downloaded = 0;
        onProgress?.({ downloaded: 0, total });
        return;
      }
      downloaded += chunk;
      onProgress?.({ downloaded, total });
    }
  );

  try {
    await invoke("download_and_install_update");
    unlisten();
    await relaunch();
  } catch (e) {
    unlisten();
    throw e;
  }
}

export async function getAutoCheckEnabled(): Promise<boolean> {
  try {
    const s = (await invoke("get_settings")) as Record<string, unknown>;
    if (typeof s.autoCheckUpdates === "boolean") return s.autoCheckUpdates;
    return true;
  } catch {
    return true;
  }
}

export async function setAutoCheckEnabled(enabled: boolean): Promise<void> {
  try {
    const s = (await invoke("get_settings")) as Record<string, unknown>;
    await invoke("set_settings", { settings: { ...s, autoCheckUpdates: enabled } });
  } catch (e) {
    console.error("Failed to save auto-check setting:", e);
  }
}

export async function getIncludeBeta(): Promise<boolean> {
  try {
    const s = (await invoke("get_settings")) as Record<string, unknown>;
    if (typeof s.includeBetaUpdates === "boolean") return s.includeBetaUpdates;
    return false;
  } catch {
    return false;
  }
}

export async function setIncludeBeta(enabled: boolean): Promise<void> {
  try {
    const s = (await invoke("get_settings")) as Record<string, unknown>;
    await invoke("set_settings", { settings: { ...s, includeBetaUpdates: enabled } });
  } catch (e) {
    console.error("Failed to save beta setting:", e);
  }
}

export function startAutoCheck(
  onUpdateFound: (info: UpdateInfo) => void
): void {
  stopAutoCheck();

  const doCheck = async () => {
    const autoEnabled = await getAutoCheckEnabled();
    if (!autoEnabled) return;
    const info = await checkForUpdate();
    if (info.available) {
      onUpdateFound(info);
    }
  };

  setTimeout(doCheck, 30_000);
  _checkTimer = setInterval(doCheck, CHECK_INTERVAL);
}

export function stopAutoCheck(): void {
  if (_checkTimer !== null) {
    clearInterval(_checkTimer);
    _checkTimer = null;
  }
}
