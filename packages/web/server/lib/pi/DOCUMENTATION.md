# Pi Bridge Module Documentation

## Purpose
This module holds the server-side normalization model for Pi RPC output before it is translated into the existing OpenAurora HTTP and SSE contracts.

## Entrypoints and structure
- `packages/web/server/lib/pi/index.js`: public exports for the Pi bridge helpers.
- `packages/web/server/lib/pi/bridge-schema.js`: normalized event catalog plus envelope and message normalizers.
- `packages/web/server/lib/pi/runtime.js`: in-memory Pi session runtime bridge for session creation, prompt submission, abort, message refresh, and OpenCode-compatible message projection.

## Public exports
- `PI_BRIDGE_EVENT_CATALOG`: canonical list of Pi agent events, assistant stream events, message roles, and extension UI methods that the bridge recognizes.
- `normalizePiRpcEnvelope(value)`: converts a raw Pi RPC line into one of the internal normalized envelopes (`command-response`, `agent-event`, `extension-ui-request`, `unknown`).
- `normalizePiMessage(value)`: normalizes Pi core/custom message roles into a stable server shape.
- `normalizePiExtensionUiRequest(value)`: normalizes extension UI requests and tags each one with bridge intent (`question`, `status`, `widget`, etc.) plus support level metadata.
- `resolveAgentRuntimeMode(value)`: runtime switch helper that currently selects between `opencode` and `pi`.
- `createPiRuntime(options)`: starts an in-memory Pi-backed session manager that drives Pi RPC processes per OpenAurora session.
- `mapPiUiRequestToQuestionRequest(sessionRecord, request)`: maps Pi extension UI requests into the existing `QuestionCard`-compatible request shape.
- `translatePiMessagesToOpenCodeMessages(sessionRecord, messages)`: projects Pi message history into the OpenCode `info + parts[]` shape consumed by the current Web client.
- `translateOpenCodeMessagesToSseEvents(sessionRecord, messageRecords, options)`: turns projected OpenCode messages into `session.status`, `message.updated`, and `message.part.updated` SSE payloads.

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
- Set `OPENAURORA_AGENT_RUNTIME=pi` (or `OPENCHAMBER_AGENT_RUNTIME=pi`) to activate the Pi session routes.
- Set `OPENAURORA_PI_BIN` or `PI_CLI_BIN` when the Pi executable is not available as plain `pi` on `PATH`.
- The normalized model intentionally excludes plugin/package identity. The current bridge only targets Pi core runtime behavior.
- Unknown RPC lines are preserved as `envelope: unknown` so the caller can log protocol drift instead of dropping data silently.
- The runtime bridge currently handles session bootstrap, prompt submission, abort, pull-based message refresh, and snapshot-style SSE translation for `session.status`, `message.updated`, and `message.part.updated`.
