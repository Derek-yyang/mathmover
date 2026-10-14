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
- The thread composer caches unsent text and images per courseware in page
  memory using the official composer subscription/setText/addAttachment APIs.
  Ready images restore from descriptors; files still being read remain in the
  draft. A stable editor identity avoids remounting on the first autosave.
  Sending/clearing/deleting removes drafts; explicit new editors start blank.
  This cache adds no localStorage or database writes and does not capture the
  separate message-edit composer.
- The message action bar omits the upstream More menu and single-message
  Markdown export. The dashboard currently exposes only the copy action.
- Markdown adds the existing math plugins and remote-image policy. Palette
  tokens and scoped chat typography live in `app/globals.css`: assistant/user
  body text uses 15px type with 24px line height and explicit system font fallbacks.
  Message geometry stays in the upstream source.
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
  Archive popovers portal inside Settings' native dialog. Batch deletion keeps
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
  installing a second collapse provider. `ui/sidebar-layout.tsx` extracts only
  SidebarHeader, SidebarContent and SidebarFooter from the official shadcn
  Sidebar; original full-source hashes are recorded in `UPSTREAM.json`.
- Sidebar spacing and row padding are unified. Search appears only for a
  nonempty current view or an existing query; batch selection is hidden for an
  empty view. Empty views use a compact icon, title and explanation. Footer entries
  share the same row style; the redundant expanded-header search action is
  removed while the collapsed-rail search shortcut is retained.
- The archive view omits the new-thread action. Its menus and delete confirmation
  portal into the native Settings dialog so they remain in its top layer and
  accept focus/pointer input. `ui/dialog.tsx` adds an optional portal container;
  other dialog users retain their existing body portal. Opening an already
  active archive closes Settings without asking the runtime to switch again.
