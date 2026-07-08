function logMetric(value) {
  return Math.log1p(Math.max(0, Number(value) || 0));
}

function minMax(value, min, max) {
  if (max <= min) return value > 0 ? 1 : 0;
  return (value - min) / (max - min);
}

export function scoreXhsNotes(notes, now = Date.now()) {
  if (!notes.length) return [];
  const raw = notes.map((note) => ({
    likes: logMetric(note.metrics?.likes),
    collections: logMetric(note.metrics?.collections),
    comments: logMetric(note.metrics?.comments),
    shares: logMetric(note.metrics?.shares)
  }));
  const ranges = {};
  for (const field of ["likes", "collections", "comments", "shares"]) {
    const values = raw.map((item) => item[field]);
    ranges[field] = { min: Math.min(...values), max: Math.max(...values) };
  }

  return notes
    .map((note, index) => {
      const normalized = Object.fromEntries(
        Object.entries(raw[index]).map(([field, value]) => [
          field,
          minMax(value, ranges[field].min, ranges[field].max)
        ])
      );
      const engagement =
        normalized.collections * 0.4 +
        normalized.comments * 0.3 +
        normalized.likes * 0.2 +
        normalized.shares * 0.1;
      const publishedAt = Number(note.publishedAt) || 0;
      const timestampMs =
        publishedAt > 1e12 ? publishedAt : publishedAt > 0 ? publishedAt * 1000 : 0;
      const ageDays = timestampMs
        ? Math.max(0, (now - timestampMs) / 86400000)
        : 180;
      const freshness = Math.pow(0.5, ageDays / 90);
      const heatScore = Number((engagement * 0.8 + freshness * 0.2).toFixed(4));
      return {
        ...note,
        ranking: {
          heatScore,
          engagementScore: Number(engagement.toFixed(4)),
          freshnessScore: Number(freshness.toFixed(4)),
          scoreType: "interaction_heat"
        }
      };
    })
    .sort((a, b) => b.ranking.heatScore - a.ranking.heatScore);
}

function compactText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

export function filterRelevantXhsNotes(notes, input) {
  const propertyTerms = [
    input.property.city,
    input.property.district,
    input.property.community,
    input.floorplanAnalysis.layoutType,
    ...input.manualHighlights
  ]
    .map(compactText)
    .filter((term) => term && term !== "unknown");
  const realEstateTerms = [
    "买房",
    "看房",
    "房产",
    "房子",
    "户型",
    "小区",
    "楼盘",
    "采光",
    "动静分区",
    "三房",
    "两房",
    "居住"
  ];

  return notes
    .map((note) => {
      const text = compactText(`${note.title} ${note.body} ${note.sourceKeyword}`);
      const matchedPropertyTerms = propertyTerms.filter((term) => text.includes(term));
      const matchedRealEstateTerms = realEstateTerms.filter((term) => text.includes(term));
      const relevant =
        matchedRealEstateTerms.length > 0 &&
        (matchedPropertyTerms.length > 0 || note.ranking?.heatScore >= 0.7);
      return {
        ...note,
        relevance: {
          relevant,
          score: Math.min(
            1,
            matchedPropertyTerms.length * 0.25 +
              matchedRealEstateTerms.length * 0.15
          ),
          reasons: [
            ...matchedPropertyTerms.map((term) => `匹配房源词：${term}`),
            ...matchedRealEstateTerms.slice(0, 3).map((term) => `匹配房产主题：${term}`)
          ]
        }
      };
    })
    .filter((note) => note.relevance.relevant)
    .sort(
      (a, b) =>
        b.relevance.score * 0.45 +
        b.ranking.heatScore * 0.55 -
        (a.relevance.score * 0.45 + a.ranking.heatScore * 0.55)
    );
}
