export const seoProviderCatalog = [
  { key: "search_console", label: "Google Search Console", data: "Search impressions, clicks and indexed-page evidence", connection: "OAuth authorization required" },
  { key: "rankings", label: "Keyword rankings", data: "Position observations supplied by a configured ranking provider", connection: "Provider authorization required" },
  { key: "ai_visibility", label: "AI visibility", data: "Cited-page observations supplied by a configured monitoring provider", connection: "Provider authorization required" },
] as const;

export type SeoProviderKey = (typeof seoProviderCatalog)[number]["key"];
export type ProviderConnectionState = "disconnected" | "authorization_required" | "connected" | "error";

export interface ProviderContext {
  orgId: string;
  websiteId: string;
  domain: string;
}

export interface ProviderEvidence<T> {
  provider: SeoProviderKey;
  retrievedAt: string;
  items: T[];
}

export interface SearchConsoleEvidence {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface RankingEvidence {
  keyword: string;
  location: string;
  observedAt: string;
  position: number;
  landingPage: string;
}

export interface AiVisibilityEvidence {
  prompt: string;
  engine: string;
  observedAt: string;
  cited: boolean;
  citedUrl?: string;
}

export interface SearchConsoleProvider {
  listProperties(context: ProviderContext): Promise<string[]>;
  queryPerformance(context: ProviderContext, from: string, to: string): Promise<ProviderEvidence<SearchConsoleEvidence>>;
}

export interface RankingProvider {
  queryRankings(context: ProviderContext, keywords: string[], location: string): Promise<ProviderEvidence<RankingEvidence>>;
}

export interface AiVisibilityProvider {
  queryObservations(context: ProviderContext, prompts: string[]): Promise<ProviderEvidence<AiVisibilityEvidence>>;
}

export type SeoProviderAdapter = SearchConsoleProvider | RankingProvider | AiVisibilityProvider;

// Providers are registered only when an implementation is configured. An empty registry
// is an honest disconnected state; callers must never substitute demo or estimated metrics.
export function providerAvailability(
  key: SeoProviderKey,
  registered: ReadonlySet<SeoProviderKey>,
): ProviderConnectionState {
  return registered.has(key) ? "authorization_required" : "disconnected";
}
