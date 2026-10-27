import type { RoutingService } from "@codeitlab/core/services";
import * as Option from "effect/Option";

/**
 * Runtime registration for the routing service.
 *
 * `RunExecutionService`/`Orchestrator` are built before the CodeItLab layer
 * (which needs the provider registries the orchestration runtime provides), so
 * the service cannot be threaded through their layer requirements without a
 * cycle. The CodeItLab layer registers the built service here at construction;
 * orchestration reads it at dispatch time. `serviceOption` in the orchestration
 * layer remains the fallback for tests that provide the service explicitly.
 */
let activeRoutingService: RoutingService["Service"] | null = null;

export const registerActiveRoutingService = (service: RoutingService["Service"]): void => {
  activeRoutingService = service;
};

export const resetActiveRoutingService = (): void => {
  activeRoutingService = null;
};

export const getActiveRoutingService = (): Option.Option<RoutingService["Service"]> =>
  activeRoutingService === null ? Option.none() : Option.some(activeRoutingService);
