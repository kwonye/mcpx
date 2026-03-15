---
phase: 02-fuzzy-search
plan: 00
type: execute
wave: 0
depends_on: []
files_modified: [app/package.json, app/src/main/search-utils.ts]
autonomous: true
requirements: [SEARCH-01, SEARCH-02]
must_haves:
  truths:
    - "Typing 'filesytem' matches 'filesystem MCP' (typo tolerance)"
    - "Search results ordered by match quality, not just filtered list"
  artifacts:
    - path: "app/package.json"
      provides: "fuse.js dependency"
      contains: "fuse.js"
    - path: "app/src/main/search-utils.ts"
      provides: "Fuzzy search with Fuse.js"
      exports: ["filterServersByQuery", "sortServersByRelevance"]
  key_links:
    - from: "app/src/main/search-utils.ts"
      to: "fuse.js"
      via: "import Fuse from 'fuse.js'"
      pattern: "new Fuse.*keys.*weight"
---

<objective>
Add Fuse.js for fuzzy search with typo tolerance and relevance-ranked results.

Purpose: Users can find MCP servers even with typos or partial matches.
Output: Fuse.js installed, search-utils refactored with fuzzy matching and weighted scoring.
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

# Current search-utils.ts implementation:
```typescript
// Uses simple includes() matching - no fuzzy
export function matchSearchQuery(server, query): boolean {
  return searchableTexts.some(text => 
    text.toLowerCase().includes(searchText)
  );
}

// Basic scoring - needs Fuse.js weights
export function calculateRelevanceScore(server, query): number {
  // name=100, title=80, description=10
}
```

# Fuse.js configuration from research:
```typescript
const fuseOptions = {
  keys: [
    { name: 'server.name', weight: 0.7 },
    { name: 'server.title', weight: 0.5 },
    { name: 'server.description', weight: 0.3 },
  ],
  threshold: 0.4,
  distance: 100,
  includeScore: true,
};
```
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install Fuse.js dependency</name>
  <files>app/package.json</files>
  <action>
    Add fuse.js to app/package.json dependencies:
    
    ```bash
    cd app && npm install fuse.js
    ```
    
    Verify version is ^7.1.0 or later.
  </action>
  <verify>
    <automated>npm ls fuse.js --prefix app</automated>
  </verify>
  <done>
    fuse.js appears in app/package.json dependencies with version ^7.1.0 or later.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Refactor search-utils with Fuse.js</name>
  <files>app/src/main/search-utils.ts</files>
  <behavior>
    - Fuse.js fuzzy search replaces includes() matching
    - Weighted keys: name (0.7), title (0.5), description (0.3), packages.identifier (0.4)
    - threshold: 0.4 for typo tolerance
    - includeScore: true for relevance ordering
    - Backward-compatible API: filterServersByQuery() and sortServersByRelevance() still work
  </behavior>
  <action>
    Rewrite app/src/main/search-utils.ts to use Fuse.js:
    
    1. Import Fuse at the top:
       ```typescript
       import Fuse from 'fuse.js';
       import type { RegistryServerEntry } from './registry-client';
       ```
    
    2. Create a function to get/create Fuse index:
       ```typescript
       function createFuseIndex(servers: RegistryServerEntry[]): Fuse<RegistryServerEntry> {
         return new Fuse(servers, {
           keys: [
             { name: 'server.name', weight: 0.7 },
             { name: 'server.title', weight: 0.5 },
             { name: 'server.description', weight: 0.3 },
             { name: 'server.packages.identifier', weight: 0.4 },
           ],
           threshold: 0.4,
           distance: 100,
           minMatchCharLength: 2,
           includeScore: true,
           ignoreLocation: true,
         });
       }
       ```
    
    3. Replace filterServersByQuery():
       ```typescript
       export function filterServersByQuery(
         servers: RegistryServerEntry[],
         query: string
       ): RegistryServerEntry[] {
         if (!query?.trim()) return servers;
         
         const fuse = createFuseIndex(servers);
         const results = fuse.search(query, { limit: 50 });
         return results.map(r => r.item);
       }
       ```
    
    4. Update sortServersByRelevance() to use Fuse scores:
       ```typescript
       export function sortServersByRelevance(
         servers: RegistryServerEntry[],
         query: string
       ): RegistryServerEntry[] {
         if (!query?.trim()) return servers;
         
         const fuse = createFuseIndex(servers);
         const results = fuse.search(query);
         // Results are already sorted by score (lower score = better match)
         return results.map(r => r.item);
       }
       ```
    
    5. Remove old matchSearchQuery() and calculateRelevanceScore() functions (replaced by Fuse.js)
    
    6. Keep SearchOptions interface for backward compatibility but note that Fuse.js ignores some options
  </action>
  <verify>
    <automated>npm test --prefix app -- registry-client.test.ts</automated>
  </verify>
  <done>
    search-utils.ts uses Fuse.js for fuzzy matching. filterServersByQuery() returns fuzzy matches. sortServersByRelevance() sorts by Fuse.js score. Existing tests updated or new fuzzy tests added.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Update tests for fuzzy matching</name>
  <files>app/test/registry-client.test.ts</files>
  <behavior>
    - Test "filesytem" matches "filesystem" (typo tolerance)
    - Test "pupeteer" matches "puppeteer" (typo tolerance)
    - Test "brve" matches "brave" (partial match)
    - Test results are ordered by relevance score
  </behavior>
  <action>
    Update app/test/registry-client.test.ts to test fuzzy matching:
    
    1. Add new test.describe block for fuzzy search:
       ```typescript
       test.describe('fuzzy search', () => {
         test('matches with typo: "filesytem" finds "filesystem"', () => {
           // Test that typo still matches
         });
         
         test('matches partial: "brve" finds "brave"', () => {
           // Test partial match
         });
         
         test('ranks exact match higher than fuzzy match', () => {
           // Test relevance ordering
         });
       });
       ```
    
    2. Update existing tests if they rely on exact match behavior
    
    3. Add mock data that demonstrates fuzzy matching (servers with similar names)
  </action>
  <verify>
    <automated>npm test --prefix app -- registry-client.test.ts</automated>
  </verify>
  <done>
    Fuzzy search tests pass. Typo tolerance verified. Relevance ordering verified.
  </done>
</task>

</tasks>

<verification>
- Build succeeds: `npm run build --prefix app`
- Tests pass: `npm test --prefix app`
- Fuzzy matching works: "filesytem" matches "filesystem"
</verification>

<success_criteria>
- SEARCH-01 addressed: Fuzzy/partial matches working
- SEARCH-02 addressed: Results ranked by Fuse.js score
- fuse.js installed and integrated
- Existing search API backward-compatible
</success_criteria>

<output>
After completion, create `.planning/phases/02-fuzzy-search/02-fuzzy-search-00-SUMMARY.md` with:
- Fuse.js installation details
- Refactored search-utils implementation
- Test results for fuzzy matching
- Examples of typo tolerance
</output>