import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { Pane } from "../../types";
import { FileEntry, TransferProgress, ConflictState, SortKey, SortDir } from "./types";
import { formatSize, formatDate, formatPermissions, buildDestNames } from "./utils";
import { headerStyle, breadcrumbBtn, rowStyle, colName, colSize, colDate, colPerm, modalOverlay, modalBox, btnCancel, btnPrimary, inputStyle } from "./styles";
import { panels, setupSystemDragListeners, startDrag, transferOwnerPaneId, setTransferOwnerPaneId } from "./dragDrop";
import { getClipboard, setClipboard } from "./clipboard";
import TransferBar from "./TransferBar";
import PermissionsDialog from "./PermissionsDialog";
import ConflictDialog from "./ConflictDialog";
import ContextMenu from "./ContextMenu";

const isWindowsDrive = (p: string) => /^[A-Za-z]:\//.test(p);

const getRoot = (p: string) => isWindowsDrive(p) ? p.slice(0, 3) : "/";

const isRoot = (p: string) => p === "/" || /^[A-Za-z]:\/?\s*$/.test(p);

const lastSepIndex = (p: string) => Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));

const joinPath = (dir: string, name: string) =>
  dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}/${name}`;

interface Props {
  pane: Pane;
}

export default function FileBrowser({ pane }: Props) {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [rawEntries, setRawEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState("");
  const lastClickedPath = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [createName, setCreateName] = useState("");
  const [deleteTargets, setDeleteTargets] = useState<FileEntry[]>([]);
  const [transfer, setTransfer] = useState<TransferProgress | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [permEditor, setPermEditor] = useState<{ path: string; name: string; current: number } | null>(null);
  const [permValue, setPermValue] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPanelDragOver, setIsPanelDragOver] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInputValue, setPathInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<FileEntry[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const suggestListRef = useRef<HTMLDivElement>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [platform, setPlatform] = useState<string>("");

  const isRemote = pane.sftpSource?.type === "remote";
  const sshSessionId = isRemote ? (pane.sftpSource as { type: "remote"; sshSessionId: number }).sshSessionId : null;
  const canChmod = isRemote || platform !== "windows";

  const listDir = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      let result: FileEntry[];
      if (isRemote && sshSessionId !== null) {
        result = await invoke<FileEntry[]>("sftp_list_dir", { sessionId: sshSessionId, path });
      } else {
        result = await invoke<FileEntry[]>("local_list_dir", { path });
      }
      let resolvedPath = path;
      if (result.length > 0) {
        const ep = result[0].path.replace(/\\/g, "/");
        const lastSlash = ep.lastIndexOf("/");
        if (lastSlash >= 0) {
          const parent = ep.slice(0, lastSlash);
          resolvedPath = parent.match(/^[A-Za-z]:$/) ? parent + "/" : parent || "/";
        }
      }
      setRawEntries(result);
      setCurrentPath(resolvedPath);
      setSelectedPaths(new Set());
      setFilter("");
      lastClickedPath.current = null;
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [isRemote, sshSessionId]);

  const entries = useMemo(() => {
    let filtered = rawEntries;
    if (!showHidden) filtered = filtered.filter(e => !e.name.startsWith("."));
    if (filter) {
      const lower = filter.toLowerCase();
      filtered = filtered.filter(e => e.name.toLowerCase().includes(lower));
    }
    const sorted = [...filtered].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase()); break;
        case "size": cmp = a.size - b.size; break;
        case "modified": cmp = (a.modified || 0) - (b.modified || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rawEntries, showHidden, filter, sortKey, sortDir]);

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }, [sortKey]);

  const navigateTo = useCallback((path: string) => { setEditingPath(false); listDir(path); }, [listDir]);

  const startEditingPath = useCallback(() => {
    setEditingPath(true);
    setPathInputValue(currentPath);
    setSuggestions([]);
    setSelectedSuggestion(-1);
    requestAnimationFrame(() => pathInputRef.current?.select());
  }, [currentPath]);

  const fetchSuggestions = useCallback(async (value: string) => {
    const sep = value.lastIndexOf("/");
    const sepBack = value.lastIndexOf("\\");
    const lastSep = Math.max(sep, sepBack);
    if (lastSep < 0) { setSuggestions([]); return; }

    const dir = value.slice(0, lastSep + 1) || "/";
    const prefix = value.slice(lastSep + 1).toLowerCase();

    try {
      let result: FileEntry[];
      if (isRemote && sshSessionId !== null) {
        result = await invoke<FileEntry[]>("sftp_list_dir", { sessionId: sshSessionId, path: dir });
      } else {
        result = await invoke<FileEntry[]>("local_list_dir", { path: dir });
      }
      const dirs = result
        .filter(e => e.is_dir && e.name.toLowerCase().startsWith(prefix) && (showHidden || !e.name.startsWith(".")));
      setSuggestions(dirs);
      setSelectedSuggestion(-1);
    } catch {
      setSuggestions([]);
    }
  }, [isRemote, sshSessionId, showHidden]);

  const onPathInputChange = useCallback((value: string) => {
    setPathInputValue(value);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => fetchSuggestions(value), 200);
  }, [fetchSuggestions]);

  const applySuggestion = useCallback((name: string) => {
    const value = pathInputValue;
    const sep = value.lastIndexOf("/");
    const sepBack = value.lastIndexOf("\\");
    const lastSep = Math.max(sep, sepBack);
    const dir = value.slice(0, lastSep + 1);
    const newPath = dir + name + "/";
    setPathInputValue(newPath);
    setSuggestions([]);
    setSelectedSuggestion(-1);
    pathInputRef.current?.focus();
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => fetchSuggestions(newPath), 200);
  }, [pathInputValue, fetchSuggestions]);

  const onPathInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      setEditingPath(false);
      setSuggestions([]);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (suggestions.length > 0) {
        const idx = selectedSuggestion >= 0 ? selectedSuggestion : 0;
        applySuggestion(suggestions[idx].name);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedSuggestion(i => {
        const next = Math.min(i + 1, suggestions.length - 1);
        requestAnimationFrame(() => suggestListRef.current?.children[next]?.scrollIntoView({ block: "nearest" }));
        return next;
      });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedSuggestion(i => {
        const next = Math.max(i - 1, -1);
        if (next >= 0) requestAnimationFrame(() => suggestListRef.current?.children[next]?.scrollIntoView({ block: "nearest" }));
        return next;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
        applySuggestion(suggestions[selectedSuggestion].name);
      } else {
        const path = pathInputValue.trim();
        if (path) navigateTo(path);
      }
      return;
    }
  }, [suggestions, selectedSuggestion, applySuggestion, pathInputValue, navigateTo]);

  const goUp = useCallback(() => {
    if (!currentPath || isRoot(currentPath)) return;
    const parts = currentPath.replace(/\/$/, "").split("/");
    parts.pop();
    const parent = parts.join("/");
    navigateTo(parent.match(/^[A-Za-z]:$/) ? parent + "/" : parent || "/");
  }, [currentPath, navigateTo]);

  const openPermEditor = useCallback((entry: FileEntry) => {
    if (entry.permissions === null || !canChmod) return;
    const mode = entry.permissions & 0o777;
    setPermEditor({ path: entry.path, name: entry.name, current: mode });
    setPermValue(mode.toString(8).padStart(3, "0"));
  }, []);

  const applyPermissions = useCallback(async () => {
    if (!permEditor) return;
    const octal = parseInt(permValue, 8);
    if (isNaN(octal) || octal < 0 || octal > 0o777) {
      setError("Invalid permissions value (use octal 000-777)");
      return;
    }
    try {
      if (isRemote && sshSessionId !== null) {
        await invoke("sftp_chmod", { sessionId: sshSessionId, path: permEditor.path, permissions: octal });
      } else {
        await invoke("local_chmod", { path: permEditor.path, permissions: octal });
      }
    } catch (e) {
      setError(String(e));
    }
    setPermEditor(null);
    try { await listDir(currentPath); } catch { }
  }, [permEditor, permValue, isRemote, sshSessionId, currentPath, listDir]);

  const checkConflicts = useCallback(async (
    files: { path: string; name: string; is_dir: boolean }[],
  ): Promise<{ path: string; name: string; is_dir: boolean }[]> => {
    const conflicting: typeof files = [];
    const safe: typeof files = [];

    for (const f of files) {
      const destPath = joinPath(currentPath, f.name);
      try {
        if (isRemote && sshSessionId !== null) {
          await invoke("sftp_stat", { sessionId: sshSessionId, path: destPath });
        } else {
          await invoke("local_stat", { path: destPath });
        }
        conflicting.push(f);
      } catch {
        safe.push(f);
      }
    }

    if (conflicting.length === 0) return files;

    return new Promise((resolve) => {
      const processNext = (remaining: typeof conflicting, resolved: typeof safe) => {
        if (remaining.length === 0) {
          setConflict(null);
          resolve(resolved);
          return;
        }
        setConflict({
          fileName: remaining[0].name,
          remaining,
          resolved,
          onDone: resolve,
        });
      };
      processNext(conflicting, [...safe]);
    });
  }, [currentPath, isRemote, sshSessionId]);

  const onConflictAction = useCallback((action: "overwrite" | "skip" | "rename" | "overwrite-all" | "skip-all") => {
    if (!conflict) return;
    const { remaining, resolved, onDone } = conflict;
    const current = remaining[0];
    const rest = remaining.slice(1);

    switch (action) {
      case "overwrite": resolved.push(current); break;
      case "skip": break;
      case "rename":
        setConflict(prev => prev ? { ...prev, renaming: true, renameValue: current.name } : null);
        return;
      case "overwrite-all":
        resolved.push(current, ...rest);
        setConflict(null);
        onDone(resolved);
        return;
      case "skip-all":
        setConflict(null);
        onDone(resolved);
        return;
    }

    if (rest.length === 0) { setConflict(null); onDone(resolved); }
    else { setConflict({ fileName: rest[0].name, remaining: rest, resolved, onDone }); }
  }, [conflict]);

  const onConflictRenameConfirm = useCallback(() => {
    if (!conflict || !conflict.renaming || !conflict.renameValue?.trim()) return;
    const { remaining, resolved, onDone } = conflict;
    const current = remaining[0];
    const rest = remaining.slice(1);
    resolved.push({ ...current, name: conflict.renameValue.trim() });

    if (rest.length === 0) { setConflict(null); onDone(resolved); }
    else { setConflict({ fileName: rest[0].name, remaining: rest, resolved, onDone }); }
  }, [conflict]);

  const handlePanelDrop = useCallback(async (payload: import("./types").DragPayload) => {
    const srcType = payload.sourceType;
    const destType = isRemote ? "remote" : "local";
    const move = payload.isMove === true;

    const resolvedFiles = await checkConflicts(payload.files);
    if (resolvedFiles.length === 0) return;

    setTransferOwnerPaneId(pane.id);
    try {
      if (srcType === "local" && destType === "local") {
        if (move) {
          for (const f of resolvedFiles) {
            const dest = joinPath(currentPath, f.name);
            try { await invoke("local_rename", { oldPath: f.path, newPath: dest }); }
            catch { await invoke("local_copy", { srcPaths: [f.path], destDir: currentPath }); await invoke("local_remove", { path: f.path, isDir: f.is_dir }); }
          }
        } else {
          await invoke("local_copy", { srcPaths: resolvedFiles.map(f => f.path), destNames: buildDestNames(resolvedFiles), destDir: currentPath });
        }
      } else if (srcType === "local" && destType === "remote") {
        await invoke("sftp_upload_paths", { sessionId: sshSessionId, paths: resolvedFiles.map(f => f.path), destNames: buildDestNames(resolvedFiles), remoteDir: currentPath });
        if (move) { for (const f of resolvedFiles) await invoke("local_remove", { path: f.path, isDir: f.is_dir }); }
      } else if (srcType === "remote" && destType === "local") {
        for (const file of resolvedFiles) {
          const origName = file.path.split("/").pop() || "";
          await invoke("sftp_download", { sessionId: payload.sshSessionId, remotePath: file.path, localDir: currentPath, isDir: file.is_dir, destName: file.name !== origName ? file.name : null });
        }
        if (move) { for (const f of resolvedFiles) await invoke("sftp_remove", { sessionId: payload.sshSessionId, path: f.path, isDir: f.is_dir }); }
      } else if (srcType === "remote" && destType === "remote") {
        if (payload.sshSessionId === sshSessionId && move) {
          for (const f of resolvedFiles) {
            const dest = joinPath(currentPath, f.name);
            await invoke("sftp_rename", { sessionId: sshSessionId, oldPath: f.path, newPath: dest });
          }
        } else {
          await invoke("sftp_cross_transfer", { srcSessionId: payload.sshSessionId, destSessionId: sshSessionId, srcPaths: resolvedFiles.map(f => f.path), srcIsDirs: resolvedFiles.map(f => f.is_dir), destNames: buildDestNames(resolvedFiles), destDir: currentPath });
          if (move) { for (const f of resolvedFiles) await invoke("sftp_remove", { sessionId: payload.sshSessionId, path: f.path, isDir: f.is_dir }); }
        }
      }
      await listDir(currentPath);
      if (move) emit("panel-refresh", { sourcePaneId: payload.sourcePaneId });
    } catch (err) { setError(String(err)); }
    finally { setTransferOwnerPaneId(null); }
  }, [pane.id, isRemote, sshSessionId, currentPath, listDir, checkConflicts]);

  const handleSystemDrop = useCallback(async (paths: string[]) => {
    const files = paths.map(p => {
      const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
      return { path: p, name: normalized.split("/").pop() || "file", is_dir: false };
    });
    const resolvedFiles = await checkConflicts(files);
    if (resolvedFiles.length === 0) return;

    setTransferOwnerPaneId(pane.id);
    try {
      if (isRemote && sshSessionId !== null) {
        await invoke("sftp_upload_paths", { sessionId: sshSessionId, paths: resolvedFiles.map(f => f.path), destNames: buildDestNames(resolvedFiles), remoteDir: currentPath });
      } else {
        await invoke("local_copy", { srcPaths: resolvedFiles.map(f => f.path), destNames: buildDestNames(resolvedFiles), destDir: currentPath });
        await listDir(currentPath);
      }
    } catch (e) { setError(String(e)); }
    finally { setTransferOwnerPaneId(null); }
  }, [pane.id, isRemote, sshSessionId, currentPath, listDir, checkConflicts]);

  const doCopy = useCallback((filesToCopy?: FileEntry[]) => {
    const targets = filesToCopy || entries.filter(e => selectedPaths.has(e.path));
    if (targets.length === 0) return;
    setClipboard({
      mode: "copy",
      sourceType: isRemote ? "remote" : "local",
      sshSessionId,
      files: targets.map(f => ({ path: f.path, name: f.name, is_dir: f.is_dir })),
    });
  }, [entries, selectedPaths, isRemote, sshSessionId]);

  const doCut = useCallback((filesToCut?: FileEntry[]) => {
    const targets = filesToCut || entries.filter(e => selectedPaths.has(e.path));
    if (targets.length === 0) return;
    setClipboard({
      mode: "cut",
      sourceType: isRemote ? "remote" : "local",
      sshSessionId,
      files: targets.map(f => ({ path: f.path, name: f.name, is_dir: f.is_dir })),
    });
  }, [entries, selectedPaths, isRemote, sshSessionId]);

  const doPaste = useCallback(async () => {
    const clip = getClipboard();
    if (!clip || clip.files.length === 0) return;
    const srcType = clip.sourceType;
    const destType = isRemote ? "remote" : "local";

    const resolvedFiles = await checkConflicts(clip.files);
    if (resolvedFiles.length === 0) return;

    setTransferOwnerPaneId(pane.id);
    try {
      const dn = buildDestNames(resolvedFiles);
      if (srcType === "local" && destType === "local") {
        if (clip.mode === "cut") {
          for (const f of resolvedFiles) {
            const dest = joinPath(currentPath, f.name);
            try { await invoke("local_rename", { oldPath: f.path, newPath: dest }); }
            catch { await invoke("local_copy", { srcPaths: [f.path], destNames: [f.name], destDir: currentPath }); await invoke("local_remove", { path: f.path, isDir: f.is_dir }); }
          }
        } else {
          await invoke("local_copy", { srcPaths: resolvedFiles.map(f => f.path), destNames: dn, destDir: currentPath });
        }
      } else if (srcType === "local" && destType === "remote") {
        await invoke("sftp_upload_paths", { sessionId: sshSessionId, paths: resolvedFiles.map(f => f.path), destNames: dn, remoteDir: currentPath });
        if (clip.mode === "cut") { for (const f of resolvedFiles) await invoke("local_remove", { path: f.path, isDir: f.is_dir }); }
      } else if (srcType === "remote" && destType === "local") {
        for (const f of resolvedFiles) {
          const origName = f.path.split("/").pop() || "";
          await invoke("sftp_download", { sessionId: clip.sshSessionId, remotePath: f.path, localDir: currentPath, isDir: f.is_dir, destName: f.name !== origName ? f.name : null });
        }
        if (clip.mode === "cut") { for (const f of resolvedFiles) await invoke("sftp_remove", { sessionId: clip.sshSessionId, path: f.path, isDir: f.is_dir }); }
      } else if (srcType === "remote" && destType === "remote") {
        if (clip.sshSessionId === sshSessionId && clip.mode === "cut") {
          for (const f of resolvedFiles) {
            const dest = joinPath(currentPath, f.name);
            await invoke("sftp_rename", { sessionId: sshSessionId, oldPath: f.path, newPath: dest });
          }
        } else {
          await invoke("sftp_cross_transfer", { srcSessionId: clip.sshSessionId, destSessionId: sshSessionId, srcPaths: resolvedFiles.map(f => f.path), srcIsDirs: resolvedFiles.map(f => f.is_dir), destNames: dn, destDir: currentPath });
          if (clip.mode === "cut") { for (const f of resolvedFiles) await invoke("sftp_remove", { sessionId: clip.sshSessionId, path: f.path, isDir: f.is_dir }); }
        }
      }
      if (clip.mode === "cut") setClipboard(null);
      await listDir(currentPath);
    } catch (err) { setError(String(err)); }
    finally { setTransferOwnerPaneId(null); }
  }, [pane.id, isRemote, sshSessionId, currentPath, listDir, checkConflicts]);

  const doDeleteConfirmed = useCallback(async () => {
    if (deleteTargets.length === 0) return;
    try {
      for (const target of deleteTargets) {
        if (isRemote && sshSessionId !== null) await invoke("sftp_remove", { sessionId: sshSessionId, path: target.path, isDir: target.is_dir });
        else await invoke("local_remove", { path: target.path, isDir: target.is_dir });
      }
      await listDir(currentPath);
    } catch (e) { setError(String(e)); }
    setDeleteTargets([]);
    setSelectedPaths(new Set());
  }, [deleteTargets, isRemote, sshSessionId, currentPath, listDir]);

  const doRename = useCallback(async (oldPath: string, newName: string) => {
    const parts = oldPath.split("/");
    if (newName === parts[parts.length - 1]) { setRenaming(null); return; }
    parts.pop();
    const newPath = [...parts, newName].join("/");
    try {
      if (isRemote && sshSessionId !== null) await invoke("sftp_rename", { sessionId: sshSessionId, oldPath, newPath });
      else await invoke("local_rename", { oldPath, newPath });
      await listDir(currentPath);
    } catch (e) { setError(String(e)); }
    setRenaming(null);
  }, [isRemote, sshSessionId, currentPath, listDir]);

  const doCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name || !creating) return;
    const path = joinPath(currentPath, name);
    try {
      if (creating === "folder") {
        if (isRemote && sshSessionId !== null) await invoke("sftp_mkdir", { sessionId: sshSessionId, path });
        else await invoke("local_mkdir", { path });
      } else {
        if (isRemote && sshSessionId !== null) await invoke("sftp_create_file", { sessionId: sshSessionId, path });
        else await invoke("local_write_file", { path, data: [] });
      }
      await listDir(currentPath);
    } catch (e) { setError(String(e)); }
    setCreating(null);
    setCreateName("");
  }, [createName, creating, isRemote, sshSessionId, currentPath, listDir]);

  const startCreate = useCallback((type: "file" | "folder") => {
    setCreating(type);
    setCreateName("");
    setTimeout(() => createRef.current?.focus(), 0);
  }, []);

  const startRename = useCallback((entry: FileEntry) => {
    setRenaming(entry.path);
    setRenameValue(entry.name);
    setTimeout(() => renameRef.current?.focus(), 0);
  }, []);

  const doUpload = useCallback(() => fileInputRef.current?.click(), []);

  const onFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = async () => {
        const data = Array.from(new Uint8Array(reader.result as ArrayBuffer));
        const dest = joinPath(currentPath, file.name);
        try {
          if (isRemote && sshSessionId !== null) await invoke("sftp_write_file", { sessionId: sshSessionId, path: dest, data });
          else await invoke("local_write_file", { path: dest, data });
          await listDir(currentPath);
        } catch (err) { setError(String(err)); }
      };
      reader.readAsArrayBuffer(file);
    }
    e.target.value = "";
  }, [isRemote, sshSessionId, currentPath, listDir]);

  const doDownload = useCallback(async (entry: FileEntry) => {
    try {
      if (isRemote && sshSessionId !== null) {
        const destDir = await save({ defaultPath: entry.name, title: `Download ${entry.name}` });
        if (!destDir) return;
        setTransferOwnerPaneId(pane.id);
        try {
          const sep = lastSepIndex(destDir);
          if (entry.is_dir) {
            const parentDir = destDir.substring(0, sep);
            await invoke("sftp_download", { sessionId: sshSessionId, remotePath: entry.path, localDir: parentDir, isDir: true });
          } else {
            const localDir = destDir.substring(0, sep);
            const fileName = destDir.substring(sep + 1);
            await invoke("sftp_download", { sessionId: sshSessionId, remotePath: entry.path, localDir, isDir: false });
            if (fileName !== entry.name) {
              await invoke("local_rename", { oldPath: joinPath(localDir, entry.name), newPath: destDir });
            }
          }
        } finally { setTransferOwnerPaneId(null); }
      }
    } catch (e) { setError(String(e)); }
  }, [isRemote, sshSessionId, pane.id]);

  useEffect(() => { invoke<string>("get_platform").then(setPlatform).catch(() => {}); }, []);

  useEffect(() => {
    setupSystemDragListeners();
    panels.set(pane.id, { containerRef, handleDrop: handlePanelDrop, handleSystemDrop, setOverlay: setIsPanelDragOver, setSystemDragOver: setIsDragOver });
    return () => { panels.delete(pane.id); };
  }, [pane.id, handlePanelDrop, handleSystemDrop]);

  useEffect(() => {
    (async () => {
      try {
        if (isRemote && sshSessionId !== null) {
          await invoke("sftp_connect", { sessionId: sshSessionId });
          const cwd = pane.sftpInitialPath || await invoke<string>("sftp_get_cwd", { sessionId: sshSessionId });
          await listDir(cwd);
        } else {
          const cwd = pane.sftpInitialPath || await invoke<string>("local_get_cwd");
          await listDir(cwd);
        }
      } catch (e) { setError(String(e)); setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = listen<TransferProgress>("transfer-progress", (event) => {
      if (transferOwnerPaneId !== null && transferOwnerPaneId !== pane.id) return;
      const p = event.payload;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (p.status === "done" || p.status === "cancelled") {
        setTransfer(p);
        if (p.status === "done") listDir(currentPath);
        hideTimer = setTimeout(() => setTransfer(null), 3000);
      } else { setTransfer(p); }
    });
    return () => { unlisten.then(fn => fn()); if (hideTimer) clearTimeout(hideTimer); };
  }, [pane.id, currentPath, listDir]);

  useEffect(() => {
    const unlisten = listen<{ sourcePaneId: number }>("panel-refresh", (event) => {
      if (event.payload.sourcePaneId === pane.id) listDir(currentPath);
    });
    return () => { unlisten.then(fn => fn()); };
  }, [pane.id, currentPath, listDir]);

  useEffect(() => {
    const onFocus = () => { if (currentPath && !loading && !error) listDir(currentPath); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [currentPath, listDir, loading, error]);

  useEffect(() => { setFocusedIndex(null); }, [entries]);

  useEffect(() => {
    if (focusedIndex !== null) {
      containerRef.current?.querySelector(`[data-row-idx="${focusedIndex}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  useEffect(() => {
    if (contextMenu) {
      const handler = () => setContextMenu(null);
      window.addEventListener("click", handler);
      return () => window.removeEventListener("click", handler);
    }
  }, [contextMenu]);

  const onDoubleClick = useCallback((entry: FileEntry) => {
    if (entry.is_dir) navigateTo(entry.path);
  }, [navigateTo]);

  const onRowClick = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

    if (isMeta) {
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      lastClickedPath.current = entry.path;
    } else if (isShift && lastClickedPath.current) {
      const lastIdx = entries.findIndex(e => e.path === lastClickedPath.current);
      const curIdx = entries.findIndex(e => e.path === entry.path);
      if (lastIdx !== -1 && curIdx !== -1) {
        const start = Math.min(lastIdx, curIdx);
        const end = Math.max(lastIdx, curIdx);
        const rangePaths = entries.slice(start, end + 1).map(e => e.path);
        setSelectedPaths(prev => { const next = new Set(prev); rangePaths.forEach(p => next.add(p)); return next; });
      }
    } else {
      setSelectedPaths(new Set([entry.path]));
      lastClickedPath.current = entry.path;
    }
    const idx = entries.findIndex(en => en.path === entry.path);
    setFocusedIndex(idx !== -1 ? idx : null);
  }, [entries]);

  const pendingDragEntry = useRef<FileEntry | null>(null);

  const onRowMouseDown = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    if (e.button !== 0 || renaming) return;
    pendingDragEntry.current = entry;

    const dragFiles = selectedPaths.has(entry.path)
      ? entries.filter(e => selectedPaths.has(e.path)).map(e => ({ path: e.path, name: e.name, is_dir: e.is_dir }))
      : [{ path: entry.path, name: entry.name, is_dir: entry.is_dir }];

    startDrag({
      sourcePaneId: pane.id,
      sourceType: isRemote ? "remote" : "local",
      sshSessionId,
      files: dragFiles,
    }, e.clientX, e.clientY);
  }, [pane.id, isRemote, sshSessionId, renaming, selectedPaths, entries]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (renaming || creating || deleteTargets.length > 0) return;
    const len = entries.length;
    if (len === 0) return;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = focusedIndex === null ? 0 : Math.min(focusedIndex + 1, len - 1);
        setFocusedIndex(next);
        if (e.shiftKey) setSelectedPaths(prev => new Set([...prev, entries[next].path]));
        else { setSelectedPaths(new Set([entries[next].path])); lastClickedPath.current = entries[next].path; }
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const next = focusedIndex === null ? len - 1 : Math.max(focusedIndex - 1, 0);
        setFocusedIndex(next);
        if (e.shiftKey) setSelectedPaths(prev => new Set([...prev, entries[next].path]));
        else { setSelectedPaths(new Set([entries[next].path])); lastClickedPath.current = entries[next].path; }
        break;
      }
      case "Enter":
        e.preventDefault();
        if (focusedIndex !== null && entries[focusedIndex]?.is_dir) navigateTo(entries[focusedIndex].path);
        break;
      case "Delete": case "Backspace":
        e.preventDefault();
        if (selectedPaths.size > 0) setDeleteTargets(entries.filter(en => selectedPaths.has(en.path)));
        else if (focusedIndex !== null) setDeleteTargets([entries[focusedIndex]]);
        break;
      case " ":
        e.preventDefault();
        if (focusedIndex !== null) {
          const entry = entries[focusedIndex];
          setSelectedPaths(prev => { const next = new Set(prev); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next; });
        }
        break;
      case "Escape":
        setSelectedPaths(new Set());
        setFocusedIndex(null);
        break;
      case "a": case "A":
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); setSelectedPaths(new Set(entries.map(en => en.path))); setFocusedIndex(0); }
        break;
      case "c": case "C":
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); doCopy(); }
        break;
      case "x": case "X":
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); doCut(); }
        break;
      case "v": case "V":
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); doPaste(); }
        break;
      case "F2":
        if (focusedIndex !== null && entries[focusedIndex]) startRename(entries[focusedIndex]);
        break;
    }
  }, [entries, focusedIndex, renaming, creating, deleteTargets, navigateTo, selectedPaths, doCopy, doCut, doPaste]);

  const root = getRoot(currentPath);
  const pathAfterRoot = isWindowsDrive(currentPath) ? currentPath.slice(3) : currentPath.slice(1);
  const breadcrumbs = pathAfterRoot.split("/").filter(Boolean);

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={onKeyDown}
         style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0b0d12", color: "#e2e8f0", userSelect: "none", WebkitUserSelect: "none", outline: "none" }}
         onClick={() => setContextMenu(null)}>

      <div style={headerStyle}>
        <button onClick={goUp} style={{ ...breadcrumbBtn, opacity: isRoot(currentPath) ? 0.3 : 1 }} disabled={isRoot(currentPath)}>
          ..
        </button>
        {editingPath ? (
          <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
            <input
              ref={pathInputRef}
              value={pathInputValue}
              onChange={e => onPathInputChange(e.target.value)}
              onKeyDown={onPathInputKeyDown}
              onBlur={() => { setTimeout(() => { setEditingPath(false); setSuggestions([]); }, 150); }}
              onMouseDown={e => e.stopPropagation()}
              style={{
                width: "100%", background: "#0e1018", border: "1px solid #667eea",
                borderRadius: 4, color: "#e2e8f0", fontSize: 11, padding: "2px 6px",
                outline: "none", boxSizing: "border-box",
              }}
            />
            {suggestions.length > 0 && (
              <div ref={suggestListRef} style={{
                position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0,
                background: "#1a1f2e", border: "1px solid #2a3050", borderRadius: 4,
                zIndex: 100, maxHeight: 200, overflowY: "auto",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              }}>
                {suggestions.map((s, i) => (
                  <div
                    key={s.path}
                    onMouseDown={e => { e.preventDefault(); applySuggestion(s.name); }}
                    style={{
                      padding: "4px 8px", fontSize: 11, cursor: "pointer",
                      color: "#e2e8f0",
                      background: i === selectedSuggestion ? "#2a3050" : "transparent",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#2a3050")}
                    onMouseLeave={e => (e.currentTarget.style.background = i === selectedSuggestion ? "#2a3050" : "transparent")}
                  >📁 {s.name}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div onClick={startEditingPath} style={{ display: "flex", alignItems: "center", gap: 0, cursor: "text", minWidth: 0, flex: 1 }}>
            <button onClick={e => { e.stopPropagation(); navigateTo(root); }} style={breadcrumbBtn}>{root}</button>
            {breadcrumbs.map((part, i) => {
              const path = root + breadcrumbs.slice(0, i + 1).join("/");
              return (
                <span key={path} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {i > 0 && <span style={{ color: "#3a4560" }}>/</span>}
                  <button onClick={e => { e.stopPropagation(); navigateTo(path); }} style={{
                    ...breadcrumbBtn,
                    color: i === breadcrumbs.length - 1 ? "#e2e8f0" : "#94a3b8",
                    fontWeight: i === breadcrumbs.length - 1 ? 500 : 400,
                  }}>{part}</button>
                </span>
              );
            })}
          </div>
        )}
        <input value={filter} onChange={e => setFilter(e.target.value)}
          onMouseDown={e => e.stopPropagation()}
          onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") { setFilter(""); (e.target as HTMLInputElement).blur(); } }}
          placeholder="Filter..."
          style={{ background: "#0e1018", border: "1px solid #1e2330", borderRadius: 4, color: "#e2e8f0", fontSize: 11, padding: "2px 6px", width: 100, outline: "none" }}
        />
        <button onClick={() => setShowHidden(v => !v)} style={{ ...breadcrumbBtn, color: showHidden ? "#667eea" : "#4a5568", fontSize: 11 }} title={showHidden ? "Hide hidden files" : "Show hidden files"}>.*</button>
        <button onClick={doUpload} style={{ ...breadcrumbBtn, color: "#667eea", fontSize: 11 }}>Upload</button>
        <button onClick={() => startCreate("file")} style={{ ...breadcrumbBtn, color: "#94a3b8", fontSize: 11 }}>+ File</button>
        <button onClick={() => startCreate("folder")} style={{ ...breadcrumbBtn, color: "#4ecdc4", fontSize: 11 }}>+ Folder</button>
        <button onClick={() => listDir(currentPath)} style={{ ...breadcrumbBtn, fontSize: 13 }} title="Refresh">↻</button>
        <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={onFileSelected} />
      </div>

      <div style={{ ...rowStyle, background: "#080a0f", borderBottom: "1px solid #161925", cursor: "default", color: "#4a5568", fontSize: 11, fontWeight: 500 }}>
        <div style={{ width: 18 }} />
        <div style={{ ...colName, cursor: "pointer" }} onClick={() => toggleSort("name")}>
          Name {sortKey === "name" && <span style={{ color: "#667eea" }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
        </div>
        <div style={{ ...colSize, cursor: "pointer" }} onClick={() => toggleSort("size")}>
          Size {sortKey === "size" && <span style={{ color: "#667eea" }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
        </div>
        <div style={{ ...colDate, cursor: "pointer" }} onClick={() => toggleSort("modified")}>
          Modified {sortKey === "modified" && <span style={{ color: "#667eea" }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
        </div>
        {canChmod && <div style={colPerm}>Permissions</div>}
      </div>

      <div style={{ flex: 1, overflow: "auto" }} onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, entry: null }); }}>
        {loading && <div style={{ padding: 20, textAlign: "center", color: "#4a5568" }}>Loading...</div>}
        {error && (
          <div style={{ padding: 20, textAlign: "center", color: "#ef4444" }}>
            {error}<br />
            <button onClick={() => listDir(currentPath)} style={{ ...breadcrumbBtn, color: "#4ecdc4", marginTop: 8 }}>Retry</button>
          </div>
        )}
        {!loading && !error && !isRoot(currentPath) && (
          <div style={{ ...rowStyle, cursor: "pointer", color: "#64748b" }} onClick={goUp} onDoubleClick={goUp}
            onMouseEnter={e => { e.currentTarget.style.background = "#0e1018"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
            <div style={{ width: 18, textAlign: "center", fontSize: 13, flexShrink: 0 }}>📁</div>
            <div style={colName}>..</div>
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#4a5568" }}>Empty directory</div>
        )}
        {!loading && !error && entries.map((entry, idx) => (
          <div key={entry.path} data-row-idx={idx} onMouseDown={e => onRowMouseDown(e, entry)}
            style={{
              ...rowStyle,
              background: selectedPaths.has(entry.path) ? "#151a28" : "transparent",
              cursor: "grab",
              outline: focusedIndex === idx ? "1px solid #3a4560" : "none",
              outlineOffset: -1,
            }}
            onClick={e => onRowClick(e, entry)} onDoubleClick={() => onDoubleClick(entry)}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, entry }); }}
            onMouseEnter={e => { if (!selectedPaths.has(entry.path)) e.currentTarget.style.background = "#0e1018"; }}
            onMouseLeave={e => { if (!selectedPaths.has(entry.path)) e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ width: 18, textAlign: "center", fontSize: 13, flexShrink: 0 }}>
              {entry.is_symlink ? "🔗" : entry.is_dir ? "📁" : "📄"}
            </div>
            <div style={colName}>
              {renaming === entry.path ? (
                <input ref={renameRef} value={renameValue} onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => doRename(entry.path, renameValue)}
                  onKeyDown={e => { if (e.key === "Enter") doRename(entry.path, renameValue); if (e.key === "Escape") setRenaming(null); }}
                  onMouseDown={e => e.stopPropagation()}
                  style={{ background: "#1e2a45", border: "1px solid #3a4560", borderRadius: 3, color: "#f1f5f9", fontSize: 12, padding: "1px 5px", width: "100%", outline: "none" }}
                />
              ) : (
                <span style={{ color: entry.is_symlink ? "#c084fc" : entry.is_dir ? "#4ecdc4" : "#e2e8f0" }}>
                  {entry.name}
                  {entry.is_symlink && entry.symlink_target && (
                    <span style={{ color: "#64748b", fontSize: 11 }}> → {entry.symlink_target}</span>
                  )}
                </span>
              )}
            </div>
            <div style={colSize}>{entry.is_dir ? "-" : formatSize(entry.size)}</div>
            <div style={colDate}>{formatDate(entry.modified)}</div>
            {canChmod && <div style={colPerm}>{formatPermissions(entry.permissions)}</div>}
          </div>
        ))}
      </div>

      {transfer && <TransferBar transfer={transfer} />}

      <div style={{ padding: "4px 12px", borderTop: "1px solid #161925", background: "#080a0f", fontSize: 11, color: "#4a5568", display: "flex", gap: 16, flexShrink: 0 }}>
        <span>{entries.length} items</span>
        {selectedPaths.size > 0 && (
          <span style={{ color: "#667eea" }}>
            {selectedPaths.size} selected
            {(() => {
              const totalSize = entries.filter(e => selectedPaths.has(e.path) && !e.is_dir).reduce((sum, e) => sum + e.size, 0);
              return totalSize > 0 ? ` · ${formatSize(totalSize)}` : "";
            })()}
          </span>
        )}
        <span>{isRemote ? `Remote (SSH #${sshSessionId})` : "Local"}</span>
        <span style={{ flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentPath}</span>
      </div>

      {isDragOver && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(102, 126, 234, 0.15)", border: "2px dashed #667eea", borderRadius: 8, zIndex: 9998, pointerEvents: "none" }}>
          <div style={{ fontSize: 14, color: "#667eea", fontWeight: 600 }}>Drop files to upload</div>
        </div>
      )}
      {isPanelDragOver && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(78, 205, 196, 0.12)", border: "2px dashed #4ecdc4", borderRadius: 8, zIndex: 9998, pointerEvents: "none" }}>
          <div style={{ fontSize: 14, color: "#4ecdc4", fontWeight: 600 }}>Drop to transfer here</div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} entry={contextMenu.entry}
          isRemote={isRemote} selectedPaths={selectedPaths} entries={entries}
          onNavigate={navigateTo} onDownload={doDownload} onCopy={doCopy} onCut={doCut}
          onPaste={doPaste} onRename={startRename} onDelete={setDeleteTargets}
          onCreateFile={() => startCreate("file")} onCreateFolder={() => startCreate("folder")}
          onRefresh={() => listDir(currentPath)} onPermissions={openPermEditor} canChmod={canChmod}
          onClose={() => setContextMenu(null)}
        />
      )}

      {creating && (
        <div style={modalOverlay} onClick={() => setCreating(null)}>
          <div onClick={e => e.stopPropagation()} style={{ ...modalBox, width: 320 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12, color: "#e2e8f0" }}>
              New {creating === "folder" ? "Folder" : "File"}
            </div>
            <input ref={createRef} value={createName} onChange={e => setCreateName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") doCreate(); if (e.key === "Escape") setCreating(null); }}
              placeholder={creating === "folder" ? "folder-name" : "filename.txt"}
              style={inputStyle}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button onClick={() => setCreating(null)} style={btnCancel}>Cancel</button>
              <button onClick={doCreate} style={{ ...btnPrimary, background: "#4ecdc4", color: "#0b0d12" }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {deleteTargets.length > 0 && (
        <div style={modalOverlay} onClick={() => setDeleteTargets([])}>
          <div onClick={e => e.stopPropagation()} style={{ ...modalBox, width: 320 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: "#ef4444" }}>
              {deleteTargets.length === 1 ? `Delete ${deleteTargets[0].is_dir ? "folder" : "file"}?` : `Delete ${deleteTargets.length} items?`}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16, wordBreak: "break-all", maxHeight: 120, overflow: "auto" }}>
              {deleteTargets.length === 1 ? deleteTargets[0].name : deleteTargets.map(t => t.name).join(", ")}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteTargets([])} style={btnCancel}>Cancel</button>
              <button onClick={doDeleteConfirmed} style={{ ...btnPrimary, background: "#ef4444", color: "#fff" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {permEditor && (
        <PermissionsDialog
          name={permEditor.name} permValue={permValue}
          onPermValueChange={setPermValue} onApply={applyPermissions}
          onClose={() => setPermEditor(null)}
        />
      )}

      {conflict && (
        <ConflictDialog
          conflict={conflict} onAction={onConflictAction}
          onRenameConfirm={onConflictRenameConfirm}
          onConflictChange={setConflict}
        />
      )}
    </div>
  );
}
