# Changelog

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
