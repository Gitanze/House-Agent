function roomCount(input, types) {
  return input.floorplanAnalysis.rooms.filter((room) => types.includes(room.type)).length;
}

export function fallbackTrendPatterns(notes) {
  return notes.slice(0, 5).map((note) => ({
    hook: note.hook_type || "从真实居住价值切入",
    structure: note.structure || "亮点钩子 → 居住价值 → 适合人群",
    keywords: Array.from(
      new Set(
        `${note.theme || ""} ${note.target_audience || ""} ${note.tone || ""}`
          .split(/[\s、，,｜|]+/)
          .map((item) => item.trim())
          .filter((item) => item.length >= 2)
      )
    ).slice(0, 6),
    sourceNoteIds: [note.id]
  }));
}

export function fallbackHighlightStrategy({ input, trendPatterns }) {
  const highlights = input.manualHighlights.slice(0, 2).map((item) => ({
    title: item,
    value: `这是房源方人工补充的重要信息，适合在口播中直接说明其实际价值。`,
    sourceType: "manual",
    evidence: item
  }));
  const rooms = input.floorplanAnalysis.rooms;
  const features = input.floorplanAnalysis.features || {};

  if (highlights.length < 3 && features.lighting === "good") {
    highlights.push({
      title: "主要空间采光较好",
      value: "日常公共活动空间更明亮，居住舒适度更容易被感知。",
      sourceType: "floorplan",
      evidence: "客观户型分析中的 lighting=good"
    });
  }
  if (
    highlights.length < 3 &&
    features.dynamicStaticZoning === "good"
  ) {
    highlights.push({
      title: "动静分区清晰",
      value: "会客和卧室休息区相对分开，家庭成员之间的干扰更少。",
      sourceType: "floorplan",
      evidence: "客观户型分析中的 dynamicStaticZoning=good"
    });
  }
  if (highlights.length < 3 && roomCount(input, ["primary_bedroom", "bedroom", "child_room"]) >= 3) {
    highlights.push({
      title: "多房间使用弹性",
      value: "卧室、书房或儿童房可以按家庭阶段灵活调整。",
      sourceType: "floorplan",
      evidence: `识别出 ${roomCount(input, ["primary_bedroom", "bedroom", "child_room"])} 个卧室空间`
    });
  }
  if (highlights.length === 0) {
    highlights.push({
      title: input.floorplanAnalysis.layoutType,
      value: "空间功能需要结合真实家庭需求进一步确认。",
      sourceType: "floorplan",
      evidence: "客观户型识别结果"
    });
  }

  return {
    audience: roomCount(input, ["primary_bedroom", "bedroom", "child_room"]) >= 3
      ? "重视空间弹性的改善型家庭"
      : "关注实用布局的刚需或小家庭",
    angle: trendPatterns[0]?.structure || "从真实居住价值切入",
    highlights: highlights.slice(0, 3)
  };
}

export function fallbackTalk30s(strategy) {
  const selected = strategy.highlights.slice(0, 3);
  const lead = selected[0];
  const rest = selected.slice(1);
  const talk30s = [
    `这套房最值得先看的，是${lead.title}。${lead.value}`,
    ...rest.map((item) => `另外，${item.title}，${item.value}`),
    `整体更适合${strategy.audience}。`
  ].join("");
  return {
    openingHook: `这套房最值得先看的，是${lead.title}。`,
    talk30s,
    usedHighlights: selected.map((item) => item.title)
  };
}

function truncateNotes(notes) {
  return notes.map((note) => ({
    id: note.id,
    theme: note.theme,
    targetAudience: note.target_audience,
    hookType: note.hook_type,
    structure: note.structure,
    tone: note.tone,
    metrics: note.metrics,
    ranking: note.ranking,
    relevance: note.relevance
  }));
}

export function createPropertyHighlightContentServices({ jsonClient } = {}) {
  const enrichmentCache = new Map();

  function fallbackMetadata(item) {
    const text = `${item.title} ${item.body}`;
    return {
      theme: item.theme || (text.includes("小户型") ? "小户型居住价值" : "真实买房与居住体验"),
      target_audience:
        item.target_audience ||
        (text.includes("独居") || text.includes("一室") ? "独居或首次置业人群" : "关注实际居住体验的购房人群"),
      hook_type: item.hook_type || (/\d/.test(item.title) ? "数字信息制造注意力" : "真实经历切入"),
      structure: item.structure || "个人处境或痛点 → 房源价值 → 入住感受",
      tone: item.tone || "真实、克制、有生活感"
    };
  }

  return {
    async enrichCases(cases) {
      if (!cases.length) return [];
      const signature = cases.map((item) => `${item.id}:${item.created_at}`).join("|");
      if (enrichmentCache.has(signature)) return enrichmentCache.get(signature);
      const fallbacks = cases.map((item) => ({ ...item, ...fallbackMetadata(item) }));
      if (!jsonClient) {
        enrichmentCache.set(signature, fallbacks);
        return fallbacks;
      }
      try {
        const generated = await jsonClient.generate([
          {
            role: "system",
            content:
              "你是房产内容案例标注节点。只分析表达方式，不复制案例中的价格、位置、装修或配套事实。为每个案例输出主题、目标人群、钩子类型、叙事结构和语气。输出 JSON。"
          },
          {
            role: "user",
            content: `案例：\n${JSON.stringify(cases.map((item) => ({
              id: item.id,
              title: item.title,
              bodyExcerpt: String(item.body).slice(0, 900)
            })), null, 2)}\n\n输出 {"cases":[{"id":"","theme":"","target_audience":"","hook_type":"","structure":"","tone":""}]}。`
          }
        ]);
        const byId = new Map(
          (Array.isArray(generated?.cases) ? generated.cases : [])
            .filter((item) => item?.id)
            .map((item) => [item.id, item])
        );
        const enriched = fallbacks.map((item) => {
          const generatedItem = byId.get(item.id) || {};
          return {
            ...item,
            theme: String(generatedItem.theme || item.theme),
            target_audience: String(generatedItem.target_audience || item.target_audience),
            hook_type: String(generatedItem.hook_type || item.hook_type),
            structure: String(generatedItem.structure || item.structure),
            tone: String(generatedItem.tone || item.tone)
          };
        });
        enrichmentCache.set(signature, enriched);
        return enriched;
      } catch {
        enrichmentCache.set(signature, fallbacks);
        return fallbacks;
      }
    },

    async extractTrendPatterns(notes) {
      const fallback = fallbackTrendPatterns(notes);
      if (!jsonClient || notes.length === 0) return fallback;
      try {
        return (
          (await jsonClient.generate([
          {
            role: "system",
            content:
              "你是房产内容研究节点。只提炼抽象的钩子类型、叙事结构和表达关键词，不复现原文，不输出案例中的价格、位置、装修或配套事实。输出 JSON。"
          },
          {
            role: "user",
            content: `参考笔记：\n${JSON.stringify(truncateNotes(notes), null, 2)}\n\n输出 {"patterns":[{"hook":"","structure":"","keywords":[],"sourceNoteIds":[]}]}，最多5条。`
          }
          ]))?.patterns || fallback
        );
      } catch {
        return fallback;
      }
    },

    async generateHighlightStrategy({ input, trendPatterns }) {
      const fallback = fallbackHighlightStrategy({ input, trendPatterns });
      if (!jsonClient) return fallback;
      try {
        const generated = await jsonClient.generate([
          {
            role: "system",
            content:
              "你是房源亮点策略节点。基于客观户型、人工信息和趋势结构选择2至3个亮点。必须标记来源，不能把趋势样本中的房源事实套到当前房源。输出 JSON。"
          },
          {
            role: "user",
            content: `当前房源：\n${JSON.stringify(input, null, 2)}\n\n趋势结构：\n${JSON.stringify(trendPatterns, null, 2)}\n\n输出 {"audience":"","angle":"","highlights":[{"title":"","value":"","sourceType":"floorplan|manual","evidence":""}]}。`
          }
        ]);
        return {
          audience: String(generated?.audience || fallback.audience),
          angle: String(generated?.angle || fallback.angle),
          highlights:
            Array.isArray(generated?.highlights) && generated.highlights.length
              ? generated.highlights
              : fallback.highlights
        };
      } catch {
        return fallback;
      }
    },

    async generateTalk30s(strategy) {
      const fallback = fallbackTalk30s(strategy);
      if (!jsonClient) return fallback;
      try {
        const generated = await jsonClient.generate([
          {
            role: "system",
            content:
              "你是房产短视频口播节点。生成约30秒中文口播：前三秒直给最强亮点，只讲2至3个亮点并说明生活价值，不流水账介绍户型，不使用夸张承诺。输出 JSON。"
          },
          {
            role: "user",
            content: `亮点策略：\n${JSON.stringify(strategy, null, 2)}\n\n输出 {"openingHook":"","talk30s":"","usedHighlights":[]}。`
          }
        ]);
        return {
          openingHook: String(generated?.openingHook || fallback.openingHook),
          talk30s: String(generated?.talk30s || fallback.talk30s),
          usedHighlights:
            Array.isArray(generated?.usedHighlights) && generated.usedHighlights.length
              ? generated.usedHighlights
              : fallback.usedHighlights
        };
      } catch {
        return fallback;
      }
    }
  };
}
