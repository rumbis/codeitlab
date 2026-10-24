import { useEffect, useRef, useState } from "react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";

import type {
  CodeitlabIntegrationStatus,
  CodeitlabShortsJob,
  CodeitlabShortsJobState,
} from "@t3tools/contracts";

import {
  codeitlabShortsCreateJobCommand,
  codeitlabShortsJobStatusCommand,
} from "../../codeitlab/api";
import {
  addTrackedShortsJob,
  clampTargetClips,
  formatClipDuration,
  isShortsJobActive,
  parseTrackedShortsJobs,
  serializeTrackedShortsJobs,
  SHORTS_JOB_POLL_MS,
  SHORTS_JOBS_STORAGE_KEY,
  shortsStateLabel,
  shortsStateVariant,
  shortsUnknownStateExplanation,
  SHORTS_OUTPUT_FORMAT_LABELS,
  SHORTS_OUTPUT_FORMATS,
  tailShortsLogs,
  type ShortsOutputFormat,
} from "../../codeitlab/integrations/shorts";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { CodeitlabCard } from "./CodeitlabPrimitives";

function readTrackedJobIds(): ReadonlyArray<string> {
  try {
    return parseTrackedShortsJobs(window.localStorage.getItem(SHORTS_JOBS_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeTrackedJobIds(ids: ReadonlyArray<string>): void {
  try {
    window.localStorage.setItem(SHORTS_JOBS_STORAGE_KEY, serializeTrackedShortsJobs(ids));
  } catch {
    // Storage can be unavailable (private mode, quota); the page still works in-memory.
  }
}

function failureMessage(result: { readonly cause: unknown }): string {
  const squashed = squashAtomCommandFailure(
    result as Parameters<typeof squashAtomCommandFailure>[0],
  );
  if (typeof squashed === "object" && squashed !== null && "message" in squashed) {
    const message = (squashed as { readonly message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "The job request failed.";
}

function isKnownJobState(value: string): value is CodeitlabShortsJobState {
  return (
    value === "queued" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed" ||
    value === "unknown"
  );
}

export function CodeitlabShortsJobs(props: { readonly status: CodeitlabIntegrationStatus }) {
  const environmentId = usePrimaryEnvironmentId();
  const createJobCommand = useAtomCommand(codeitlabShortsCreateJobCommand, {
    reportFailure: false,
  });
  const jobStatusCommand = useAtomCommand(codeitlabShortsJobStatusCommand, {
    reportFailure: false,
  });
  const statusCommandRef = useRef(jobStatusCommand);

  const [trackedIds, setTrackedIds] = useState<ReadonlyArray<string>>(readTrackedJobIds);
  const [jobs, setJobs] = useState<Readonly<Record<string, CodeitlabShortsJob>>>({});
  const [jobErrors, setJobErrors] = useState<Readonly<Record<string, string>>>({});
  const [url, setUrl] = useState("");
  const [targetClips, setTargetClips] = useState("3");
  const [captions, setCaptions] = useState(false);
  const [autoHook, setAutoHook] = useState(false);
  const [outputFormat, setOutputFormat] = useState<ShortsOutputFormat>("vertical");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    statusCommandRef.current = jobStatusCommand;
  });

  useEffect(() => {
    writeTrackedJobIds(trackedIds);
  }, [trackedIds]);

  useEffect(() => {
    if (trackedIds.length === 0 || environmentId === null) return;
    let cancelled = false;
    const load = async () => {
      const results = await Promise.all(
        trackedIds.map(async (jobId) => {
          const result = await statusCommandRef.current({ environmentId, input: { jobId } });
          return { jobId, result };
        }),
      );
      if (cancelled) return;
      const nextJobs: Record<string, CodeitlabShortsJob> = {};
      const nextErrors: Record<string, string> = {};
      for (const { jobId, result } of results) {
        if (result._tag === "Success") nextJobs[jobId] = result.value;
        else nextErrors[jobId] = failureMessage(result);
      }
      setJobs((previous) => ({ ...previous, ...nextJobs }));
      setJobErrors(nextErrors);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [trackedIds, environmentId]);

  useEffect(() => {
    if (environmentId === null) return;
    const activeIds = trackedIds.filter((jobId) => {
      const job = jobs[jobId];
      return job !== undefined && isShortsJobActive(job.state);
    });
    if (activeIds.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      const results = await Promise.all(
        activeIds.map(async (jobId) => {
          const result = await statusCommandRef.current({ environmentId, input: { jobId } });
          return { jobId, result };
        }),
      );
      if (cancelled) return;
      const nextJobs: Record<string, CodeitlabShortsJob> = {};
      const nextErrors: Record<string, string> = {};
      for (const { jobId, result } of results) {
        if (result._tag === "Success") nextJobs[jobId] = result.value;
        else nextErrors[jobId] = failureMessage(result);
      }
      setJobs((previous) => ({ ...previous, ...nextJobs }));
      setJobErrors((previous) => ({ ...previous, ...nextErrors }));
    };
    const timer = window.setInterval(() => {
      void poll();
    }, SHORTS_JOB_POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [jobs, trackedIds, environmentId]);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be denied; the text stays visible and selectable.
    }
  };

  const handleSubmit = async () => {
    if (environmentId === null || submitting) return;
    if (url.trim().length === 0 || !acknowledged) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await createJobCommand({
      environmentId,
      input: {
        url: url.trim(),
        acknowledged: true,
        targetClips: clampTargetClips(Number(targetClips)),
        captions,
        autoHook,
        outputFormat,
      },
    });
    setSubmitting(false);
    if (result._tag !== "Success") {
      setSubmitError(failureMessage(result));
      return;
    }
    const created = result.value;
    const state = isKnownJobState(created.state) ? created.state : "unknown";
    setJobs((previous) => ({
      ...previous,
      [created.jobId]: {
        jobId: created.jobId,
        state,
        logs: [],
        clips: [],
        ...(created.partial === undefined ? {} : { partial: created.partial }),
      },
    }));
    setTrackedIds((previous) => addTrackedShortsJob(previous, created.jobId));
    setUrl("");
    setAcknowledged(false);
  };

  const canSubmit = url.trim().length > 0 && acknowledged && !submitting && environmentId !== null;
  const ready = props.status.state === "ready";

  return (
    <div className="flex flex-col gap-4" data-shorts-jobs-root>
      {ready ? (
        <CodeitlabCard data-shorts-form>
          <div className="flex flex-col gap-3 px-4 py-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-foreground">New clip job</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Paste a video link; {props.status.engine} cuts it into short clips with captions.
              </p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Video URL</span>
              <Input
                aria-label="Video URL"
                placeholder="https://www.youtube.com/watch?v=…"
                value={url}
                disabled={submitting}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Target clips (1–12)</span>
                <Input
                  aria-label="Target clips"
                  type="number"
                  min={1}
                  max={12}
                  value={targetClips}
                  disabled={submitting}
                  onChange={(event) => setTargetClips(event.target.value)}
                />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Output format</span>
                <Select
                  value={outputFormat}
                  disabled={submitting}
                  onValueChange={(value) => {
                    if (SHORTS_OUTPUT_FORMATS.includes(value as ShortsOutputFormat)) {
                      setOutputFormat(value as ShortsOutputFormat);
                    }
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Output format">
                    <SelectValue>{SHORTS_OUTPUT_FORMAT_LABELS[outputFormat]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    {SHORTS_OUTPUT_FORMATS.map((format) => (
                      <SelectItem key={format} value={format}>
                        {SHORTS_OUTPUT_FORMAT_LABELS[format]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-xs text-foreground">
                <Switch
                  aria-label="Captions"
                  checked={captions}
                  disabled={submitting}
                  onCheckedChange={setCaptions}
                />
                Burn in captions
              </label>
              <label className="flex items-center gap-2 text-xs text-foreground">
                <Switch
                  aria-label="Auto hook"
                  checked={autoHook}
                  disabled={submitting}
                  onCheckedChange={setAutoHook}
                />
                Add an auto hook
              </label>
            </div>
            <label className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
              <Checkbox
                className="mt-0.5"
                aria-label="Rights confirmation"
                checked={acknowledged}
                disabled={submitting}
                onCheckedChange={(checked) => setAcknowledged(checked === true)}
              />
              <span className="text-xs leading-snug text-foreground">
                I own this content or have the rights to process it.
              </span>
            </label>
            {submitError === null ? null : (
              <Alert variant="error" data-shorts-error>
                <AlertTitle>Could not start the job</AlertTitle>
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
                data-shorts-submit
              >
                {submitting ? "Submitting…" : "Create clip job"}
              </Button>
              <span className="text-2xs text-muted-foreground">
                Needs the rights confirmation; the engine rejects jobs without it.
              </span>
            </div>
          </div>
        </CodeitlabCard>
      ) : (
        <p className="text-sm text-muted-foreground" data-shorts-not-ready>
          Start the engine to submit a clip job.
        </p>
      )}

      {trackedIds.length === 0 ? null : (
        <div className="flex flex-col gap-3" data-shorts-jobs>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="codeitlab-mono-label text-muted-foreground">CLIP JOBS</p>
            <Badge size="sm" variant="outline">
              {trackedIds.length}
            </Badge>
          </div>
          {trackedIds.map((jobId) => (
            <ShortsJobCard
              key={jobId}
              jobId={jobId}
              job={jobs[jobId]}
              error={jobErrors[jobId]}
              copied={copied}
              onCopy={(key, value) => void copy(key, value)}
              onRetry={() => {
                void (async () => {
                  if (environmentId === null) return;
                  const result = await statusCommandRef.current({
                    environmentId,
                    input: { jobId },
                  });
                  if (result._tag === "Success") {
                    setJobs((previous) => ({ ...previous, [jobId]: result.value }));
                    setJobErrors((previous) => {
                      const next = { ...previous };
                      delete next[jobId];
                      return next;
                    });
                  } else {
                    setJobErrors((previous) => ({ ...previous, [jobId]: failureMessage(result) }));
                  }
                })();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShortsJobCard(props: {
  readonly jobId: string;
  readonly job: CodeitlabShortsJob | undefined;
  readonly error: string | undefined;
  readonly copied: string | null;
  readonly onCopy: (key: string, value: string) => void;
  readonly onRetry: () => void;
}) {
  const job = props.job;
  if (job === undefined) {
    return (
      <CodeitlabCard data-shorts-job data-shorts-job-id={props.jobId}>
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="font-mono text-xs text-foreground">{props.jobId}</p>
          {props.error === undefined ? (
            <p className="text-xs text-muted-foreground">Reading this job…</p>
          ) : (
            <>
              <p className="text-xs text-error-foreground">{props.error}</p>
              <Button size="sm" variant="outline" onClick={props.onRetry}>
                Retry
              </Button>
            </>
          )}
        </div>
      </CodeitlabCard>
    );
  }

  const logs = tailShortsLogs(job.logs);
  return (
    <CodeitlabCard data-shorts-job data-shorts-job-id={job.jobId} data-shorts-job-state={job.state}>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-foreground">{job.jobId}</span>
            <Badge size="sm" variant={shortsStateVariant(job.state)}>
              {shortsStateLabel(job.state)}
            </Badge>
            {job.partial === true ? (
              <Badge size="sm" variant="warning">
                partial
              </Badge>
            ) : null}
          </div>
          {job.queuePosition === undefined ? null : (
            <span className="text-2xs text-muted-foreground" data-shorts-queue>
              Queue position {job.queuePosition}
            </span>
          )}
        </div>

        {job.state === "unknown" ? (
          <p className="text-xs text-warning-foreground">
            {shortsUnknownStateExplanation(job.engineStatus)}
          </p>
        ) : null}
        {job.engineStatus === undefined || job.state === "unknown" ? null : (
          <p className="text-2xs text-muted-foreground">Engine status: {job.engineStatus}</p>
        )}
        {job.detail === undefined ? null : (
          <p className="text-xs text-muted-foreground">{job.detail}</p>
        )}

        {logs.length === 0 ? null : (
          <details className="rounded-lg border border-border/60 bg-muted/20" data-shorts-logs>
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
              Log · last {logs.length} lines
            </summary>
            <pre className="max-h-48 overflow-auto px-3 pb-3 font-mono text-2xs leading-relaxed text-foreground/80">
              {logs.join("\n")}
            </pre>
          </details>
        )}

        {job.clips.length === 0 ? null : (
          <ul className="flex flex-col gap-2">
            {job.clips.map((clip, index) => {
              const duration = formatClipDuration(clip);
              return (
                <li
                  key={`${job.jobId}:${clip.title}:${clip.startSeconds ?? ""}:${clip.endSeconds ?? ""}`}
                  className="flex flex-col gap-2 rounded-lg border border-border/60 px-3 py-2"
                  data-shorts-clip
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{clip.title}</span>
                    {duration === null ? null : (
                      <span className="text-2xs text-muted-foreground">{duration}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {clip.videoUrl === undefined ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <a
                            href={clip.videoUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            data-shorts-clip-open
                          />
                        }
                      >
                        <ExternalLinkIcon className="size-3.5" />
                        Open clip
                      </Button>
                    )}
                    <ClipCopyButton
                      label="YouTube title"
                      value={clip.youtubeTitle}
                      copied={props.copied === `${job.jobId}:${index}:youtube`}
                      onCopy={() =>
                        props.onCopy(`${job.jobId}:${index}:youtube`, clip.youtubeTitle ?? "")
                      }
                    />
                    <ClipCopyButton
                      label="TikTok caption"
                      value={clip.tiktokDescription}
                      copied={props.copied === `${job.jobId}:${index}:tiktok`}
                      onCopy={() =>
                        props.onCopy(`${job.jobId}:${index}:tiktok`, clip.tiktokDescription ?? "")
                      }
                    />
                    <ClipCopyButton
                      label="Instagram caption"
                      value={clip.instagramDescription}
                      copied={props.copied === `${job.jobId}:${index}:instagram`}
                      onCopy={() =>
                        props.onCopy(
                          `${job.jobId}:${index}:instagram`,
                          clip.instagramDescription ?? "",
                        )
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </CodeitlabCard>
  );
}

function ClipCopyButton(props: {
  readonly label: string;
  readonly value: string | undefined;
  readonly copied: boolean;
  readonly onCopy: () => void;
}) {
  if (props.value === undefined || props.value.trim().length === 0) return null;
  return (
    <Button size="sm" variant="ghost" onClick={props.onCopy}>
      {props.copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {props.label}
    </Button>
  );
}
