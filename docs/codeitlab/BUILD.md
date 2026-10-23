# Building CodeitLab for macOS

CodeitLab (Beta) is the original-branded fork of T3 Code in this repository. This page covers
producing a local, unsigned macOS app from source. The app is built for development and local
testing; it is ad-hoc signed, not notarized, and not distributable to other machines as-is.

## Prerequisites

- macOS 13 or newer (Apple silicon or Intel).
- Node 24.13.1 or newer (`engines` in the root `package.json`), and pnpm 11.
- Xcode Command Line Tools: `xcode-select --install` provides `sips`, `iconutil`, and `codesign`.
- Python 3 with Pillow, only if you want to regenerate the icon artwork.

```bash
pnpm install --prefer-offline
```

## 1. Build the app bundles

```bash
pnpm run build:desktop
```

This builds the web client, the bundled server (`apps/server/dist`), and the Electron main/preload
bundles (`apps/desktop/dist-electron`). The command must exit 0 before packaging. Dev builds keep
sourcemaps for debugging; the release packager rebuilds with `CODEITLAB_RELEASE=1`, which disables
them (see [Release / hardened packaging](#release--hardened-packaging)).

## 2. Package `release/CodeitLab.app`

```bash
pnpm --filter @t3tools/desktop run package:codeitlab
```

Equivalent direct invocation:

```bash
node apps/desktop/scripts/package-codeitlab-app.mjs --output release/CodeitLab.app
```

The script:

- copies `apps/desktop/dist-electron`, `apps/server/dist`, and `apps/desktop/resources` into a
  staged `Resources/app` payload, and applies the production web icon set from `assets/prod`;
- copies the runtime packages the bundles keep external (`node-pty`, `ajv`, `ajv-formats`,
  `playwright-core`, `ffi-rs`, `@napi-rs/keyring`, `@crowecawcaw/xa11y`, `electron-webauthn`,
  `@clerk/electron-passkeys`) plus their dependency closures into the payload;
- wraps the Electron.app from `node_modules` into `release/CodeitLab.app`, renames the executable,
  and patches `Info.plist` with the CodeitLab identity:
  - `CFBundleDisplayName` / `CFBundleName`: `CodeitLab`
  - `CFBundleIdentifier`: `com.codeitlab.app`
  - URL scheme: `codeitlab://`
  - `CFBundleIconFile`: `icon.icns` generated from `assets/prod/codeitlab.icns`
- ad-hoc signs the bundle with `codesign --force --deep --sign -` and verifies it.

### Release / hardened packaging

The shipped app is built by the same script in release mode:

```bash
node apps/desktop/scripts/package-codeitlab-app.mjs --release
```

This runs the build itself with `CODEITLAB_RELEASE=1`, so no sourcemaps or legal comments are
emitted and every bundle is minified. It then:

- prunes `*.map`, `*.ts`, `*.tsx`, `*.test.*`, `*.spec.*`, `*.md`, `fixtures/`, and
  `__tests__/` from the staged payload;
- packs `Contents/Resources/app.asar` (no readable `Contents/Resources/app` directory) and
  leaves only native/spawned files in `app.asar.unpacked`: `node-pty`, `playwright-core`,
  `@ff-labs`, and every `*.node` addon;
- writes `ElectronAsarIntegrity` into `Info.plist` and flips Electron fuses:
  `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`, `EnableCookieEncryption` on;
  `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` off;
- keeps `RunAsNode` enabled because the desktop app runs the bundled server and snapshot workers
  as Electron-as-Node children (`ELECTRON_RUN_AS_NODE=1`); disabling it breaks the backend;
- ad-hoc signs, then verifies the asar contents, integrity hash, and fuse values.

`--no-build` repackages existing release artifacts. Passing `--release` is equivalent to exporting
`CODEITLAB_RELEASE=1` for the packager. Debug packaging (no flag) keeps the readable
`Resources/app` directory and sourcemaps.

Release-mode packaging is an obstacle, not encryption: asar archives can be extracted and the
minified bundles decompiled by a determined attacker. What it removes is the free, readable source
tree and the sourcemap-assisted reconstruction. `release/verification/hardening.md` records the
exact posture and evidence.

Why not electron-builder? The upstream release script
(`scripts/build-desktop-artifact.ts`) compiles the Rust resource monitor (`cargo`) and performs a
full staged `pnpm install --prod` before invoking electron-builder. Neither is needed for a local
unsigned app, so this repository ships a minimal packager instead. The upstream script remains
available for real release artifacts on a machine with the Rust toolchain.

## 3. Launch and verify

Normal use (uses your default T3 home):

```bash
open release/CodeitLab.app
```

Isolated smoke test that does not touch your real T3 state, with a DevTools port for automated
screenshots:

```bash
env -u ELECTRON_RUN_AS_NODE \
  T3CODE_HOME=/tmp/codeitlab-packaged-home \
  T3CODE_PORT=4773 \
  release/CodeitLab.app/Contents/MacOS/CodeitLab \
  --remote-debugging-port=9222 \
  > /tmp/codeitlab-app.log 2>&1 &
```

`env -u ELECTRON_RUN_AS_NODE` is required when your shell exports `ELECTRON_RUN_AS_NODE=1`
(common in agent sandboxes); otherwise Electron starts as plain Node and never opens a window.
Packaged builds omit the View → Toggle Developer Tools menu item; the `--remote-debugging-port`
flag above is only for automated screenshot/CDP verification.
`T3CODE_HOME` and `T3CODE_PORT` keep the packaged app off the developer's live data directory and
off ports already used by a dev server.

Verify the bundle identity and signature:

```bash
plutil -extract CFBundleIdentifier raw release/CodeitLab.app/Contents/Info.plist
plutil -extract CFBundleDisplayName raw release/CodeitLab.app/Contents/Info.plist
codesign --verify --deep --strict release/CodeitLab.app
```

Verify the packaged app serves the UI: it starts its bundled server on the configured port and the
renderer loads the bundled client. With the launch command above:

```bash
curl -fsS http://127.0.0.1:4773/ >/dev/null && echo "server serves the client"
curl -fsS http://127.0.0.1:9222/json/list   # renderer target for CDP screenshots
```

Stop the app by the PID you started; do not kill processes by pattern.

## 4. Tests and type checks

Targeted checks (do not run repo-wide suites):

```bash
pnpm --filter @t3tools/web exec vp test run src/branding.test.ts
pnpm --filter @t3tools/desktop exec vp test run scripts/electron-launcher.test.mjs
pnpm --filter @t3tools/desktop exec tsc-rs --noEmit
```

## Icons

The committed icon set lives in `assets/prod` and `assets/dev`:

- `assets/prod/black-macos-1024.png`, `black-ios-1024.png`, `black-universal-1024.png`
- `assets/prod/codeitlab-black-web-favicon*.{png,ico}`, `codeitlab-black-web-apple-touch-180.png`,
  `codeitlab-black-windows.ico`
- `assets/prod/codeitlab.icns` (used by the packager) and `assets/prod/logo.svg`
- `assets/dev/blueprint-*` for development builds

The artwork is original: a near-black body with a phosphor-green ring and a cyan node core. It uses
no T3 or Matrix trademarks. Regenerate the raster set (requires Pillow, `sips`, and `iconutil`):

```bash
python3 -m pip install pillow
python3 apps/desktop/scripts/generate-codeitlab-icons.py
```

The Icon Composer projects under `assets/*/app-icon.icon` carry the same mark in their `text.svg`
layers. Upstream's `icons:export` / `icons:check` scripts require Icon Composer 2 and are not used
by this fork's local build.

## Identity and internal identifiers

User-visible identity is CodeitLab (`CodeitLab (Beta)` display name, Beta stage label, bundle id
`com.codeitlab.app`, `codeitlab://` scheme, original icons, CodeitLab splash/title strings).

Internal identifiers are intentionally unchanged: workspace package names (`@t3tools/*`),
`T3CODE_*` environment variables, the `t3` CLI name, and protocol/database identifiers. Keeping
them means upstream fixes and existing T3 state keep working in this fork.
