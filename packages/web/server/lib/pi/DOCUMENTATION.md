# Pi Bridge Module Documentation

## Purpose
This module is the server-side Pi SDK bridge for OpenChamber. It keeps the existing HTTP and SSE contracts stable while the backend runtime is driven directly by `@mariozechner/pi-coding-agent` instead of spawning the external `pi` CLI.

## Entrypoints and structure
- `packages/web/server/lib/pi/index.js`: public exports for bridge schema and message projection helpers.
- `packages/web/server/lib/pi/bridge-schema.js`: normalized event catalog plus envelope and message normalizers.
- `packages/web/server/lib/pi/providers.js`: Pi model/provider discovery built directly on `AuthStorage`, `ModelRegistry`, and `SettingsManager`.
- `packages/web/server/lib/pi/sdk-host.js`: in-memory Pi session host backed by `createAgentSession()`.
- `packages/web/server/lib/pi/extensions/question.js`: adapts Pi extension UI requests into the existing Web question flow.
- `packages/web/server/lib/pi/extensions/subagent.js`: SDK-backed subagent tool that creates nested in-memory Pi sessions instead of spawning `pi` subprocesses.
- `packages/web/server/lib/pi/agents.js`: discovers `.pi/agents/*.md` definitions and parses their frontmatter.
- `packages/web/server/lib/pi/permissions.js`: normalizes OpenCode-style permission rules, compiles runtime policies, and provides the shared `tool_call` gate.
- `packages/web/server/lib/pi/runtime.js`: pure translation helpers for projecting Pi messages/events into the legacy OpenCode-shaped payloads still used by the Web UI.

## Public exports
- `PI_BRIDGE_EVENT_CATALOG`: canonical list of Pi agent events, assistant stream events, message roles, and extension UI methods that the bridge recognizes.
- `normalizePiRpcEnvelope(value)`: normalizes SDK event payloads into bridge envelopes (`agent-event`, `extension-ui-request`, `unknown`).
- `normalizePiMessage(value)`: normalizes Pi core/custom message roles into a stable server shape.
- `normalizePiExtensionUiRequest(value)`: tags extension UI requests with bridge intent (`question`, `status`, `widget`, etc.) plus support level metadata.
- `AGENT_RUNTIME_PI`: runtime marker written into projected assistant messages.
- `mapPiUiRequestToQuestionRequest(sessionRecord, request)`: maps Pi extension UI requests into the existing `QuestionCard`-compatible request shape.
- `translatePiMessagesToOpenCodeMessages(sessionRecord, messages)`: projects Pi message history into the OpenCode `info + parts[]` shape consumed by the current Web client.
- `translateOpenCodeMessagesToSseEvents(sessionRecord, messageRecords, options)`: turns projected OpenCode messages into `session.status`, `message.updated`, and `message.part.updated` SSE payloads.
- `translatePiEnvelopeToSseEvents(sessionRecord, envelope, options)`: converts normalized Pi event envelopes into Web SSE payloads.
- `buildPromptTextFromParts(parts)`: converts existing OpenCode-style message parts into a Pi prompt string.

## Catalog coverage
- Agent events: `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`.
- Assistant stream updates: `start`, `text_start`, `text_delta`, `text_end`, `thinking_start`, `thinking_delta`, `thinking_end`, `toolcall_start`, `toolcall_delta`, `toolcall_end`, `done`, `error`.
- Message roles:
  - Core: `user`, `assistant`, `toolResult`
  - Coding-agent custom: `custom`, `bashExecution`, `branchSummary`, `compactionSummary`
- Extension UI requests: `input`, `select`, `confirm`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

## Bridge intent mapping
- Priority interactive bridge targets: `input`, `select`, `confirm` -> normalized as `question` requests.
- Explicit downgrade path: `editor` -> rendered as an unsupported `QuestionCard` prompt so the user can cancel it deliberately instead of the bridge dropping it silently.
- Passive/degraded UI: `notify` -> normalized as `notification`.
- Deferred UI follow-ups: `setStatus`, `setWidget` -> normalized but marked deferred for later Web support.
- Unsupported for now: `setTitle`, `set_editor_text`.

## Notes for contributors
- The active server routes use `sdk-host.js` and `providers.js`; they do not rely on the external `pi` binary or RPC mode.
- Model/provider discovery must stay separate from session bootstrap. `providers.js` reads Pi's `ModelRegistry` directly instead of creating throwaway sessions.
- Subagents are also SDK-backed. Agent frontmatter now uses the Pi-native subset: `description`, `mode`, `model`, `thinking`, `steps`, `permission`, `enabled`, `display_name`, plus markdown body prompt.
- Agent `permission` now accepts OpenCode-style rule values for `edit` (for example `edit: deny` or `edit: { "*": "deny", "**/*.md": "allow" }`). `permissions.js` compiles those rules into `activeToolNames` plus a shared `tool_call` gate that both `sdk-host.js` and `extensions/subagent.js` inject through `DefaultResourceLoader` extension factories.
- Unknown event payloads are preserved as `envelope: unknown` so the caller can log protocol drift instead of dropping data silently.
- `runtime.js` is intentionally limited to translation helpers. Session lifecycle, prompt execution, and extension binding live in `sdk-host.js`.
