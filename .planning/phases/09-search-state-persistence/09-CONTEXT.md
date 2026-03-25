# Phase 9: Search State Persistence - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Persist search query and active tab between dashboard window sessions so users can resume searching without retyping the previous query. Search results are fetched fresh from the API on window open (no client-side result caching).

</domain>

<decisions>
## Implementation Decisions

### What to Persist
- **D-01:** Persist `searchQuery` (string) — the last search query typed by user
- **D-02:** Persist `activeCategory` (string) — the last selected category ("all", "trending", "databases", "devtools", "web")
- **D-03:** Persist `activeTab` (string) — which tab was active ("servers", "browse", "settings")
- **D-04:** Do NOT persist search results — fetch fresh from API on window open (consistent with Phase 5 preference: no caching, use API)

### When to Persist
- **D-05:** Save state on explicit user actions:
  - On search form submit (when user presses Enter or clicks Search button)
  - On category click (when user selects a category pill)
  - On tab change (when user switches between tabs)
- **D-06:** Do NOT persist on every keystroke — too chatty, user may be refining query

### Where to Persist
- **D-07:** Add `browseState` to `DesktopSettings` interface in `app/src/shared/desktop-settings.ts`
- **D-08:** Store in existing `settings.json` via `saveDesktopSettings()` pattern
- **D-09:** New fields:
  ```typescript
  interface DesktopSettings {
    autoUpdateEnabled: boolean;
    startOnLoginEnabled: boolean;
    browseState?: {
      searchQuery?: string;
      activeCategory?: string;
      activeTab?: string;
    };
  }
  ```

### State Restoration
- **D-10:** On Dashboard mount, read `browseState` from settings
- **D-11:** If `activeTab` is "browse", show Browse tab with restored query/category
- **D-12:** If `activeTab` is "servers" or "settings", show that tab
- **D-13:** Restore search input value and category selection in BrowseTab
- **D-14:** Auto-trigger search with restored query/category to fetch fresh results

### Code Changes Required
- `app/src/shared/desktop-settings.ts`:
  - Add `browseState` field to `DesktopSettings` interface
  - Add default value in `DEFAULT_DESKTOP_SETTINGS`
- `app/src/main/settings-store.ts`:
  - Update `normalizeSettings()` to handle `browseState`
- `app/src/renderer/components/Dashboard.tsx`:
  - Load `browseState` on mount
  - Initialize `tab` state from persisted `activeTab`
  - Pass `browseState` and save callback to BrowseTab
- `app/src/renderer/components/BrowseTab.tsx`:
  - Accept `initialQuery`, `initialCategory`, `onStateChange` props
  - Initialize `searchInput` and `activeCategory` from props
  - Call `onStateChange` on search submit and category click

</decisions>

<specifics>
## Specific Ideas

- User preference (Phase 5): "I don't want any caching, etc in my project. I want to strictly just use the API when possible."
- Minimal state persistence for convenience, no result caching

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — BROWSE-03 (search state persists between window opens)

### Code Files
- `app/src/shared/desktop-settings.ts` — Settings type definitions
- `app/src/main/settings-store.ts` — Settings persistence logic
- `app/src/renderer/components/Dashboard.tsx` — Dashboard layout and tab state
- `app/src/renderer/components/BrowseTab.tsx` — Browse tab with search UI
- `app/src/renderer/hooks/useMcpx.ts` — useRegistryList hook

### Prior Context
- `.planning/phases/05-fuzzy-search-fix/05-CONTEXT.md` — User preference: no caching, use API

</canonical_refs>

<code_context>
## Existing Code Insights

### Current State Management
- BrowseTab uses local React state: `searchInput`, `activeQuery`, `activeCategory`
- Dashboard uses local React state: `tab` for active tab
- All state is lost when dashboard window closes

### Settings Persistence Pattern
```typescript
// app/src/shared/desktop-settings.ts
interface DesktopSettings {
  autoUpdateEnabled: boolean;
  startOnLoginEnabled: boolean;
}

// app/src/main/settings-store.ts
function saveDesktopSettings(settings: DesktopSettings): DesktopSettings
function loadDesktopSettings(): DesktopSettings
function updateDesktopSettings(patch: DesktopSettingsPatch): DesktopSettings
```

### Settings Storage Location
- Path: `app.getPath("userData") + "/settings.json"`
- Example: `~/Library/Application Support/mcpx-desktop/settings.json`

### IPC Integration
- Settings are read/written in main process
- Renderer accesses via IPC (need to add new IPC handlers for browse state)

### Current BrowseTab Props
```typescript
interface BrowseTabProps {
  onServerAdded: () => void;
  status: { servers: Array<{ name: string }> };
}
```

### After Change
```typescript
interface BrowseTabProps {
  onServerAdded: () => void;
  status: { servers: Array<{ name: string }> };
  initialState?: {
    searchQuery?: string;
    activeCategory?: string;
  };
  onStateChange?: (state: { searchQuery?: string; activeCategory?: string }) => void;
}
```

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-search-state-persistence*
*Context gathered: 2026-03-25*