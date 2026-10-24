import { profileBrief, profileIsEmpty } from "@codeitlab/core/profile";

import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import { Textarea } from "../ui/textarea";
import { CodeitlabCard, CodeitlabEmptyBlock, CodeitlabSectionHeading } from "./CodeitlabPrimitives";

/**
 * The declaration a person makes about their own work: what they want to build
 * and what they can already do. It is stored locally, written only by the human,
 * and labelled as declared context when it reaches an agent.
 */
export function CodeitlabProfilePage() {
  const { codeitlab, update } = useCodeitlabSettingsWriter();
  const profile = codeitlab.profile;
  const brief = profileBrief(profile);

  const patch = (next: Partial<typeof profile>) => {
    update({ profile: { ...profile, ...next } });
  };

  return (
    <div className="flex flex-col gap-6">
      <CodeitlabSectionHeading
        description="Say what you want the work to be about and what you can already do. Bot briefs carry it as declared context, and you can paste it into a marketplace job brief; nothing here is inferred, uploaded, or filled in for you."
        eyebrow="CodeItLab // profile"
        title="Profile"
      />

      <CodeitlabCard className="flex flex-col gap-4 p-4">
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
        <p className="text-2xs text-muted-foreground" aria-live="polite">
          {profileIsEmpty(profile)
            ? "Nothing declared yet. Empty fields are simply left out of briefs."
            : "Saved on this machine. The marketplace only sees this if you paste it into a job brief."}
        </p>
      </CodeitlabCard>

      {brief.length === 0 ? (
        <CodeitlabEmptyBlock
          title="No brief context yet"
          description="Fill either field above and this block shows the exact lines an agent would receive."
        />
      ) : (
        <CodeitlabCard className="flex flex-col gap-2 p-4">
          <p className="text-xs font-medium">What an agent would receive</p>
          <pre className="text-muted-foreground overflow-x-auto text-xs whitespace-pre-wrap">
            {brief.filter((line) => line !== "").join("\n")}
          </pre>
        </CodeitlabCard>
      )}
    </div>
  );
}
