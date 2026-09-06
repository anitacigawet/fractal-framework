export interface NotebookSource {
  id: string;
  title: string;
  url?: string | null;
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeTitle(value).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3));
}

function uniqueSource(sources: NotebookSource[]): NotebookSource | null {
  // Repeated records for the same identity are harmless; competing identities
  // must remain unresolved even if their titles happen to be identical.
  const identities = new Map(sources.map((source) => [JSON.stringify([source.id, source.url]), source]));
  return identities.size === 1 ? [...identities.values()][0] : null;
}

export function findBestSourceMatch(description: string, sources: NotebookSource[]): NotebookSource | null {
  const query = description.trim();
  if (!query) return null;
  const known = sources.filter((source) => source.id && source.title);
  const linkedIdentity = (matches: NotebookSource[]) => {
    const match = uniqueSource(matches);
    return typeof match?.url === "string" && match.url.trim() ? match : null;
  };
  const ids = known.filter((source) => source.id === query);
  if (ids.length) return linkedIdentity(ids);
  const exact = known.filter((source) => normalizeTitle(source.title) === normalizeTitle(query));
  if (exact.length) return linkedIdentity(exact);
  const eligible = known.filter((source) => typeof source.url === "string" && source.url.trim());

  // Compatibility with saved responses that used a title description: require
  // at least two words and reject all best-score ties, regardless of list order.
  const words = tokenize(query);
  const scored = eligible.map((source) => {
    const sourceWords = tokenize(source.title);
    return { source, score: [...words].filter((word) => sourceWords.has(word)).length };
  });
  const bestScore = Math.max(0, ...scored.map(({ score }) => score));
  if (bestScore < 2) return null;
  return uniqueSource(scored.filter(({ score }) => score === bestScore).map(({ source }) => source));
}
