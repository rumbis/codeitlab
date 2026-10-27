import type { CodeItLabBot } from "@codeitlab/core/bots";
import { buildBotBrief, botIssue } from "@codeitlab/core/bots";
import { scopeProjectRef } from "@codeitlab/client-runtime/environment";
import type { ProviderInstanceId } from "@codeitlab/contracts";
import { MessageSquareIcon, PlusIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import { createBot } from "../../codeitlab/bots";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { CodeItLabCard, CodeItLabEmptyBlock, CodeItLabSectionHeading } from "./CodeItLabPrimitives";

const PROVIDERS_LIST_ID = "codeitlab-bot-providers";
const MODELS_LIST_ID = "codeitlab-bot-models";

/**
 * Bots: saved personas with a chat box. Starting a chat opens a normal thread
 * with the persona and the user's message, so the conversation lives in the same
 * chat surface as everything else and can be steered or shared.
 */
export function CodeItLabBotsPage() {
  const { codeitlab, update } = useCodeItLabSettingsWriter();
  const bots = codeitlab.bots.bots;
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [startingId, setStartingId] = useState<string | null>(null);

  const environmentId = usePrimaryEnvironmentId();
  const providersByEnvironment = useEnvironmentProviders();
  const providers = environmentId === null ? [] : (providersByEnvironment.get(environmentId) ?? []);
  const entries = deriveProviderInstanceEntries(providers).filter((entry) => entry.enabled);
  const models = entries.flatMap((entry) =>
    entry.models.map((model) => ({ instanceId: entry.instanceId as string, slug: model.slug })),
  );

  const projects = useProjects();
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();
  // One place decides whether a bot can start a chat, so the button can say why
  // before the click instead of opening a toast afterwards.
  const firstProject = sortScopedProjectsForSidebar(
    projects.filter((entry) => entry.isScratch !== true),
    threads,
    "updated_at",
  )[0];

  const persist = (next: ReadonlyArray<CodeItLabBot>) => {
    update({ bots: { ...codeitlab.bots, bots: [...next] } });
  };

  const updateBot = (id: string, patch: Partial<CodeItLabBot>) => {
    persist(bots.map((bot) => (bot.id === id ? { ...bot, ...patch } : bot)));
  };

  const startChat = async (bot: CodeItLabBot) => {
    const issue = botIssue(bot);
    if (issue !== null) {
      toastManager.add({ type: "error", title: "Bot is not ready", description: issue });
      return;
    }
    if (!bot.enabled) {
      toastManager.add({
        type: "error",
        title: "Bot is disabled",
        description: "Enable it before starting a chat.",
      });
      return;
    }
    const message = (messages[bot.id] ?? "").trim();
    if (message === "") {
      toastManager.add({
        type: "error",
        title: "Write a message",
        description: "The bot needs a first message to answer.",
      });
      return;
    }
    const project = firstProject;
    if (project === undefined) {
      toastManager.add({
        type: "error",
        title: "Open a project first",
        description: "Bot chats run as threads in a project so their changes have a home.",
      });
      return;
    }
    setStartingId(bot.id);
    try {
      const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        replace: true,
      });
      if (opened === null) {
        toastManager.add({
          type: "error",
          title: "Could not open a thread",
          description: "Try again, or start the chat from the composer.",
        });
        return;
      }
      const composer = useComposerDraftStore.getState();
      composer.setPrompt(opened.draftId, buildBotBrief(bot, message, codeitlab.profile));
      if (bot.instanceId.trim() !== "" && bot.model.trim() !== "") {
        composer.setModelSelection(
          opened.draftId,
          {
            instanceId: bot.instanceId as ProviderInstanceId,
            model: bot.model.trim(),
          },
          { explicit: true },
        );
      }
      setMessages((current) => ({ ...current, [bot.id]: "" }));
      toastManager.add({
        type: "success",
        title: `${bot.name} is ready`,
        description: "The chat is in the composer. Send it to start the thread.",
      });
    } finally {
      setStartingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="bots">
      <CodeItLabSectionHeading
        description="A bot is a saved persona plus a chat box. Starting a chat opens a normal thread with the persona and your message, so you can steer it, read the diff and share it like any other thread."
        eyebrow="CodeItLab // bots"
        title="Bots"
      />

      {bots.length === 0 ? (
        <CodeItLabEmptyBlock
          action={
            <Button type="button" onClick={() => persist([createBot(new Date())])} size="sm">
              <PlusIcon /> New bot
            </Button>
          }
          description="Give a bot standing instructions, an optional model, and a memory note you curate. Its chats then start with that context already in place."
          title="No bots yet"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {bots.map((bot) => {
            const issue = botIssue(bot);
            const blockReason =
              issue ??
              (!bot.enabled
                ? "This bot is disabled; enable it before starting a chat."
                : (messages[bot.id] ?? "").trim() === ""
                  ? "Write a message so the bot has something to answer."
                  : firstProject === undefined
                    ? "Open a project first: bot chats run as threads in a project."
                    : null);
            return (
              <CodeItLabCard className="flex flex-col gap-3 p-4" key={bot.id}>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-40 flex-1">
                    <label
                      className="text-xs font-medium text-muted-foreground"
                      htmlFor={`bot-name-${bot.id}`}
                    >
                      Name
                    </label>
                    <Input
                      id={`bot-name-${bot.id}`}
                      onChange={(event) => updateBot(bot.id, { name: event.currentTarget.value })}
                      value={bot.name}
                    />
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
                    <Checkbox
                      aria-label={`Enable ${bot.name}`}
                      checked={bot.enabled}
                      onCheckedChange={(checked) =>
                        updateBot(bot.id, { enabled: checked === true })
                      }
                    />
                    Enabled
                  </label>
                  <Button
                    type="button"
                    aria-label={`Delete ${bot.name}`}
                    onClick={() => persist(bots.filter((entry) => entry.id !== bot.id))}
                    size="sm"
                    variant="ghost"
                  >
                    <Trash2Icon />
                  </Button>
                </div>

                <div>
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`bot-persona-${bot.id}`}
                  >
                    Standing instructions
                  </label>
                  <Textarea
                    id={`bot-persona-${bot.id}`}
                    onChange={(event) => updateBot(bot.id, { persona: event.currentTarget.value })}
                    placeholder="How should this bot answer?"
                    value={bot.persona}
                  />
                </div>

                <div>
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`bot-memory-${bot.id}`}
                  >
                    Memory (you curate this; the agent never writes it)
                  </label>
                  <Textarea
                    id={`bot-memory-${bot.id}`}
                    onChange={(event) => updateBot(bot.id, { memory: event.currentTarget.value })}
                    placeholder="Facts the bot should remember across chats"
                    value={bot.memory}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      className="text-xs font-medium text-muted-foreground"
                      htmlFor={`bot-provider-${bot.id}`}
                    >
                      Provider
                    </label>
                    <Input
                      id={`bot-provider-${bot.id}`}
                      list={PROVIDERS_LIST_ID}
                      onChange={(event) =>
                        updateBot(bot.id, { instanceId: event.currentTarget.value })
                      }
                      placeholder="Inherit"
                      value={bot.instanceId}
                    />
                  </div>
                  <div>
                    <label
                      className="text-xs font-medium text-muted-foreground"
                      htmlFor={`bot-model-${bot.id}`}
                    >
                      Model
                    </label>
                    <Input
                      id={`bot-model-${bot.id}`}
                      list={MODELS_LIST_ID}
                      onChange={(event) => updateBot(bot.id, { model: event.currentTarget.value })}
                      placeholder="Inherit"
                      value={bot.model}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`bot-message-${bot.id}`}
                  >
                    Message {bot.name}
                  </label>
                  <div className="flex flex-wrap items-start gap-2">
                    <Textarea
                      aria-describedby={`bot-issue-${bot.id}`}
                      className="min-h-16 flex-1"
                      id={`bot-message-${bot.id}`}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setMessages((current) => ({ ...current, [bot.id]: value }));
                      }}
                      placeholder="Ask this bot something"
                      value={messages[bot.id] ?? ""}
                    />
                    <Button
                      aria-describedby={`bot-issue-${bot.id}`}
                      type="button"
                      data-bot-start={bot.id}
                      disabled={startingId === bot.id || blockReason !== null}
                      onClick={() => void startChat(bot)}
                      size="sm"
                    >
                      <SendIcon /> {startingId === bot.id ? "Opening…" : "Start chat"}
                    </Button>
                  </div>
                  <p
                    aria-live="polite"
                    className="text-2xs text-muted-foreground"
                    id={`bot-issue-${bot.id}`}
                  >
                    {blockReason === null ? (
                      <>
                        <MessageSquareIcon className="mr-1 inline size-3" aria-hidden />
                        Opens a normal thread in your most recent project.
                      </>
                    ) : (
                      blockReason
                    )}
                  </p>
                </div>
              </CodeItLabCard>
            );
          })}

          <Button
            type="button"
            className="justify-start"
            onClick={() => persist([...bots, createBot(new Date())])}
            size="sm"
            variant="ghost"
          >
            <PlusIcon /> New bot
          </Button>
        </div>
      )}

      <datalist id={PROVIDERS_LIST_ID}>
        {entries.map((entry) => (
          <option key={entry.instanceId as string} value={entry.instanceId as string}>
            {entry.displayName}
          </option>
        ))}
      </datalist>
      <datalist id={MODELS_LIST_ID}>
        {models.map((model) => (
          <option key={`${model.instanceId}:${model.slug}`} value={model.slug}>
            {model.instanceId}
          </option>
        ))}
      </datalist>
    </div>
  );
}
