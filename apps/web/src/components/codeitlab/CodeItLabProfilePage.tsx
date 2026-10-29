import {
  profileIsComplete,
  profileIsEmpty,
  profilePublicSummary,
  profileSteps,
  profileWorkHistory,
  type CodeItLabWorkHistoryEntry,
} from "@codeitlab/core/profile";
import { CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import { useCodeItLabProfilePublish } from "../../codeitlab/engagements";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  CodeItLabCard,
  CodeItLabEmptyBlock,
  CodeItLabPrimaryCard,
  CodeItLabSectionHeading,
  CodeItLabStepMarker,
} from "./CodeItLabPrimitives";

/** The comma-separated fields a person typed, as the list the marketplace stores. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * The declaration a person makes about their own work: who they are, what they
 * have built, and what they want next. It is stored locally, written only by the
 * human, and labelled as declared context when it reaches an agent. Showing it
 * to businesses stays off until the person switches it on.
 */
export function CodeItLabProfilePage() {
  const { codeitlab, update } = useCodeItLabSettingsWriter();
  const profile = codeitlab.profile;
  const steps = profileSteps(profile);
  // The first thing still missing is what this screen is asking for.
  const currentStep = steps.findIndex((step) => !step.done);
  const work = profileWorkHistory(profile);
  const summary = profilePublicSummary(profile);
  const publish = useCodeItLabProfilePublish(null);
  const [publishing, setPublishing] = useState(false);

  const patch = (next: Partial<typeof profile>) => {
    update({ profile: { ...profile, ...next } });
  };

  const patchWorkEntry = (index: number, next: Partial<CodeItLabWorkHistoryEntry>) => {
    patch({
      workHistory: profile.workHistory.map((entry, at) =>
        at === index ? { ...entry, ...next } : entry,
      ),
    });
  };

  // A new row starts blank and is trimmed out of briefs until it says something.
  const addWorkEntry = () => {
    patch({
      workHistory: [...profile.workHistory, { company: "", role: "", period: "", summary: "" }],
    });
  };

  const removeWorkEntry = (index: number) => {
    patch({ workHistory: profile.workHistory.filter((_, at) => at !== index) });
  };

  // The summary is the only thing that leaves this machine, and only when the
  // user copies it or switches visibility on; there is no upload behind the button.
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      toastManager.add({
        type: "success",
        title: "Profile copied",
        description: "Paste it into a marketplace introduction or a job brief.",
      });
    } catch {
      toastManager.add({
        type: "error",
        title: "Clipboard is not available",
        description: "Select the text in the preview and copy it manually.",
      });
    }
  };

  // Publishing is the only write this screen makes on the user's behalf, so it
  // sends exactly what the preview shows and refuses while the switch is off.
  const publishProfile = async () => {
    setPublishing(true);
    try {
      const result = await publish({
        visibleToBusinesses: profile.visibleToBusinesses,
        displayName: profile.fullName,
        headline: profile.headline,
        bio: profile.skillset,
        skills: splitList(profile.skillset),
        interests: splitList(profile.interestDomain),
        workHistory: work.map((entry) => ({
          company: entry.company,
          role: entry.role,
          period: entry.period,
          summary: entry.summary,
        })),
      });
      if (result === null) {
        toastManager.add({
          type: "error",
          title: "Could not publish",
          description: "The app could not reach its own server. Try again in a moment.",
        });
      } else if (!result.published) {
        toastManager.add({
          type: "error",
          title: "Not published",
          description: result.reason ?? "The marketplace did not accept the profile.",
        });
      } else {
        toastManager.add({
          type: "success",
          title: "Profile published",
          description:
            result.profileUrl === undefined
              ? "Businesses on our site can see it now."
              : "Businesses can see it here: " + result.profileUrl,
        });
      }
    } finally {
      setPublishing(false);
    }
  };

  const stateLine = profileIsEmpty(profile)
    ? "Nothing declared yet. Empty fields are left out of briefs, and Copy profile stays disabled until one is filled."
    : profileIsComplete(profile)
      ? "All three steps are done."
      : "Fill in the remaining steps so a business can tell who you are and what you have done.";

  return (
    <div className="flex flex-col gap-6">
      <CodeItLabSectionHeading
        description="Say who you are, what you have built, and what you want next. Bot briefs carry it as declared context, and you can paste it into a marketplace introduction; nothing here is inferred, uploaded, or filled in for you."
        eyebrow="CodeItLab // profile"
        title="Profile"
        action={
          <Button
            aria-describedby="profile-state"
            disabled={summary === ""}
            onClick={() => void copySummary()}
            size="sm"
            variant="outline"
          >
            <CopyIcon className="size-3.5" /> Copy profile
          </Button>
        }
      />

      <CodeItLabCard className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {steps.map((step, index) => (
            <span className="flex items-center gap-2 text-xs text-muted-foreground" key={step.id}>
              <CodeItLabStepMarker
                index={index}
                state={step.done ? "done" : index === currentStep ? "current" : "upcoming"}
              />
              <span className={step.done ? "text-foreground" : undefined}>{step.label}</span>
            </span>
          ))}
        </div>
        <p aria-live="polite" className="text-2xs text-muted-foreground" id="profile-state">
          {stateLine}
        </p>
      </CodeItLabCard>

      <CodeItLabCard className="flex flex-col gap-4 p-4">
        <h3 className="text-sm font-medium">Who you are</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="profile-name">
              Name
            </label>
            <Input
              id="profile-name"
              onChange={(event) => patch({ fullName: event.currentTarget.value })}
              placeholder="Maria Papadopoulou"
              value={profile.fullName}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="profile-location">
              Location
            </label>
            <Input
              id="profile-location"
              onChange={(event) => patch({ location: event.currentTarget.value })}
              placeholder="Athens, Greece"
              value={profile.location}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="profile-headline">
            Headline
          </label>
          <Input
            id="profile-headline"
            onChange={(event) => patch({ headline: event.currentTarget.value })}
            placeholder="Backend engineer, mostly TypeScript and Postgres"
            value={profile.headline}
          />
        </div>
      </CodeItLabCard>

      <CodeItLabCard className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">What you have worked on</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              One row per job or client, newest first. Blank rows never reach a brief.
            </p>
          </div>
          <Button onClick={addWorkEntry} size="sm" variant="outline">
            <PlusIcon className="size-3.5" /> Add
          </Button>
        </div>
        {work.length === 0 ? (
          <CodeItLabEmptyBlock
            description="Add a job and it appears on your profile, in your briefs, and in the text you copy for a business."
            title="No work history yet"
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {profile.workHistory.map((entry, index) => (
              <li
                className="flex flex-col gap-2 rounded-md border border-border p-3"
                // Rows are plain objects with no id; keying on what the row says
                // keeps React from reusing an input owned by a different entry.
                key={`${entry.company}\u0000${entry.role}\u0000${entry.period}`}
              >
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    aria-label={`Company for work entry ${index + 1}`}
                    onChange={(event) =>
                      patchWorkEntry(index, { company: event.currentTarget.value })
                    }
                    placeholder="Company"
                    value={entry.company}
                  />
                  <Input
                    aria-label={`Role for work entry ${index + 1}`}
                    onChange={(event) => patchWorkEntry(index, { role: event.currentTarget.value })}
                    placeholder="Role"
                    value={entry.role}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={`Period for work entry ${index + 1}`}
                      onChange={(event) =>
                        patchWorkEntry(index, { period: event.currentTarget.value })
                      }
                      placeholder="2021 - 2023"
                      value={entry.period}
                    />
                    <Button
                      aria-label={`Remove work entry ${index + 1}`}
                      onClick={() => removeWorkEntry(index)}
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <Textarea
                  aria-label={`What you did at work entry ${index + 1}`}
                  onChange={(event) =>
                    patchWorkEntry(index, { summary: event.currentTarget.value })
                  }
                  placeholder="What you built there, in one or two sentences"
                  rows={2}
                  value={entry.summary}
                />
              </li>
            ))}
          </ul>
        )}
      </CodeItLabCard>

      <CodeItLabCard className="flex flex-col gap-4 p-4">
        <div>
          <h3 className="text-sm font-medium">What interests you</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            The work you want next, and what you can already do without help.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="profile-domain">
            Interest domain
          </label>
          <Textarea
            id="profile-domain"
            onChange={(event) => patch({ interestDomain: event.currentTarget.value })}
            placeholder="Local-first developer tools for small studios"
            rows={2}
            value={profile.interestDomain}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="profile-skillset">
            Skillset
          </label>
          <Textarea
            id="profile-skillset"
            onChange={(event) => patch({ skillset: event.currentTarget.value })}
            placeholder="TypeScript, Electron, Effect, design systems"
            rows={2}
            value={profile.skillset}
          />
        </div>
      </CodeItLabCard>

      <CodeItLabPrimaryCard className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">Show my profile to businesses</span>
            <span className="text-xs text-muted-foreground">
              Off by default. When it is on, the text below is what a business sees on our site.
              Copy profile works while it is off too.
            </span>
          </span>
          <Switch
            aria-label="Show my profile to businesses"
            checked={profile.visibleToBusinesses}
            onCheckedChange={(checked) => patch({ visibleToBusinesses: checked })}
          />
        </div>
        {summary === "" ? (
          <CodeItLabEmptyBlock
            description="A profile with nothing in it has nothing to show, so nothing is published."
            title="Nothing to show yet"
          />
        ) : (
          <div className="flex flex-col gap-2">
            <pre
              className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap"
              id="profile-public-preview"
            >
              {summary}
            </pre>
            <div className="flex items-center justify-between gap-3">
              <p className="text-2xs text-muted-foreground">
                {profile.visibleToBusinesses
                  ? "Visible to businesses on our site."
                  : "Only you can see this."}
              </p>
              <Button
                disabled={!profile.visibleToBusinesses || publishing}
                onClick={() => {
                  void publishProfile();
                }}
                size="sm"
                variant="outline"
              >
                {publishing ? "Publishing…" : "Publish to businesses"}
              </Button>
            </div>
          </div>
        )}
      </CodeItLabPrimaryCard>
    </div>
  );
}
