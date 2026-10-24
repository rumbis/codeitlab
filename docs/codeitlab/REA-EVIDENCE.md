# REA evidence: the CodeitLab (Beta) app we are forking

Status: research artifact. Every number below is read out of the sealed REA evidence envelope at
`/tmp/ref/rea-t3-full.json` (288,802,637 bytes), produced by REA 6.7.0 against the installed app
`/Applications/CodeitLab (Beta).app`. Nothing here is inferred from the source checkout unless the
text says so.

- Evidence id: `ev_42db763151f705cac1bede01215895a10170deab447a858894543686559f4442`
- Subject: `CodeitLab (Beta).app`, format `directory`, SHA-256
  `c62398e4d89119cced11ec0e92a46b472d6e2bf2f6ac64a2e44611b7ec9dc782`
- Root artifact SHA-256 (`normalized_result.root_artifact_sha256`, same digest):
  `c62398e4d89119cced11ec0e92a46b472d6e2bf2f6ac64a2e44611b7ec9dc782`
- Provider: `rea-javascript-application` v1, predicate
  `rea.javascript-application-analysis`, operation `analyze_javascript_application`
- Authority `shipped-artifact`, confidence `derived`
- Inventory: manifest `agm_b0787691cdb45aac5328c3dbf047d62552b628df18b39474842c420310d598df`,
  graph `dbad111d72b34e13c424960187f19137dc34c901a17a3ccca7b440d03a7e2809`
- Application graph id: `jag_f2e1948df2ebb2429dae20f912688a659f63d89cbf8eb9f79f56bfcb9edb8336`

## Exact REA commands

The evidence envelope stores the _parameters_ but not the argv that produced it, so the primary
invocation below is reconstructed from those parameters and verified against the recorded
progress stream and exit status. The failed attempt is preserved verbatim in its own files.

```bash
# Primary run (reconstructed argv; parameters match the envelope exactly).
/opt/homebrew/bin/rea analyze-javascript-application \
  "/Applications/CodeitLab (Beta).app" \
  --artifact-format auto \
  --integrity-policy record-and-continue \
  --format json \
  > /tmp/ref/rea-t3-full.json \
  2> /tmp/ref/rea-t3-full.err

# Evidence identity / verification (read-only; not required to reproduce the analysis).
rea capabilities
rea inspect-analysis-view --help   # projection surface for a completed analysis
```

Verification that the reconstructed argv is the one that ran:

| Check                         | Observed                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parameters.format`           | `auto` → `--artifact-format auto`                                                                                                                        |
| `parameters.integrity_policy` | `record-and-continue` → `--integrity-policy record-and-continue`                                                                                         |
| stderr                        | NDJSON `rea_progress` stream, 1,950 records, last record `analyze_javascript_application completed:1 total:1 terminal:true sequence:1950`, then `EXIT:0` |
| stdout                        | one JSON envelope, 16 top-level keys, parses cleanly, `evidence_id` embedded                                                                             |
| default limits                | semantic ceilings and worker budget are the CLI defaults (100,000 nodes / 1,024 MiB / 300,000 ms), i.e. no override flags were passed                    |

The earlier, failed invocation is recorded at `/tmp/ref/rea-t3-analysis.json` and
`/tmp/ref/rea-t3-analysis.err`:

```json
{
  "ok": false,
  "error": {
    "code": "UNSUPPORTED_OUTPUT_COMBINATION",
    "message": "Token windows cannot preserve structured output. Remove --token-limit/--token-offset and use --filter-output or command pagination."
  }
}
```

It used `--token-limit`/`--token-offset` on the same command. REA refuses token windows for
structured output, which is why the full envelope was written to a file instead. No
`rea evidence-export` was run; the file is the raw result envelope, and its `evidence_id` plus the
root digest are the canonical handles.

Derived extracts used to write this document (safe to regenerate, not authoritative):

- `/tmp/ref/extract/extract-meta.json` — statistics, summary, contradictions, graph metadata
- `/tmp/ref/extract/ipc.txt` — literal/dynamic IPC channels, handlers, sender validations

## Analysis statistics

| Metric                   | Value          |
| ------------------------ | -------------- |
| Relevant files           | **1,937**      |
| Parsed JavaScript files  | **1,835**      |
| Skipped JavaScript files | 6              |
| Parse failures           | 0              |
| Visited AST nodes        | **12,265,753** |
| Findings                 | **27,084**     |
| Modules                  | **1,658**      |
| Text bytes read          | 110,531,697    |
| Invalid UTF-8 files      | 0              |
| Nested asar containers   | 1              |

The app is an Electron bundle: `Contents/Resources/app.asar` contains the desktop main/preload,
the bundled server and its web client, plus `node_modules`; a second unpacked tree lives under
`Contents/Resources/app.asar.unpacked` and `Contents/Resources/node_modules`.

## Electron boundaries

### Browser windows (4)

All four are constructed in `Contents/Resources/app.asar/apps/desktop/dist-electron/main.cjs`.
Thirteen explicit web preferences were recovered in total.

| #   | Location             | contextIsolation       | nodeIntegration | sandbox | preload                                 | backgroundThrottling |
| --- | -------------------- | ---------------------- | --------------- | ------- | --------------------------------------- | -------------------- |
| 1   | `42383:17-42405:4`   | true                   | false           | true    | dynamic (`preload`)                     | —                    |
| 2   | `115988:16-116006:3` | true                   | false           | true    | none                                    | false                |
| 3   | `112509:12-112532:5` | true                   | false           | true    | dynamic (`pictureInPicturePreloadPath`) | false                |
| 4   | `84786:15-84786:50`  | dynamic options object | dynamic         | dynamic | dynamic                                 | dynamic              |

Reading: the shipped app runs every concrete window with `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, and never with a statically resolvable preload path.
REA therefore reports `preload_entrypoints: 0` even though two preload paths exist as runtime
values — a real limitation of static analysis, not an absence of preloads.

### Roles and entrypoints

| Role                 | Resolved artifact                                                                         | Mechanism                                          |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Electron main        | `Contents/Resources/app.asar/apps/desktop/dist-electron/boot.cjs`                         | `package.json:main`                                |
| Electron preload     | unresolved (`metadata`)                                                                   | `property:preload`, `external`                     |
| Renderer (app UI)    | `Contents/Resources/app.asar/apps/server/dist/client/index.html`                          | HTML script entrypoint `/assets/index-C4f_xMnc.js` |
| Renderers (vendored) | 6 Playwright HTML entrypoints (`traceViewer/*.html`, `htmlReport`, `recorder`, dashboard) | HTML script entrypoints                            |
| Workers              | 4 (`conoutSocketWorker.js`, reader/checkpoint workers, `workerPath`)                      | `new Worker(...)`                                  |
| Utility processes    | 0                                                                                         | —                                                  |

### Context-bridge surface (4 APIs, 125 exposed members)

| API key                              | Kind                               | Members               |
| ------------------------------------ | ---------------------------------- | --------------------- |
| `desktopBridge`                      | object literal, `main:289:0-606:2` | **124**               |
| `previewPictureInPicture`            | object literal                     | 1 (`onFrame`)         |
| `__clerk_internal_electron`          | dynamic                            | 0 resolved, 1 unknown |
| `__clerk_internal_electron_passkeys` | dynamic                            | 0 resolved, 1 unknown |

`desktopBridge` is the whole desktop capability surface: window/app lifecycle, SnapShot, preview
browser (tabs, navigation, recording, PiP, annotation, cookies, zoom, DevTools), SSH environment
bootstrap/tunnels, Tailscale serve, WSL, updates, CLI command install, provider auth callbacks,
connection catalog, client settings, theme, folder/favicon/theme-file pickers, notifications,
context menu, and the two event feeds `webLinks.*` and `appActivation.*`.

## IPC shape

`summary.ipc` (the analyzer's own aggregate) and the graph projections agree on the structure:

| Metric                                  | Value          |
| --------------------------------------- | -------------- |
| IPC operations                          | **276**        |
| Literal channels                        | **117**        |
| Dynamic channel operations              | **155**        |
| Renderer transmissions                  | **222**        |
| Renderer listeners                      | **42**         |
| Main handlers                           | **12**         |
| Paired renderer transmissions           | 1              |
| Ambiguous renderer transmissions        | 0              |
| Unpaired literal renderer transmissions | 103            |
| Sender-validation observations          | 15             |
| Utility processes                       | 0              |
| Native addon bindings                   | 2 (2 resolved) |

Graph projection: 272 `ipc-channel` nodes and 54 `ipc-handler` nodes. Operation mix:
198 renderer `invoke`, 41 renderer `on`, 13 renderer `send-sync`, 10 main `handle`, 8 renderer
`send`, 2 main `on`. The 42 renderer listeners and 12 main handlers are the 54 handler nodes.

### Main-side handlers (12)

| Channel / expression                                 | Operation |
| ---------------------------------------------------- | --------- |
| `PASSKEY_CHANNELS.capabilities`                      | handle    |
| `PASSKEY_CHANNELS.get`                               | handle    |
| `PASSKEY_CHANNELS.create`                            | handle    |
| `OAUTH_TRANSPORT_CHANNELS.getRedirectUrl` (×2 sites) | handle    |
| `OAUTH_TRANSPORT_CHANNELS.open` (×2 sites)           | handle    |
| `TOKEN_CACHE_CHANNELS.getToken`                      | handle    |
| `TOKEN_CACHE_CHANNELS.saveToken`                     | handle    |
| `TOKEN_CACHE_CHANNELS.clearToken`                    | handle    |
| `MAC_PERMISSION_HELPER_CHANNEL`                      | on        |
| `electron-store-get-data` (literal)                  | on        |

Every `desktop:*` operation is a renderer→main invoke/send; the main process registers exactly one
literal main handler (`electron-store-get-data`) and the rest through channel constants owned by
Clerk (passkeys, OAuth transport, token cache) and a macOS permission helper.

### Sender validation

The summary records 15 sender-validation observations. The graph carries concrete comparison
sites in three observations (nine comparisons total), all of the form `subject: frame-id` with
`mechanism: comparison:===/!==` and `enforcement: unknown` — e.g. Playwright's
`params2.frameId === this._targetId` checks and `resource._frameref` comparisons. There is **no**
observation of an `event.senderFrame`/`webContents.id` authorization check on a `desktop:*`
handler, which is consistent with those handlers being callable only through the contextBridge
surface exposed by the preload.

### Literal channels (117)

All are `desktop:*` except the last. This is the complete desktop IPC vocabulary recovered from
the bundle:

```
desktop:acknowledge-snap-shot, desktop:app-activation-complete, desktop:app-activation-ready,
desktop:app-activation-request, desktop:apply-snap-shot-config,
desktop:bootstrap-ssh-bearer-session, desktop:cancel-provider-auth-callback,
desktop:check-snap-shot-shortcut, desktop:check-system-permission,
desktop:clear-connection-catalog, desktop:cli-command-get-state,
desktop:cli-command-install, desktop:cli-command-uninstall, desktop:context-menu,
desktop:disconnect-ssh-environment, desktop:discover-ssh-hosts,
desktop:dismiss-snap-shot-animation, desktop:ensure-ssh-environment,
desktop:fetch-ssh-environment-descriptor, desktop:fetch-ssh-session-state,
desktop:get-advertised-endpoints, desktop:get-app-branding, desktop:get-client-settings,
desktop:get-connection-catalog, desktop:get-local-environment-bearer-token,
desktop:get-local-environment-bootstraps, desktop:get-local-environment-enabled,
desktop:get-relay-telemetry-enabled, desktop:get-server-exposure-state,
desktop:get-snap-shot-state, desktop:get-system-locale,
desktop:get-window-fullscreen-state, desktop:get-wsl-state,
desktop:issue-ssh-websocket-token, desktop:list-pending-snap-shots,
desktop:mac-permission-helper, desktop:menu-action, desktop:open-external,
desktop:open-system-settings, desktop:paste-as-text, desktop:pick-folder,
desktop:pick-project-favicon, desktop:pick-theme-files, desktop:preview-cancel-pick-element,
desktop:preview-capture-screenshot, desktop:preview-clear-cache,
desktop:preview-clear-cookies, desktop:preview-close-tab, desktop:preview-copy-artifact,
desktop:preview-create-tab, desktop:preview-get-config, desktop:preview-go-back,
desktop:preview-go-forward, desktop:preview-hard-reload, desktop:preview-import-cookies,
desktop:preview-import-sources, desktop:preview-navigate, desktop:preview-open-devtools,
desktop:preview-open-link, desktop:preview-pick-element, desktop:preview-pip-close,
desktop:preview-pip-frame, desktop:preview-pip-open, desktop:preview-pointer-event,
desktop:preview-recording-frame, desktop:preview-recording-input,
desktop:preview-recording-save, desktop:preview-recording-start,
desktop:preview-recording-stop, desktop:preview-refresh,
desktop:preview-register-webview, desktop:preview-reset-zoom,
desktop:preview-reveal-artifact, desktop:preview-set-annotation-send-enabled,
desktop:preview-set-annotation-theme, desktop:preview-set-audio-muted,
desktop:preview-set-color-scheme, desktop:preview-set-forwarded-shortcuts,
desktop:preview-set-zoom-factor, desktop:preview-snap-shot-config,
desktop:preview-state-change, desktop:preview-zoom-in, desktop:preview-zoom-out,
desktop:probe-remote-editors, desktop:quit-shortcut, desktop:read-snap-shot,
desktop:receive-provider-auth-callback, desktop:request-snap-shot-permissions,
desktop:resolve-ssh-host, desktop:resolve-ssh-password-prompt, desktop:reveal-window,
desktop:set-client-settings, desktop:set-connection-catalog,
desktop:set-local-environment-enabled, desktop:set-notification-badge,
desktop:set-server-exposure-mode, desktop:set-snap-shot-animation-destination,
desktop:set-snap-shot-shortcut-suppressed, desktop:set-tailscale-serve-enabled,
desktop:set-theme, desktop:set-wsl-backend-enabled, desktop:set-wsl-distro,
desktop:set-wsl-only, desktop:setup-snap-shot, desktop:snap-shot-event,
desktop:ssh-password-prompt, desktop:trackpad-scroll-end, desktop:update-check,
desktop:update-download, desktop:update-get-state, desktop:update-install,
desktop:update-set-channel, desktop:update-state, desktop:web-link-open,
desktop:web-link-ready, desktop:window-fullscreen-state, electron-store-get-data
```

### Dynamic channel expressions (140)

155 dynamic operations resolve to 140 distinct constant expressions — mostly the `*_CHANNEL`
constants that carry the same names as the literal channels above, plus grouped namespaces:

```
ACKNOWLEDGE_SNAP_SHOT_CHANNEL, ANNOTATION_CAPTURED_CHANNEL, ANNOTATION_SEND_ENABLED_CHANNEL,
ANNOTATION_THEME_CHANNEL, APPLY_SNAP_SHOT_CONFIG_CHANNEL, BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL,
CANCEL_PICK_CHANNEL, CANCEL_PROVIDER_AUTH_CALLBACK_CHANNEL, CHECK_SNAP_SHOT_SHORTCUT_CHANNEL,
CHECK_SYSTEM_PERMISSION_CHANNEL, CLEAR_CONNECTION_CATALOG_CHANNEL, CLI_COMMAND_GET_STATE_CHANNEL,
CLI_COMMAND_INSTALL_CHANNEL, CLI_COMMAND_UNINSTALL_CHANNEL,
COMPLETE_LEGACY_LOCAL_STORAGE_CHANNEL, CONTEXT_MENU_CHANNEL,
DESKTOP_APP_ACTIVATION_COMPLETE_CHANNEL, DESKTOP_APP_ACTIVATION_READY_CHANNEL,
DESKTOP_APP_ACTIVATION_REQUEST_CHANNEL, DISCONNECT_SSH_ENVIRONMENT_CHANNEL,
DISCOVER_SSH_HOSTS_CHANNEL, DISMISS_SNAP_SHOT_ANIMATION_CHANNEL, ELEMENT_PICKED_CHANNEL,
ENSURE_SSH_ENVIRONMENT_CHANNEL, FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL,
FETCH_SSH_SESSION_STATE_CHANNEL, GET_ADVERTISED_ENDPOINTS_CHANNEL, GET_APP_BRANDING_CHANNEL,
GET_CLIENT_SETTINGS_CHANNEL, GET_CONNECTION_CATALOG_CHANNEL,
GET_LOCAL_ENVIRONMENT_BEARER_TOKEN_CHANNEL, GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL,
GET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL, GET_RELAY_TELEMETRY_ENABLED_CHANNEL,
GET_SERVER_EXPOSURE_STATE_CHANNEL, GET_SNAP_SHOT_STATE_CHANNEL, GET_SYSTEM_LOCALE_CHANNEL,
GET_WINDOW_FULLSCREEN_STATE_CHANNEL, GET_WSL_STATE_CHANNEL, HUMAN_INPUT_CHANNEL,
ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL, LIST_PENDING_SNAP_SHOTS_CHANNEL,
MAC_PERMISSION_HELPER_CHANNEL, MENU_ACTION_CHANNEL, MOUSE_NAVIGATE_CHANNEL,
OAUTH_TRANSPORT_CHANNELS.getRedirectUrl, OAUTH_TRANSPORT_CHANNELS.open,
OPEN_EXTERNAL_CHANNEL, OPEN_SYSTEM_SETTINGS_CHANNEL, PASSKEY_CHANNELS.capabilities,
PASSKEY_CHANNELS.create, PASSKEY_CHANNELS.get, PASTE_AS_TEXT_CHANNEL, PICK_FOLDER_CHANNEL,
PICK_PROJECT_FAVICON_CHANNEL, PICK_THEME_FILES_CHANNEL, PREVIEW_CANCEL_PICK_ELEMENT_CHANNEL,
PREVIEW_CAPTURE_SCREENSHOT_CHANNEL, PREVIEW_CLEAR_CACHE_CHANNEL, PREVIEW_CLEAR_COOKIES_CHANNEL,
PREVIEW_CLOSE_TAB_CHANNEL, PREVIEW_COPY_ARTIFACT_CHANNEL, PREVIEW_CREATE_TAB_CHANNEL,
PREVIEW_GET_CONFIG_CHANNEL, PREVIEW_GO_BACK_CHANNEL, PREVIEW_GO_FORWARD_CHANNEL,
PREVIEW_HARD_RELOAD_CHANNEL, PREVIEW_IMPORT_COOKIES_CHANNEL, PREVIEW_IMPORT_SOURCES_CHANNEL,
PREVIEW_NAVIGATE_CHANNEL, PREVIEW_OPEN_DEVTOOLS_CHANNEL, PREVIEW_OPEN_LINK_CHANNEL,
PREVIEW_PICK_ELEMENT_CHANNEL, PREVIEW_PICTURE_IN_PICTURE_CLOSE_CHANNEL,
PREVIEW_PICTURE_IN_PICTURE_FRAME_CHANNEL, PREVIEW_PICTURE_IN_PICTURE_OPEN_CHANNEL,
PREVIEW_POINTER_EVENT_CHANNEL, PREVIEW_RECORDING_FRAME_CHANNEL,
PREVIEW_RECORDING_INPUT_CHANNEL, PREVIEW_RECORDING_SAVE_CHANNEL,
PREVIEW_RECORDING_START_CHANNEL, PREVIEW_RECORDING_STOP_CHANNEL, PREVIEW_REFRESH_CHANNEL,
PREVIEW_REGISTER_WEBVIEW_CHANNEL, PREVIEW_RESET_ZOOM_CHANNEL, PREVIEW_REVEAL_ARTIFACT_CHANNEL,
PREVIEW_SET_ANNOTATION_SEND_ENABLED_CHANNEL, PREVIEW_SET_ANNOTATION_THEME_CHANNEL,
PREVIEW_SET_AUDIO_MUTED_CHANNEL, PREVIEW_SET_COLOR_SCHEME_CHANNEL,
PREVIEW_SET_FORWARDED_SHORTCUTS_CHANNEL, PREVIEW_SET_ZOOM_FACTOR_CHANNEL,
PREVIEW_SNAP_SHOT_CONFIG_CHANNEL, PREVIEW_STATE_CHANGE_CHANNEL, PREVIEW_ZOOM_IN_CHANNEL,
PREVIEW_ZOOM_OUT_CHANNEL, PROBE_REMOTE_EDITORS_CHANNEL, QUIT_SHORTCUT_CHANNEL,
READ_SNAP_SHOT_CHANNEL, RECEIVE_PROVIDER_AUTH_CALLBACK_CHANNEL, RECORDING_CONTROLLER_CHANNEL,
RECORDING_CURSOR_CHANNEL, RECORDING_INPUT_CHANNEL, RECORDING_KEY_CHANNEL,
RECORDING_POINTER_CHANNEL, REQUEST_SNAP_SHOT_PERMISSIONS_CHANNEL, RESOLVE_SSH_HOST_CHANNEL,
RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL, REVEAL_WINDOW_CHANNEL, SETUP_SNAP_SHOT_CHANNEL,
SET_CLIENT_SETTINGS_CHANNEL, SET_CONNECTION_CATALOG_CHANNEL,
SET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL, SET_NOTIFICATION_BADGE_CHANNEL,
SET_SERVER_EXPOSURE_MODE_CHANNEL, SET_SNAP_SHOT_ANIMATION_DESTINATION_CHANNEL,
SET_SNAP_SHOT_SHORTCUT_SUPPRESSED_CHANNEL, SET_TAILSCALE_SERVE_ENABLED_CHANNEL,
SET_THEME_CHANNEL, SET_WSL_BACKEND_ENABLED_CHANNEL, SET_WSL_DISTRO_CHANNEL,
SET_WSL_ONLY_CHANNEL, SNAP_SHOT_EVENT_CHANNEL, SSH_PASSWORD_PROMPT_CHANNEL,
START_PICK_CHANNEL, TAKE_LEGACY_LOCAL_STORAGE_CHANNEL, TOKEN_CACHE_CHANNELS.clearToken,
TOKEN_CACHE_CHANNELS.getToken, TOKEN_CACHE_CHANNELS.saveToken, TRACKPAD_SCROLL_END_CHANNEL,
UPDATE_CHECK_CHANNEL, UPDATE_DOWNLOAD_CHANNEL, UPDATE_GET_STATE_CHANNEL,
UPDATE_INSTALL_CHANNEL, UPDATE_SET_CHANNEL_CHANNEL, UPDATE_STATE_CHANNEL,
WEB_LINK_OPEN_CHANNEL, WEB_LINK_READY_CHANNEL, WINDOW_FULLSCREEN_STATE_CHANNEL, channel
```

(`channel` is a genuinely unresolved identifier — one operation reads a variable named `channel`.)

## Native addons and integrity contradictions

14 `native-addon` artifacts were inventoried; the summary counts 2 native-addon bindings, of which
2 resolve. The graph projects one explicit `require("./binding.node")` edge to
`Contents/Resources/node_modules/@cursor/sdk-darwin-arm64/vendor/tree-sitter/binding.node`
(`requested_members: []`, `namespace_access: true`); the second binding is counted by the analyzer
but is not projected as a separate load edge.

The analysis ran with `--integrity-policy record-and-continue`, so 13 contradictions were recorded
instead of aborting. Every one is an **unpacked** file whose observed bytes differ from the
declared SHA-256 in the asar integrity metadata (`entry_kind: file`, `unpacked: true`,
`provenance: container-integrity-metadata-versus-observed-bytes`):

| #   | Logical path (under `Contents/Resources/app.asar/`)                                      | Declared SHA-256 | Observed SHA-256 |
| --- | ---------------------------------------------------------------------------------------- | ---------------- | ---------------- |
| 1   | `node_modules/@clerk/electron-passkeys-darwin-arm64/electron-passkeys.darwin-arm64.node` | `d1c6bc1d…561b`  | `cf79ea66…2f13`  |
| 2   | `node_modules/@clerk/electron-passkeys/electron-passkeys.darwin-arm64.node`              | `d1c6bc1d…561b`  | `3bf7b045…4905`  |
| 3   | `node_modules/@crowecawcaw/xa11y-darwin-arm64/xa11y.darwin-arm64.node`                   | `81a0e3f9…2171`  | `0c5deb62…82b3`  |
| 4   | `node_modules/@ff-labs/fff-bin-darwin-arm64/libfff_c.dylib`                              | `d052aae9…ba43`  | `be260497…1e5d`  |
| 5   | `node_modules/@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node`                   | `9627560b…6fff`  | `9a014167…ef98`  |
| 6   | `node_modules/@napi-rs/keyring/keyring.darwin-arm64.node`                                | `9627560b…6fff`  | `0a124eb6…ebf8`  |
| 7   | `node_modules/@yuuang/ffi-rs-darwin-arm64/ffi-rs.darwin-arm64.node`                      | `47b518f1…42bc`  | `addb365d…a64a`  |
| 8   | `node_modules/node-pty/build/Release/pty.node`                                           | `1ac2f18c…7161`  | `1eb22ec5…1dcc`  |
| 9   | `node_modules/node-pty/build/Release/spawn-helper`                                       | `082eb9ae…e1fe7` | `a5b64eab…b669`  |
| 10  | `node_modules/node-pty/prebuilds/darwin-arm64/pty.node`                                  | `0aae8551…1366`  | `ca720f02…a925`  |
| 11  | `node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`                              | `08bc83a0…e999`  | `374b4f54…51be`  |
| 12  | `node_modules/objc-js/prebuilds/darwin-arm64/node.napi.armv8.node`                       | `1399b5ce…8c12`  | `3853b60e…7114`  |
| 13  | `node_modules/objc-js/prebuilds/darwin-x64/node.napi.node`                               | `4a99133d…956a`  | `a97ebc97…3620`  |

Reading: these are macOS code-signing/notarization rewrites of unpacked binaries (the asar header
keeps the pre-signing digest). The package set tells us what native capability the shipped app
actually carries: Clerk passkeys (WebAuthn), `xa11y` accessibility (SnapShot), `fff` fuzzy finder,
`keyring` (OS credential storage), `ffi-rs` (Win32 calls on Windows builds), `node-pty` (terminal),
`objc-js` (macOS APIs), plus Cursor's vendored `tree-sitter` bindings. This matches the source
rule that native modules never load in Electron main on the startup path
(`docs/internals/overview.md`).

## Semantic graph

| Metric                | Value                             |
| --------------------- | --------------------------------- |
| Schema                | `JavaScriptSemanticRelationGraph` |
| Root nodes            | **1,950**                         |
| Nodes                 | 96,281                            |
| Relations             | **78,303**                        |
| Unknowns              | **76,040**                        |
| Evidence contexts     | 6,356                             |
| Function fingerprints | 19,258                            |
| Coverage status       | **partial**, `truncated: true`    |

Node kinds: expression 35,392 · function 20,433 · call-site 14,889 · binding 11,238 ·
return-site 4,460 · parameter 4,066 · property-slot 3,172 · module 1,841 · literal 267 ·
boundary 161 · event 83 · listener 81 · config-source 60 · task 59 · promise 57 · timer 12 ·
stdio 2 · request 2 · signal 2 · child-process 2 · resource 1 · response 1.

Relation kinds (top): aliases 29,229 · reads 13,432 · captures 9,280 · returns-to-call 6,957 ·
defines 6,449 · calls 5,711 · reads-property 3,966 · argument-to-parameter 1,497 · writes 663 ·
writes-property 603, then smaller families (destructures, awaits, registers-listener,
creates-promise, reads-environment, spreads, coerces, parses, removes-listener, schedules-timer,
returns-task, chains, detaches-task, supplies-request-field, owns, cancels-timer,
dispatches-candidate, aggregates, defaults, forwards-signal, spawns, constructs-request,
connects-stdio, overrides, reads-argv, supplies-env, consumed-by, acquires, supplies-argv,
listens-error).

Unknowns omitted at the capacity ceiling, counted by family/reason (emission occurrences, repeats
included): `call-flow/dynamic-call` 47,090 · `object-flow/ambiguous-target` 40,873 ·
`object-flow/dynamic-property` 5,280 · `timer/ambiguous-target` 42.

Hard limits recorded in the envelope: semantic nodes/file 20,000, semantic unknowns/file 20,000,
semantic nodes 100,000, semantic unknowns 100,000, worker heap 1,098,907,648 bytes (1,024 MiB),
worker timeout 300,000 ms, parent result budget 1,983,006,992 bytes.

Application graph projection for context: 9,844 nodes and 11,619 edges. Node kinds:
unknown 3,570 · asar-entry 1,880 · javascript-asset 1,756 · javascript-module 1,611 ·
javascript-expression 325 · ipc-channel 272 · endpoint 186 · artifact 58 · ipc-handler 54 ·
package 51 · source-map 44 · native-addon 14 · electron-renderer 7 · context-bridge-api 4 ·
browser-window 4 · worker 4 · electron-main 1 · electron-preload 1 · native-export 1 ·
storage 1. Edge relations: contains 5,790 · maps_to 2,040 · imports 1,958 · exposes 1,273 ·
calls 271 · invokes 198 · handles 54 · sends 23 · loads 11 · persists_to 1.

## Coverage and limitations (read before citing this document)

- `coverage.status: partial`, `truncated: true`. The semantic graph hit its unknown capacity, so
  76,040 retained unknowns under-count what a complete analysis would surface; omitted emission
  occurrences are counted, not the unexamined source frontiers.
- Static only: no runtime observation, no control-flow-sensitive reaching definitions, no arbitrary
  dynamic property resolution. Dynamic preload paths, dynamic IPC channel variables, and dynamic
  browser-window options stay unresolved by construction.
- The 3,594-entry `limitations` array is dominated by the 13 integrity contradictions (one per
  affected artifact, repeated per reference). Treat the contradiction list above as the complete
  set.
- Findings (27,084) are analyzer findings, not vulnerabilities. REA does not assert exploitability.
- The envelope describes the **installed upstream app** (CodeitLab v0.1.1 packaging), not the
  codeitlab fork. The fork's source is a different artifact with its own digest; do not reuse this
  evidence as a claim about fork behavior.

## What REA confirms about the app we are cloning

1. **The product is an Electron shell around a local server + web client.** Main is
   `apps/desktop/dist-electron/boot.cjs`; the server and its bundled client ship inside the same
   asar (`apps/server/dist/client/index.html`). The renderer is the same web app the server serves
   over HTTP — the desktop shell is not a separate UI implementation.
2. **Security posture is explicit and consistent.** Every concrete window sets
   `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; capability reaches the
   renderer only through `contextBridge`. 4 bridges, 125 members, one of which (`desktopBridge`)
   carries 124 of them.
3. **IPC is a wide, typed desktop API, not a general message bus.** 276 operations, 117 literal
   `desktop:*` channels, 155 dynamic constants, 42 renderer listeners, 12 main handlers, and one
   literal main handler. The main side only implements Clerk passkeys, OAuth transport, token
   cache, a macOS permission helper, and `electron-store-get-data`; everything else is
   renderer-invoked main work.
4. **Remote execution is a first-class desktop capability.** SSH environment bootstrap, bearer
   sessions, websocket tickets, Tailscale serve, advertised endpoints, connection catalog, relay
   telemetry — all present in the bridge surface, matching `docs/internals/remote.md`.
5. **The preview/browser subsystem is large.** Roughly half of `desktopBridge` is `preview.*`:
   tabs, navigation, recording, PiP, annotation, cookies, DevTools, zoom, element picking. Any
   fork that keeps the upstream UI inherits this surface.
6. **Native code is isolated and small.** 14 native artifacts, 2 bindings, no native module on the
   startup path; pty, keyring, accessibility, fuzzy-find, macOS/Win32 helpers, and vendored
   tree-sitter for the Cursor SDK.
7. **The app is signed and notarized after asar packing** — the 13 unpacked-binary digest
   contradictions are the signature of that pipeline, not tampering by the user.

## How codeitlab will implement REA natively

Goal: REA is not a tool the user remembers to run. It is a built-in capability of every codeitlab
environment, available to the control surface and to every ACP agent, with no user request.

### 1. Built-in MCP server

Ship a first-party MCP server that wraps the REA CLI (`rea` 6.7.0, `npx rea-agents@6.7.0` as the
portable fallback) and exposes the analysis surface as tools:

| Tool                  | Maps to                                        | Notes                                                                 |
| --------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `rea_analyze_app`     | `rea analyze-javascript-application`           | async job; writes evidence JSON under the project's `.codeitlab/rea/` |
| `rea_inspect`         | `rea inspect-analysis-view`                    | projections: electron boundaries, IPC, endpoints, packages, native    |
| `rea_function`        | `rea function`                                 | one function with evidence                                            |
| `rea_decompile`       | `rea decompile`                                | one part of a binary/JS bundle                                        |
| `rea_compare`         | `rea compare` / `compare-application-versions` | diff two evidence bundles                                             |
| `rea_evidence_export` | `rea evidence-export`                          | canonical, hash-verified bundle for the ledger                        |

Server-side module: `apps/server/src/rea/` (new), registered next to the existing MCP toolkits in
`apps/server/src/mcp/McpHttpServer.ts` (`layerOrchestratorToolkit`, `layerThreadToolkit`, …). The
toolkit gets its own layer, `layerReaToolkit`, so REA tools inherit the same auth, invocation
context, and capability gating as the existing toolkits (`McpInvocationContext`,
`McpToolAccess`, `McpSessionRegistry`). Long analyses run as background jobs
(`apps/server/src/background`, `jobs`) with progress streamed through the existing job/event
machinery, not a blocking RPC.

### 2. Built-in skill

A first-party skill (`rea`) in the codeitlab skill roots, following the same `SKILL.md`
frontmatter contract the fork already parses (`ServerProviderSkill` in
`packages/contracts/src/server.ts`; discovery in `packages/provider-cursor/src/server/skills.ts`,
`apps/server/src/provider/Drivers/ClaudeSkills.ts`). The skill teaches the agent when to reach for
REA (unfamiliar binary, Electron app, bundled JS, pre-purchase audit) and how to cite
`evidence_id` + root digest. It is exposed to every provider through the existing per-provider
skill union, so no provider-specific code is needed.

### 3. Auto-activation policy

A server-side policy service (new `apps/server/src/rea/ReaActivationPolicy.ts`) decides when REA
context is injected:

- **Always-on capability, opt-in cost.** The MCP server is registered for every session; the
  _analysis_ only runs when a trigger fires. Registration is cheap; analysis is a job.
- **Triggers.** (a) workspace contains an `.app`/`.asar`/`.dmg`/bundle artifact or a bundled
  `dist/` JS tree; (b) the user asks about "the installed app", "what does this binary do", or
  compares a fork to upstream; (c) a provider turn targets a path matching the artifact rules;
  (d) an explicit `/rea` command or skill invocation.
- **Injection.** The policy writes a short `appContext` entry (the existing
  `ProviderAdapterV2TurnInput.appContext` channel, `packages/provider-core/src/server/ProviderAdapter.ts`)
  plus the skill's trigger text — so the provider sees "REA is available and relevant; call
  `rea_analyze_app`" without the user asking. Cached evidence for the same root digest is reused
  and never re-analyzed.
- **Settings override.** `rea.enabled` (default on), `rea.autoAnalyze` (default on for artifacts
  under the project root), `rea.maxHeapMb`, `rea.timeoutMs`, `rea.evidenceDir`. Stored through the
  existing `ServerSettings` contract (`packages/contracts/src/settings.ts`) and its patch/RPC path,
  scoped like every other environment setting.
- **Safety.** REA runs read-only against a path the environment already owns; it never executes
  the analyzed app. The policy must refuse paths outside the project root and outside an explicit
  allow-list of installed apps, and must record the digest it analyzed.

### 4. Evidence ledger

Every REA run stores `{evidence_id, root_artifact_sha256, operation, parameters, created_at,
project_id, thread_id}` in a new table next to the orchestration event store
(`apps/server/src/persistence/`), so a thread can cite exactly which artifact version it reasoned
about. Re-analysis of an unchanged digest is a cache hit; a changed digest produces a new record
and a `rea.evidence.changed` event that the UI can surface.
