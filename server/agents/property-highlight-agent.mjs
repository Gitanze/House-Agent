import { randomUUID } from "node:crypto";
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph
} from "@langchain/langgraph";
import {
  highlightStrategySchema,
  propertyHighlightInputSchema,
  talk30sSchema,
  trendPatternsSchema
} from "./property-highlight-schema.mjs";
import {
  createPropertyHighlightContentServices,
  fallbackHighlightStrategy,
  fallbackTalk30s,
  fallbackTrendPatterns
} from "./property-highlight-content.mjs";

export const PropertyHighlightAgentState = Annotation.Root({
  input: Annotation(),
  context: Annotation(),
  cases: Annotation(),
  enrichedCases: Annotation(),
  selectedNotes: Annotation(),
  trendPatterns: Annotation(),
  highlightStrategy: Annotation(),
  talk30s: Annotation(),
  audit: Annotation(),
  status: Annotation(),
  warnings: Annotation({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  executionPath: Annotation({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  })
});

export function createPropertyHighlightAgentGraph(
  {
    caseLibrary,
    contentServices = createPropertyHighlightContentServices()
  } = {},
  options = {}
) {
  if (!caseLibrary || typeof caseLibrary.load !== "function" || typeof caseLibrary.match !== "function") {
    throw new TypeError("caseLibrary must provide load() and match()");
  }

  function prepareContextNode(state) {
    const input = propertyHighlightInputSchema.parse(state.input);
    return {
      input,
      context: {
        location: `${input.property.city}${input.property.district}`,
        community: input.property.community,
        layoutType: input.floorplanAnalysis.layoutType,
        area: input.floorplanAnalysis.area,
        manualHighlights: input.manualHighlights
      },
      status: "loading_cases",
      executionPath: ["prepare_context"]
    };
  }

  function loadCasesNode() {
    const cases = caseLibrary.load();
    return {
      cases,
      status: cases.length ? "cases_loaded" : "no_cases",
      warnings: cases.length ? [] : ["本地案例库为空，请先补充 samples.json。"],
      executionPath: ["load_manual_cases"]
    };
  }

  async function enrichCasesNode(state) {
    const enrichedCases = await contentServices.enrichCases(state.cases);
    return {
      enrichedCases,
      executionPath: ["enrich_case_metadata"]
    };
  }

  function matchCasesNode(state) {
    const selectedNotes = caseLibrary.match(state.enrichedCases, state.input, 3);
    return {
      selectedNotes,
      status: selectedNotes.length ? "cases_matched" : "no_matching_cases",
      warnings: selectedNotes.length ? [] : ["没有找到可用的本地参考案例。"],
      executionPath: ["match_relevant_cases"]
    };
  }

  async function extractTrendsNode(state) {
    const fallback = fallbackTrendPatterns(state.selectedNotes);
    const candidate = await contentServices.extractTrendPatterns(state.selectedNotes);
    const parsed = trendPatternsSchema.safeParse(candidate);
    return {
      trendPatterns: parsed.success ? parsed.data : fallback,
      warnings: parsed.success ? [] : ["案例结构提炼结果不完整，已使用本地兜底结构。"],
      executionPath: ["extract_case_patterns"]
    };
  }

  async function generateStrategyNode(state) {
    const fallback = fallbackHighlightStrategy({
      input: state.input,
      trendPatterns: state.trendPatterns
    });
    const candidate = await contentServices.generateHighlightStrategy({
      input: state.input,
      trendPatterns: state.trendPatterns
    });
    const parsed = highlightStrategySchema.safeParse(candidate);
    return {
      highlightStrategy: parsed.success ? parsed.data : fallback,
      warnings: parsed.success ? [] : ["亮点策略字段不完整，已使用当前房源事实补全。"],
      executionPath: ["generate_highlight_strategy"]
    };
  }

  async function generateTalkNode(state) {
    const fallback = fallbackTalk30s(state.highlightStrategy);
    const candidate = await contentServices.generateTalk30s(state.highlightStrategy);
    const parsed = talk30sSchema.safeParse(candidate);
    return {
      talk30s: parsed.success ? parsed.data : fallback,
      warnings: parsed.success ? [] : ["口播结果不完整，已使用亮点策略生成兜底口播。"],
      executionPath: ["generate_talk_30s"]
    };
  }

  function auditOutputNode(state) {
    const strategyTitles = new Set(
      state.highlightStrategy.highlights.map((item) => item.title)
    );
    const unsupported = state.talk30s.usedHighlights.filter(
      (title) => !strategyTitles.has(title)
    );
    const warnings = unsupported.map(
      (title) => `口播引用了未在当前房源亮点策略中出现的内容：${title}`
    );
    return {
      audit: {
        passed: warnings.length === 0,
        warnings,
        unsupportedHighlights: unsupported
      },
      warnings,
      status: warnings.length ? "needs_output_review" : "completed",
      executionPath: ["audit_highlight_output"]
    };
  }

  return new StateGraph(PropertyHighlightAgentState)
    .addNode("prepare_context", prepareContextNode)
    .addNode("load_manual_cases", loadCasesNode)
    .addNode("enrich_case_metadata", enrichCasesNode)
    .addNode("match_relevant_cases", matchCasesNode)
    .addNode("extract_case_patterns", extractTrendsNode)
    .addNode("generate_highlight_strategy", generateStrategyNode)
    .addNode("generate_talk_30s", generateTalkNode)
    .addNode("audit_highlight_output", auditOutputNode)
    .addEdge(START, "prepare_context")
    .addEdge("prepare_context", "load_manual_cases")
    .addEdge("load_manual_cases", "enrich_case_metadata")
    .addEdge("enrich_case_metadata", "match_relevant_cases")
    .addEdge("match_relevant_cases", "extract_case_patterns")
    .addEdge("extract_case_patterns", "generate_highlight_strategy")
    .addEdge("generate_highlight_strategy", "generate_talk_30s")
    .addEdge("generate_talk_30s", "audit_highlight_output")
    .addEdge("audit_highlight_output", END)
    .compile({ checkpointer: options.checkpointer || new MemorySaver() });
}

export async function runPropertyHighlightAgent(graph, input, options = {}) {
  const threadId = options.threadId || randomUUID();
  const result = await graph.invoke(
    { input, executionPath: [], warnings: [] },
    { configurable: { thread_id: threadId } }
  );
  return { ...result, threadId };
}
