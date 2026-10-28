/**
 * CodeItLab feature contracts. The schemas live in `@codeitlab/core` so the
 * server, web and desktop share one definition without a contracts cycle; this
 * module re-exports them for the usual `@codeitlab/contracts` import path.
 */
export * from "@codeitlab/core";

/**
 * One error shape for every CodeItLab feature RPC. Defined once in
 * `@codeitlab/core` so services and transports share the exact same schema.
 */
export { CodeItLabServiceError as CodeItLabError } from "@codeitlab/core";
