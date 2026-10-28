import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import {
  codeitlabEcosystemStatusQuery,
  codeitlabIntegrationsListQuery,
  codeitlabMemoryStatsQuery,
  codeitlabNexusCatalogQuery,
  codeitlabPolicyEffectiveQuery,
  codeitlabReaStatusQuery,
  codeitlabRoutingCatalogQuery,
} from "../../state/codeitlab";
import { useEnvironmentQuery } from "../../state/query";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "../settings/components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import {
  useSettingsEnvironmentFilter,
  type SettingsTarget,
} from "../settings/settings-environment-filter";

/**
 * Read-only CodeItLab status for mobile. Tuning stays on web/desktop; this screen
 * answers "what is the harness doing right now" from a phone without porting the
 * nine-tab panel.
 */
export function CodeItLabStatusScreen() {
  const insets = useSafeAreaInsets();
  const { selectedTargets } = useSettingsEnvironmentFilter();

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="CodeItLab" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-4 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedTargets.length === 0 ? (
            <EmptyState
              title="No environment connected"
              detail="Connect an environment to see its CodeItLab status."
            />
          ) : (
            selectedTargets.map((environment) => (
              <EnvironmentStatus key={environment.environmentId} environment={environment} />
            ))
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function EnvironmentStatus({ environment }: { readonly environment: SettingsTarget }) {
  const environmentId = environment.environmentId;
  const nexus = useEnvironmentQuery(codeitlabNexusCatalogQuery({ environmentId, input: {} }));
  const memory = useEnvironmentQuery(codeitlabMemoryStatsQuery({ environmentId, input: {} }));
  const routing = useEnvironmentQuery(codeitlabRoutingCatalogQuery({ environmentId, input: {} }));
  const policy = useEnvironmentQuery(codeitlabPolicyEffectiveQuery({ environmentId, input: {} }));
  const rea = useEnvironmentQuery(codeitlabReaStatusQuery({ environmentId, input: {} }));
  const ecosystem = useEnvironmentQuery(
    codeitlabEcosystemStatusQuery({ environmentId, input: {} }),
  );
  const integrations = useEnvironmentQuery(
    codeitlabIntegrationsListQuery({ environmentId, input: {} }),
  );

  const queries = [nexus, memory, routing, policy, rea, ecosystem, integrations];
  const loading = queries.every((query) => query.data === null && query.error === null);
  const failed = queries.every((query) => query.data === null && query.error !== null);

  if (failed) {
    const message = queries.find((query) => query.error !== null)?.error;
    return (
      <EmptyState
        title="Can't reach this environment"
        detail={message ?? "The environment did not answer the CodeItLab status requests."}
        actionLabel="Retry"
        onAction={() => {
          for (const query of queries) query.refresh();
        }}
      />
    );
  }

  if (loading) {
    return (
      <View className="items-center gap-3 py-10">
        <AppActivityIndicator />
        <Text className="text-foreground-muted">Reading harness status…</Text>
      </View>
    );
  }

  const providers = nexus.data?.providers.length;
  const skills = nexus.data?.skills.length;
  const mcpServers = nexus.data?.mcpServers.length;
  const sessions = nexus.data?.sessions.length;
  const healthChecks = rea.data?.health ?? [];
  const passingChecks = healthChecks.filter((check) => check.ok).length;
  const ecosystemWarnings =
    ecosystem.data === null
      ? []
      : [
          ...ecosystem.data.warnings,
          ...ecosystem.data.integrations.flatMap((integration) => integration.warnings),
        ];

  return (
    <SettingsSection
      title={environment.label}
      footer="Read-only status from the connected environment."
    >
      <StatusRow
        label="Providers"
        value={providers === undefined ? unavailable(nexus) : `${providers}`}
      />
      <StatusRow label="Skills" value={skills === undefined ? unavailable(nexus) : `${skills}`} />
      <StatusRow
        label="MCP servers"
        value={mcpServers === undefined ? unavailable(nexus) : `${mcpServers}`}
      />
      <StatusRow
        label="Sessions"
        value={sessions === undefined ? unavailable(nexus) : `${sessions}`}
      />
      <StatusRow
        label="Memory entries"
        value={memory.data === null ? unavailable(memory) : `${memory.data.total}`}
        description={
          memory.data === null
            ? undefined
            : `${memory.data.project} project · ${memory.data.global} global`
        }
      />
      <StatusRow
        label="Routing mode"
        value={routing.data === null ? unavailable(routing) : routing.data.mode}
      />
      <StatusRow
        label="Policy profile"
        value={policy.data === null ? unavailable(policy) : policy.data.profile}
      />
      <StatusRow
        label="REA"
        value={
          rea.data === null
            ? unavailable(rea)
            : rea.data.installed
              ? `v${rea.data.version}`
              : "not installed"
        }
        description={
          healthChecks.length === 0
            ? undefined
            : `${passingChecks}/${healthChecks.length} health checks passing`
        }
      />
      {ecosystem.data === null ? (
        <StatusRow label="Ecosystem" value={unavailable(ecosystem)} />
      ) : (
        ecosystem.data.integrations.map((integration) => (
          <ListRowLayout
            key={integration.id}
            label={integration.name}
            description={`${integration.kind === "mcp" ? "MCP" : "Policy pack"} · ${
              integration.enabled ? "enabled" : "disabled"
            }`}
            detail={`${integration.mode}${integration.version === undefined ? "" : ` · v${integration.version}`}`}
          />
        ))
      )}
      {integrations.data === null ? (
        <StatusRow label="Integrations" value={unavailable(integrations)} />
      ) : (
        integrations.data.integrations.map((integration) => (
          <ListRowLayout
            key={integration.id}
            label={integration.name}
            description={`${integration.engine} · ${integration.enabled ? "enabled" : "disabled"}`}
            detail={integrationStateLabel(integration.state)}
          />
        ))
      )}
      {ecosystemWarnings.length === 0 ? null : (
        <View className="gap-1 border-t border-separator px-4 py-3">
          {ecosystemWarnings.map((warning) => (
            <Text key={warning} textRole="footnote" className="text-warning-foreground">
              {warning}
            </Text>
          ))}
        </View>
      )}
    </SettingsSection>
  );
}

function StatusRow(props: {
  readonly label: string;
  readonly value: string;
  readonly description?: string | undefined;
}) {
  return <ListRowLayout label={props.label} description={props.description} detail={props.value} />;
}

const INTEGRATION_STATE_LABELS = {
  ready: "ready",
  unreachable: "unreachable",
  "not-configured": "not configured",
  disabled: "disabled",
} as const;

function integrationStateLabel(state: keyof typeof INTEGRATION_STATE_LABELS): string {
  return INTEGRATION_STATE_LABELS[state];
}

function unavailable(query: { readonly error: string | null }): string {
  return query.error === null ? "…" : "Unavailable";
}
