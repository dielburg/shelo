# Changelog

## v0.3.1

Bug fixes for SSH auto-reconnect.

### Bug Fixes

- Fixed SSH auto-reconnect not triggering when the initial connection fails (e.g. no route to host, connection refused) — the countdown now starts correctly regardless of whether the error comes from the network layer or an established session drop
- Fixed auto-reconnect countdown not starting when the toggle is enabled after a disconnect has already occurred
- Fixed "Reconnect now" button not resetting the retry counter, which could permanently block further reconnect attempts after exhausting the limit
- Fixed reconnect logic calling side effects inside a React state updater function, which could cause double connection attempts in strict mode


## v0.3.0

SSH port forwarding tunnels, host group persistence, and bug fixes.

### Features

- Local and remote SSH port forwarding tunnels with full lifecycle management
- Tunnel cards with Start/Stop controls, connecting animation, and error display
- Interactive host key verification dialog for tunnel SSH connections
- SSH connection health monitoring for active tunnels with automatic status updates
- Active tunnel counter badge on Tunnels sidebar button (green/red by status)
- Collapsed host groups now persist across app restarts

### Bug Fixes

- SFTP now maintains an independent SSH connection — closing the terminal no longer disconnects the file browser
- SFTP retry reconnects properly after a dropped connection instead of reusing the dead session
- Fixed SSH and SFTP jump host chains not resolving recursively — connecting to host C via B (which itself requires A) now correctly routes through A → B → C
- Fixed context menu appearing outside the visible area when right-clicking near the bottom or right edge of the window (terminal and SFTP panels)
- Fixed host search not showing results when the matching host's group was collapsed


## v0.3.0-2

Bug fixes for SFTP, SSH jump hosts, and context menu.

### Bug Fixes

- SFTP now maintains an independent SSH connection — closing the terminal no longer disconnects the file browser
- SFTP retry reconnects properly after a dropped connection instead of reusing the dead session
- Fixed SSH and SFTP jump host chains not resolving recursively — connecting to host C via B (which itself requires A) now correctly routes through A → B → C
- Fixed context menu appearing outside the visible area when right-clicking near the bottom or right edge of the window (terminal and SFTP panels)

## v0.3.0-1

SSH port forwarding tunnels.

### Features

- Local and remote SSH port forwarding tunnels with full lifecycle management
- Tunnel cards with Start/Stop controls, connecting animation, and error display
- Interactive host key verification dialog for tunnel SSH connections
- SSH connection health monitoring for active tunnels with automatic status updates
- Active tunnel counter badge on Tunnels sidebar button (green/red by status)

## v0.2.4

Beta update channel and update system improvements.

### Features

- Beta updates opt-in — checkbox in Settings → General to receive pre-release versions from GitHub
- Update checks moved to Rust backend for dynamic endpoint resolution and better reliability

### Improvements

- Update preferences (auto-check, beta channel) now persist in settings.json instead of localStorage
- Release workflow automatically marks tags containing `-alpha`, `-beta`, or `-rc` as pre-releases

## v0.2.3

Terminal zoom, auto-reconnect for SSH sessions, and host password reveal.

### Features

- Per-panel terminal zoom — Cmd/Ctrl + scroll, Cmd/Ctrl +/-, or click the percentage in the toolbar to type a value (50%–200%)
- Auto-reconnect for SSH sessions — 5-second countdown after disconnect with configurable retry limit (Settings → Connection)
- Auto-reconnect toggle directly on the disconnect screen for quick access
- Default terminal font size setting (Settings → Terminal)
- Zoom In, Zoom Out, and Zoom Reset added as configurable keyboard shortcuts

### Improvements

- Reveal stored password when editing a host instead of requiring re-entry

## v0.2.2

Terminal paste fix, SFTP improvements, and vault UI polish.

### Features

- Terminal right-click context menu with copy, paste, and select all
- SFTP path input with folder autocomplete — click breadcrumbs to type a path manually
- Password visibility toggle (eye icon) on vault setup and unlock screens

### Bug Fixes

- Fix multiline paste in terminal losing formatting (bracketed paste mode)
- Fix SFTP drag-and-drop from OS file explorer not detecting file conflicts on Windows
- Fix Windows drive letter (C:/) missing from SFTP breadcrumbs and paths
- Fix SFTP ".." row showing on Windows drive roots where it had no effect
- Fix duplicate breadcrumb separator on macOS/Linux root paths
- Fix Cmd+W closing entire app instead of active tab on macOS
- Fix global shortcuts (Cmd+T, Cmd+W) firing while typing in input fields
- Fix clipboard shortcuts (copy, paste, cut, select all) not working in vault password inputs on macOS
- Hide native password reveal button on Windows to avoid duplicate eye icons

## v0.2.1

Under the hood tune-up — faster transfers, smoother tabs.

### Performance

- Increase SFTP transfer buffer from 32KB to 256KB
- Throttle transfer progress events to ~7/s instead of ~84/s, reducing CPU usage and IPC overhead during transfers
- Replace cumulative average speed calculation with 3-second rolling window for accurate real-time speed display
- Release SFTP session lock before upload transfer loop, unblocking concurrent SFTP operations during uploads

### Bug Fixes

- Fix terminal content loss when switching tabs — last line of output no longer disappears
- Fix terminal flicker on tab switch caused by xterm.js `fit()` firing on hidden containers
- Fix progress output (rsync, wget, etc.) garbling into stacked lines when switching tabs during active transfers

## v0.2.0

Configurable keyboard shortcuts, transfer progress improvements, and quality-of-life fixes.

### Features

- Configurable keyboard shortcuts with per-OS defaults (macOS / Windows / Linux)
- Shortcuts settings panel with rebinding, conflict detection, and reset to defaults
- ETA and speed display for all SFTP transfer types (upload, download, cross-transfer, local copy)
- Cumulative progress tracking for multi-file transfers
- Copy/paste toast notification in terminal
- Streaming local file copy with progress bar and cancel support

### Bug Fixes

- Fix update download progress bar stuck at 50% instead of advancing
- Fix system drag & drop (e.g. from Finder) loading entire files into memory
- Fix clipboard paste on Windows showing browser permission prompt (uses Tauri clipboard plugin)
- Fix double paste when using CMD+V on macOS
- Fix native tooltip not displaying on info icons in settings

## v0.1.2

### Bug Fixes

- Fix Ctrl+Shift+C not copying selected text in terminal on Windows and Linux
- Fix SFTP upload and download loading entire files into memory instead of streaming
- Fix update changelog displayed as unformatted single-line text

## v0.1.1

First patch, totally not because v0.1.0 was unusable.

### Features

- Group combo-box with suggestions from existing groups when editing hosts
- Host search by name or hostname in hosts panel
- Collapsible host groups with expand/collapse toggle
- Search in jump path host picker

### Bug Fixes

- Fix window dragging on vault setup and unlock screens
- Fix terminal rendering in production builds (CSP blocking xterm.js WebGL renderer)
- Fix local SFTP opening in app launch directory instead of terminal's current working directory
- Fix SFTP transfer progress bar flickering when transferring folders with many small files
- Add cancel support for SFTP upload and download transfers
- Show preparing state during folder transfer scanning phase

### Other

- Bundle JetBrains Mono font for consistent terminal rendering across systems

## v0.1.0

Initial release of shelo.

### Features

- Multi-panel terminal with horizontal and vertical splits, drag-and-drop panel reordering
- SSH client with password authentication and multi-hop jump host support
- SFTP dual-panel file browser with drag-and-drop transfers, conflict resolution, permissions editor
- Encrypted vault with AES-256-GCM encryption and Argon2id key derivation, optional system keychain unlock
- Hosts management with groups and one-click connect
- Workspaces and tabs with reorderable tabs and flexible pane layouts
- Cross-platform support for macOS, Windows, and Linux (x64 and arm64)
