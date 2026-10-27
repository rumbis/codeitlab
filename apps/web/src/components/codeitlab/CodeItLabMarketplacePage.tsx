import { useRef, useState } from "react";
import { SendIcon } from "lucide-react";

import { useCodeItLabEngagementApplyToJob } from "../../codeitlab/engagements";
import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CodeItLabCard, CodeItLabEmptyBlock, CodeItLabSectionHeading } from "./CodeItLabPrimitives";

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

/**
 * The marketplace is a separate server-rendered deployment, not a route inside
 * this app. The panel therefore only stores where it lives and says plainly
 * when that is not configured yet.
 */
export function CodeItLabMarketplacePage() {
  const { codeitlab, environmentId, update } = useCodeItLabSettingsWriter();
  const url = codeitlab.marketplace.url;
  const ready = isHttpUrl(url);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const applyToJob = useCodeItLabEngagementApplyToJob(environmentId);
  const [jobId, setJobId] = useState("");
  const [applyMessage, setApplyMessage] = useState("");
  const [applyStatus, setApplyStatus] = useState<{
    applied: boolean;
    reason?: string | undefined;
  } | null>(null);
  const [applying, setApplying] = useState(false);

  const handleApply = async () => {
    if (!ready || !jobId.trim()) {
      setApplyStatus({ applied: false, reason: "Set the marketplace URL and a job ID first." });
      return;
    }
    setApplying(true);
    setApplyStatus(null);
    try {
      const message = applyMessage.trim();
      const result = await applyToJob({
        jobId: jobId.trim(),
        ...(message === "" ? {} : { message }),
      });
      setApplyStatus(result ?? { applied: false, reason: "No response from server." });
    } catch {
      setApplyStatus({ applied: false, reason: "Failed to apply to job." });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="marketplace">
      <CodeItLabSectionHeading
        description="The marketplace runs as its own deployment. Point the app at it here; the panel never pretends the marketplace is hosted inside CodeItLab."
        eyebrow="CodeItLab // marketplace"
        title="Marketplace"
      />

      {ready ? null : (
        <CodeItLabEmptyBlock
          action={
            <Button
              onClick={() => urlInputRef.current?.focus()}
              size="sm"
              type="button"
              variant="outline"
            >
              Paste the marketplace address
            </Button>
          }
          description="The marketplace is a separate deployment: escrow, fees and jobs live there, not in this app. Deploy it (the repository's DEPLOY-MARKETPLACE guide) or paste the address of a marketplace you already run. Nothing opens until an http(s) address is saved."
          title="Nothing to open yet"
        />
      )}

      <CodeItLabCard className="flex flex-col gap-2 p-4">
        <h3 className="text-sm font-medium">What the marketplace charges, in plain numbers</h3>
        <ul className="text-muted-foreground flex list-disc flex-col gap-1 ps-4 text-xs">
          <li>
            <span className="tabular-nums">15%</span> platform fee on a self-serve job;{" "}
            <span className="tabular-nums">20%</span> when the platform assists with matching.
          </li>
          <li>Payment sits in escrow until the buyer approves the delivery, then pays out.</li>
          <li>All amounts are integer cents, so no rounding drifts between quote and payout.</li>
          <li>
            A cancelled job is refunded in full; a fee is only recorded when work is approved.
          </li>
          <li>Payments are handled by that deployment, not by this app.</li>
        </ul>
      </CodeItLabCard>

      <CodeItLabCard className="flex flex-col gap-2 p-4">
        <h3 className="text-sm font-medium">What each escrow state means</h3>
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="font-medium">requested</dt>
            <dd className="text-muted-foreground">You asked; nothing has moved yet.</dd>
          </div>
          <div>
            <dt className="font-medium">accepted</dt>
            <dd className="text-muted-foreground">
              The practitioner agreed; the job is ready to start.
            </dd>
          </div>
          <div>
            <dt className="font-medium">in_progress</dt>
            <dd className="text-muted-foreground">
              Work is happening; the payment stays in escrow.
            </dd>
          </div>
          <div>
            <dt className="font-medium">delivered</dt>
            <dd className="text-muted-foreground">
              Work was handed over and waits for the buyer's approval.
            </dd>
          </div>
          <div>
            <dt className="font-medium">approved</dt>
            <dd className="text-muted-foreground">
              The buyer approved; the payout and the fee are recorded.
            </dd>
          </div>
          <div>
            <dt className="font-medium">paid_out</dt>
            <dd className="text-muted-foreground">The practitioner has received the money.</dd>
          </div>
          <div>
            <dt className="font-medium">cancelled</dt>
            <dd className="text-muted-foreground">
              The job ended and the charge was refunded in full.
            </dd>
          </div>
          <div>
            <dt className="font-medium">disputed</dt>
            <dd className="text-muted-foreground">
              Buyer and practitioner disagree; the money stays in escrow until it is resolved.
            </dd>
          </div>
        </dl>
        <p className="text-2xs text-muted-foreground">
          These are the states the marketplace deployment actually stores; this panel only explains
          them.
        </p>
      </CodeItLabCard>

      <CodeItLabCard className="flex flex-col gap-2 p-4">
        <h3 className="text-sm font-medium">What you agree to before the money moves</h3>
        <ul className="text-muted-foreground flex list-disc flex-col gap-1 ps-4 text-xs">
          <li>
            The job post carries the description, skills, timeline and a budget range; the
            engagement amount has to sit inside that range.
          </li>
          <li>
            A job can have one active engagement at a time, so two buyers cannot both fund it.
          </li>
          <li>
            An assisted job (the 20% tier) is scoped, shortlisted and evidence-reviewed by an
            operator; it cannot be charged at the self-serve tier.
          </li>
          <li>
            Nothing is captured until the engagement starts, and the amount is in integer cents
            before any provider is called.
          </li>
        </ul>
      </CodeItLabCard>

      <CodeItLabCard className="flex flex-col gap-2 p-4">
        <h3 className="text-sm font-medium">If something goes wrong</h3>
        <ul className="text-muted-foreground flex list-disc flex-col gap-1 ps-4 text-xs">
          <li>
            Raise a dispute from the engagement while it is still in escrow; the money is not paid
            out in the meantime.
          </li>
          <li>
            An operator of that deployment resolves it with a written reason, so the decision has an
            audit trail you can read.
          </li>
          <li>
            The outcome is either <span className="font-medium">refunded</span> to the business or{" "}
            <span className="font-medium">released</span> to the practitioner - never both.
          </li>
          <li>This app does not mediate, hold money, or decide disputes.</li>
        </ul>
      </CodeItLabCard>

      <CodeItLabCard className="flex flex-col gap-3 p-4">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="marketplace-url">
          Marketplace URL
        </label>
        <Input
          ref={urlInputRef}
          aria-describedby="marketplace-url-help"
          aria-invalid={url.trim() !== "" && !ready}
          id="marketplace-url"
          onChange={(event) =>
            update({ marketplace: { ...codeitlab.marketplace, url: event.currentTarget.value } })
          }
          placeholder="https://market.example.com"
          value={url}
        />
        <p
          aria-live="polite"
          className={
            url.trim() !== "" && !ready
              ? "text-2xs text-destructive"
              : "text-2xs text-muted-foreground"
          }
          id="marketplace-url-help"
        >
          {url.trim() === ""
            ? "Not configured. The marketplace is not part of this app bundle, so there is nothing to open until you deploy it and paste the address here."
            : ready
              ? "Configured. Opening it leaves CodeItLab and uses your browser."
              : "That is not an http(s) address, so nothing will open. Paste the full URL, including https://."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            aria-describedby="marketplace-url-help"
            disabled={!ready}
            onClick={() => {
              if (ready) window.open(url, "_blank", "noopener,noreferrer");
            }}
            size="sm"
            type="button"
          >
            Open marketplace
          </Button>
        </div>
        <p className="text-2xs text-muted-foreground">
          Escrow, fees and jobs live in the marketplace deployment; this panel only stores the
          address. Nothing is proxied through the app.
        </p>
      </CodeItLabCard>

      <CodeItLabCard className="flex flex-col gap-2 p-4">
        <h3 className="text-sm font-medium">Apply to jobs</h3>
        <p className="text-xs text-muted-foreground">
          Apply to marketplace jobs from a connected business environment. Configure the marketplace
          URL and token in Engagements first.
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            placeholder="Job ID"
            className="sm:max-w-xs"
          />
          <Input
            value={applyMessage}
            onChange={(event) => setApplyMessage(event.target.value)}
            placeholder="Message (optional)"
            className="flex-1"
          />
          <Button disabled={!ready || applying} onClick={handleApply} size="sm" type="button">
            <SendIcon className="mr-1 size-3.5" />
            {applying ? "Applying..." : "Apply"}
          </Button>
        </div>
        {applyStatus ? (
          <p
            className={`text-xs ${applyStatus.applied ? "text-codeitlab-green" : "text-destructive"}`}
          >
            {applyStatus.applied ? "Applied to job." : applyStatus.reason || "Failed to apply."}
          </p>
        ) : null}
      </CodeItLabCard>
    </div>
  );
}
