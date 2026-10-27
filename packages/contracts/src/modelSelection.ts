import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderOptionSelections } from "./model.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});

const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformEffect({
      decode: (raw) => {
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          instanceId: value.instanceId,
          model: value.model,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

/**
 * Opt-in "Auto router" model choice. The picker stores this sentinel as the
 * thread selection; the server resolves it to a concrete provider/model for
 * every new turn by routing across every enabled app's models. It is never
 * passed to a provider session as-is.
 */
export const AUTO_ROUTE_INSTANCE_ID = "codeitlab_auto";
export const AUTO_ROUTE_MODEL = "auto";

export const AUTO_ROUTE_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make(AUTO_ROUTE_INSTANCE_ID),
  model: AUTO_ROUTE_MODEL,
};

export function createAutoRouteSelection(): ModelSelection {
  return { instanceId: ProviderInstanceId.make(AUTO_ROUTE_INSTANCE_ID), model: AUTO_ROUTE_MODEL };
}

export function isAutoRouteSelection(
  selection: { readonly instanceId: unknown; readonly model: unknown } | null | undefined,
): boolean {
  if (selection == null) return false;
  return (
    String(selection.instanceId) === AUTO_ROUTE_INSTANCE_ID &&
    String(selection.model) === AUTO_ROUTE_MODEL
  );
}
