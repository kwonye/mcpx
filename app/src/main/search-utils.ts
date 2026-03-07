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

export function matchSearchQuery(
  server: RegistryServerEntry,
  query: string,
  options: SearchOptions = {}
): boolean {
  const {
    fields = DEFAULT_FIELDS,
    caseSensitive = false
  } = options;

  const searchText = query.toLowerCase();
  
  const searchableTexts: string[] = [];

  if (fields.includes("name")) {
    searchableTexts.push(server.server.name);
  }

  if (fields.includes("title") && server.server.title) {
    searchableTexts.push(server.server.title);
  }

  if (fields.includes("description") && server.server.description) {
    searchableTexts.push(server.server.description);
  }

  if (fields.includes("repository") && server.server.repository?.url) {
    searchableTexts.push(server.server.repository.url);
    if (server.server.repository.subfolder) {
      searchableTexts.push(server.server.repository.subfolder);
    }
  }

  if (fields.includes("packages") && server.server.packages) {
    for (const pkg of server.server.packages) {
      searchableTexts.push(pkg.identifier);
      if (pkg.runtimeHint) {
        searchableTexts.push(pkg.runtimeHint);
      }
    }
  }

  return searchableTexts.some(text => 
    caseSensitive 
      ? text.includes(query)
      : text.toLowerCase().includes(searchText)
  );
}

export function filterServersByQuery(
  servers: RegistryServerEntry[],
  query: string,
  options?: SearchOptions
): RegistryServerEntry[] {
  if (!query || !query.trim()) {
    return servers;
  }

  return servers.filter(server => 
    matchSearchQuery(server, query, options)
  );
}

export function calculateRelevanceScore(
  server: RegistryServerEntry,
  query: string
): number {
  const searchText = query.toLowerCase();
  let score = 0;

  const nameLower = server.server.name.toLowerCase();
  const titleLower = (server.server.title || "").toLowerCase();
  const descriptionLower = (server.server.description || "").toLowerCase();

  if (nameLower === searchText) {
    score += 100;
  } else if (nameLower.startsWith(searchText)) {
    score += 50;
  } else if (nameLower.includes(searchText)) {
    score += 30;
  }

  if (titleLower === searchText) {
    score += 80;
  } else if (titleLower.startsWith(searchText)) {
    score += 40;
  } else if (titleLower.includes(searchText)) {
    score += 20;
  }

  if (descriptionLower.includes(searchText)) {
    score += 10;
    const words = descriptionLower.split(/\s+/);
    if (words.some(word => word.startsWith(searchText))) {
      score += 5;
    }
  }

  if (server.server.repository?.url) {
    const repoUrl = server.server.repository.url.toLowerCase();
    if (repoUrl.includes(searchText)) {
      score += 15;
    }
  }

  if (server.server.packages) {
    for (const pkg of server.server.packages) {
      const identifier = pkg.identifier.toLowerCase();
      if (identifier.includes(searchText)) {
        score += 25;
        break;
      }
    }
  }

  return score;
}

export function sortServersByRelevance(
  servers: RegistryServerEntry[],
  query: string
): RegistryServerEntry[] {
  if (!query || !query.trim()) {
    return servers;
  }

  return [...servers].sort((a, b) => {
    const scoreA = calculateRelevanceScore(a, query);
    const scoreB = calculateRelevanceScore(b, query);
    return scoreB - scoreA;
  });
}
