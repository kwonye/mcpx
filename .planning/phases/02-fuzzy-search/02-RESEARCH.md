---
phase: 02-fuzzy-search
research_completed: 2026-03-12
confidence: HIGH
stack_decision: Fuse.js 7.1.0
---

# Phase 2: Fuzzy Search - Research Summary

**Goal:** Users can find MCP servers even with typos or partial matches

**Requirements:** SEARCH-01, SEARCH-02, SEARCH-03, SEARCH-04

## Current State Analysis

### Existing Search Implementation

**File:** `app/src/main/search-utils.ts`
- `matchSearchQuery()` — uses simple `includes()` matching (exact substring)
- `filterServersByQuery()` — filters servers by exact match
- `calculateRelevanceScore()` — basic scoring (name=100, title=80, description=10)
- `sortServersByRelevance()` — sorts by score

**File:** `app/src/renderer/components/BrowseTab.tsx`
- Search input with `onSubmit` handler (no debounce)
- Calls `search(query)` on form submit
- No real-time filtering as user types

**File:** `app/src/main/registry-client.ts`
- Calls `filterServersByQuery()` and `sortServersByRelevance()` for search
- Works client-side after fetching from API

### Gaps

| Requirement | Current | Gap |
|-------------|---------|-----|
| SEARCH-01 (partial/fuzzy matches) | `includes()` only | Need Fuse.js fuzzy matching |
| SEARCH-02 (relevance ranking) | Basic scoring exists | Need Fuse.js weighted scoring |
| SEARCH-03 (debounced input) | No debounce | Need debounced search in BrowseTab |
| SEARCH-04 (typo tolerance) | No tolerance | Fuse.js provides this automatically |

## Recommended Implementation

### Fuse.js Configuration

```typescript
import Fuse from 'fuse.js';

const fuseOptions: Fuse.IFuseOptions<RegistryServerEntry> = {
  keys: [
    { name: 'server.name', weight: 0.7 },
    { name: 'server.title', weight: 0.5 },
    { name: 'server.description', weight: 0.3 },
    { name: 'server.packages.identifier', weight: 0.4 },
  ],
  threshold: 0.4,           // Lower = stricter (0.0-1.0)
  distance: 100,            // Max character distance for match
  minMatchCharLength: 2,    // Minimum characters to trigger match
  includeScore: true,       // Include relevance score
  ignoreLocation: true,     // Search anywhere in string
  findAllMatches: true,     // Find all matches, not just first
};
```

### Debounce Implementation

```typescript
// In BrowseTab.tsx or useMcpx.ts
import { useMemo, useCallback } from 'react';
import { debounce } from 'lodash-es'; // or custom implementation

const debouncedSearch = useMemo(
  () => debounce((query: string) => search(query), 300),
  [search]
);
```

### Architecture Decision

**Option A:** Replace search-utils entirely with Fuse.js
- Pro: Simpler, single search implementation
- Con: Lose custom scoring logic

**Option B:** Fuse.js for fuzzy + keep existing scoring
- Pro: Preserve custom relevance weights
- Con: More complex, two scoring systems

**Recommendation:** Option A — Fuse.js with configured weights handles both fuzzy matching AND relevance scoring.

## Dependencies

| Package | Version | Size | Purpose |
|---------|---------|------|---------|
| fuse.js | ^7.1.0 | 6KB gzipped | Fuzzy search engine |

**Note:** Fuse.js has zero dependencies, actively maintained (Feb 2025), 20k+ GitHub stars.

## Performance Considerations

1. **Index Size:** Typical registry has ~100-500 servers, Fuse.js handles this trivially
2. **Debounce:** 250-300ms prevents excessive re-indexing
3. **Result Limiting:** Limit to top 20-50 results for performance

## Files to Modify

| File | Change |
|------|--------|
| `app/package.json` | Add fuse.js dependency |
| `app/src/main/search-utils.ts` | Replace with Fuse.js implementation |
| `app/src/renderer/components/BrowseTab.tsx` | Add debounced search |
| `app/src/renderer/hooks/useMcpx.ts` | Optionally add debounce to search hook |
| `app/test/registry-client.test.ts` | Update tests for fuzzy matching |

## Test Strategy

1. **Unit tests:** Test Fuse.js configuration with typo cases
   - "filesytem" → matches "filesystem"
   - "pupeteer" → matches "puppeteer"
   - "brve" → matches "brave"

2. **Integration tests:** Test BrowseTab debounced search
   - Verify debounce timing
   - Verify results update after debounce

3. **E2E tests:** Test full search flow
   - Type with typo, verify correct results

---

*Research completed: 2026-03-12*
*Ready for planning: yes*