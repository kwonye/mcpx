import Fuse from "fuse.js";
import type { RegistryServerEntry } from "./registry-client";

export interface SearchOptions {
  fields?: Array<"name" | "title" | "description" | "repository" | "packages">;
  caseSensitive?: boolean;
}

const DEFAULT_FIELDS: SearchOptions["fields"] = [
  "name",
  "title",
  "description",
  "repository",
  "packages"
];

function createFuseIndex(
  servers: RegistryServerEntry[],
  options: SearchOptions = {}
): Fuse<RegistryServerEntry> {
  const { fields = DEFAULT_FIELDS } = options;
  
  const keys: Fuse.FuseOptionKey<RegistryServerEntry>[] = [];
  
  if (fields.includes("name")) {
    keys.push({ name: "server.name", weight: 0.7 });
  }
  if (fields.includes("title")) {
    keys.push({ name: "server.title", weight: 0.5 });
  }
  if (fields.includes("description")) {
    keys.push({ name: "server.description", weight: 0.3 });
  }
  if (fields.includes("repository")) {
    keys.push({ name: "server.repository.url", weight: 0.2 });
  }
  if (fields.includes("packages")) {
    keys.push({ name: "server.packages.identifier", weight: 0.4 });
  }

  return new Fuse(servers, {
    keys,
    threshold: 0.4,
    distance: 100,
    minMatchCharLength: 2,
    includeScore: true,
    ignoreLocation: true,
    findAllMatches: true,
    isCaseSensitive: options.caseSensitive ?? false,
  });
}

export function matchSearchQuery(
  server: RegistryServerEntry,
  query: string,
  options: SearchOptions = {}
): boolean {
  if (!query?.trim()) return true;
  
  const fuse = createFuseIndex([server], options);
  const results = fuse.search(query);
  return results.length > 0;
}

export function filterServersByQuery(
  servers: RegistryServerEntry[],
  query: string,
  options?: SearchOptions
): RegistryServerEntry[] {
  if (!query?.trim()) return servers;
  
  const fuse = createFuseIndex(servers, options);
  const results = fuse.search(query, { limit: 50 });
  return results.map((r) => r.item);
}

export function calculateRelevanceScore(
  server: RegistryServerEntry,
  query: string
): number {
  if (!query?.trim()) return 0;
  
  const fuse = createFuseIndex([server]);
  const results = fuse.search(query);
  if (results.length === 0) return 0;
  
  // Fuse.js score is 0 (perfect match) to 1 (no match)
  // Convert to our scale: higher = better
  const fuseScore = results[0].score ?? 1;
  return Math.round((1 - fuseScore) * 100);
}

export function sortServersByRelevance(
  servers: RegistryServerEntry[],
  query: string
): RegistryServerEntry[] {
  if (!query?.trim()) return servers;
  
  const fuse = createFuseIndex(servers);
  const results = fuse.search(query);
  // Results are already sorted by score (lower fuse score = better match)
  return results.map((r) => r.item);
}