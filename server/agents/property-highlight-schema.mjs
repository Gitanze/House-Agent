import { z } from "zod";

export const propertyHighlightInputSchema = z.object({
  floorplanAnalysis: z.object({
    schemaVersion: z.literal("floorplan-analysis/v1").optional(),
    layoutType: z.string().default("unknown"),
    area: z.string().default("unknown"),
    orientation: z.string().default("unknown"),
    rooms: z.array(z.object({
      id: z.string(),
      type: z.string(),
      name: z.string().optional()
    }).passthrough()).default([]),
    features: z.record(z.string(), z.unknown()).default({}),
    unknowns: z.array(z.string()).default([]),
    needsReview: z.array(z.string()).default([])
  }).passthrough(),
  property: z.object({
    city: z.string().trim().min(1, "请填写城市"),
    district: z.string().trim().min(1, "请填写板块或区域"),
    community: z.string().trim().min(1, "请填写小区名")
  }),
  manualHighlights: z.array(z.string().trim().min(1)).default([])
});

export const searchQueriesSchema = z
  .array(z.string().trim().min(2))
  .min(3, "至少需要 3 组搜索关键词")
  .max(5, "最多允许 5 组搜索关键词")
  .transform((queries) => Array.from(new Set(queries)));

export const trendPatternsSchema = z.array(z.object({
  hook: z.string().min(1),
  structure: z.string().min(1),
  keywords: z.array(z.string()),
  sourceNoteIds: z.array(z.string())
})).max(5);

export const highlightStrategySchema = z.object({
  audience: z.string().min(1),
  angle: z.string().min(1),
  highlights: z.array(z.object({
    title: z.string().min(1),
    value: z.string().min(1),
    sourceType: z.enum(["floorplan", "manual"]),
    evidence: z.string().min(1)
  })).min(1).max(3)
});

export const talk30sSchema = z.object({
  openingHook: z.string().min(1),
  talk30s: z.string().min(20),
  usedHighlights: z.array(z.string()).min(1).max(3)
});

export const propertyHighlightPlanSchema = z.object({
  schemaVersion: z.literal("property-highlight-plan/v1"),
  searchQueries: z.array(z.string()).default([]),
  sourceNotes: z.array(z.unknown()).default([]),
  trendPatterns: z.array(z.unknown()).default([]),
  highlightStrategy: z.array(z.unknown()).default([]),
  talk30s: z.string().default(""),
  warnings: z.array(z.string()).default([]),
  runMetadata: z.object({
    executionPath: z.array(z.string()),
    cacheHits: z.number().int().nonnegative().default(0),
    provider: z.string()
  })
});
