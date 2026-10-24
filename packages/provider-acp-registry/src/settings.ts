import {
  CustomModelSetting,
  TrimmedString,
  makeBinaryPathSetting,
  makeProviderSettingsSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const AcpRegistryDistributionPreference = Schema.Literals(["auto", "binary", "npx", "uvx"]);
export type AcpRegistryDistributionPreference = typeof AcpRegistryDistributionPreference.Type;

export const AcpRegistrySettings = makeProviderSettingsSchema(
  {
    source: Schema.Literals(["registry", "local"]).pipe(
      Schema.withDecodingDefault(Effect.succeed("registry")),
      Schema.annotateKey({
        title: "ACP source",
        providerSettingsForm: {
          control: "select",
          options: [
            { value: "registry", label: "ACP Registry" },
            { value: "local", label: "Local command" },
          ],
        },
      }),
    ),
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    agentId: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Registry agent ID",
        description: "Agent identifier from the official ACP Registry, for example 'devin'.",
        providerSettingsForm: { placeholder: "devin", clearWhenEmpty: "persist" },
      }),
    ),
    commandPath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Executable override",
        description:
          "Executable on this environment. For registry agents, this overrides the distribution executable while keeping its arguments and environment.",
        providerSettingsForm: { placeholder: "Registry default", clearWhenEmpty: "omit" },
      }),
    ),
    commandArgs: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    authMethodId: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Authentication method",
        description:
          "Optional ACP authentication method ID. By default, the first agent-managed method is selected.",
        providerSettingsForm: { placeholder: "auto", clearWhenEmpty: "omit" },
      }),
    ),
    distribution: AcpRegistryDistributionPreference.pipe(
      Schema.withDecodingDefault(Effect.succeed("auto")),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    /** Extra environment for a local command (custom ACP agents carry their own env). */
    env: Schema.Record(Schema.String, Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed({})),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    /**
     * Give this instance its own credential store (HOME/XDG under the state
     * dir) so a second account of the same OAuth agent can sign in separately.
     */
    accountProfile: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["source", "agentId", "commandPath", "authMethodId"],
  },
);
export type AcpRegistrySettings = typeof AcpRegistrySettings.Type;

/**
 * Hermes Agent runs as a local ACP command (`hermes acp`). It is a first-class
 * driver instead of a hand-configured ACP Registry instance so the provider
 * list, settings form and default instance exist without setup, but its config
 * is a thin translation of {@link AcpRegistrySettings}: the generic local ACP
 * runtime owns spawning, authentication, models and session management.
 */
export const HermesSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("hermes").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description:
          "Path to the Hermes CLI. Hermes is launched as `<binary> acp`, so the default resolves `hermes` on PATH.",
        providerSettingsForm: { placeholder: "hermes", clearWhenEmpty: "omit" },
      }),
    ),
    acpSubcommand: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({
        title: "Use `acp` subcommand",
        description:
          "Keep this on for the `hermes` CLI. Turn it off when the path points at a standalone `hermes-acp` binary, which starts ACP mode without arguments.",
        providerSettingsForm: { control: "switch" },
      }),
    ),
    acceptHooks: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({
        title: "Accept shell hooks",
        description:
          "Pass --accept-hooks so Hermes auto-approves unseen shell hooks instead of waiting for a TTY prompt.",
        providerSettingsForm: { control: "switch" },
      }),
    ),
    authMethodId: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "acpSubcommand", "acceptHooks"],
  },
);
export type HermesSettings = typeof HermesSettings.Type;

export const DEFAULT_HERMES_SETTINGS: HermesSettings = Schema.decodeSync(HermesSettings)({});

/**
 * Translate the Hermes form into the generic local-ACP config. Kept pure so
 * the spawn arguments are testable without starting Hermes.
 */
export function hermesAcpSettings(settings: HermesSettings): AcpRegistrySettings {
  return Schema.decodeSync(AcpRegistrySettings)({
    source: "local",
    enabled: settings.enabled,
    commandPath: settings.binaryPath,
    commandArgs: [
      ...(settings.acpSubcommand ? ["acp"] : []),
      ...(settings.acceptHooks ? ["--accept-hooks"] : []),
    ],
    agentId: "hermes",
    authMethodId: settings.authMethodId,
    distribution: "auto",
    // The generic local-ACP config only carries model slugs; Hermes settings
    // keep the richer custom-model shape for its own form.
    customModels: settings.customModels.map((model) =>
      typeof model === "string" ? model : model.slug,
    ),
  });
}
