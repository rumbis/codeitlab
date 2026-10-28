import { useState } from "react";
import { PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";

import type { MemoryEntry } from "@codeitlab/contracts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { randomUUID } from "~/lib/utils";
import { useCodeItLabMemory } from "../../codeitlab/api";
import {
  CodeItLabCard,
  CodeItLabEmptyBlock,
  CodeItLabSectionHeading,
  CodeItLabSourceNote,
  CodeItLabStat,
} from "./CodeItLabPrimitives";

const KIND_LABELS: Readonly<Record<MemoryEntry["kind"], string>> = {
  fact: "Fact",
  preference: "Preference",
  decision: "Decision",
  convention: "Convention",
  gotcha: "Gotcha",
  "session-summary": "Session summary",
};

const KIND_ORDER = Object.keys(KIND_LABELS) as MemoryEntry["kind"][];

function kindVariant(kind: MemoryEntry["kind"]): "info" | "success" | "warning" | "outline" {
  if (kind === "gotcha") return "warning";
  if (kind === "decision" || kind === "convention") return "info";
  if (kind === "preference") return "success";
  return "outline";
}

export function CodeItLabMemoryPage() {
  const memory = useCodeItLabMemory();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<MemoryEntry["kind"]>("fact");
  const [draftScope, setDraftScope] = useState<"global" | "project">("project");
  const [localEntries, setLocalEntries] = useState<ReadonlyArray<MemoryEntry>>([]);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const normalized = query.trim().toLowerCase();
  const all = [...localEntries, ...memory.data].filter((entry) => !removedIds.has(entry.id));
  const entries = all.filter(
    (entry) =>
      normalized.length === 0 ||
      entry.text.toLowerCase().includes(normalized) ||
      entry.tags.some((tag) => tag.toLowerCase().includes(normalized)),
  );

  const submit = async () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setBusy(true);
    if (memory.source === "server") {
      const saved = await memory.add({ scope: draftScope, kind: draftKind, text });
      setMessage(
        saved === null
          ? "The server rejected the memory; kept locally for this session."
          : "Memory saved to the environment.",
      );
      if (saved === null) appendLocal(text);
    } else {
      appendLocal(text);
      setMessage("Saved locally (preview adapter); the server copy is written once the RPC lands.");
    }
    setBusy(false);
    setDraft("");
  };

  const appendLocal = (text: string) => {
    const now = new Date().toISOString();
    setLocalEntries((previous) => [
      {
        id: `local-${randomUUID()}`,
        scope: draftScope,
        projectId: draftScope === "project" ? "codeitlab" : null,
        kind: draftKind,
        text,
        source: "manual",
        createdAt: now,
        updatedAt: now,
        recalls: 0,
        tags: [],
        confidence: 1,
      },
      ...previous,
    ]);
  };

  const remove = async (entry: MemoryEntry) => {
    setBusy(true);
    if (entry.id.startsWith("local-")) {
      setLocalEntries((previous) => previous.filter((candidate) => candidate.id !== entry.id));
    } else if (memory.source === "server") {
      const removed = await memory.remove(entry.id);
      if (!removed) setRemovedIds((previous) => new Set(previous).add(entry.id));
    } else {
      setRemovedIds((previous) => new Set(previous).add(entry.id));
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="memory">
      <CodeItLabSourceNote source={memory.source} />
      <CodeItLabSectionHeading
        eyebrow="Memory"
        title="Durable context, recalled automatically"
        description="Facts, preferences, decisions, conventions, and gotchas are extracted from finished turns, stored per project or globally, and recalled into future instructions."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CodeItLabStat label="Total" value={memory.stats.total.toLocaleString()} />
        <CodeItLabStat label="Project" value={memory.stats.project.toLocaleString()} />
        <CodeItLabStat label="Global" value={memory.stats.global.toLocaleString()} />
        <CodeItLabStat
          label="Last extraction"
          value={
            memory.stats.lastExtractionAt === null
              ? "never"
              : new Date(memory.stats.lastExtractionAt).toLocaleTimeString()
          }
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <CodeItLabCard>
          <div className="flex flex-col gap-2 px-4 py-3">
            <p className="codeitlab-mono-label text-codeitlab-green/80">Soul · what I learned</p>
            <p className="text-xs text-muted-foreground">
              Written by the agent from finished turns. Stored as SOUL.md; edit it and your words
              survive the next refresh.
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground/80">
              {memory.soul.memory.trim().length === 0
                ? "Nothing learned yet. Finish a turn and it will appear here."
                : memory.soul.memory}
            </pre>
          </div>
        </CodeItLabCard>
        <CodeItLabCard>
          <div className="flex flex-col gap-2 px-4 py-3">
            <p className="codeitlab-mono-label text-codeitlab-green/80">Soul · who I work with</p>
            <p className="text-xs text-muted-foreground">
              Your preferences, kept apart from project facts. Stored as USER.md.
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground/80">
              {memory.soul.user.trim().length === 0
                ? "No preferences learned yet."
                : memory.soul.user}
            </pre>
          </div>
        </CodeItLabCard>
      </div>
      <CodeItLabCard>
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="codeitlab-mono-label text-codeitlab-green/80">Add memory</p>
          <Textarea
            aria-label="Memory text"
            className="min-h-20"
            placeholder="A durable fact, preference, or convention the agent should remember…"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={draftKind}
              onValueChange={(value) => {
                if (value !== null && KIND_ORDER.includes(value as MemoryEntry["kind"])) {
                  setDraftKind(value as MemoryEntry["kind"]);
                }
              }}
            >
              <SelectTrigger size="sm" className="w-40" aria-label="Memory kind">
                <SelectValue>{KIND_LABELS[draftKind]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {KIND_ORDER.map((kind) => (
                  <SelectItem key={kind} hideIndicator value={kind}>
                    {KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Select
              value={draftScope}
              onValueChange={(value) => {
                if (value === "global" || value === "project") setDraftScope(value);
              }}
            >
              <SelectTrigger size="sm" className="w-32" aria-label="Memory scope">
                <SelectValue>{draftScope === "global" ? "Global" : "Project"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="project">
                  Project
                </SelectItem>
                <SelectItem hideIndicator value="global">
                  Global
                </SelectItem>
              </SelectPopup>
            </Select>
            <Button
              className="ms-auto"
              disabled={busy || draft.trim().length === 0}
              size="sm"
              onClick={() => void submit()}
            >
              <PlusIcon className="size-3.5" />
              Add memory
            </Button>
          </div>
          {message === null ? null : (
            <p className="text-xs text-muted-foreground" role="status">
              {message}
            </p>
          )}
        </div>
      </CodeItLabCard>

      <InputGroup>
        <InputGroupAddon>
          <SearchIcon className="text-muted-foreground" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Filter memories"
          placeholder="Filter memories by text or tag…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </InputGroup>

      {normalized.length > 0 && entries.length > 0 ? (
        <p className="text-2xs tabular-nums text-muted-foreground">
          Showing {entries.length} of {all.length} memories for “{query.trim()}”.
        </p>
      ) : null}

      {all.length === 0 ? (
        <CodeItLabEmptyBlock
          description="Finished turns extract memories automatically; you can also add one above. Until then the agent starts every turn without stored context."
          title="No memories yet"
        />
      ) : entries.length === 0 ? (
        <CodeItLabEmptyBlock
          action={
            <Button type="button" onClick={() => setQuery("")} size="sm" variant="outline">
              Clear filter
            </Button>
          }
          description={`The filter reads memory text and tags, not the kind or scope labels. There ${all.length === 1 ? "is 1 memory" : `are ${all.length} memories`} without this text.`}
          title={`No memories match “${query.trim()}”`}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/40 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge size="sm" variant={kindVariant(entry.kind)}>
                  {KIND_LABELS[entry.kind]}
                </Badge>
                <Badge size="sm" variant="outline">
                  {entry.scope}
                </Badge>
                <span className="text-2xs tabular-nums text-muted-foreground">
                  recalled {entry.recalls}× · confidence {Math.round(entry.confidence * 100)}%
                </span>
                <Button
                  aria-label={`Delete memory: ${entry.text.slice(0, 40)}`}
                  className="ms-auto"
                  disabled={busy}
                  size="icon-micro"
                  variant="ghost-muted"
                  onClick={() => void remove(entry)}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
              <p className="text-sm text-foreground">{entry.text}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {entry.tags.map((tag) => (
                  <Badge key={tag} size="sm" variant="secondary">
                    {tag}
                  </Badge>
                ))}
                <span className="ms-auto font-mono text-2xs text-muted-foreground/70">
                  {new Date(entry.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
