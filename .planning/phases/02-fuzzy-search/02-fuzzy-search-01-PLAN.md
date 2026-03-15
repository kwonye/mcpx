---
phase: 02-fuzzy-search
plan: 01
type: execute
wave: 1
depends_on: ["00"]
files_modified: [app/src/renderer/components/BrowseTab.tsx, app/src/renderer/hooks/useMcpx.ts]
autonomous: true
requirements: [SEARCH-03]
must_haves:
  truths:
    - "Search input doesn't freeze UI while typing (debounced)"
    - "Results update in real-time as user types (after debounce)"
  artifacts:
    - path: "app/src/renderer/components/BrowseTab.tsx"
      provides: "Debounced search input"
      contains: "debounce|setTimeout"
    - path: "app/src/renderer/hooks/useMcpx.ts"
      provides: "Debounced search hook"
      exports: ["useRegistryList"]
  key_links:
    - from: "BrowseTab.tsx"
      to: "useMcpx.ts"
      via: "useRegistryList hook"
      pattern: "search.*debounce"
---

<objective>
Add debounced search input to prevent UI freezing and enable real-time results as user types.

Purpose: Search feels responsive without blocking UI or making too many API calls.
Output: Debounced search in BrowseTab with 300ms delay.
</objective>

<execution_context>
@/Users/will/.config/opencode/get-shit-done/workflows/execute-plan.md
@/Users/will/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-fuzzy-search/02-RESEARCH.md

# Current BrowseTab.tsx search:
```tsx
const handleSearch = (e: React.FormEvent) => {
  e.preventDefault();
  const normalizedQuery = searchInput.trim();
  setActiveCategory("");
  setActiveQuery(normalizedQuery);
  search(normalizedQuery);  // Immediate search, no debounce
};

<form className="browse-search" onSubmit={handleSearch}>
  <input
    type="text"
    placeholder="Search..."
    value={searchInput}
    onChange={(e) => setSearchInput(e.target.value)}  // Just updates local state
  />
  <button type="submit">Search</button>
</form>
```

# Current useRegistryList hook:
```typescript
const search = useCallback(async (query?: string) => {
  // No debounce, fires immediately
  setLoading(true);
  const result = await window.mcpx.registryList(undefined, normalizedQuery, limit);
  // ...
}, []);
```
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add debounce utility</name>
  <files>app/src/renderer/utils/debounce.ts</files>
  <behavior>
    - Simple debounce function with configurable delay
    - Returns debounced function and cancel method
    - Works with React useEffect cleanup
  </behavior>
  <action>
    Create new file app/src/renderer/utils/debounce.ts:
    
    ```typescript
    export function debounce<T extends (...args: any[]) => any>(
      fn: T,
      delay: number
    ): (...args: Parameters<T>) => void {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      
      return (...args: Parameters<T>) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
      };
    }
    ```
    
    This is a simple debounce without external dependencies (no lodash needed).
  </action>
  <verify>
    <automated>npx tsc --noEmit --prefix app</automated>
  </verify>
  <done>
    debounce utility created in app/src/renderer/utils/debounce.ts
  </done>
</task>

<task type="auto">
  <name>Task 2: Add debounced search to useRegistryList hook</name>
  <files>app/src/renderer/hooks/useMcpx.ts</files>
  <behavior>
    - search() becomes debounced with 300ms delay
    - Real-time search as user types
    - Cancel pending search on unmount or new input
  </behavior>
  <action>
    Update app/src/renderer/hooks/useMcpx.ts:
    
    1. Import useEffect for cleanup:
       ```typescript
       import { useCallback, useEffect, useRef, useState } from 'react';
       ```
    
    2. Add debounce to search function:
       ```typescript
       const DEBOUNCE_MS = 300;
       
       const search = useCallback(async (query?: string) => {
         const normalizedQuery = query?.trim();
         const requestId = ++requestIdRef.current;
         currentQueryRef.current = normalizedQuery;
         setLoading(true);
         try {
           const limit = normalizedQuery ? 200 : 100;
           const result = await window.mcpx.registryList(undefined, normalizedQuery || undefined, limit);
           if (requestId !== requestIdRef.current) return;
           // ... rest of existing logic
         } catch (err) {
           console.error("Registry search error:", err);
         } finally {
           if (requestId === requestIdRef.current) {
             setLoading(false);
           }
         }
       }, []);
       
       // Debounced version for input onChange
       const debouncedSearch = useRef(
         debounce((query: string) => search(query), DEBOUNCE_MS)
       ).current;
       ```
    
    3. Add cleanup on unmount:
       ```typescript
       useEffect(() => {
         return () => {
           // Cancel any pending debounced search
         };
       }, []);
       ```
    
    4. Return debouncedSearch in the hook:
       ```typescript
       return { 
         servers, 
         loading, 
         search,           // Immediate search (for form submit)
         debouncedSearch,  // Debounced search (for onChange)
         loadMore, 
         hasMore: Boolean(cursor) 
       };
       ```
  </action>
  <verify>
    <automated>npm test --prefix app</automated>
  </verify>
  <done>
    useRegistryList returns debouncedSearch function. Search debounced by 300ms.
  </done>
</task>

<task type="auto">
  <name>Task 3: Update BrowseTab to use debounced search</name>
  <files>app/src/renderer/components/BrowseTab.tsx</files>
  <behavior>
    - Input onChange triggers debounced search (real-time)
    - Form submit triggers immediate search (no debounce)
    - Search results update as user types
  </behavior>
  <action>
    Update app/src/renderer/components/BrowseTab.tsx:
    
    1. Get debouncedSearch from hook:
       ```typescript
       const { servers, loading, search, debouncedSearch, loadMore, hasMore } = useRegistryList();
       ```
    
    2. Add onChange handler for real-time search:
       ```typescript
       const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
         const value = e.target.value;
         setSearchInput(value);
         setActiveCategory("");
         debouncedSearch(value);  // Debounced search as user types
       };
       ```
    
    3. Update input to use onChange:
       ```tsx
       <input
         type="text"
         placeholder="Search for tools, databases, APIs..."
         value={searchInput}
         onChange={handleSearchInputChange}  // Real-time debounced search
       />
       ```
    
    4. Keep form submit for immediate search (when user presses Enter):
       ```typescript
       const handleSearch = (e: React.FormEvent) => {
         e.preventDefault();
         const normalizedQuery = searchInput.trim();
         setActiveCategory("");
         setActiveQuery(normalizedQuery);
         search(normalizedQuery);  // Immediate search on submit
       };
       ```
  </action>
  <verify>
    <automated>npm run build --prefix app</automated>
  </verify>
  <done>
    BrowseTab uses debounced search on input change. Search feels responsive without freezing.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Add tests for debounced search</name>
  <files>app/test/hooks/useMcpx.test.ts</files>
  <behavior>
    - Test debounce delay works (300ms)
    - Test rapid inputs only trigger one search
    - Test form submit bypasses debounce
  </behavior>
  <action>
    Create or update app/test/hooks/useMcpx.test.ts:
    
    ```typescript
    import { renderHook, act } from '@testing-library/react';
    import { vi } from 'vitest';
    import { useRegistryList } from '../../src/renderer/hooks/useMcpx';
    
    describe('useRegistryList debounce', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      
      afterEach(() => {
        vi.useRealTimers();
      });
      
      it('debounces search by 300ms', async () => {
        // Test that rapid calls only trigger one search after delay
      });
      
      it('cancels pending search on new input', () => {
        // Test that typing again cancels previous pending search
      });
    });
    ```
    
    Use vi.useFakeTimers() to test debounce timing without real delays.
  </action>
  <verify>
    <automated>npm test --prefix app -- useMcpx.test.ts</automated>
  </verify>
  <done>
    Debounce tests pass. Timing verified with fake timers.
  </done>
</task>

</tasks>

<verification>
- Build succeeds: `npm run build --prefix app`
- Tests pass: `npm test --prefix app`
- Search input feels responsive (no freezing)
</verification>

<success_criteria>
- SEARCH-03 addressed: Search input debounced to prevent UI freezing
- Real-time results as user types (after 300ms delay)
- Form submit bypasses debounce for immediate search
</success_criteria>

<output>
After completion, create `.planning/phases/02-fuzzy-search/02-fuzzy-search-01-SUMMARY.md` with:
- Debounce utility implementation
- useMcpx hook updates
- BrowseTab real-time search
- Test results
</output>