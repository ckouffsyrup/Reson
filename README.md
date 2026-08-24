# Reson v0.3.3

Reson is a local-first Tauri + React music player. v0.3.3 adds the first online Discover catalog while keeping playback and your indexed music local.

## Run

```powershell
npm install
npm run tauri dev
```

## Discover

Discover uses the public iTunes Search API for album metadata and artwork. It seeds suggestions from artists and genres in your local Reson library, and includes a catalog search box. Catalog entries are informational only in this build; Reson does not stream or download them.

# Reson v0.3

Reson is a local-first desktop music player built with Tauri 2, React, TypeScript, Rust, Rodio, and Lofty.

## New in v0.3
- Fixed the white/default WebView button surface on playlist song rows.
- Functional Shuffle mode with a reshuffled remaining queue.
- Repeat Off / Repeat All / Repeat One modes.
- Shuffle and repeat mode are remembered between launches.
- Explicit Up Next queue with jump, remove, move up, move down, and clear controls.
- Playlist playback now builds the queue from that playlist.
- Song-list playback now builds the queue from the visible list.
- Native `audio_stop` command for clean end-of-queue behavior.

## Existing functionality
- Native Rust/Rodio playback with play, pause, resume, seek, volume, previous, and next.
- Local music-folder scanning and metadata extraction with Lofty.
- Embedded and folder-based album artwork.
- Songs, albums, artists, genres, likes, playlists, listening history, play counts, and stats.
- Persistent local settings and library folder selection.

## Run
```powershell
npm install
npm run tauri dev
```

If you are replacing an older Reson project, use this complete v0.3 folder so the React UI and Rust/Tauri backend stay in sync.
