import { profileBrief, profileIsEmpty } from "@codeitlab/core/profile";
import { CopyIcon } from "lucide-react";

import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { CodeItLabCard, CodeItLabEmptyBlock, CodeItLabSectionHeading } from "./CodeItLabPrimitives";

/**
 * The declaration a person makes about their own work: what they want to build
 * and what they can already do. It is stored locally, written only by the human,
 * and labelled as declared context when it reaches an agent.
 */
export function CodeItLabProfilePage() {
  const { codeitlab, update } = useCodeItLabSettingsWriter();
  const profile = codeitlab.profile;
  const brief = profileBrief(profile);

  const patch = (next: Partial<typeof profile>) => {
    update({ profile: { ...profile, ...next } });
  };

  // The brief is the only thing that leaves this machine, and only when the user
  // copies it; there is no upload behind this button.
  const copyBrief = async () => {
    const text = brief.filter((line) => line !== "").join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toastManager.add({
        type: "success",
        title: "Brief copied",
        description: "Paste it into a marketplace job brief or a bot brief.",
      });
    } catch {
      toastManager.add({
        type: "error",
        title: "Clipboard is not available",
        description: "Select the text in the preview and copy it manually.",
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <CodeItLabSectionHeading
        description="Say what you want the work to be about and what you can already do. Bot briefs carry it as declared context, and you can paste it into a marketplace job brief; nothing here is inferred, uploaded, or filled in for you."
        eyebrow="CodeItLab // profile"
        title="Profile"
        action={
          <Button
            aria-describedby="profile-brief-state"
            disabled={brief.length === 0}
            onClick={() => void copyBrief()}
            size="sm"
            variant="outline"
          >
            <CopyIcon className="size-3.5" /> Copy brief
          </Button>
        }
      />

      <CodeItLabCard className="flex flex-col gap-4 p-4">
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
        <p aria-live="polite" className="text-2xs text-muted-foreground" id="profile-brief-state">
          {profileIsEmpty(profile)
            ? "Nothing declared yet. Empty fields are left out of briefs, and Copy brief stays disabled until one has text."
            : "Saved on this machine. The marketplace only sees this if you paste it into a job brief."}
        </p>
      </CodeItLabCard>

      {brief.length === 0 ? (
        <CodeItLabEmptyBlock
          title="No brief context yet"
          description="Fill either field above and this block shows the exact lines an agent would receive."
        />
      ) : (
        <CodeItLabCard className="flex flex-col gap-2 p-4">
          <p className="text-xs font-medium">What an agent would receive</p>
          <pre className="text-muted-foreground overflow-x-auto text-xs whitespace-pre-wrap">
            {brief.filter((line) => line !== "").join("\n")}
          </pre>
        </CodeItLabCard>
      )}
    </div>
  );
}
