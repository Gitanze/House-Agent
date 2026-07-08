import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const caseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().default(""),
  likes: z.coerce.number().nonnegative().default(0),
  collects: z.coerce.number().nonnegative().default(0),
  comments: z.coerce.number().nonnegative().default(0),
  theme: z.string().default(""),
  target_audience: z.string().default(""),
  hook_type: z.string().default(""),
  structure: z.string().default(""),
  tone: z.string().default(""),
  reusable_phrases: z.string().default(""),
  created_at: z.string().default("")
});

function extractArea(value) {
  const match = String(value || "").match(/(\d+(?:\.\d+)?)\s*(?:平|㎡|m²)/i);
  return match ? Number(match[1]) : null;
}

function heatScore(item) {
  return item.comments * 0.45 + item.collects * 0.35 + item.likes * 0.2;
}

function matchText(input) {
  return [
    input.property.city,
    input.property.district,
    input.property.community,
    input.floorplanAnalysis.layoutType,
    input.floorplanAnalysis.area,
    ...input.manualHighlights
  ].join(" ");
}

function usefulTerms(text) {
  const fixed = [
    "一室", "两室", "二室", "三室", "四室", "小户型", "改善", "刚需",
    "独居", "家庭", "精装", "二手房", "采光", "收纳", "通勤", "北京",
    "上海", "广州", "深圳"
  ];
  return fixed.filter((term) => text.includes(term));
}

export class ManualCaseLibrary {
  constructor(filePath = path.resolve("rednote/content_data/samples.json")) {
    this.filePath = filePath;
    this.cachedMtimeMs = -1;
    this.cachedCases = [];
  }

  load() {
    const stat = fs.statSync(this.filePath);
    if (stat.mtimeMs === this.cachedMtimeMs) return this.cachedCases;
    const parsed = z.array(caseSchema).parse(
      JSON.parse(fs.readFileSync(this.filePath, "utf8"))
    );
    this.cachedCases = parsed.map((item) => ({
      ...item,
      metrics: {
        likes: item.likes,
        collections: item.collects,
        comments: item.comments,
        shares: 0
      },
      heatScore: heatScore(item)
    }));
    this.cachedMtimeMs = stat.mtimeMs;
    return this.cachedCases;
  }

  match(cases, input, limit = 3) {
    const targetText = matchText(input);
    const targetTerms = usefulTerms(targetText);
    const targetArea = extractArea(input.floorplanAnalysis.area);
    const maxHeat = Math.max(1, ...cases.map((item) => item.heatScore));

    return cases
      .map((item) => {
        const caseText = `${item.title} ${item.body} ${item.theme} ${item.target_audience}`;
        const matchedTerms = targetTerms.filter((term) => caseText.includes(term));
        const caseArea = extractArea(caseText);
        const areaScore =
          targetArea && caseArea
            ? Math.max(0, 1 - Math.abs(targetArea - caseArea) / Math.max(targetArea, 30))
            : 0;
        const relevanceScore = matchedTerms.length * 3 + areaScore * 2;
        const totalScore = relevanceScore * 100 + item.heatScore / maxHeat;
        const reasons = [
          ...matchedTerms.slice(0, 3).map((term) => `匹配房源特征：${term}`),
          ...(areaScore >= 0.65 && caseArea ? [`面积接近：案例约${caseArea}㎡`] : [])
        ];
        return {
          ...item,
          relevance: {
            score: Number(relevanceScore.toFixed(2)),
            reasons: reasons.length ? reasons : ["作为高互动房产内容结构参考"]
          },
          ranking: { heatScore: Number(item.heatScore.toFixed(2)) },
          totalScore
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, Math.min(limit, cases.length));
  }
}

export { caseSchema, extractArea };
