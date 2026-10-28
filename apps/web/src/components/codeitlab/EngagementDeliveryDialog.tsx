import {
  DELIVERY_MAX_EVIDENCE,
  DELIVERY_NOTE_MAX_LENGTH,
  deliveryEvidenceProblem,
  deliveryNoteProblem,
  formatEngagementAmount,
  type CodeItLabDeliveryHandoff,
} from "@codeitlab/contracts";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

import {
  engagementStatusLabel,
  useEngagementDelivery,
  type CodeItLabEngagementDeliveryView,
} from "../../codeitlab/engagements";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Textarea } from "../ui/textarea";

/**
 * Two dialogs can be mounted at once (a stale one from a slow unmount, or the
 * settings page and the composer), and duplicate ids would break every
 * `htmlFor` in the second one, so labels and regions get per-instance ids.
 */

/** One URL per line; the marketplace stores at most five and dedupes them. */
function evidenceLines(raw: string): ReadonlyArray<string> {
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function candidatesOf(delivery: CodeItLabEngagementDeliveryView) {
  return delivery.engagements.filter(
    (engagement) => engagement.role === "coder" && engagement.status === "in_progress",
  );
}

/**
 * The reviewed delivery flow. The server reads the thread's git state and drafts
 * a note from the facts it can prove; the coder reviews and edits it, optionally
 * swaps in the longer client-facing handoff, and presses Deliver. Nothing is
 * sent before that press, and a refusal is reported verbatim instead of retried.
 */
export function EngagementDeliveryDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
}) {
  const delivery = useEngagementDelivery(props.threadId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [attemptedId, setAttemptedId] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<CodeItLabDeliveryHandoff | null>(null);
  const [explanation, setExplanation] = useState("");
  const idPrefix = useId();
  const noteId = idPrefix + "-delivery-note";
  const evidenceId = idPrefix + "-delivery-evidence";
  const explanationId = idPrefix + "-delivery-explanation";
  const pickId = idPrefix + "-delivery-pick";
  const attachId = idPrefix + "-delivery-attach";
  const reviewId = idPrefix + "-delivery-review";
  const reasonId = idPrefix + "-delivery-reason";

  const bridge = delivery.bridge;
  const candidates = candidatesOf(delivery);
  const selected = candidates.find((engagement) => engagement.id === selectedId) ?? null;
  const draft =
    delivery.draft !== null && delivery.draft.engagementId === selectedId ? delivery.draft : null;
  const lines = evidenceLines(evidence);
  const noteProblem = deliveryNoteProblem(note);
  const evidenceProblem = deliveryEvidenceProblem(lines);
  const delivered = delivery.lastResult?.delivered === true;

  const disabledReason = delivery.deliverPending
    ? "Sending the delivery…"
    : bridge === null
      ? "Waiting for the marketplace bridge to answer."
      : draft === null
        ? "Attach this thread's work first."
        : noteProblem !== ""
          ? noteProblem
          : evidenceProblem !== ""
            ? evidenceProblem
            : null;

  const select = (value: string) => {
    setSelectedId(value);
    setNote("");
    setEvidence("");
    setNotice(null);
    setHandoff(null);
    setExplanation("");
  };

  const explain = async () => {
    if (selected === null || draft === null) return;
    setNotice(null);
    const result = await delivery.loadHandoff(
      selected.id,
      selected.jobTitle,
      formatEngagementAmount(selected.amountCents, selected.currency),
    );
    if (result === null) {
      setNotice("The server did not answer, so there is no explanation to review.");
      return;
    }
    setHandoff(result);
    setExplanation(result.body);
    if (!result.generated && result.reason !== "") setNotice(result.reason);
  };

  const attach = async () => {
    if (selected === null) return;
    setNotice(null);
    const next = await delivery.loadDraft(
      selected.id,
      selected.jobTitle,
      formatEngagementAmount(selected.amountCents, selected.currency),
    );
    if (next === null) {
      setNotice("The server did not answer, so there is no draft to review.");
      return;
    }
    setNote(next.note);
    setEvidence("");
  };

  const submit = async () => {
    if (selected === null || draft === null || disabledReason !== null) return;
    setNotice(null);
    setAttemptedId(selected.id);
    const result = await delivery.deliver(selected.id, note.trim(), lines);
    if (result === null) setNotice("The server did not answer, so nothing was delivered.");
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) {
          setHandoff(null);
          setExplanation("");
          props.onOpenChange(false);
        }
      }}
    >
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Deliver to the marketplace</DialogTitle>
          <DialogDescription>
            The note is drafted from this thread's git state and sent only when you press Deliver.
            The marketplace holds the money and owns the status.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {bridge === null ? (
            <p className="text-sm text-muted-foreground">Reading the marketplace bridge…</p>
          ) : bridge.readOnly ? (
            <div
              className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/32 px-3 py-2"
              data-delivery-readonly=""
            >
              <Badge className="self-start" size="sm" variant="warning">
                Read-only
              </Badge>
              <p className="text-sm text-muted-foreground" data-delivery-readonly-reason="">
                {bridge.reason}
              </p>
              <Link
                className="self-start text-sm underline underline-offset-2"
                to="/settings/codeitlab/engagements"
              >
                Open the engagements settings
              </Link>
            </div>
          ) : delivered ? (
            <div
              className="flex flex-col gap-1 rounded-lg border border-success/30 bg-success/8 px-3 py-2"
              data-delivery-result="delivered"
              role="status"
            >
              <p className="text-sm font-medium">Delivered. Waiting for the business to approve.</p>
              {delivery.lastResult?.engagement == null ? null : (
                <p className="text-xs text-muted-foreground">
                  Marketplace status: {engagementStatusLabel(delivery.lastResult.engagement.status)}
                  .
                </p>
              )}
            </div>
          ) : (
            <>
              <section className="flex flex-col gap-2" aria-labelledby={pickId}>
                <h3 className="text-sm font-medium" id={pickId}>
                  Which engagement is this delivery for?
                </h3>
                {delivery.isPending ? (
                  <p className="text-sm text-muted-foreground">Reading your engagements…</p>
                ) : candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No engagement is waiting for a delivery right now.
                  </p>
                ) : (
                  <RadioGroup
                    aria-label="Engagements waiting for a delivery"
                    onValueChange={(value) => {
                      if (typeof value === "string") select(value);
                    }}
                    value={selectedId ?? ""}
                  >
                    {candidates.map((engagement) => (
                      <label
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3 py-2"
                        key={engagement.id}
                      >
                        <Radio
                          aria-label={engagement.jobTitle + " — " + engagement.counterpartName}
                          className="mt-0.5"
                          value={engagement.id}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {engagement.jobTitle}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {engagement.counterpartName} ·{" "}
                            {formatEngagementAmount(engagement.amountCents, engagement.currency)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                )}
                {delivery.error === null ? null : (
                  <p className="text-sm text-warning-foreground">{delivery.error}</p>
                )}
              </section>

              {selected === null ? null : (
                <section className="flex flex-col gap-2" aria-labelledby={attachId}>
                  <h3 className="text-sm font-medium" id={attachId}>
                    Attach work from this thread
                  </h3>
                  <Button
                    className="self-start"
                    disabled={delivery.draftPending}
                    onClick={() => void attach()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {delivery.draftPending ? "Reading the thread…" : "Attach work from this thread"}
                  </Button>
                  {draft === null || draft.reason === "" ? null : (
                    <p className="text-xs text-warning-foreground" data-delivery-draft-reason="">
                      {draft.reason}
                    </p>
                  )}
                </section>
              )}

              {delivery.lastResult !== null &&
              !delivery.lastResult.delivered &&
              attemptedId === selectedId ? (
                <p
                  className="rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-sm text-warning-foreground"
                  data-delivery-result="refused"
                  role="status"
                >
                  {delivery.lastResult.reason}
                </p>
              ) : null}

              {draft === null ? null : (
                <section className="flex flex-col gap-3" aria-labelledby={reviewId}>
                  <h3 className="text-sm font-medium" id={reviewId}>
                    Review the delivery
                  </h3>
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {draft.fileCount} file(s) changed · +{draft.insertions} −{draft.deletions}
                      {draft.branch === null || draft.branch === "" ? "" : " · " + draft.branch}
                    </p>
                    {draft.files.length === 0 ? null : (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {draft.files.slice(0, 8).map((file) => (
                          <li
                            className="flex items-baseline justify-between gap-2 text-2xs"
                            key={file.path}
                          >
                            <span className="truncate font-mono">{file.path}</span>
                            <span className="shrink-0 text-muted-foreground tabular-nums">
                              +{file.insertions} −{file.deletions}
                            </span>
                          </li>
                        ))}
                        {draft.files.length > 8 ? (
                          <li className="text-2xs text-muted-foreground">
                            … and {draft.files.length - 8} more file(s)
                          </li>
                        ) : null}
                      </ul>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={noteId}>Delivery note</Label>
                    <Textarea
                      id={noteId}
                      maxLength={DELIVERY_NOTE_MAX_LENGTH}
                      onChange={(event) => setNote(event.target.value)}
                      rows={6}
                      value={note}
                    />
                    <p className="text-xs text-muted-foreground">
                      Drafted from the thread's git state; edit anything before sending. The app
                      does not record test results.
                    </p>
                  </div>
                  <Button
                    aria-busy={delivery.handoffPending}
                    className="self-start"
                    disabled={delivery.handoffPending || draft === null || !props.open}
                    onClick={() => void explain()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {delivery.handoffPending
                      ? "Writing the explanation…"
                      : "Explain this delivery to the client"}
                  </Button>
                  {handoff === null ? null : (
                    <div className="flex flex-col gap-2" data-delivery-handoff="">
                      {handoff.generated && handoff.model !== null ? (
                        <p
                          className="font-mono text-2xs text-muted-foreground"
                          data-delivery-handoff-model=""
                        >
                          Written by {handoff.model}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground" data-delivery-handoff-summary="">
                        {handoff.summary}
                      </p>
                      <div className="grid gap-1.5">
                        <Label htmlFor={explanationId}>Client explanation</Label>
                        <Textarea
                          id={explanationId}
                          onChange={(event) => setExplanation(event.target.value)}
                          rows={10}
                          value={explanation}
                        />
                      </div>
                      <Button
                        className="self-start"
                        onClick={() => setNote(explanation)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Use this text
                      </Button>
                    </div>
                  )}
                  <div className="grid gap-1.5">
                    <Label htmlFor={evidenceId}>Evidence links</Label>
                    <Textarea
                      id={evidenceId}
                      mono
                      onChange={(event) => setEvidence(event.target.value)}
                      rows={3}
                      value={evidence}
                    />
                    <p className="text-xs text-muted-foreground">
                      One full http(s) URL per line, at most {DELIVERY_MAX_EVIDENCE}: a pull
                      request, a deploy or a test run. The app does not record test results.
                    </p>
                  </div>
                </section>
              )}
            </>
          )}

          {notice === null ? null : (
            <p className="text-sm text-warning-foreground" role="status">
              {notice}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            This app does not hold money, does not mediate and does not decide a release. The
            marketplace owns the status, the amount and the payout.
          </p>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button onClick={() => props.onOpenChange(false)} type="button" variant="outline">
            Close
          </Button>
          {bridge === null || bridge.readOnly || delivered ? null : (
            <Button
              aria-describedby={disabledReason === null ? undefined : reasonId}
              disabled={disabledReason !== null}
              onClick={() => void submit()}
              type="button"
            >
              {delivery.deliverPending ? "Delivering…" : "Deliver"}
            </Button>
          )}
        </DialogFooter>
        <p aria-live="polite" className="px-6 pb-4 text-xs text-muted-foreground" id={reasonId}>
          {bridge === null || bridge.readOnly || delivered
            ? ""
            : (disabledReason ??
              "Ready. Pressing Deliver sends the note and evidence to the marketplace.")}
        </p>
      </DialogPopup>
    </Dialog>
  );
}
