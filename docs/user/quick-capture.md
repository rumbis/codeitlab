# Quick capture

Quick capture turns a thought into a thread without navigating the app first. Press
**Cmd+Shift+Space** (macOS) or **Ctrl+Shift+Space** (Windows, Linux) from any app: CodeItLab comes
forward and shows a compact prompt box over the window. Type the task, press **Enter**, and the
prompt opens as a new thread through the same new-thread flow as a prompt link — project picker,
model defaults, and prompt handling included.

- **Enter** opens the thread. **Shift+Enter** adds a newline.
- **Escape**, **Cancel**, or clicking outside the box dismisses it without creating anything.
- The overlay is keyboard-only by design: it opens with focus in the prompt, so you can type
  immediately.

## Changing the shortcut

The shortcut is global, so CodeItLab must reserve it while the app runs. The default is
`CommandOrControl+Shift+Space`. To move it, set `CODEITLAB_QUICK_OVERLAY_SHORTCUT` to an
[Electron accelerator](https://www.electronjs.org/docs/latest/api/menu-item#accelerator) before starting the
app, for example `Control+Alt+K`. There is no settings control for it yet; the environment variable
keeps the choice in one place until the settings page lands.

If the operating system or another app already owns the chord, CodeItLab does not pretend the
shortcut exists. A notification names the accelerator and the environment variable, and the rest of
the app keeps working.

## When the prompt opens a picker

Quick capture hands the prompt to the normal new-thread route. With more than one project you pick
the destination first; with a single project the thread opens directly. The prompt is preserved
exactly, including newlines from **Shift+Enter**.

## What it does not do

The overlay starts a thread; it does not attach files, screenshots, or a model choice. Use the
composer for those. SnapShots stay a separate feature with their own shortcut.
