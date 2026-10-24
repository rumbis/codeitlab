import { CodeitlabServiceError } from "@codeitlab/core";
import type { PolicyProfile } from "@codeitlab/core/policy";
import { PolicyAuditEntry } from "@codeitlab/core/policy";
import { PolicyService as PolicyServiceTag } from "@codeitlab/core/services";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";

import * as ServerConfig from "../../config.ts";
import * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { resolveEffectivePolicy } from "./instruction.ts";

/**
 * Uncensored-mode policy resolution plus its audit trail.
 *
 * `effective` is a read path used both by the settings panel and by the turn
 * hook; only a call that names a provider instance is a real per-turn
 * application and lands in the audit file (when auditing is enabled). Profile
 * changes always land in the audit file.
 */

const MAX_AUDIT_ENTRIES = 500;

const decodeAuditLine = Schema.decodeUnknownOption(Schema.fromJsonString(PolicyAuditEntry));
const encodeAuditLine = Schema.encodeSync(Schema.fromJsonString(PolicyAuditEntry));

export const make = Effect.fn("codeitlab.policy.service.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const crypto = yield* Crypto.Crypto;

  const auditDirectory = path.join(config.stateDir, "codeitlab", "policy");
  const auditPath = path.join(auditDirectory, "audit.jsonl");

  const auditRef = yield* Ref.make<ReadonlyArray<PolicyAuditEntry>>([]);
  const auditLock = yield* Semaphore.make(1);

  const loadAudit = Effect.gen(function* () {
    const text = yield* fs.readFileString(auditPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
      Effect.orElseSucceed(() => ""),
    );
    const entries: PolicyAuditEntry[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const decoded = decodeAuditLine(trimmed);
      if (Option.isSome(decoded)) entries.push(decoded.value);
    }
    return entries.slice(-MAX_AUDIT_ENTRIES);
  });
  yield* Ref.set(auditRef, yield* loadAudit);

  const appendAudit = (entry: PolicyAuditEntry): Effect.Effect<void, CodeitlabServiceError> =>
    auditLock.withPermits(1)(
      Effect.gen(function* () {
        const entries = [...(yield* Ref.get(auditRef)), entry].slice(-MAX_AUDIT_ENTRIES);
        yield* Ref.set(auditRef, entries);
        yield* writeFileStringAtomically({
          filePath: auditPath,
          contents: `${entries.map((item) => encodeAuditLine(item)).join("\n")}\n`,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError(
            (cause) =>
              new CodeitlabServiceError({
                operation: "policy.audit",
                message: "Failed to write the policy audit trail.",
                cause,
              }),
          ),
        );
      }),
    );

  const newAuditId = (operation: string) =>
    crypto.randomUUIDv7().pipe(
      Effect.mapError(
        (cause) =>
          new CodeitlabServiceError({
            operation,
            message: "Failed to generate an audit id.",
            cause,
          }),
      ),
    );

  const readSettings = settings.getSettings.pipe(
    Effect.mapError(
      (cause) =>
        new CodeitlabServiceError({
          operation: "policy.effective",
          message: "Could not read settings to resolve the policy.",
          cause,
        }),
    ),
  );

  const effective = Effect.fn("codeitlab.policy.effective")(function* (
    input: {
      readonly providerInstanceId?: string;
    } = {},
  ) {
    const current = yield* readSettings;
    const policySettings = current.codeitlab.policy;
    const profile: PolicyProfile = policySettings.uncensored ? "permissive" : "standard";
    const instances = yield* registry.listInstances.pipe(
      Effect.mapError(
        (cause) =>
          new CodeitlabServiceError({
            operation: "policy.effective",
            message: "Could not read the provider instance registry.",
            cause,
          }),
      ),
      Effect.map((instances) =>
        instances.map((instance) => ({
          instanceId: instance.instanceId,
          driverKind: instance.driverKind,
        })),
      ),
    );
    const effectivePolicy = resolveEffectivePolicy({
      profile,
      applyToProviders: policySettings.applyToProviders,
      instances,
      providerInstanceId: input.providerInstanceId,
    });

    // A turn-scoped application is auditable. A panel read without an instance
    // is not an application and must not spam the trail.
    if (
      effectivePolicy.profile === "permissive" &&
      policySettings.auditTrail &&
      input.providerInstanceId !== undefined
    ) {
      const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
      yield* appendAudit({
        id: `pol_${yield* newAuditId("policy.effective")}`,
        at,
        providerInstanceId: input.providerInstanceId,
        profile: effectivePolicy.profile,
      }).pipe(
        // An audit write failure must not fail the turn that is about to run.
        Effect.catch((cause) =>
          Effect.logWarning("Failed to append the policy audit entry.", { cause }),
        ),
      );
    }

    return effectivePolicy;
  });

  const setProfile = Effect.fn("codeitlab.policy.setProfile")(function* (profile: PolicyProfile) {
    const current = yield* readSettings;
    const nextCodeitlab = {
      ...current.codeitlab,
      policy: {
        ...current.codeitlab.policy,
        uncensored: profile === "permissive",
      },
    };
    yield* settings.updateSettings({ codeitlab: nextCodeitlab }).pipe(
      Effect.mapError(
        (cause) =>
          new CodeitlabServiceError({
            operation: "policy.setProfile",
            message: "Failed to save the policy profile.",
            cause,
          }),
      ),
    );
    const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
    yield* appendAudit({
      id: `pol_${yield* newAuditId("policy.setProfile")}`,
      at,
      providerInstanceId: "environment",
      profile,
    }).pipe(
      Effect.catch((cause) => Effect.logWarning("Failed to audit a profile change.", { cause })),
    );
  });

  const audit = (limit = 100) =>
    Ref.get(auditRef).pipe(Effect.map((entries) => entries.toReversed().slice(0, limit)));

  return PolicyServiceTag.of({ effective, setProfile, audit });
});

export const layer = Layer.effect(PolicyServiceTag, make());

export {
  PERMISSIVE_INSTRUCTION_BLOCK,
  PERMISSIVE_PROFILE_ID,
  POLICY_LIMITATIONS,
  providerInstructionSupport,
  resolveEffectivePolicy,
} from "./instruction.ts";
