import { check, Update } from "@tauri-apps/plugin-updater";
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

const AUTO_CHECK_KEY = "shelo_auto_check_updates";
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

let _pendingUpdate: Update | null = null;
let _checkTimer: ReturnType<typeof setInterval> | null = null;

export function getAutoCheckEnabled(): boolean {
  const val = localStorage.getItem(AUTO_CHECK_KEY);
  return val === null ? true : val === "true";
}

export function setAutoCheckEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_CHECK_KEY, String(enabled));
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const update = await check();
    if (update) {
      _pendingUpdate = update;
      return {
        available: true,
        version: update.version,
        notes: update.body ?? "",
      };
    }
    _pendingUpdate = null;
    return { available: false, version: "", notes: "" };
  } catch (e) {
    console.error("Update check failed:", e);
    return { available: false, version: "", notes: "" };
  }
}

export async function downloadAndInstall(
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  if (!_pendingUpdate) {
    throw new Error("No update available");
  }

  let downloaded = 0;
  let total: number | null = null;

  await _pendingUpdate.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        downloaded = 0;
        total = event.data.contentLength ?? null;
        onProgress?.({ downloaded: 0, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
      case "Finished":
        onProgress?.({ downloaded, total: downloaded });
        break;
    }
  });

  await relaunch();
}

export function startAutoCheck(
  onUpdateFound: (info: UpdateInfo) => void
): void {
  stopAutoCheck();

  if (!getAutoCheckEnabled()) return;

  const doCheck = async () => {
    if (!getAutoCheckEnabled()) return;
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
