import assert from "node:assert/strict";
import test from "node:test";
import {
  createPropertyHighlightAgentGraph,
  runPropertyHighlightAgent
} from "./property-highlight-agent.mjs";
import {
  createPropertyHighlightContentServices,
  fallbackHighlightStrategy,
  fallbackTalk30s,
  fallbackTrendPatterns
} from "./property-highlight-content.mjs";
import { ManualCaseLibrary } from "../providers/manual-case-library.mjs";

const input = {
  floorplanAnalysis: {
    schemaVersion: "floorplan-analysis/v1",
    layoutType: "2室2厅1卫",
    area: "63㎡",
    orientation: "南向",
    rooms: [
      { id: "primary", type: "primary_bedroom" },
      { id: "bedroom_a", type: "bedroom" },
      { id: "living", type: "living_room" }
    ],
    features: { lighting: "good", dynamicStaticZoning: "good" },
    unknowns: [],
    needsReview: []
  },
  property: {
    city: "北京",
    district: "朝阳",
    community: "示例小区"
  },
  manualHighlights: ["客厅可看小区中庭"]
};

function localServices(overrides = {}) {
  return {
    enrichCases: async (cases) => cases.map((item) => ({
      ...item,
      theme: item.theme || "真实居住体验",
      target_audience: item.target_audience || "刚需家庭",
      hook_type: item.hook_type || "真实经历切入",
      structure: item.structure || "痛点 → 居住价值 → 生活感受",
      tone: item.tone || "真实克制"
    })),
    extractTrendPatterns: async (notes) => fallbackTrendPatterns(notes),
    generateHighlightStrategy: async (args) => fallbackHighlightStrategy(args),
    generateTalk30s: async (strategy) => fallbackTalk30s(strategy),
    ...overrides
  };
}

test("manual case library loads current samples and converts metrics", () => {
  const library = new ManualCaseLibrary();
  const cases = library.load();
  assert.equal(cases.length, 4);
  assert.equal(typeof cases[0].metrics.likes, "number");
  assert.equal(typeof cases[0].metrics.collections, "number");
  assert.equal(typeof cases[0].metrics.comments, "number");
  assert.equal(library.load(), cases);
});

test("Agent 2 directly matches at most three cases without an interrupt", async () => {
  const library = new ManualCaseLibrary();
  const graph = createPropertyHighlightAgentGraph({
    caseLibrary: library,
    contentServices: localServices()
  });
  const result = await runPropertyHighlightAgent(graph, input);

  assert.equal(result.__interrupt__, undefined);
  assert.equal(result.status, "completed");
  assert.equal(result.selectedNotes.length, 3);
  assert.equal(result.selectedNotes[0].relevance.reasons.length > 0, true);
  assert.deepEqual(result.executionPath, [
    "prepare_context",
    "load_manual_cases",
    "enrich_case_metadata",
    "match_relevant_cases",
    "extract_case_patterns",
    "generate_highlight_strategy",
    "generate_talk_30s",
    "audit_highlight_output"
  ]);
});

test("empty case metadata is enriched with non-empty fallback fields", async () => {
  const services = createPropertyHighlightContentServices({
    jsonClient: {
      generate: async () => ({ cases: [{ id: "case_1", theme: "", structure: "" }] })
    }
  });
  const [enriched] = await services.enrichCases([{
    id: "case_1",
    title: "63平的小房子",
    body: "一室一厅，适合独居",
    theme: "",
    target_audience: "",
    hook_type: "",
    structure: "",
    tone: "",
    created_at: ""
  }]);

  assert.ok(enriched.theme);
  assert.ok(enriched.target_audience);
  assert.ok(enriched.hook_type);
  assert.ok(enriched.structure);
  assert.ok(enriched.tone);
});

test("invalid empty audience and angle fall back instead of stopping the graph", async () => {
  const graph = createPropertyHighlightAgentGraph({
    caseLibrary: new ManualCaseLibrary(),
    contentServices: localServices({
      generateHighlightStrategy: async () => ({
        audience: "",
        angle: "",
        highlights: []
      })
    })
  });
  const result = await runPropertyHighlightAgent(graph, input);

  assert.ok(result.highlightStrategy.audience);
  assert.ok(result.highlightStrategy.angle);
  assert.equal(result.status, "completed");
  assert.match(result.warnings.join(" "), /补全/);
});

test("fallback talk uses only current property highlights, not case facts", async () => {
  const graph = createPropertyHighlightAgentGraph({
    caseLibrary: new ManualCaseLibrary(),
    contentServices: localServices()
  });
  const result = await runPropertyHighlightAgent(graph, input);

  assert.match(result.talk30s.talk30s, /客厅可看小区中庭/);
  assert.doesNotMatch(result.talk30s.talk30s, /130W|30万|160w|248/);
  assert.doesNotMatch(result.talk30s.talk30s, /东三环|五环/);
});
