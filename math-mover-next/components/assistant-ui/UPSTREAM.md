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

- Settings uses the existing official shadcn/Radix Dialog foundation in
  `ui/dialog.tsx`, retaining its 840x640 panel, 12px radius and MathMover tokens.
  Radix owns modal focus looping, outside dismissal and nested Escape priority;
  the host restores the invoking element because Settings can open from several
  controls/events. Content accepts optional overlay styles and a close-button
  toggle; existing callers retain their defaults. Motion respects the system's
  reduced-motion preference. Centered dialogs fade/scale in place; legacy
  directional slide classes are removed so Tailwind 4's independent centering
  translation does not combine with an extra diagonal animation offset.
  Settings menus/confirmations remain in its focus
  scope and use its `data-slot=settings-dialog` boundary. The appearance menu is
  non-modal within the enclosing modal, avoiding overlapping modal locks.
- Unsaved API drafts guard Settings dismissal through its close control, Escape,
  backdrop and archive navigation. A small Radix Popover anchored to the close
  control offers continue/discard, with focus returning to the invoking control.
  BYOK publishes dirty/saving flags from input/save events; credentials remain
  in the form's memory only. Reverting or saving clears the guard, failed saves
  retain drafts, and pending saves cannot be discarded. Immediate settings such
  as theme/model selection do not trigger this guard.

- Settings use official `tabs.json` (Radix line variant) and `badge.json`
  sources (retrieved 2026-10-16), alongside the existing shared Button. Host
  adapters unify 32px actions, 20px neutral/success/warning badges, theme-green
  selection/focus and reduced-motion styles. Tabs keep both panels mounted,
  explicitly hide inactive panels and retain stable accessible IDs, preserving
  drafts/results while Radix owns roving focus and automatic keyboard selection.
  Existing test, refresh, save and runtime-switch guards remain in their hosts.

- Settings model and reasoning controls use the official `select.json` Radix
  component (retrieved 2026-10-16), with existing MathMover theme tokens and
  compact triggers. The wrapper accepts a portal container so lists stay inside
  the settings dialog's focus scope, and retains upstream keyboard, focus,
  typeahead, scroll controls and selection indicators. Motion respects reduced
  motion; long labels are constrained to the viewport. Model/effort state is
  still owned by the existing AgentRuntimeProvider.

- The API format field reuses the same Select and dialog portal boundary. Its
  four protocol choices are shared with the server-side OpenCode configuration;
  the browser does not import any SDK. Missing legacy values default to Chat
  Completions. Format edits participate in the existing unsaved-draft guard and
  invalidate test results; tests use the saved format's model-list API/auth,
  without generating model output or treating a missing list as success.

- API model discovery uses the official shadcn/ui `command.json` (cmdk),
  retrieved 2026-10-18, inside the existing Radix Popover. Its imports, search
  divider and icon accessibility are adapted to the host; upstream filtering,
  keyboard selection and scrolling remain intact. The list stays in Settings'
  focus scope and collision boundary; Escape closes it before the dialog. The
  ordinary model text field remains available for manual IDs. Discovery uses
  the current draft through a same-origin POST, resolves blank keys only on the
  server, follows Anthropic/Gemini pagination and never writes configuration.
  Endpoint/format/key changes abort pending discovery and clear the old list;
  request identity checks also ignore stale responses. No polling or browser
  persistence is added.

- The canvas export menu uses a local Radix DropdownMenu wrapper, the same
  foundation as the official ThreadListItemMore primitives. Both share menu
  surface styles; keyboard navigation, dismissal and focus restoration use
  Radix. Export portals stay inside the browser fullscreen element when needed.
  The existing HTML/GGB/PNG download handlers are retained.

- Imports for supporting UI components and hooks are namespaced here to avoid
  replacing existing project components.
- The two upstream message components are exported for use in the dashboard's
  message iterator. Assistant messages expose before/after slots for canvas
  metadata and an error slot for the existing runtime diagnosis, without
  replacing their standard content or action layout.
- Labels are translated into Chinese. Tool-group triggers accept a label for
  actual execution/check results supplied by the host and a separate suffix
  for elapsed time, keeping digits outside the animated shimmer label.
- Agent execution uses the official `elements-run-activity` registry component
  containing public commentary and props-driven ToolCall elements in event order.
  Runtime message IDs, text phases and final results drive presentation; tool
  request boundaries classify preceding provisional narration, while unclassified
  settled text stays visible. Legacy messages retain their original body.
  Classification is saved in courseware metadata; no raw tool payloads or private
  thinking are stored. Final answers and actionable errors stay outside the
  disclosure. Waiting, running and completed states share the trigger, with a
  separately ticking duration component. Each call
  expands to recorded tool name, call identifier, status and duration; an empty
  run shows a placeholder. Raw arguments/results are not saved by the host, so
  the sections are named call record and execution status instead of implying
  raw payload availability. ToolCall adds localized section labels and separate
  error/unconfirmed outcome icons; returned is not a construction audit.
  Activity and call toggles use useScrollLock, with Radix data-state selectors for
  chevrons and panel animations. Outline borders use the host border token
  explicitly under Tailwind v4.
- RunActivity keeps the current activity in its single-line disclosure trigger,
  with truncation and a separate duration suffix. The host supplies an optional
  `currentActivityLabel` from observed tool states: active calls show the running
  action; between calls the most recently returned result stays readable with
  an explicit returned/error/unconfirmed label. No artificial delay is added
  to execution, next-step updates or run completion. The upstream fallback remains for
  other callers. Native tool names have short localized action labels. New
  events preserve the user's expansion state and the complete ordered history.
- Running summaries compose the official `elements-thinking-indicator` source
  (retrieved 2026-10-15). Its pulse uses the host primary color; label changes
  retain the upstream shimmer and enter animation with reduced-motion support.
  The root is a span so it can live inside the disclosure button. Elapsed time
  accepts a React node to reuse the isolated clock without restarting label
  animations every second. Labels use a 20px line height to preserve descenders.
  Settled summaries remain static and history remains in RunActivity.
- Empty summaries reserve the disclosure icon's width and share the trigger's
  flex alignment and row height. The dot/text stay fixed when activity arrives,
  without exposing an empty button. The host clock initializes from current time
  against the persisted run start so this layout transition cannot reset elapsed
  time to zero.
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
- The thread composer caches unsent text and images per courseware in page
  memory using the official composer subscription/setText/addAttachment APIs.
  Ready images restore from descriptors; files still being read remain in the
  draft. A stable editor identity avoids remounting on the first autosave.
  Sending/clearing/deleting removes drafts; explicit new editors start blank.
  This cache adds no localStorage or database writes and does not capture the
  separate message-edit composer.
- The message action bar omits the upstream More menu and single-message
  Markdown export. The dashboard currently exposes only the copy action.
  Copy uses the shared ghost icon Button with an accessible Chinese name and
  the upstream copied-state checkmark, without a hover tooltip.
- Markdown adds the existing math plugins and remote-image policy. Palette
  tokens and scoped chat typography live in `app/globals.css`: assistant/user
  body text uses 15px type with 24px line height and explicit system font fallbacks.
  Message geometry stays in the upstream source.
- `elements/code-block.tsx` extracts the Markdown renderer's official CodeHeader
  and pre surface for reuse by the construction-command disclosure. It preserves
  language casing, uses Chinese copy/copied labels and the existing clipboard
  hook, and adds reduced-motion support and bounded horizontal scrolling.
  Construction commands use literal source without Markdown parsing; the source
  and its line breaks are copied unchanged.
- `elements/shiki-highlighter.tsx` is the official standalone Shiki renderer,
  retrieved from `elements-shiki-highlighter` on 2026-10-16. Imports use the host
  utility namespace, source trimming is omitted to preserve whitespace, and the
  plain fallback keeps keyboard access. The upstream pending-load ref has the
  same narrow lint exemption as the Markdown renderer. The GeoGebra adapter
  supplies an already initialized Shiki core with only the local lexical grammar
  and MathMover light/dark token palettes, bypassing automatic engine/language
  loading. No WASM or remote grammar/theme fetch is used for GeoGebra.
  React lazy/Suspense defers this renderer until the command disclosure mounts;
  plain code remains visible during loading and on load/initialization failure.
  Both palettes are emitted together and switch through the host color-scheme,
  without retokenizing on a theme change. Fallback and highlighted code share
  font metrics, padding and line spacing. `lib/ggb-highlight.ts` is a local
  display grammar, not GeoGebra's parser or command validation catalog.
- Historical Markdown is windowed by the dashboard host. Measured text heights
  stay in the message shell while distant text DOM is released; tool controls
  retain state through React Activity while their offscreen subscriptions pause.
  Focused and selected messages stay active until the interaction ends.
- Attachment thumbnails use native lazy/async images inside the existing tile.
  Radix AvatarImage's eager preloader would fetch every historical attachment.
- The upstream immutable renderer-map cache has a narrowly scoped lint
  exception for Next's React Compiler ref heuristic; its behavior is unchanged.

Agent execution steps are display-only domain metadata. They are never
registered as executable frontend tool calls. Regeneration/edit/feedback
controls follow the runtime's supported capabilities.

## Courseware sidebar (2026-10-13)

- The New button accepts a host click handler and its own disabled state. During
  Agent execution it opens a separate tab synchronously, preserving the original
  page's thread and canvas. Idle creation still uses the current page. The host
  prevents the primitive's default thread switch for this action; other list
  mutation/switch controls retain the running-task guard.

- `elements/thread-list.aui.tsx` is vendored from the official runtime
  `https://r.assistant-ui.com/thread-list.json`, not the props-only standalone
  list. Its original source hash and the shadcn Input dependency are recorded
  in `UPSTREAM.json`; the existing MIT notices apply.
- New, search, local-day grouping, active rows, keyboard navigation, inline
  rename and the overflow menu retain the official primitives and structure.
  Labels use Chinese, rows use the workspace's emerald active state and 36px
  height. Overflow menus use a light stone border and subtle shadow. The
  MathMover brand, collapsed rail and settings are hosted
  by the existing `DashboardSidebar` shell.
- `CoursewareThreadList` supplies an external-store list adapter. It reads
  `/api/coursewares?archived=all`, uses revision-checked rename/archive, and selects
  the existing `history_id` route. `useCoursewareLibrary` still saves/restores
  messages, Agent sessions and complete GeoGebra snapshots. This list runtime
  holds no chat history and adds no browser/cloud persistence.
- Official Archive/Unarchive primitives move items between the recent and
  archived views. The sidebar shows recent records; archived records are managed
  in Settings > Archived coursewares, using the same runtime list and adapter.
  Opening a record closes Settings, including reopening the current archive.
  Settings owns archive scrolling; the sidebar retains its bounded list
  viewport. Archive items do not intercept wheel scrolling in the outer panel.
  Archived coursewares can still restore chat/canvas and save
  edits without becoming regular items. Delete confirms permanent removal;
  there is no recycle bin or restore action. The host retains batch selection
  and mutation/busy guards.
- Single-record deletion uses a local Radix Popover anchored to the row's
  overflow button, with no backdrop. Cancel owns initial focus; Escape/outside
  interaction dismisses it and deletion errors remain in the popover for retry.
  Archive popovers portal inside Settings' Dialog. Batch deletion keeps
  the host's centered confirmation dialog and both use the same delete adapter.
- Motion preserves deletion fade/slide and layout movement with reduced-motion
  support. Exiting rows release their index scope and render an inert static
  title, preventing deleted indices from reading another item during exit.
- Inline rename waits for the runtime promise so a failed rename remains
  editable. Menu close/Escape focus handling avoids blurring the editor during
  the dropdown exit animation. Sidebar/canvas resize preview is unchanged.
- `scripts/verify-courseware-thread-list.mjs` exercises the real dashboard and
  GeoGebra against isolated courseware fixtures; it never writes the database.
- `elements/threadlist-sidebar.aui.tsx` adapts the official
  `https://r.assistant-ui.com/threadlist-sidebar.json` Header/Content/Footer
  composition. Brand and footer slots replace its external links, and the host
  supplies the existing courseware runtime. The native aside keeps the existing
  dashboard clip/rail, focus restoration and canvas resize preview instead of
  installing a second collapse provider. The Header/Content/Footer containers are
  **host-owned** (`components/dashboard/SidebarSections.tsx`, taken over on
  2026-10-20): the vendored `ui/sidebar-layout.tsx` only ever used three of the
  official shadcn Sidebar's ~700 lines, so it carried the upstream URL/hash
  bookkeeping without any of the behaviour. No upstream entry tracks them now.
- Sidebar spacing and row padding are unified. Search appears only for a
  nonempty current view or an existing query; batch selection is hidden for an
  empty view. Empty views use a compact icon, title and explanation. Footer entries
  share the same row style; the redundant expanded-header search action is
  removed while the collapsed-rail search shortcut is retained.
- Batch selection uses a single compact footer row: selected count, select-all
  and an accessible delete icon reuse the shared ghost Button. The extra divider
  and second full-width delete row are omitted. Delete is disabled at zero
  selection and otherwise uses the destructive text/hover tokens; existing
  confirmation, filtering, busy guards and deletion behavior are retained.
- The archive view omits the new-thread action. Its menus and delete confirmation
  portal into the Settings Dialog so they remain in its focus scope and
  accept focus/pointer input. `ui/dialog.tsx` adds an optional portal container;
  other dialog users retain their existing body portal. Opening an already
  active archive closes Settings without asking the runtime to switch again.

## Theme integration

- Theme persistence, system preference, cross-window synchronization and the
  initial theme script use `next-themes`, following the shadcn/ui Next.js
  dark-mode integration: https://ui.shadcn.com/docs/dark-mode/next .
- `components/ThemeProvider.tsx` configures `data-theme`, the existing `mm.theme`
  preference key, a light default and transitions disabled during theme changes.
  There is no parallel host theme store or custom initialization script.
- AppearanceSettings adapts the shadcn mode-toggle composition with the shared
  Button and Radix DropdownMenu. Radio items add a selected indicator and menus
  portal inside the Settings Dialog. These are host adaptations, not a
  separate assistant-ui theme-management component.
- Colors remain MathMover's CSS tokens in `app/globals.css`: warm light
  surfaces, neutral dark grays and emerald accents. GeoGebra content
  keeps its original colors for editing and export.
