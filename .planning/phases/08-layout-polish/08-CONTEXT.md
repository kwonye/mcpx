# Phase 8: Layout Polish - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix dashboard and browse views to have consistent, macOS-standard spacing and layout. Move daemon controls to sidebar hero position, standardize padding throughout, organize browse registry with grid layout, and make paste command display multi-line.

</domain>

<decisions>
## Implementation Decisions

### Sidebar Reorganization (SIDE-01)
- **D-01:** Move DaemonControls component to top of sidebar, below `.sidebar-logo` and above nav buttons
- **D-02:** Daemon controls becomes the "hero" element in sidebar — most prominent position
- **D-03:** Remove DaemonControls from `servers-controls-container` in main content
- **D-04:** Style daemon controls for sidebar context — compact, glass-panel styling
- **D-05:** CliCommandInput remains in main content area (servers tab)

### Dashboard Padding Consistency (WIND-02)
- **D-06:** Standardize all dashboard padding to 16px (macOS standard)
- **D-07:** Current inconsistent values found: 8px, 10px, 12px, 16px, 20px, 24px
- **D-08:** Specific changes:
  - `.sidebar`: keep 16px padding (line 261)
  - `.sidebar-logo`: keep 8px padding (line 282) — smaller is appropriate for logo area
  - `.nav-button`: change from 10px 12px to 12px 16px (line 320)
  - `.page-header`: change from `16px 24px 16px 0` to `16px` (line 351)
  - `.popover`: keep 16px padding (line 432)
  - CliCommandInput glass-panel: change from 20px to 16px padding
  - DaemonControls glass-panel: change from 16px 20px to 16px padding

### Browse Card Layout (BROWSE-01)
- **D-09:** Change from single-column list to 2-column grid layout
- **D-10:** Use CSS Grid with `grid-template-columns: repeat(2, 1fr)`
- **D-11:** Consistent 16px gap between cards
- **D-12:** Cards maintain current styling (glass-card, 16px 20px padding)
- **D-13:** On narrower windows, collapse to single column via `minmax(300px, 1fr)`

### Paste Command Display (PASTE-01)
- **D-14:** The placeholder text shows a long command example — wrap it to multiple lines
- **D-15:** Change input styling to allow text wrap in placeholder
- **D-16:** Consider showing example commands in a help text below the input instead of in placeholder
- **D-17:** Keep single-line input for actual user paste — users paste, not type

### Code Changes Required
- `app/src/renderer/components/Dashboard.tsx`:
  - Move `<DaemonControls>` into sidebar, below logo
  - Pass daemon state and refresh callback
- `app/src/renderer/index.css`:
  - Standardize padding values throughout
  - Add CSS Grid for server cards and browse cards
- `app/src/renderer/components/BrowseTab.tsx`:
  - Change card container from flex column to CSS Grid
- `app/src/renderer/components/CliCommandInput.tsx`:
  - Adjust placeholder display or add help text
  - Standardize padding

</decisions>

<specifics>
## Specific Ideas

- User preference: Clean, consistent spacing — 16px standard throughout
- User preference: Daemon controls in sidebar hero position — most important action
- User preference: Grid layout for browse — better use of horizontal space

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — WIND-02 (padding), SIDE-01 (daemon in sidebar), BROWSE-01 (organized layout), PASTE-01 (multi-line)

### Code Files
- `app/src/renderer/components/Dashboard.tsx` — Dashboard layout, sidebar structure
- `app/src/renderer/index.css` — All padding/spacing values
- `app/src/renderer/components/BrowseTab.tsx` — Browse registry card layout
- `app/src/renderer/components/DaemonControls.tsx` — Daemon controls component
- `app/src/renderer/components/CliCommandInput.tsx` — Paste command input

</canonical_refs>

<code_context>
## Existing Code Insights

### Current Sidebar Structure
```
<aside className="sidebar">
  <div className="sidebar-logo">...</div>  // Draggable header
  <div className="sidebar-inner glass-panel">
    <button>My Servers</button>
    <button>Browse Registry</button>
    <div className="nav-spacer" />
    <button>Settings</button>
  </div>
</aside>
```

### After Change
```
<aside className="sidebar">
  <div className="sidebar-logo">...</div>
  <DaemonControls daemon={...} onRefresh={...} />  // Hero position
  <div className="sidebar-inner glass-panel">
    <button>My Servers</button>
    ...
  </div>
</aside>
```

### Current Browse Layout (problematic)
- Single column flex layout
- Each card is full width
- Doesn't use horizontal space well

### New Browse Layout
- CSS Grid: `display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px;`
- Cards take available width
- Responsive to window size

### Integration Points
- `useStatus()` hook provides `daemon` state
- `refresh` callback triggers status refresh
- CliCommandInput and DaemonControls both need daemon info but in different places after change

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-layout-polish*
*Context gathered: 2026-03-25*