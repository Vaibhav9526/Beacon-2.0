import { config } from "./config.js";

export type VerificationSource = {
  kind: "fact-check" | "news";
  title: string;
  url: string;
  publisher: string;
  published_at?: string;
  rating?: string;
  claim?: string;
};

export type ExternalVerification = {
  verdict: "Supported" | "Contradicted" | "Corroborating coverage" | "Insufficient external evidence";
  status: "complete" | "partial" | "unavailable";
  summary: string;
  sources: VerificationSource[];
  providers: string[];
  checked_at: string;
  errors: string[];
  human_review_required: true;
};

const safeUrl = (value: unknown) => {
  try { const url = new URL(String(value)); return ["http:", "https:"].includes(url.protocol) ? url.toString() : null; } catch { return null; }
};
const safeError = (provider: string, error: unknown) => `${provider}: ${error instanceof Error ? error.message : "request failed"}`.slice(0, 180);

async function googleFactChecks(query: string) {
  if (!config.verification.googleFactCheckKey) return { sources: [] as VerificationSource[], provider: "google-fact-check:not-configured" };
  const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
  url.searchParams.set("query", query.slice(0, 300)); url.searchParams.set("languageCode", "en"); url.searchParams.set("pageSize", "5"); url.searchParams.set("key", config.verification.googleFactCheckKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(config.verification.timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json() as any;
  const sources = (json.claims || []).flatMap((claim: any) => (claim.claimReview || []).map((review: any) => ({
    kind: "fact-check" as const, title: String(review.title || claim.text || "Fact-check review").slice(0, 240), url: safeUrl(review.url), publisher: String(review.publisher?.name || review.publisher?.site || "Fact-check publisher").slice(0, 100), published_at: review.reviewDate, rating: String(review.textualRating || "Unrated").slice(0, 100), claim: String(claim.text || "").slice(0, 400),
  }))).filter((item: any) => item.url).slice(0, 5);
  return { sources, provider: "Google Fact Check Tools" };
}

async function gdeltCoverage(query: string) {
  const terms = query.normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 2).slice(0, 12).join(" ");
  if (!terms) return { sources: [] as VerificationSource[], provider: "GDELT DOC 2.0" };
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", terms); url.searchParams.set("mode", "artlist"); url.searchParams.set("format", "json"); url.searchParams.set("maxrecords", String(Math.min(20, config.verification.maxSources))); url.searchParams.set("timespan", "1week"); url.searchParams.set("sort", "datedesc");
  const response = await fetch(url, { signal: AbortSignal.timeout(config.verification.timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json() as any;
  const sources = (json.articles || []).map((article: any) => ({ kind: "news" as const, title: String(article.title || "Related coverage").slice(0, 240), url: safeUrl(article.url), publisher: String(article.domain || article.sourcecountry || "News source").slice(0, 100), published_at: article.seendate })).filter((item: any) => item.url).slice(0, config.verification.maxSources);
  return { sources, provider: "GDELT DOC 2.0" };
}

export async function verifyClaim(query: string): Promise<ExternalVerification> {
  const settled = await Promise.allSettled([googleFactChecks(query), gdeltCoverage(query)]);
  const sources: VerificationSource[] = [], providers: string[] = [], errors: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") { sources.push(...result.value.sources); providers.push(result.value.provider); }
    else errors.push(safeError(index === 0 ? "Google Fact Check" : "GDELT", result.reason));
  });
  const deduped = [...new Map(sources.map((source) => [source.url, source])).values()].slice(0, config.verification.maxSources);
  const ratings = deduped.filter((source) => source.kind === "fact-check").map((source) => (source.rating || "").toLowerCase());
  const contradicted = ratings.filter((rating) => /false|fake|misleading|incorrect|pants on fire|fabricated/.test(rating)).length;
  const supported = ratings.filter((rating) => /(^|\b)(true|correct|accurate|verified)(\b|$)/.test(rating) && !/not true|partly|half/.test(rating)).length;
  const domains = new Set(deduped.filter((source) => source.kind === "news").map((source) => source.publisher));
  const verdict: ExternalVerification["verdict"] = contradicted > supported ? "Contradicted" : supported > contradicted ? "Supported" : domains.size >= 2 ? "Corroborating coverage" : "Insufficient external evidence";
  const status = settled.every((item) => item.status === "rejected") ? "unavailable" : errors.length ? "partial" : "complete";
  const summary = verdict === "Contradicted" ? `${contradicted} published fact-check review(s) conflict with the claim.` : verdict === "Supported" ? `${supported} published fact-check review(s) support the claim.` : verdict === "Corroborating coverage" ? `Related coverage was found across ${domains.size} publishers; this is corroboration, not proof.` : "No decisive external fact-check match was found. Review citizen evidence and field corroboration.";
  return { verdict, status, summary, sources: deduped, providers, checked_at: new Date().toISOString(), errors, human_review_required: true };
}
