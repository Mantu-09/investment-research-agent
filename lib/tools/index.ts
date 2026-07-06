// ---------------------------------------------------------------------------
// Research Tools — barrel export
// ---------------------------------------------------------------------------

export { webResearch } from "./webResearch";
export type { WebResearchResult, SearchResult } from "./webResearch";

export { fetchFinancialData } from "./financialData";
export type {
  FinancialDataResult,
  CompanyOverview,
  StockQuote,
} from "./financialData";

export { fetchNewsFindings } from "./newsFindings";
export type {
  NewsFindingsResult,
  RedFlagItem,
  RedFlagCategory,
} from "./newsFindings";
