# assistant-ui registry components

These are official assistant-ui registry sources, installed on 2026-10-11.
`UPSTREAM.json` records source URLs and SHA-256 hashes of the unmodified sources.
The MIT license is retained in `LICENSE.assistant-ui`; the supporting shadcn/ui
components also use the MIT license.

The dashboard imports `AssistantMessage` and `UserMessage` directly from
`elements/thread.aui.tsx`. It uses the official Markdown renderer, message
actions, attachment previews and tool-group disclosure components. The existing
dashboard shell, runtime transport and approved image composer are retained.

Local integration changes:

- Imports for supporting UI components and hooks are namespaced here to avoid
  replacing existing project components.
- The two upstream message components are exported for use in the dashboard's
  message iterator. Assistant messages expose before/after slots for canvas
  metadata and an error slot for the existing runtime diagnosis, without
  replacing their standard content or action layout.
- Labels are translated into Chinese. Tool-group triggers accept a label for
  actual execution/check results supplied by the host and a separate suffix
  for elapsed time, keeping digits outside the animated shimmer label.
- Agent execution uses the official ToolGroup ghost variant containing
  props-driven ToolCall elements. Waiting, running and completed states share
  the group trigger, with elapsed time pinned to its trailing edge. Each call
  expands to recorded tool name, call identifier, status and duration; an empty
  run shows a placeholder. Raw arguments/results are not saved by the host, so
  the sections are named call record and execution status instead of implying
  raw payload availability. ToolCall adds localized section labels and separate
  error/unconfirmed outcome icons; returned is not a construction audit.
  Group and call toggles use useScrollLock, with Radix data-state selectors for
  chevrons and panel animations. Outline borders use the host border token
  explicitly under Tailwind v4. The ToolTimeline trial source remains available.
- Shimmer labels and swap layers use a 20px line height so text masks
  include font descenders such as the lower part of `g` in `Agent`.
- The assistant-ui message indicator is suppressed because the host tool group
  already communicates that a reply is in progress.
- The regeneration action is conditional on the external runtime supporting it.
- The upstream EditComposer is exported for the dashboard's message iterator,
  retains image attachments and uses Chinese cancel/resend labels. Its inline
  editing surface uses a subtle muted background, faint focus border, one-row
  autosizing input and compact buttons without shadow. The inline explanatory
  paragraph is omitted to keep message editing compact.
  The host's onEdit callback replaces subsequent turns and starts a fresh Agent session
  with the retained history, continuing to work on the current canvas.
- The message action bar omits the upstream More menu and single-message
  Markdown export. The dashboard currently exposes only the copy action.
- Markdown adds the existing math plugins and remote-image policy. Palette
  tokens and scoped chat typography live in `app/globals.css`: assistant/user
  body text uses 15px type with 24px line height and explicit system font fallbacks.
  Message geometry stays in the upstream source.
- The upstream immutable renderer-map cache has a narrowly scoped lint
  exception for Next's React Compiler ref heuristic; its behavior is unchanged.

Agent execution steps are display-only domain metadata. They are never
registered as executable frontend tool calls. Regeneration/edit/feedback
controls follow the runtime's supported capabilities.
