# Releasing Reson

Updater repository: `ckouffsyrup/Reson`

Updater metadata:
`https://github.com/ckouffsyrup/Reson/releases/latest/download/latest.json`

## Required GitHub Actions secrets

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Never commit `.tauri/reson.key`.

## Release flow

1. Update the version in `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json`, and Reson's visible version text.
2. Commit and push the version change.
3. Push a matching tag:

```cmd
git tag v0.26.1
git push origin main
git push origin v0.26.1
```

4. GitHub Actions creates a draft GitHub Release.
5. Open GitHub → Releases.
6. Review the generated assets. Confirm `latest.json` and signed updater
   artifacts are attached.
7. Replace the placeholder notes and publish the draft.
8. Existing Reson installs will detect the newly published release.

For testing, keep the release as a draft until its assets look correct.
