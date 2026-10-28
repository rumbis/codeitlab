# Context sizes

The composer's context meter uses the limit your provider reports. Some providers report token
usage without a maximum, and then the meter can only show how many tokens are used, not how
full the window is. **Settings → CodeItLab → Context** fills that gap.

## What you can do

- See every model from your connected providers in one table.
- **Record a size** per model (and per provider instance when two instances share a slug). A
  recorded value shows as measured, e.g. `1M`.
- Leave the field empty to fall back to the family estimate, shown with a `~` prefix.

## How the fallback is chosen

1. **Provider-reported limit** — always wins; nothing on this page overrides it.
2. **Recorded value** for that model and instance, then a recorded value for any instance.
3. **Family estimate** — conservative, round numbers for Claude, GPT-5, GPT-4.1, Gemini,
   DeepSeek, Qwen, Kimi, GLM, Grok and Llama, marked with `~`.

Estimates exist so the meter can show a percentage instead of "unknown". They are not a
promise about the model's real window, and they never hide a provider's own number.
