import { z } from "zod";
import { loadVoiceoverSkill } from "./voiceover-skill-loader.mjs";

const durationSchema = z.union([z.literal(60), z.literal(90)]);
const styleSchema = z.enum([
  "local_highlight",
  "renovation_ready",
  "owner_story",
  "buyer_dilemma",
  "playful"
]);

const styleLabels = {
  local_highlight: "局部亮点型",
  renovation_ready: "装修省心型",
  owner_story: "业主个人叙述型",
  buyer_dilemma: "看房人纠结型",
  playful: "搞笑抽象互动型"
};

const inputSchema = z.object({
  duration: durationSchema.default(60),
  style: styleSchema.default("buyer_dilemma"),
  floorplanAnalysis: z.object({
    layoutType: z.string().optional(),
    area: z.string().optional(),
    orientation: z.string().optional(),
    rooms: z.array(z.object({
      id: z.string(),
      type: z.string(),
      name: z.string().optional(),
      position: z.string().optional(),
      areaAssessment: z.string().optional(),
      geometry: z.string().optional(),
      orientation: z.string().optional(),
      connectedTo: z.array(z.string()).optional(),
      hasWindow: z.union([z.boolean(), z.literal("unknown")]).optional()
    }).passthrough()).default([]),
    basicRoute: z.string().optional(),
    unknowns: z.array(z.string()).default([]),
    needsReview: z.array(z.string()).default([])
  }).passthrough(),
  property: z.record(z.string(), z.unknown()).default({}),
  enrichedDescription: z.string().default(""),
  objectiveDescription: z.string().default(""),
  manualHighlights: z.array(z.string()).default([]),
  factConfirmations: z.array(z.object({
    question: z.string(),
    answer: z.string(),
    source: z.string().optional(),
    updatedAt: z.string().nullable().optional()
  })).default([]),
  refinementInstruction: z.string().trim().optional(),
  requireModel: z.boolean().default(false),
  baseScript: z.object({
    storyPositioning: z.string().default(""),
    voiceover: z.string().default(""),
    scenes: z.array(z.unknown()).default([])
  }).passthrough().optional()
});

const unknownFactValues = new Set(["", "待确认", "unknown", "未知", "不确定"]);
const chineseNumbers = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10
};

function normalizedFact(value) {
  const text = String(value || "").trim();
  return unknownFactValues.has(text.toLowerCase()) ? "" : text;
}

function numberValue(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (chineseNumbers[value.slice(1)] || 0);
  if (value.endsWith("十")) return (chineseNumbers[value[0]] || 0) * 10;
  return chineseNumbers[value] || null;
}

export function extractLayout(value) {
  const text = String(value || "");
  const match = text.match(/([一二两三四五六七八九十\d]+)\s*室(?:\s*([一二两三四五六七八九十\d]+)\s*厅)?(?:\s*([一二两三四五六七八九十\d]+)\s*卫)?(?:\s*([一二两三四五六七八九十\d]+)\s*厨)?/);
  if (!match) return null;
  const [rooms, halls, bathrooms, kitchens] = match.slice(1).map((item) =>
    item ? numberValue(item) : null
  );
  if (!rooms) return null;
  return [
    `${rooms}室`,
    halls ? `${halls}厅` : "",
    bathrooms ? `${bathrooms}卫` : "",
    kitchens ? `${kitchens}厨` : ""
  ].join("");
}

function layoutReview(input) {
  return [...input.factConfirmations]
    .reverse()
    .find((item) =>
      /(户型|厅室|几室|几厅)/.test(item.question)
      && normalizedFact(item.answer)
      && extractLayout(item.answer)
    );
}

function roomScriptFacts(room, limit = 2) {
  const facts = room.roomVisual?.analysis?.scriptFacts;
  if (!Array.isArray(facts)) return [];
  return facts.filter((item) => typeof item === "string" && item.trim()).slice(0, limit);
}

export function resolveScriptFacts(input) {
  const review = layoutReview(input);
  const reviewedLayout = review ? extractLayout(review.answer) : null;
  const declaredLayout = extractLayout(normalizedFact(input.property.declaredLayout));
  const authoritativeLayout = reviewedLayout || declaredLayout || null;
  return {
    authoritativeLayout,
    layoutStatus: authoritativeLayout ? "confirmed" : "unconfirmed",
    enrichedPropertyDescription:
      input.enrichedDescription || input.objectiveDescription || "未提供补充房源描述",
    humanReviewedFacts: input.factConfirmations
      .filter((item) => normalizedFact(item.answer))
      .map((item) => ({
        originalUncertainty: item.question,
        confirmedInformation: item.answer,
        source: "人工复核"
      })),
    roomVisualFacts: input.floorplanAnalysis.rooms.map((room) => ({
      roomId: room.id,
      roomName: room.name || room.type,
      scriptFacts: roomScriptFacts(room, 2)
    }))
  };
}

export function buildPropertyUnderstanding(input) {
  const rooms = input.floorplanAnalysis.rooms;
  const byId = new Map(rooms.map((room) => [room.id, room.name || room.type]));
  const resolved = resolveScriptFacts(input);
  return {
    sourcePriority: [
      "人工复核与人工填写户型（最高优先级）",
      "加入人工补充后的描述",
      "逐房实景识别客观描述"
    ],
    authoritativeLayout: resolved.authoritativeLayout,
    layoutStatus: resolved.layoutStatus,
    baseObjectiveDescription: resolved.enrichedPropertyDescription,
    enrichedPropertyDescription: resolved.enrichedPropertyDescription,
    propertyOverview: {
      community: input.property.community,
      city: input.property.city,
      district: input.property.district,
      buildingArea: input.floorplanAnalysis.area || input.property.buildingArea,
      layoutType: resolved.authoritativeLayout,
      orientation: input.floorplanAnalysis.orientation,
      decoration: input.property.decoration,
      elevator: input.property.elevator,
      schoolInfo: input.property.schoolInfo,
      transitInfo: input.property.transitInfo,
      amenities: input.property.amenities
    },
    layoutUnderstanding: {
      roomComposition: rooms.map((room) => room.name || room.type),
      roomRelationships: rooms.map((room) => ({
        room: room.name || room.type,
        connectedTo: (room.connectedTo || []).map((id) => byId.get(id) || id)
      })),
      basicRoute: input.floorplanAnalysis.basicRoute || "待确认"
    },
    priorityManualHighlights: input.manualHighlights,
    humanReviewedFacts: resolved.humanReviewedFacts,
    roomReality: rooms.map((room) => ({
      roomId: room.id,
      roomName: room.name || room.type,
      floorplanFacts: {
        position: room.position,
        areaAssessment: room.areaAssessment,
        geometry: room.geometry,
        orientation: room.orientation,
        hasWindow: room.hasWindow,
        connectedTo: (room.connectedTo || []).map((id) => byId.get(id) || id)
      },
      roomStoryDetails: roomScriptFacts(room, 2).length
        ? {
            usableDetails: roomScriptFacts(room, 2),
            usageRule: "可选使用；每个房间最多选1个细节；不要逐项罗列家具，不要改变人设、动线和故事结构。"
          }
        : null
    }))
  };
}

export function buildShotlistContext(input) {
  return {
    layoutType: input.floorplanAnalysis.layoutType,
    area: input.floorplanAnalysis.area,
    orientation: input.floorplanAnalysis.orientation,
    basicRoute: input.floorplanAnalysis.basicRoute,
    unknowns: input.floorplanAnalysis.unknowns,
    needsReview: input.floorplanAnalysis.needsReview,
    rooms: input.floorplanAnalysis.rooms.map((room) => ({
      id: room.id,
      type: room.type,
      name: room.name,
      position: room.position,
      areaAssessment: room.areaAssessment,
      geometry: room.geometry,
      orientation: room.orientation,
      connectedTo: room.connectedTo,
      hasWindow: room.hasWindow,
      roomCameraDetails: roomScriptFacts(room, 1).length
        ? {
            focusHints: roomScriptFacts(room, 1),
            usageRule: "只影响本房间镜头重点，不影响整套漫游顺序，不推断房间连接关系。"
          }
        : null
    }))
  };
}

function compactBaseScenes(scenes = []) {
  return scenes.map((scene) => ({
    roomId: scene.roomId,
    space: scene.space,
    storyVoiceover: scene.storyVoiceover,
    shot: scene.shot || (Array.isArray(scene.shots) ? scene.shots[0] : undefined)
  }));
}

const cameraPlanSchema = z.object({
  framing: z.string().min(1),
  cameraMove: z.string().min(1),
  focus: z.string().min(1),
  note: z.string().default("")
});

const voiceoverResultSchema = z.object({
  storyPositioning: z.string().min(1),
  voiceover: z.string().min(20),
  highlightCoverage: z.array(z.string()).default([]),
  pendingConfirmations: z.array(z.string()).max(3).default([])
});

const integratedScriptSchema = z.object({
  scenes: z.array(z.object({
    roomId: z.string().min(1),
    space: z.string().min(1),
    shot: cameraPlanSchema
  })).min(1),
  onSiteConfirmations: z.array(z.string()).default([])
});

function roomNames(input) {
  return input.floorplanAnalysis.rooms
    .map((room) => room.name || room.type)
    .filter(Boolean);
}

function fallbackVoiceover(input) {
  const rooms = roomNames(input);
  const area = input.floorplanAnalysis.area || input.property.buildingArea || "待确认";
  const { authoritativeLayout } = resolveScriptFacts(input);
  const highlightLines = input.manualHighlights.length
    ? input.manualHighlights.map((item) => `${item}，会直接影响每天住在这里的感受。`)
    : ["房间关系和真实使用感，才是看房时真正值得留意的部分。"];
  return {
    storyPositioning: `${styleLabels[input.style]}：从真实看房取舍切入`,
    voiceover: [
      "这套房，我没有急着先下结论。",
      `建筑面积${area}${authoritativeLayout ? `，人工确认为${authoritativeLayout}` : ""}。`,
      `图上能确认的空间有${rooms.join("、") || "主要功能空间"}。`,
      "",
      "真正需要看的，",
      "是每天回家以后，",
      "这些空间顺不顺手。",
      ...highlightLines,
      "",
      "从公共空间到休息区域，",
      "每一间房都能找到自己的生活节奏。",
      "",
      "如果是你，",
      "最想先走进哪一个空间？"
    ].join("\n"),
    highlightCoverage: input.manualHighlights,
    pendingConfirmations: [
      ...(input.floorplanAnalysis.unknowns || []),
      ...(input.floorplanAnalysis.needsReview || [])
    ].slice(0, 3)
  };
}

function fallbackIntegratedScript(input) {
  const rooms = input.floorplanAnalysis.rooms;
  const scenes = rooms.map((room) => {
    const name = room.name || room.type;
    return {
      roomId: room.id,
      space: name,
      shot: {
        framing: "全景",
        cameraMove: `从${name}入口稳定前推，逐步呈现空间全貌`,
        focus: "空间尺度与连接关系",
        note: room.connectedTo?.length
          ? `可连接：${room.connectedTo.join("、")}`
          : "连接关系需现场确认"
      }
    };
  });
  return {
    scenes,
    onSiteConfirmations: input.floorplanAnalysis.unknowns || []
  };
}

function splitVoiceoverAcrossRooms(voiceover, roomCount) {
  const lines = String(voiceover)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!roomCount) return [];
  return Array.from({ length: roomCount }, (_, index) => {
    const start = Math.floor((index * lines.length) / roomCount);
    const end = Math.floor(((index + 1) * lines.length) / roomCount);
    return lines.slice(start, end).join("\n");
  });
}

function normalizeIntegratedScenes(input, candidateScenes, storyVoiceover) {
  const generatedByRoom = new Map(
    candidateScenes.map((scene) => [scene.roomId, scene])
  );
  const fallbackByRoom = new Map(
    fallbackIntegratedScript(input).scenes.map((scene) => [scene.roomId, scene])
  );
  const storySegments = splitVoiceoverAcrossRooms(
    storyVoiceover,
    input.floorplanAnalysis.rooms.length
  );
  const scenes = input.floorplanAnalysis.rooms.map((room) => {
    const generated = generatedByRoom.get(room.id);
    const fallback = fallbackByRoom.get(room.id);
    const storySegment = storySegments.shift() || "";
    const generatedShot = generated?.shot
      || (Array.isArray(generated?.shots) ? generated.shots[0] : null);
    return {
      roomId: room.id,
      space: room.name || room.type,
      storyVoiceover: storySegment,
      shot: generatedShot || fallback.shot
    };
  });
  const weights = scenes.map((scene) =>
    Math.max(scene.storyVoiceover.replace(/\s/g, "").length, 1)
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let allocated = 0;
  return scenes.map((scene, index) => {
    const isLast = index === scenes.length - 1;
    const durationSeconds = isLast
      ? input.duration - allocated
      : Math.max(3, Math.round((input.duration * weights[index]) / totalWeight));
    allocated += durationSeconds;
    return { sceneNumber: index + 1, durationSeconds, ...scene };
  });
}

export function buildVoiceoverMessages(input, skillContext = loadVoiceoverSkill(input.style)) {
  const lengthRule = input.duration === 90
    ? "正文430—580个汉字，通常26—38行"
    : "正文280—380个汉字，通常18—26行";
  return [
    {
      role: "system",
      content:
        `你正在执行 residential-story-voiceover。以下是本次运行时从 Skill Markdown 动态加载的唯一写作参考：\n\n<skill-reference>\n${skillContext.promptReference}\n</skill-reference>\n\n最高优先级覆盖规则：采用“${styleLabels[input.style]}”风格，但全程只写可确认的正向信息。房源事实严格按以下优先级使用：人工复核与人工填写户型 > 加入人工补充后的描述 > 对应房间的实景识别细节。authoritativeLayout 是唯一允许写入口播的整套厅室数量；layoutStatus 为 unconfirmed 时，正文禁止出现任何具体“几室几厅”表述。不得根据房间列表、房间名称或实景照片反推整套户型。实景照片不是故事结构来源，只是可选细节点缀：先根据户型、人工补充、人工复核和故事模板建立完整口播；每个房间最多使用1个实景细节，如果影响顺畅可以不用。不得使用“可以看到”“照片中”“画面中”“该空间具备”“此处配置”等识别报告语气；不得因为实景照片改变人设口吻、故事主线或房间动线。参考中的顾虑、限制、代价、缺点和负面比较均不适用于本任务。“看房人纠结型”改写为正向生活选择，不制造房屋问题。先建立完整户型认知，再围绕一个核心命题组织故事，保持真实漫游顺序，默认从入口进入公共空间。人工补充亮点必须保留事实含义，但允许自然改写；把亮点放进与它最相关的空间、人物动作或生活场景中，并说明生活价值。禁止使用“这里还要重点说一句”“人工补充的信息是”“另外一个亮点是”等报幕句式，禁止把亮点集中罗列或原样拼接。不得编造、重复或直接喊口号。${lengthRule}。输出 JSON。`
    },
    {
      role: "user",
      content: `整理后的房源认知：\n${JSON.stringify(buildPropertyUnderstanding(input), null, 2)}\n\n以下人工亮点的事实含义必须全部保留，但要像其他房源要素一样自然融入，不要照抄成清单：\n${input.manualHighlights.length ? input.manualHighlights.map((item) => `- ${item}`).join("\n") : "- 无"}${input.baseScript ? `\n\n需要二次润色的原方案：\n${JSON.stringify({ storyPositioning: input.baseScript.storyPositioning, voiceover: input.baseScript.voiceover }, null, 2)}\n\n用户润色方向：${input.refinementInstruction}\n保持所有已确认房源事实与原有时长、风格，在此基础上完成明显且连贯的改写。` : ""}\n\n输出 {"storyPositioning":"一句话说明核心命题","voiceover":"逻辑连续、一行一句的可录音正文","highlightCoverage":["逐项原样返回已自然融入的人工亮点，仅用于校验，不属于口播"],"pendingConfirmations":[]}。`
    }
  ];
}

export function buildShotlistMessages(input, voiceover) {
  return [
    {
      role: "system",
      content:
        "你正在执行 residential-video-shotlist，为完整口播故事匹配逐房间运镜。必须且只能覆盖输入 rooms 中的每一个 room id，不得遗漏、合并或虚构房间。每个房间只输出一个可执行运镜，不生成任何额外旁白或解说。按平面图连接关系和基础动线排序，禁止穿墙。实景照片只用于确定当前房间内的镜头关注点，不得根据照片推断房间连接关系，不得改变整套漫游顺序。运镜必须写明起点、方向或揭示目标。输出 JSON。"
    },
    {
      role: "user",
      content: `目标时长：${input.duration}秒\n户型资料（已移除照片原始数据）：\n${JSON.stringify(buildShotlistContext(input), null, 2)}\n\n需要保留并由后端分段的完整口播故事：\n${voiceover}${input.baseScript ? `\n\n原方案分镜：\n${JSON.stringify(compactBaseScenes(input.baseScript.scenes), null, 2)}\n用户润色方向：${input.refinementInstruction}\n请联动重写运镜，不得增加户型中不存在的空间。` : ""}\n\n每个空间只生成一个运镜，不要生成旁白。输出 {"scenes":[{"roomId":"living","space":"客厅","shot":{"framing":"全景","cameraMove":"从入户门稳定前推，逐步呈现客厅全貌","focus":"空间关系","note":""}}],"onSiteConfirmations":[]}。`
    }
  ];
}

export function auditVoiceoverLayout(input, voiceover) {
  const { authoritativeLayout, layoutStatus } = resolveScriptFacts(input);
  const mentions = String(voiceover || "")
    .match(/[一二两三四五六七八九十\d]+\s*室(?:\s*[一二两三四五六七八九十\d]+\s*厅)?(?:\s*[一二两三四五六七八九十\d]+\s*卫)?(?:\s*[一二两三四五六七八九十\d]+\s*厨)?/g)
    ?.map(extractLayout)
    .filter(Boolean) || [];
  const layoutCore = (value) => String(value || "").match(/^\d+室(?:\d+厅)?/)?.[0] || value;
  const invalidMentions = layoutStatus === "confirmed"
    ? mentions.filter((item) => layoutCore(item) !== layoutCore(authoritativeLayout))
    : mentions;
  return {
    valid: invalidMentions.length === 0,
    authoritativeLayout,
    layoutStatus,
    mentions,
    invalidMentions
  };
}

export async function generatePropertyScript(jsonClient, rawInput) {
  const input = inputSchema.parse(rawInput);
  if (input.baseScript && !input.refinementInstruction) {
    throw new Error("请填写二次润色方向。");
  }
  const skillContext = loadVoiceoverSkill(input.style, { input });
  const voiceoverFallback = fallbackVoiceover(input);
  let voiceoverResult = voiceoverFallback;
  let provider = "fallback";

  if (jsonClient?.available) {
    try {
      const candidate = await jsonClient.generate(
        buildVoiceoverMessages(input, skillContext)
      );
      const parsed = voiceoverResultSchema.safeParse(candidate);
      if (parsed.success) {
        voiceoverResult = parsed.data;
        provider = "deepseek";
        const missing = input.manualHighlights.filter(
          (highlight) => !voiceoverResult.highlightCoverage.includes(highlight)
        );
        if (missing.length) {
          const retry = await jsonClient.generate([
            ...buildVoiceoverMessages(input, skillContext),
            {
              role: "user",
              content: `上一版可能没有充分表达以下人工亮点的事实含义：${missing.join("；")}。请把它们分别融入最相关的空间、人物动作或生活场景并说明价值，允许改写措辞。不得单独罗列，不得原样拼接，不得使用“这里还要重点说一句”“人工补充的信息是”等报幕句式。重新输出完整 JSON。`
            }
          ]);
          const retryParsed = voiceoverResultSchema.safeParse(retry);
          if (retryParsed.success) voiceoverResult = retryParsed.data;
        }
        let layoutAudit = auditVoiceoverLayout(input, voiceoverResult.voiceover);
        if (!layoutAudit.valid) {
          const correction = await jsonClient.generate([
            ...buildVoiceoverMessages(input, skillContext),
            {
              role: "user",
              content: layoutAudit.layoutStatus === "confirmed"
                ? `上一版写入了错误厅室信息：${layoutAudit.invalidMentions.join("、")}。人工权威户型是 ${layoutAudit.authoritativeLayout}。请保持其他事实与故事质量，按权威户型重写完整 JSON。`
                : `当前没有经过人工确认的厅室数量，上一版却写入了：${layoutAudit.invalidMentions.join("、")}。请删除所有具体“几室几厅”表述，改为描述已确认空间和生活场景，重写完整 JSON。`
            }
          ]);
          const correctionParsed = voiceoverResultSchema.safeParse(correction);
          if (correctionParsed.success) voiceoverResult = correctionParsed.data;
          layoutAudit = auditVoiceoverLayout(input, voiceoverResult.voiceover);
          if (!layoutAudit.valid) {
            throw new Error(
              layoutAudit.layoutStatus === "confirmed"
                ? `脚本厅室信息与人工确认不一致：应为${layoutAudit.authoritativeLayout}`
                : "脚本包含未经人工确认的厅室数量，已停止保存。"
            );
          }
        }
      }
    } catch (error) {
      if (input.requireModel) throw error;
      voiceoverResult = voiceoverFallback;
    }
  }

  const scriptFallback = fallbackIntegratedScript(input);
  let scriptResult = scriptFallback;
  if (jsonClient?.available) {
    try {
      const candidate = await jsonClient.generate(
        buildShotlistMessages(input, voiceoverResult.voiceover)
      );
      const parsed = integratedScriptSchema.safeParse(candidate);
      if (parsed.success) {
        scriptResult = parsed.data;
        provider = "deepseek";
      }
    } catch (error) {
      if (input.requireModel) throw error;
      scriptResult = scriptFallback;
    }
  }

  const scenes = normalizeIntegratedScenes(
    input,
    scriptResult.scenes,
    voiceoverResult.voiceover
  );

  return {
    schemaVersion: "property-video-script/v1",
    provider,
    duration: input.duration,
    style: input.style,
    styleLabel: styleLabels[input.style],
    storyPositioning: voiceoverResult.storyPositioning,
    voiceover: voiceoverResult.voiceover,
    generationTrace: {
      ...skillContext.trace,
      manualHighlights: input.manualHighlights.map((highlight) => ({
        highlight,
        included: voiceoverResult.highlightCoverage.includes(highlight)
      }))
    },
    pendingConfirmations: voiceoverResult.pendingConfirmations,
    scenes,
    onSiteConfirmations: scriptResult.onSiteConfirmations
  };
}
