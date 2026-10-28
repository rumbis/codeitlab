# CodeItLab constraint docs

The durable documents behind CodeItLab: what it promises, how it is built, what it
deliberately does not do, and the tests that prove it. User-facing guides live in
[docs/user](../user/README.md); the short path from the root README is
[What CodeItLab does not do](./LIMITS.md).

## Start here

- [STATUS](./STATUS.md) - the honest map: every promise, where it lives, what proves it.
- [LIMITS](./LIMITS.md) - what CodeItLab does not do, and what it does instead.
- [VISION](./VISION.md) - the unified product (Greek, as the objective was written).
- [FEATURE-SPEC](./FEATURE-SPEC.md) - the feature specification the build follows.

## Architecture and building

- [ARCHITECTURE](./ARCHITECTURE.md) - repo shape, the files and types an implementer touches.
- [BUILD](./BUILD.md) - building the macOS app bundles and the hardened package.
- [PERFORMANCE](./PERFORMANCE.md) - the measured startup baseline and how to rerun it.
- [BUILD-PLAN](./BUILD-PLAN.md) - the historical phased plan and its parallel-work rules; phases are done, the rules still hold.

## Harness and providers

- [HARNESS-MATRIX](./HARNESS-MATRIX.md) - every agent CodeItLab must support.
- [NEXUS](./NEXUS.md) - one catalog across every harness.
- [ACP-SIGN-IN](./ACP-SIGN-IN.md) - which ACP agents need which sign-in.
- [ACP-MULTI-ACCOUNT](./ACP-MULTI-ACCOUNT.md) - several accounts per OAuth ACP agent.
- [ACP-FREE-TIERS](./ACP-FREE-TIERS.md) - which registry agents run at zero cost.
- [ACP-REGION-AVAILABILITY](./ACP-REGION-AVAILABILITY.md) - where each agent is available.
- [FREEMIUM-AGENTS](./FREEMIUM-AGENTS.md) - the freemium ACP catalog.
- [FREE-API-PROVIDERS](./FREE-API-PROVIDERS.md) - OpenAI-compatible providers with a free allowance.

## Marketplace and money

- [MARKETPLACE](./MARKETPLACE.md) - the marketplace, escrow lifecycle and fees.
- [ENGAGEMENTS](./ENGAGEMENTS.md) - the app's bridge to your own marketplace deployment: shapes, read-only states, polling, what it never does.
- [DEPLOY-MARKETPLACE](./DEPLOY-MARKETPLACE.md) - deploying the separate marketplace app.
- [CREDENTIALS-PROXY](./CREDENTIALS-PROXY.md) - the local privacy firewall for secrets.

## CodeItLab features

- [MEMORY-REA-ROUTING](./MEMORY-REA-ROUTING.md) - memory, REA, policy and auto-routing.
- [MEMORY-WHITELABEL](./MEMORY-WHITELABEL.md) - the white-label rules for memory.
- [REA-EVIDENCE](./REA-EVIDENCE.md) - the evidence behind the REA surface.
- [STUDIO](./STUDIO.md) - decks and video scenes.
- [INTEGRATIONS](./INTEGRATIONS.md) - the whitelabel integrations (Shorts, Crew, Search).
- [ECOSYSTEM](./ECOSYSTEM.md) - OmniRoute, Graft, Ponytail, Caveman.
- [REMOTE](./REMOTE.md) - remote access across machines.
- [PWA](./PWA.md) - installing the web app as a desktop or mobile app.
- [SETUP](./SETUP.md) - sandbox backends (Tart, Docker, Podman, WSL2) and what an install really does.
- [MODELS-AND-QUOTA](./MODELS-AND-QUOTA.md) - one model list, honest quota, custom endpoints and masking.

## Quality, naming and release

- [UI](./UI.md) - the UI quality bar every surface is held to.
- [RENAME](./RENAME.md) - the rename, and what deliberately keeps the old name.
- [PUBLISH-NPM](./PUBLISH-NPM.md) - publishing `codeitlab` to npm (Greek, as requested).
- [TAURI-PROPOSAL](./TAURI-PROPOSAL.md) - the Tauri proposal, explicitly not a migration.
- [SESSION-HISTORY](./SESSION-HISTORY.md) - the full picture across DSH sessions.
