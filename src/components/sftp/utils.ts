export function formatSize(bytes: number): string {
  if (bytes === 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDate(ts: number | null): string {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatPermissions(mode: number | null): string {
  if (mode === null) return "-";
  const perm = mode & 0o777;
  const chars = "rwxrwxrwx";
  let result = "";
  for (let i = 0; i < 9; i++) {
    result += perm & (1 << (8 - i)) ? chars[i] : "-";
  }
  return result;
}

export function buildDestNames(files: { path: string; name: string }[]): string[] | null {
  const hasRename = files.some(f => {
    const origName = f.path.split("/").pop() || "";
    return f.name !== origName;
  });
  return hasRename ? files.map(f => f.name) : null;
}
