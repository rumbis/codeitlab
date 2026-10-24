# Bots

A bot is a saved persona with a chat box. Open **Settings → CodeItLab → Bots**, create a
bot, and give it:

- **Standing instructions** — how it should answer, what it is for.
- **Memory** — facts you curate so they carry across chats. The agent never writes here;
  it is your note, not an automatic log.
- **Provider / model** — optional. Empty inherits the thread's provider and its default
  model.
- **Enabled** — a disabled bot cannot start a chat.

## Starting a chat

Write a message and press **Start chat**. CodeItLab opens a normal draft thread in your
most recent project, puts the persona, your memory note and your message in the composer,
and sets the model if the bot names one. Nothing runs until you send.

The conversation is then an ordinary thread: the same chat surface, the same queue/steer,
the same diffs and approvals, and the same sharing as any other thread. Bots add context,
not a second execution path.

## Limits

- Bot memory is a note you maintain, not automatic long-term memory; the durable memory
  feature is separate and opt-in.
- Telegram and other chat transports are not wired yet; this release ships the local chat.
- A bot chat needs a project, because its changes need a home. With no project open the
  page says so instead of doing nothing.

## Keyboard

Tab reaches each bot's message box and its **Start chat** button; Enter on the
button starts the same chat a click does. The buttons are explicit `type="button"`
so they never submit a surrounding form by accident.
