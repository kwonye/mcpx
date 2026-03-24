# Phase 5: Fuzzy Search Fix - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix fuzzy search so queries like "vercel" return matching results. This phase removes redundant client-side filtering and relies on the registry API's native search capability. Search state persistence is Phase 9.

</domain>

<decisions>
## Implementation Decisions

### Search Architecture
- Use registry API's native search parameter (`?search=query`) — API already filters results
- Remove client-side Fuse.js filtering entirely — redundant with API search
- Remove Fuse.js dependency entirely — no longer needed
- Trust API result ordering — no client-side relevance sorting

### Type Definition
- Add `repository?: { url?: string; source?: string }` to `RegistryServerEntry.server` type
- This is for display purposes, not search functionality

### Code Cleanup
- Remove debug `console.log` from registry-client.ts line 85
- Delete search-utils.ts entirely

</decisions>

<specifics>
## Specific Ideas

- User preference: "I don't want any caching, etc in my project. I want to strictly just use the API when possible."
- Simpler is better — remove unnecessary client-side processing

</specifics>

<code_context>
## Existing Code Insights

### Current Flow (problematic)
```
User types "vercel"
    ↓
API called with ?search=vercel
    ↓
API returns 5 Vercel servers (already filtered)
    ↓
Fuse.js filters those 5 servers again (REDUNDANT)
    ↓
Fuse.js sorts by relevance
    ↓
Return to user
```

### New Flow (API-only)
```
User types "vercel"
    ↓
API called with ?search=vercel
    ↓
API returns 5 Vercel servers (already filtered & ordered)
    ↓
Return to user
```

### Files to Modify
- `app/src/main/registry-client.ts` — Remove Fuse.js import, remove client-side filtering, remove console.log, add repository type
- `app/src/main/search-utils.ts` — DELETE ENTIRELY

### Integration Points
- `BrowseTab.tsx` calls `useRegistryList` hook which calls `fetchRegistryServers`
- No changes needed to BrowseTab.tsx — API change is transparent to UI

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-fuzzy-search-fix*
*Context gathered: 2026-03-24*