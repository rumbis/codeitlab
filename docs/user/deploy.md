# Deploy

The deploy menu saves the commands your project already uses, so shipping does not mean
remembering a CLI invocation or leaving the app. Open it from
**Settings → CodeItLab → Deploy**.

## Targets

A target is a name, one command, an optional note and an enabled switch. Add a starter
(Vercel, Netlify, Cloudflare Pages, Railway, Fly.io) or a custom command; edit any field
inline. A target without a command cannot run, and a multi-line command is rejected with a
reason — extra steps belong in the notes.

## What Run deploy does

**Run deploy** opens a new draft thread in your most recent project and writes the target's
brief into the composer. The brief tells the agent to run the command in the project root
and report the real output. It also forbids the three things that make a deploy panel
dishonest:

- inventing a deployment URL instead of reporting the one the command printed;
- installing a CLI or logging in without asking first;
- retrying with a different provider when the command fails.

Nothing runs until you send the message, and the command is visible, approvable and
transcript-backed like every other command the agent runs. CodeItLab does not call a
hosting API itself and does not store provider tokens: the CLI's own login or the
credentials proxy keeps them.

## Requirements

The provider CLI must be installed and authenticated on the machine that runs the server.
If it is missing, the thread stops and asks instead of guessing. Deploys are only as
repeatable as the command you save, so keep secrets in the CLI or the credentials proxy,
never in the target.

## Keyboard

Tab reaches each target's fields and its **Run deploy** button; Enter on the
button runs the same check a click does, including the "Open a project first"
message when no project is open. Buttons are explicit `type="button"`.
