---
phase: 02-fuzzy-search
plan: 02
type: execute
wave: 2
depends_on: ["00", "01"]
files_modified: [app/e2e/search.spec.ts]
autonomous: true
requirements: [SEARCH-01, SEARCH-02, SEARCH-03, SEARCH-04]
must_haves:
  truths:
    - "Complete search flow works: type with typo, see fuzzy results"
    - "All 4 SEARCH requirements verified with E2E tests"
  artifacts:
    - path: "app/e2e/search.spec.ts"
      provides: "E2E tests for fuzzy search"
      contains: "test.describe.*search"
  key_links:
    - from: "app/e2e/search.spec.ts"
      to: "app/src/renderer/components/BrowseTab.tsx"
      via: "electron.launch + window.locator"
      pattern: "locator.*search.*input"
---

<objective>
Create E2E tests to verify complete fuzzy search flow with typo tolerance and debounced input.

Purpose: Verify all 4 SEARCH requirements work end-to-end in the real app.
Output: E2E test suite for search functionality.
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

# Search requirements to verify:
- SEARCH-01: Fuzzy/partial matches
- SEARCH-02: Relevance ranking
- SEARCH-03: Debounced input
- SEARCH-04: Typo tolerance

# E2E test pattern from existing tests:
```typescript
const app = await electron.launch({ args: [mainPath] });
const window = await app.firstWindow();
await window.locator('.browse-search input').fill('filesytem');
await window.waitForSelector('.browse-results');
```
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create E2E test for fuzzy search</name>
  <files>app/e2e/search.spec.ts</files>
  <behavior>
    - Test typing typo "filesytem" matches "filesystem" server
    - Test partial match "brve" matches "brave"
    - Test results are ordered by relevance (exact match first)
    - Test debounced search updates results after input
  </behavior>
  <action>
    Create app/e2e/search.spec.ts:
    
    ```typescript
    import { test, expect, _electron as electron } from '@playwright/test';
    import { resolve } from 'node:path';
    
    const mainPath = resolve(__dirname, '../out/main/index.js');
    
    test.describe('fuzzy search', () => {
      test('finds server with typo in name', async () => {
        const app = await electron.launch({ args: [mainPath] });
        
        // Navigate to Browse tab
        const window = await app.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        
        // Click Browse tab
        await window.locator('button:has-text("Browse Registry")').click();
        
        // Type with typo
        const searchInput = window.locator('.browse-search input');
        await searchInput.fill('filesytem');  // Typo: missing 's'
        
        // Wait for debounced search
        await window.waitForTimeout(400);  // 300ms debounce + buffer
        
        // Verify results contain filesystem-related servers
        const results = window.locator('.browse-card');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
        
        // Verify at least one result mentions file/filesystem
        const firstResult = await results.first().textContent();
        expect(firstResult?.toLowerCase()).toMatch(/file/i);
        
        await app.close();
      });
      
      test('finds server with partial name', async () => {
        const app = await electron.launch({ args: [mainPath] });
        const window = await app.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        
        await window.locator('button:has-text("Browse Registry")').click();
        
        const searchInput = window.locator('.browse-search input');
        await searchInput.fill('brve');  // Partial: missing 'a'
        
        await window.waitForTimeout(400);
        
        const results = window.locator('.browse-card');
        const count = await results.count();
        
        if (count > 0) {
          const text = await results.first().textContent();
          expect(text?.toLowerCase()).toMatch(/brave/i);
        }
        
        await app.close();
      });
      
      test('ranks exact match higher than fuzzy match', async () => {
        const app = await electron.launch({ args: [mainPath] });
        const window = await app.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        
        await window.locator('button:has-text("Browse Registry")').click();
        
        const searchInput = window.locator('.browse-search input');
        await searchInput.fill('github');  // Exact match
        
        await window.waitForTimeout(400);
        
        const firstCard = window.locator('.browse-card').first();
        const text = await firstCard.textContent();
        
        // First result should mention github
        expect(text?.toLowerCase()).toMatch(/github/i);
        
        await app.close();
      });
    });
    ```
  </action>
  <verify>
    <automated>npm run e2e --prefix app -- search.spec.ts</automated>
  </verify>
  <done>
    E2E search tests created. Typo tolerance, partial matches, and relevance verified.
  </done>
</task>

</tasks>

<verification>
- Build succeeds: `npm run build --prefix app`
- E2E tests pass: `npm run e2e --prefix app -- search.spec.ts`
- All 4 SEARCH requirements verified
</verification>

<success_criteria>
- SEARCH-01 verified: Fuzzy matches work
- SEARCH-02 verified: Results ranked by relevance
- SEARCH-03 verified: Debounced input works
- SEARCH-04 verified: Typo tolerance works
- E2E test suite covers all search scenarios
</success_criteria>

<output>
After completion, create `.planning/phases/02-fuzzy-search/02-fuzzy-search-02-SUMMARY.md` with:
- E2E test results
- Verification of all 4 SEARCH requirements
- Examples of fuzzy matching in action
</output>