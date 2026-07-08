import dotenv from "dotenv";

// 项目配置应优先于启动终端中可能残留的旧环境变量。
dotenv.config({ override: true });
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import {
  createFloorplanAgentGraph,
  resumeFloorplanAgent,
  runFloorplanAgent
} from "./agents/floorplan-agent.mjs";
import {
  createPropertyHighlightAgentGraph,
  runPropertyHighlightAgent
} from "./agents/property-highlight-agent.mjs";
import { createPropertyHighlightContentServices } from "./agents/property-highlight-content.mjs";
import {
  buildEnrichedDescriptionMessages,
  buildObjectiveDescriptionMessages
} from "./agents/property-description-content.mjs";
import { generatePropertyScript } from "./agents/property-script-agent.mjs";
import { DeepseekJsonClient } from "./providers/deepseek-json-client.mjs";
import { ManualCaseLibrary } from "./providers/manual-case-library.mjs";
import { LocalPropertyRecordStore } from "./providers/local-property-record-store.mjs";
import { VoiceoverCaseLibrary } from "./providers/voiceover-case-library.mjs";
import {
  ModelJsonParseError,
  parseModelJsonObject,
  snippet
} from "./lib/model-json.mjs";

const app = express();
const port = Number(process.env.PORT || 8787);
const labelsPath = "benchmark/taxonomy/canonical-labels.json";
const extractedLabelsPath = "benchmark/taxonomy/labels.json";
const benchmarkImageDir = "benchmark/images";
const generatedCaseDir = "benchmark/cases/generated";
const benchmarkCaseDir = "benchmark/cases";
const labelSections = new Set(["pros", "cons", "suitableFor"]);
const propertyRecordStore = new LocalPropertyRecordStore();
const voiceoverCaseLibrary = new VoiceoverCaseLibrary();

app.use(express.json({ limit: "12mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".json") ? [fullPath] : [];
  });
}

function normalizeLabelId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fallbackLabelId(label) {
  const hex = Buffer.from(String(label || "").trim()).toString("hex").slice(0, 12);
  return `custom_${hex || Date.now().toString(36)}`;
}

function assertLabelSection(section) {
  if (!labelSections.has(section)) throw new Error("标签类型不合法。");
}

function loadLabels() {
  return readJsonIfExists(labelsPath) || { pros: [], cons: [], suitableFor: [] };
}

function saveLabels(labels) {
  const sectionNames = ["pros", "cons", "suitableFor"];
  const lines = ["{"];
  sectionNames.forEach((section, sectionIndex) => {
    lines.push(`  "${section}": [`);
    const items = labels[section] ?? [];
    items.forEach((item, itemIndex) => {
      const aliases = Array.isArray(item.aliases) ? item.aliases : [];
      const suffix = itemIndex === items.length - 1 ? "" : ",";
      lines.push(
        `    { "id": ${JSON.stringify(item.id)}, "label": ${JSON.stringify(item.label)}, "aliases": [${aliases
          .map((alias) => JSON.stringify(alias))
          .join(", ")}] }${suffix}`
      );
    });
    lines.push(`  ]${sectionIndex === sectionNames.length - 1 ? "" : ","}`);
  });
  lines.push("}");
  fs.writeFileSync(labelsPath, `${lines.join("\n")}\n`, "utf8");
}

function addExtractedLabel(section, label) {
  const data = readJsonIfExists(extractedLabelsPath);
  if (!data?.labels?.[section]) return;
  if (data.labels[section].some((item) => item.id === label.id)) return;
  data.labels[section].push({
    id: label.id,
    label: label.label,
    count: 0,
    rawLabels: {},
    sources: []
  });
  writeJson(extractedLabelsPath, data);
}

function removeExtractedLabel(section, labelId) {
  const data = readJsonIfExists(extractedLabelsPath);
  if (!data?.labels?.[section]) return false;
  const before = data.labels[section].length;
  data.labels[section] = data.labels[section].filter((item) => item.id !== labelId);
  if (data.labels[section].length === before) return false;
  writeJson(extractedLabelsPath, data);
  return true;
}

function removeLabelFromBenchmarkCases(section, labelId) {
  let touched = 0;
  for (const filePath of listJsonFiles(benchmarkCaseDir)) {
    const data = readJsonIfExists(filePath);
    const records = Array.isArray(data) ? data : [data];
    let changed = false;
    const nextRecords = records.map((record) => {
      if (!record || !Array.isArray(record[section])) return record;
      const next = record[section].filter((id) => id !== labelId);
      if (next.length !== record[section].length) {
        changed = true;
        return { ...record, [section]: next };
      }
      return record;
    });
    if (changed) {
      writeJson(filePath, Array.isArray(data) ? nextRecords : nextRecords[0]);
      touched += 1;
    }
  }
  return touched;
}

function isSupportedImage(fileName) {
  return /\.(jpe?g|png|webp)$/i.test(fileName);
}

function safeBaseName(fileName) {
  return path.basename(String(fileName || ""));
}

function caseIdFromFile(fileName) {
  return safeBaseName(fileName).replace(/\.[^.]+$/, "");
}

function resolveBenchmarkImage(fileName) {
  const safeName = safeBaseName(fileName);
  if (!isSupportedImage(safeName)) throw new Error("图片文件格式不支持。");
  const root = path.resolve(benchmarkImageDir);
  const resolved = path.resolve(root, safeName);
  if (!resolved.startsWith(root)) throw new Error("图片路径不合法。");
  if (!fs.existsSync(resolved)) throw new Error("未找到该 case 图片。");
  return resolved;
}

function mimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function imageFileToDataUrl(fileName) {
  const resolved = resolveBenchmarkImage(fileName);
  const bytes = fs.readFileSync(resolved);
  return `data:${mimeType(fileName)};base64,${bytes.toString("base64")}`;
}

function deepseekChatUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/chat/completions`;
}

function arkResponsesUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/responses")) return normalized;
  return `${normalized}/responses`;
}

function extractJson(text) {
  return parseModelJsonObject(text);
}

function extractArkText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const texts = [];
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") texts.push(content.text);
    }
  }
  return texts.join("\n").trim();
}

function labelOptions(section) {
  const labels = readJsonIfExists(labelsPath);
  return (labels?.[section] ?? []).map((item) => `${item.id}: ${item.label}`).join("\n");
}

function labelName(id, section) {
  const labels = readJsonIfExists(labelsPath);
  const item = (labels?.[section] ?? []).find((entry) => entry.id === id);
  return item?.label || id;
}

function buildBaseRecognitionPrompt(imageName, suppliedArea) {
  return `你是一个房产户型图识别 Agent。请只根据图片中能看到的户型图信息输出 JSON，不要输出 Markdown。

图片文件名：${imageName || "未命名户型图"}
用户填写的建筑面积：${suppliedArea || "未提供"}

目标：只识别客观户型信息，包括户型、朝向、房间、连接关系、采光通风和空间布局特征。面积必须原样使用用户填写值，不要根据图片估算。不要在这个步骤生成营销亮点、短板或适合人群。没有证据的信息必须写 unknown 或放进 unknowns，不要编造。

输出必须是单个 JSON object，字段如下：
{
  "layoutType": "例如 3室2厅1卫，无法确认写 unknown",
  "area": "${suppliedArea || "unknown"}",
  "orientation": "以客厅窗户所在外墙方向判断，例如 南向/东向；无法确认写 unknown",
  "rooms": [
    {
      "id": "英文稳定 id，例如 living_room, kitchen, bedroom_a",
      "type": "living_room | dining_room | kitchen | primary_bedroom | bedroom | child_room | study | bathroom | balcony | entrance | corridor | storage | unknown",
      "name": "图中中文房间名",
      "position": "相对位置，例如 北侧/南侧中部/东南侧",
      "areaAssessment": "仅在图中有面积或尺寸依据时填写面积/占比，否则按明显比例写较大/中等/紧凑，仍无法判断写待确认",
      "geometry": "例如近似方正/长方形/狭长，无法确认写待确认",
      "orientation": "根据户型图默认上北下南判断房间主要外窗朝向，无法确认写待确认",
      "connectedTo": ["只写能确认直接门洞或开口连接的房间 id"],
      "hasWindow": true,
      "light": "good | medium | weak | unknown"
    }
  ],
  "basicRoute": "只描述可确认的入户及公共区、餐厨、卧室区基础通行路径，无法确认写待确认",
  "unknowns": ["无法确认但重要的信息"],
  "needsReview": ["需要人工复核的判断"]
}

规则：
1. connectedTo 必须使用 rooms 里存在的 id。
2. 户型图默认上北、下南、左西、右东。朝向只以客厅窗户所在的外墙方向为判断点：窗户在客厅上侧外墙为北向、下侧为南向、左侧为西向、右侧为东向；位于转角且两个方向均有明确窗户时可写东南向等组合朝向。
3. 不要输出价格、楼层、学区、噪音、承重墙等户型图无法证明的信息。
4. 不要根据图中文字、房间尺寸或比例估算或覆盖用户填写的面积。
5. hasWindow 无法确认时写 "unknown"，不要用 false 代替“不知道”。`;
}

function buildRecognitionPrompt(imageName, suppliedArea) {
  return `${buildBaseRecognitionPrompt(imageName, suppliedArea)}

JSON 严格规则：
- 只输出一个 JSON object，不要 Markdown、注释、解释文字或尾随逗号。
- 所有 key 和字符串值必须使用英文双引号。
- 所有数组元素必须是合法 JSON 值；中文文本也必须加英文双引号，例如 ["入户门位置", "是否存在独立餐厅"]。
- unknowns 和 needsReview 必须是字符串数组，不能输出未加引号的中文短语。`;
}

async function repairFloorplanRecognitionJson(rawContent) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new ModelJsonParseError("DeepSeek JSON repair is unavailable", {
      rawSnippet: snippet(rawContent)
    });
  }

  const repaired = await callDeepseekJson([
    {
      role: "system",
      content:
        "你是严格的 JSON 修复器。只把输入修复为一个合法 JSON object，不补充新事实，不改写字段含义，不输出 Markdown。所有 key 和字符串必须使用英文双引号，unknowns 和 needsReview 必须是字符串数组。"
    },
    {
      role: "user",
      content: `请修复下面的户型识别 JSON。只输出修复后的 JSON object：\n${rawContent}`
    }
  ], 0);

  if (!repaired || typeof repaired !== "object") {
    throw new ModelJsonParseError("DeepSeek JSON repair returned empty content", {
      rawSnippet: snippet(rawContent)
    });
  }

  return repaired;
}

export async function parseFloorplanRecognitionJson(rawContent) {
  try {
    return parseModelJsonObject(rawContent, "Ark floorplan recognition");
  } catch (error) {
    console.warn("Floorplan recognition JSON parse failed; attempting repair.", {
      message: error.message,
      rawSnippet: error.rawSnippet || snippet(rawContent),
      extractedSnippet: error.extractedSnippet || ""
    });

    try {
      return await repairFloorplanRecognitionJson(rawContent);
    } catch (repairError) {
      console.error("Floorplan recognition JSON repair failed.", {
        message: repairError.message,
        rawSnippet: repairError.rawSnippet || snippet(rawContent)
      });
      throw new Error("模型返回格式异常，请重试或进入人工校正。");
    }
  }
}

async function recognizeFloorplan({ imageDataUrl, imageName, suppliedArea }) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("缺少 ARK_API_KEY，无法调用视觉识图模型。");

  const baseUrl = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
  const model = process.env.ARK_VISION_MODEL || "doubao-seed-2-0-mini-260428";

  const response = await fetch(arkResponsesUrl(baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: imageDataUrl },
            { type: "input_text", text: buildRecognitionPrompt(imageName, suppliedArea) }
          ]
        }
      ]
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`方舟识图失败：${response.status} ${responseText.slice(0, 300)}`);
  }

  const data = JSON.parse(responseText);
  const content = extractArkText(data);
  if (!content) throw new Error("方舟识图返回为空。");
  const recognized = await parseFloorplanRecognitionJson(content);
  if (suppliedArea) recognized.area = suppliedArea;
  return recognized;
}

async function recognizeRoomPhoto({ imageDataUrl, imageName, room, floorplan }) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("缺少 ARK_API_KEY，无法识别房间实景图。");
  const baseUrl = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
  const model = process.env.ARK_VISION_MODEL || "doubao-seed-2-0-mini-260428";
  const prompt = `你是住宅房间实景识别节点。当前户型中的目标房间是“${room.name || room.type}”，户型为“${floorplan.layoutType || "待确认"}”。
只描述照片中直接可见、可核验的客观事实，不做营销评价，不猜测尺寸、品牌、价格、材质真伪、隐蔽工程或照片外区域。
输出完整 JSON：
{
  "roomId": "${room.id}",
  "roomName": "${room.name || room.type}",
  "objectiveDescription": "80—160字客观描述",
  "visibleElements": ["可见家具、设备或固定设施"],
  "spatialLayout": "照片能确认的摆放与通行关系，不能确认写待确认",
  "finishAndCondition": "墙地顶、柜体和装修状态的可见情况",
  "windowAndLighting": "可见窗户和当时光线情况，不推断全天采光",
  "storage": "可见收纳设施，没有直接证据写待确认",
  "scriptFacts": ["后续脚本可以安全使用的正向客观事实"],
  "unknowns": ["照片无法确认但容易被误判的内容"]
}

严格要求：visibleElements、scriptFacts、unknowns 必须返回字符串数组；scriptFacts 不能返回单个字符串。`;
  const response = await fetch(arkResponsesUrl(baseUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_image", image_url: imageDataUrl },
          { type: "input_text", text: prompt }
        ]
      }]
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`方舟房间识别失败：${response.status} ${text.slice(0, 300)}`);
  const content = extractArkText(JSON.parse(text));
  if (!content) throw new Error("方舟房间识别返回为空。");
  return extractJson(content);
}

function normalizeRoomVisualList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function normalizeRoomPhotoAnalysis(analysis) {
  return {
    ...analysis,
    visibleElements: normalizeRoomVisualList(analysis?.visibleElements),
    scriptFacts: normalizeRoomVisualList(analysis?.scriptFacts),
    unknowns: normalizeRoomVisualList(analysis?.unknowns)
  };
}

function fallbackFeatureAnalysis(recognized) {
  const rooms = recognized.rooms || [];
  const bedrooms = rooms.filter((room) =>
    ["primary_bedroom", "bedroom", "child_room"].includes(room.type)
  );
  const bathrooms = rooms.filter((room) => room.type === "bathroom");
  const knownLights = rooms
    .map((room) => room.light)
    .filter((light) => light && light !== "unknown");

  return {
    northSouthVentilation: recognized.orientation?.includes("南北")
      ? true
      : "unknown",
    dynamicStaticZoning: rooms.some((room) => room.type === "corridor")
      ? "good"
      : "unknown",
    kitchenDiningFlow: rooms.some(
      (room) =>
        room.type === "kitchen" &&
        room.connectedTo?.some((id) =>
          rooms.some((candidate) => candidate.id === id && candidate.type === "dining_room")
        )
    )
      ? "good"
      : "unknown",
    bathroomPressure:
      bathrooms.length >= 2
        ? "low"
        : bathrooms.length === 1 && bedrooms.length >= 3
          ? "high"
          : "unknown",
    lighting: knownLights.includes("weak")
      ? "medium"
      : knownLights.includes("good")
        ? "good"
        : "unknown",
    storagePotential: rooms.some((room) => room.type === "storage")
      ? "good"
      : "unknown"
  };
}

async function callDeepseekJson(messages, temperature = 0.2) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const response = await fetch(deepseekChatUrl(baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: 1200,
      response_format: { type: "json_object" }
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`DeepSeek responded with ${response.status}: ${responseText.slice(0, 300)}`);
  }
  const data = JSON.parse(responseText);
  return extractJson(data.choices?.[0]?.message?.content || "");
}

async function analyzeFloorplanFeatures(recognized) {
  const fallback = fallbackFeatureAnalysis(recognized);
  try {
    const generated = await callDeepseekJson([
      {
        role: "system",
        content:
          "你是户型空间分析节点。只能根据给定的客观识别 JSON 判断空间特征；证据不足必须写 unknown。只输出 JSON。"
      },
      {
        role: "user",
        content: `客观识别结果：\n${JSON.stringify(recognized, null, 2)}\n\n输出字段：northSouthVentilation、dynamicStaticZoning、kitchenDiningFlow、bathroomPressure、lighting、storagePotential。枚举沿用输入系统定义。`
      }
    ]);
    return generated || fallback;
  } catch (error) {
    console.error("Feature analysis fallback:", error);
    return fallback;
  }
}

function fallbackHighlights({ recognized, features }) {
  const pros = [];
  const cons = [];
  const suitableFor = [];
  const evidence = [];
  const rooms = recognized.rooms || [];
  const add = (list, id, reason) => {
    if (!list.includes(id)) list.push(id);
    evidence.push({ id, evidence: reason });
  };

  if (features.lighting === "good") add(pros, "good_lighting", "主要房间采光判断为 good");
  if (features.dynamicStaticZoning === "good") add(pros, "clear_zoning", "卧室区由走廊组织");
  if (features.kitchenDiningFlow === "good") add(pros, "kitchen_dining_flow_good", "厨房与餐厅直接连接");
  if (rooms.some((room) => room.type === "living_room" && room.connectedTo?.some((id) => rooms.some((candidate) => candidate.id === id && candidate.type === "balcony")))) {
    add(pros, "living_balcony_connected", "客厅直接连接阳台");
  }
  if (features.bathroomPressure === "high") add(cons, "single_bath_pressure", "多卧室仅配置一个卫生间");
  if (rooms.some((room) => room.light === "weak")) add(cons, "weak_lighting_room", "存在采光标记为 weak 的房间");
  const bedroomCount = rooms.filter((room) => ["primary_bedroom", "bedroom", "child_room"].includes(room.type)).length;
  if (bedroomCount >= 3) {
    suitableFor.push("three_person_family", "multi_room_need");
    evidence.push(
      { id: "three_person_family", evidence: `识别出 ${bedroomCount} 个卧室` },
      { id: "multi_room_need", evidence: `识别出 ${bedroomCount} 个卧室` }
    );
  } else {
    suitableFor.push("single_or_couple");
    evidence.push({ id: "single_or_couple", evidence: `识别出 ${bedroomCount} 个卧室` });
  }
  return { pros, cons, suitableFor, evidence };
}

async function generateFloorplanHighlights(input) {
  const fallback = fallbackHighlights(input);
  try {
    const generated = await callDeepseekJson([
      {
        role: "system",
        content:
          "你是户型亮点判断节点。只能基于输入的客观识别和空间特征选择固定标签，并为每个判断提供直接证据。证据不足就不要选。只输出 JSON。"
      },
      {
        role: "user",
        content: `识别与特征：\n${JSON.stringify(input, null, 2)}\n\npros 可选：\n${labelOptions("pros")}\n\ncons 可选：\n${labelOptions("cons")}\n\nsuitableFor 可选：\n${labelOptions("suitableFor")}\n\n输出 {"pros":[],"cons":[],"suitableFor":[],"evidence":[{"id":"标签ID","evidence":"输入中的直接依据"}]}`
      }
    ]);
    if (!generated) return fallback;

    const labels = loadLabels();
    const allowed = {
      pros: new Set(labels.pros.map((item) => item.id)),
      cons: new Set(labels.cons.map((item) => item.id)),
      suitableFor: new Set(labels.suitableFor.map((item) => item.id))
    };
    const pros = (generated.pros || []).filter((id) => allowed.pros.has(id));
    const cons = (generated.cons || []).filter((id) => allowed.cons.has(id));
    const suitableFor = (generated.suitableFor || []).filter((id) => allowed.suitableFor.has(id));
    const selected = new Set([...pros, ...cons, ...suitableFor]);
    const evidence = (generated.evidence || []).filter(
      (item) => selected.has(item?.id) && typeof item?.evidence === "string"
    );
    return { pros, cons, suitableFor, evidence };
  } catch (error) {
    console.error("Highlight generation fallback:", error);
    return fallback;
  }
}

fs.mkdirSync(".data", { recursive: true });
const floorplanCheckpointer = SqliteSaver.fromConnString(
  path.resolve(".data/floorplan-agent.sqlite")
);
const floorplanAgentGraph = createFloorplanAgentGraph({
  recognizeFloorplan,
  analyzeFeatures: analyzeFloorplanFeatures,
  generateHighlights: generateFloorplanHighlights
}, {
  checkpointer: floorplanCheckpointer
});

const manualCaseLibrary = new ManualCaseLibrary();
const highlightJsonClient = new DeepseekJsonClient();
const highlightContentServices = createPropertyHighlightContentServices({
  jsonClient: highlightJsonClient.available ? highlightJsonClient : undefined
});
const highlightCheckpointer = SqliteSaver.fromConnString(
  path.resolve(".data/property-highlight-agent.sqlite")
);
const propertyHighlightAgentGraph = createPropertyHighlightAgentGraph(
  {
    caseLibrary: manualCaseLibrary,
    contentServices: highlightContentServices
  },
  { checkpointer: highlightCheckpointer }
);

function reviewResponse(graphResult) {
  const review = graphResult.__interrupt__?.[0]?.value;
  if (!review) return null;
  return {
    status: "needs_review",
    threadId: graphResult.threadId,
    review
  };
}

function formatHighlightAgentResult(graphResult) {
  return {
    schemaVersion: "property-highlight-plan/v1",
    status: graphResult.status,
    threadId: graphResult.threadId,
    searchQueries: [],
    sourceNotes: (graphResult.selectedNotes || []).map((note) => ({
      id: note.id,
      title: note.title,
      bodyExcerpt: String(note.body || "").slice(0, 180),
      theme: note.theme,
      targetAudience: note.target_audience,
      hookType: note.hook_type,
      structure: note.structure,
      tone: note.tone,
      metrics: note.metrics,
      ranking: note.ranking,
      relevance: note.relevance
    })),
    trendPatterns: graphResult.trendPatterns || [],
    highlightStrategy: graphResult.highlightStrategy,
    openingHook: graphResult.talk30s?.openingHook || "",
    talk30s: graphResult.talk30s?.talk30s || "",
    warnings: [
      ...(graphResult.warnings || []),
      ...(graphResult.audit?.warnings || [])
    ],
    audit: graphResult.audit,
    runMetadata: {
      provider: "manual_case_library",
      contentModel: highlightJsonClient.available ? "deepseek" : "fallback",
      cacheHits: 0,
      crawlerStatus: "disabled",
      executionPath: graphResult.executionPath || []
    }
  };
}

function normalizeList(list, fallbackItems, count = 3) {
  const items = Array.isArray(list) ? list.filter(Boolean).map(String) : [];
  return [...items, ...fallbackItems].slice(0, count);
}

function fallbackBrief(recognized, familyType, focusTags, manualHighlights = []) {
  const layout = recognized.layoutType && recognized.layoutType !== "unknown" ? recognized.layoutType : "这套户型";
  const rooms = Array.isArray(recognized.rooms) ? recognized.rooms : [];
  const roomNames = rooms.slice(0, 5).map((room) => room.name || room.type).filter(Boolean);
  const pros = normalizeList(
    manualHighlights,
    (recognized.pros || []).map((id) => labelName(id, "pros")),
    3
  );
  const completedPros = normalizeList(
    pros,
    ["空间功能清晰", "主要生活区容易讲解", "适合按关注点继续现场核对"]
  );
  const cons = normalizeList(
    (recognized.cons || []).map((id) => labelName(id, "cons")),
    ["部分信息需要现场确认"]
  );
  const focus = focusTags?.length ? focusTags.join("、") : "采光、动线和收纳";

  return {
    talk30s: `${layout}可以先按${familyType || "年轻家庭"}的生活方式来看。图上能看到${roomNames.join("、") || "主要功能空间"}，讲解重点建议放在${focus}。目前比较明确的卖点是${completedPros.slice(0, 2).join("、")}；同时要提醒客户，${cons[0]}，最好结合现场采光和家具尺度再确认。`,
    sellingPoints: completedPros,
    faqs: [
      {
        question: "这个户型适合我们家庭吗？",
        answer: `如果你们关注${focus}，这套可以重点看公共区尺度、卧室分布和收纳位置，整体是否匹配要结合现场家具摆放确认。`
      },
      {
        question: "采光和通风怎么样？",
        answer: `图上判断为${recognized.features?.lighting || "unknown"}，朝向为${recognized.orientation || "unknown"}。没有明确证据的部分建议现场看窗户、阳台和实际日照。`
      },
      {
        question: "后期改造空间大吗？",
        answer: "户型图只能判断功能关系，承重墙、管井和排烟排水位置不能直接下结论，需要结合原始结构图或现场复核。"
      }
    ],
    riskTip: recognized.needsReview?.[0] || recognized.unknowns?.[0] || cons[0] || "图上无法确认的信息不要直接承诺，建议现场复核。"
  };
}

function buildBriefPrompt(recognized, familyType, focusTags, manualHighlights = []) {
  return [
    {
      role: "system",
      content:
        "你是一名专业、亲切、不夸大的房产讲解 Agent。你只能基于输入的户型识别 JSON、家庭类型和关注点生成讲解，不得编造楼层、价格、学区、噪音、承重墙等没有证据的信息。输出必须是 JSON。"
    },
    {
      role: "user",
      content: `户型识别 JSON：
${JSON.stringify(recognized, null, 2)}

家庭类型：${familyType || "年轻家庭"}
关注点：${focusTags?.join("、") || "采光、动线、收纳"}

用户人工补充信息（不是识图结论，但可作为已提供的房源资料使用）：
${manualHighlights.length ? manualHighlights.map((item) => `- ${item}`).join("\n") : "- 无"}

请输出单个 JSON object：
{
  "talk30s": "一段适合真实带看的 30 秒中文讲解词，120-180 字，不夸大",
  "sellingPoints": ["三个核心卖点，每条 12-28 字", "必须与识图 JSON 一致", "围绕关注点"],
  "faqs": [
    { "question": "常见问题1", "answer": "回答1" },
    { "question": "常见问题2", "answer": "回答2" },
    { "question": "常见问题3", "answer": "回答3" }
  ],
  "riskTip": "一个风险提示，必须指出图上无法确认或需要现场复核的点"
}`
    }
  ];
}

export async function generateBrief({ recognized, familyType, focusTags, manualHighlights = [] }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return { provider: "fallback", brief: fallbackBrief(recognized, familyType, focusTags, manualHighlights) };

  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

  try {
    const response = await fetch(deepseekChatUrl(baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: buildBriefPrompt(recognized, familyType, focusTags, manualHighlights),
        temperature: 0.45,
        max_tokens: 1200,
        response_format: { type: "json_object" }
      })
    });

    const responseText = await response.text();
    if (!response.ok) throw new Error(`DeepSeek responded with ${response.status}: ${responseText.slice(0, 300)}`);
    const data = JSON.parse(responseText);
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("DeepSeek response was empty");

    const parsed = extractJson(content);
    return {
      provider: "deepseek",
      brief: {
        talk30s: parsed.talk30s || fallbackBrief(recognized, familyType, focusTags, manualHighlights).talk30s,
        sellingPoints: normalizeList(parsed.sellingPoints, fallbackBrief(recognized, familyType, focusTags, manualHighlights).sellingPoints),
        faqs: normalizeList(parsed.faqs, fallbackBrief(recognized, familyType, focusTags, manualHighlights).faqs),
        riskTip: parsed.riskTip || fallbackBrief(recognized, familyType, focusTags, manualHighlights).riskTip
      }
    };
  } catch (error) {
    console.warn("Floorplan brief generation fell back to local template.", {
      message: error?.message || String(error),
      rawSnippet: error?.rawSnippet || "",
      extractedSnippet: error?.extractedSnippet || ""
    });
    return { provider: "fallback", brief: fallbackBrief(recognized, familyType, focusTags, manualHighlights) };
  }
}

function normalizePropertyFacts(input = {}) {
  const clean = (value) =>
    typeof value === "string" && value.trim() ? value.trim() : "待确认";
  return {
    community: clean(input.community),
    city: clean(input.city),
    district: clean(input.district),
    buildingArea: clean(input.buildingArea),
    declaredLayout: clean(input.declaredLayout),
    decoration: clean(input.decoration),
    elevator: clean(input.elevator),
    schoolInfo: clean(input.schoolInfo),
    transitInfo: clean(input.transitInfo),
    amenities: clean(input.amenities)
  };
}

function propertyFactSources(propertyFacts, recognized, manualHighlights = []) {
  const sources = [];
  for (const [field, value] of Object.entries(propertyFacts)) {
    sources.push({
      field: `propertyFacts.${field}`,
      source: "user",
      status: value === "待确认" ? "pending" : "confirmed"
    });
  }
  for (const field of ["layoutType", "orientation", "rooms", "basicRoute"]) {
    sources.push({
      field: `floorplanAnalysis.${field}`,
      source: "floorplan",
      status:
        recognized?.[field] === "待确认" ||
        recognized?.[field] === "unknown" ||
        recognized?.[field] == null
          ? "pending"
          : "recognized"
    });
  }
  manualHighlights.forEach((_, index) => {
    sources.push({
      field: `manualHighlights.${index}`,
      source: "manual",
      status: "user_provided"
    });
  });
  return sources;
}

function descriptionWarnings(propertyFacts, recognized) {
  const labels = {
    community: "小区名称",
    city: "城市",
    district: "板块",
    declaredLayout: "人工填写户型",
    decoration: "装修情况",
    elevator: "电梯",
    schoolInfo: "学区/学校信息",
    transitInfo: "交通信息",
    amenities: "周边配套"
  };
  return [
    ...Object.entries(labels)
      .filter(([field]) => propertyFacts[field] === "待确认")
      .map(([, label]) => `${label}待确认`),
    ...(recognized.unknowns || []),
    ...(recognized.needsReview || [])
  ].filter((item, index, list) => item && list.indexOf(item) === index);
}

function fallbackObjectiveDescription(propertyFacts, recognized) {
  const rooms = (recognized.rooms || [])
    .map((room) => room.name || room.type)
    .filter(Boolean)
    .join("、");
  const location = [propertyFacts.city, propertyFacts.district]
    .filter((item) => item !== "待确认")
    .join("·");
  return [
    `${propertyFacts.community === "待确认" ? "该房源" : propertyFacts.community}位于${location || "待确认区域"}，建筑面积为${propertyFacts.buildingArea}。`,
    `户型识别为${recognized.layoutType || "待确认"}，整体朝向为${recognized.orientation || "待确认"}，包含${rooms || "待确认的功能空间"}。`,
    `基础动线为${recognized.basicRoute || "待确认"}。装修、电梯、学校、交通及周边配套均以用户填写信息为准，未提供部分保留待确认。`
  ].join("");
}

function fallbackEnrichedDescription(objectiveDescription, manualHighlights) {
  if (!manualHighlights.length) return objectiveDescription;
  return `${objectiveDescription}人工补充信息显示：${manualHighlights.join("；")}。这些信息可作为了解房源使用体验的补充，仍建议结合现场或相关材料核验。`;
}

async function generatePropertyDescriptions({
  propertyFacts,
  recognized,
  manualHighlights = []
}) {
  const fallbackObjective = fallbackObjectiveDescription(propertyFacts, recognized);
  let objectiveDescription = fallbackObjective;
  let enrichedDescription = fallbackEnrichedDescription(
    fallbackObjective,
    manualHighlights
  );
  let provider = "fallback";

  try {
    const objective = await callDeepseekJson(
      buildObjectiveDescriptionMessages(propertyFacts, recognized)
    );
    objectiveDescription =
      typeof objective?.description === "string" && objective.description.trim()
        ? objective.description.trim()
        : fallbackObjective;
    provider = objective ? "deepseek" : "fallback";
  } catch (error) {
    console.error("Objective description fallback:", error);
  }

  if (manualHighlights.length) {
    try {
      const enriched = await callDeepseekJson(
        buildEnrichedDescriptionMessages(objectiveDescription, manualHighlights)
      );
      enrichedDescription =
        typeof enriched?.description === "string" && enriched.description.trim()
          ? enriched.description.trim()
          : fallbackEnrichedDescription(objectiveDescription, manualHighlights);
      if (enriched) provider = "deepseek";
    } catch (error) {
      console.error("Enriched description fallback:", error);
      enrichedDescription = fallbackEnrichedDescription(
        objectiveDescription,
        manualHighlights
      );
    }
  } else {
    enrichedDescription = objectiveDescription;
  }

  return { provider, objectiveDescription, enrichedDescription };
}

app.get("/api/label-taxonomy", (_req, res) => {
  res.json(loadLabels());
});

app.post("/api/label-taxonomy/label", (req, res) => {
  try {
    const { section, label, id } = req.body || {};
    assertLabelSection(section);
    const cleanLabel = String(label || "").trim();
    if (!cleanLabel) {
      res.status(400).json({ error: "请填写标签名称。" });
      return;
    }

    const labels = loadLabels();
    const preferredId = normalizeLabelId(id) || normalizeLabelId(label) || fallbackLabelId(label);
    let nextId = preferredId;
    let suffix = 2;
    const existingIds = new Set(labels[section].map((item) => item.id));
    while (existingIds.has(nextId)) {
      nextId = `${preferredId}_${suffix}`;
      suffix += 1;
    }

    const labelItem = { id: nextId, label: cleanLabel, aliases: [cleanLabel] };
    labels[section] = [...labels[section], labelItem];
    saveLabels(labels);
    addExtractedLabel(section, labelItem);
    res.json({ ok: true, label: { id: nextId, label: cleanLabel }, taxonomy: labels });
  } catch (error) {
    res.status(400).json({ error: error.message || "新增标签失败。" });
  }
});

app.post("/api/label-taxonomy/delete", (req, res) => {
  try {
    const { section, id } = req.body || {};
    assertLabelSection(section);
    const labelId = String(id || "").trim();
    if (!labelId) {
      res.status(400).json({ error: "缺少标签 ID。" });
      return;
    }

    const labels = loadLabels();
    const before = labels[section].length;
    labels[section] = labels[section].filter((item) => item.id !== labelId);
    if (labels[section].length === before) {
      res.status(404).json({ error: "未找到该标签。" });
      return;
    }

    saveLabels(labels);
    const touchedExtractedLabels = removeExtractedLabel(section, labelId);
    const touchedCases = removeLabelFromBenchmarkCases(section, labelId);
    res.json({ ok: true, removedId: labelId, touchedCases, touchedExtractedLabels, taxonomy: labels });
  } catch (error) {
    res.status(400).json({ error: error.message || "删除标签失败。" });
  }
});

app.get("/api/benchmark-images", (_req, res) => {
  const files = fs.existsSync(benchmarkImageDir)
    ? fs
        .readdirSync(benchmarkImageDir)
        .filter(isSupportedImage)
        .sort()
        .map((fileName) => {
          const stat = fs.statSync(path.join(benchmarkImageDir, fileName));
          return {
            id: caseIdFromFile(fileName),
            fileName,
            imagePath: `benchmark/images/${fileName}`,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
            reviewed: fs.existsSync(path.join(generatedCaseDir, `${caseIdFromFile(fileName)}.json`))
          };
        })
    : [];
  res.json({ images: files });
});

app.get("/api/benchmark-image/:fileName", (req, res) => {
  try {
    res.sendFile(resolveBenchmarkImage(req.params.fileName));
  } catch (error) {
    res.status(404).json({ error: error.message || "图片不存在。" });
  }
});

app.post("/api/floorplan-analyze", async (req, res) => {
  const {
    imageDataUrl,
    imageName,
    area,
    property = {},
    familyType = "年轻家庭",
    focusTags = [],
    manualHighlights = []
  } = req.body || {};

  if (!imageDataUrl || typeof imageDataUrl !== "string") {
    res.status(400).json({ error: "请先上传户型图。" });
    return;
  }

  if (!imageDataUrl.startsWith("data:image/")) {
    res.status(400).json({ error: "图片格式不正确，请上传 jpg、png 或 webp。" });
    return;
  }

  const numericArea = Number(area);
  if (!Number.isFinite(numericArea) || numericArea <= 0) {
    res.status(400).json({ error: "请填写有效的房屋面积。" });
    return;
  }
  const suppliedArea = `${numericArea}㎡`;

  try {
    const graphResult = await runFloorplanAgent(floorplanAgentGraph, {
      imageDataUrl,
      imageName,
      suppliedArea,
      // 第一层房源描述只应被识图结构错误阻断；亮点标签审核留给
      // Benchmark/后续亮点流程，不把普通用户强制切到标注台。
      skipHighlightReview: true
    });
    const pendingReview = reviewResponse(graphResult);
    if (pendingReview) {
      res.status(202).json(pendingReview);
      return;
    }
    if (!graphResult.recognitionValid) {
      res.status(422).json({
        error: "视觉模型返回的户型结构未通过校验。",
        provider: { vision: "ark", workflow: "langgraph" },
        executionPath: graphResult.executionPath,
        recognized: graphResult.recognized,
        validationErrors: graphResult.validationErrors,
        repairLog: graphResult.repairLog,
        needsHumanReview: graphResult.needsHumanReview
      });
      return;
    }
    if (!graphResult.auditResult.passed && !graphResult.skipHighlightReview) {
      res.status(422).json({
        error: "亮点审核未通过，需要人工复核。",
        provider: { vision: "ark", workflow: "langgraph" },
        executionPath: graphResult.executionPath,
        recognized: graphResult.validatedRecognition,
        evidence: graphResult.highlights.evidence,
        audit: graphResult.auditResult,
        needsHumanReview: true
      });
      return;
    }
    const recognized = graphResult.validatedRecognition;
    const propertyFacts = normalizePropertyFacts({
      ...property,
      buildingArea: suppliedArea
    });
    const descriptions = await generatePropertyDescriptions({
      propertyFacts,
      recognized,
      manualHighlights
    });
    const generated = await generateBrief({ recognized, familyType, focusTags, manualHighlights });
    const response = {
      schemaVersion: "property-facts/v1",
      floorplanSchemaVersion: "floorplan-analysis/v1",
      status: "completed",
      threadId: graphResult.threadId,
      provider: {
        vision: "ark",
        description: descriptions.provider,
        brief: generated.provider,
        workflow: "langgraph"
      },
      executionPath: graphResult.executionPath,
      validation: { valid: true, errors: [] },
      repairLog: graphResult.repairLog,
      evidence: graphResult.highlights.evidence,
      audit: graphResult.auditResult,
      manualHighlights,
      propertyFacts,
      sources: propertyFactSources(propertyFacts, recognized, manualHighlights),
      warnings: descriptionWarnings(propertyFacts, recognized),
      objectiveDescription: descriptions.objectiveDescription,
      enrichedDescription: descriptions.enrichedDescription,
      recognized,
      brief: generated.brief
    };
    const record = propertyRecordStore.create({
      image: {
        name: imageName || "未命名户型图",
        dataUrl: imageDataUrl,
        size: Math.round((imageDataUrl.length * 3) / 4)
      },
      propertyFacts,
      manualHighlights,
      analysis: response
    });
    res.json({ ...response, recordId: record.id, recordTitle: record.title });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || "户型图识别失败，请稍后重试。" });
  }
});

app.post("/api/floorplan-analyze-case", async (req, res) => {
  const {
    fileName,
    property = {},
    familyType = "年轻家庭",
    focusTags = [],
    manualHighlights = []
  } = req.body || {};

  try {
    const safeName = safeBaseName(fileName);
    const imageDataUrl = imageFileToDataUrl(safeName);
    const graphResult = await runFloorplanAgent(floorplanAgentGraph, {
      imageDataUrl,
      imageName: safeName
    });
    const pendingReview = reviewResponse(graphResult);
    if (pendingReview) {
      res.status(202).json({
        ...pendingReview,
        image: {
          id: caseIdFromFile(safeName),
          fileName: safeName,
          imagePath: `benchmark/images/${safeName}`
        }
      });
      return;
    }
    if (!graphResult.recognitionValid) {
      res.status(422).json({
        error: "视觉模型返回的户型结构未通过校验。",
        provider: { vision: "ark", workflow: "langgraph" },
        executionPath: graphResult.executionPath,
        image: {
          id: caseIdFromFile(safeName),
          fileName: safeName,
          imagePath: `benchmark/images/${safeName}`
        },
        recognized: graphResult.recognized,
        validationErrors: graphResult.validationErrors,
        repairLog: graphResult.repairLog,
        needsHumanReview: graphResult.needsHumanReview
      });
      return;
    }
    if (!graphResult.auditResult.passed) {
      res.status(422).json({
        error: "亮点审核未通过，需要人工复核。",
        provider: { vision: "ark", workflow: "langgraph" },
        executionPath: graphResult.executionPath,
        image: {
          id: caseIdFromFile(safeName),
          fileName: safeName,
          imagePath: `benchmark/images/${safeName}`
        },
        recognized: graphResult.validatedRecognition,
        evidence: graphResult.highlights.evidence,
        audit: graphResult.auditResult,
        needsHumanReview: true
      });
      return;
    }
    const recognized = graphResult.validatedRecognition;
    const propertyFacts = normalizePropertyFacts({
      ...property,
      buildingArea: recognized.area
    });
    const descriptions = await generatePropertyDescriptions({
      propertyFacts,
      recognized,
      manualHighlights
    });
    const generated = await generateBrief({ recognized, familyType, focusTags, manualHighlights });
    res.json({
      schemaVersion: "property-facts/v1",
      floorplanSchemaVersion: "floorplan-analysis/v1",
      status: "completed",
      threadId: graphResult.threadId,
      provider: {
        vision: "ark",
        description: descriptions.provider,
        brief: generated.provider,
        workflow: "langgraph"
      },
      executionPath: graphResult.executionPath,
      validation: { valid: true, errors: [] },
      repairLog: graphResult.repairLog,
      evidence: graphResult.highlights.evidence,
      audit: graphResult.auditResult,
      manualHighlights,
      propertyFacts,
      sources: propertyFactSources(propertyFacts, recognized, manualHighlights),
      warnings: descriptionWarnings(propertyFacts, recognized),
      objectiveDescription: descriptions.objectiveDescription,
      enrichedDescription: descriptions.enrichedDescription,
      image: {
        id: caseIdFromFile(safeName),
        fileName: safeName,
        imagePath: `benchmark/images/${safeName}`
      },
      recognized,
      brief: generated.brief
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || "户型图识别失败，请稍后重试。" });
  }
});

app.post("/api/floorplan-brief", async (req, res) => {
  const {
    recognized,
    familyType = "年轻家庭",
    focusTags = [],
    manualHighlights = []
  } = req.body || {};

  if (!recognized || typeof recognized !== "object") {
    res.status(400).json({ error: "缺少已校正的户型识别结果。" });
    return;
  }

  const generated = await generateBrief({ recognized, familyType, focusTags, manualHighlights });
  res.json({
    provider: { brief: generated.provider },
    brief: generated.brief
  });
});

app.post("/api/floorplan-review/:threadId", async (req, res) => {
  try {
    const graphResult = await resumeFloorplanAgent(floorplanAgentGraph, {
      threadId: safeBaseName(req.params.threadId),
      resume: req.body
    });
    const pendingReview = reviewResponse(graphResult);
    if (pendingReview) {
      res.status(202).json(pendingReview);
      return;
    }

    const recognized = graphResult.validatedRecognition;
    const propertyFacts = normalizePropertyFacts({
      ...(req.body?.property || {}),
      buildingArea:
        req.body?.property?.buildingArea || recognized.area
    });
    const manualHighlights = req.body?.manualHighlights || [];
    const descriptions = await generatePropertyDescriptions({
      propertyFacts,
      recognized,
      manualHighlights
    });
    const generated = await generateBrief({
      recognized,
      familyType: req.body?.familyType || "年轻家庭",
      focusTags: req.body?.focusTags || [],
      manualHighlights
    });
    res.json({
      schemaVersion: "property-facts/v1",
      floorplanSchemaVersion: "floorplan-analysis/v1",
      status: "completed",
      threadId: graphResult.threadId,
      provider: {
        vision: "ark",
        description: descriptions.provider,
        brief: generated.provider,
        workflow: "langgraph"
      },
      executionPath: graphResult.executionPath,
      validation: {
        valid: graphResult.recognitionValid,
        errors: graphResult.validationErrors
      },
      evidence: graphResult.highlights?.evidence || [],
      audit: graphResult.auditResult,
      manualHighlights,
      propertyFacts,
      sources: propertyFactSources(propertyFacts, recognized, manualHighlights),
      warnings: descriptionWarnings(propertyFacts, recognized),
      objectiveDescription: descriptions.objectiveDescription,
      enrichedDescription: descriptions.enrichedDescription,
      recognized,
      brief: generated.brief
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || "恢复人工复核失败。" });
  }
});

app.get("/api/highlight-agent/health", async (_req, res) => {
  let caseLibrary;
  try {
    caseLibrary = { available: true, count: manualCaseLibrary.load().length };
  } catch (error) {
    caseLibrary = {
      available: false,
      count: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  res.json({
    ok: true,
    caseLibrary,
    contentModel: {
      available: highlightJsonClient.available,
      provider: highlightJsonClient.available ? "deepseek" : "fallback"
    }
  });
});

app.post("/api/highlight-agent/start", async (req, res) => {
  try {
    const graphResult = await runPropertyHighlightAgent(
      propertyHighlightAgentGraph,
      req.body
    );
    res.json(formatHighlightAgentResult(graphResult));
  } catch (error) {
    console.error(error);
    res.status(400).json({
      error: error.message || "房源亮点 Agent 启动失败。"
    });
  }
});

app.post("/api/script-agent/generate", async (req, res) => {
  try {
    const result = await generatePropertyScript(highlightJsonClient, req.body);
    const savedScript = req.body?.propertyRecordId
      ? propertyRecordStore.addScript(req.body.propertyRecordId, result)
      : null;
    res.json({
      ...result,
      ...(savedScript ? { scriptId: savedScript.id, scriptName: savedScript.name } : {})
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      error: error.message || "房源脚本生成失败。"
    });
  }
});

app.post("/api/property-records/:recordId/scripts/:scriptId/refine", async (req, res) => {
  try {
    const instruction = String(req.body?.instruction || "").trim();
    if (!instruction) return res.status(400).json({ error: "请填写二次润色方向。" });
    const record = propertyRecordStore.read(req.params.recordId);
    if (!record) return res.status(404).json({ error: "户型档案不存在。" });
    const source = record.scripts.find((item) => item.id === req.params.scriptId);
    if (!source) return res.status(404).json({ error: "脚本方案不存在。" });
    if (!highlightJsonClient.available) {
      return res.status(503).json({ error: "DeepSeek 尚未配置，请检查 DEEPSEEK_API_KEY 后重启服务。" });
    }

    const result = await generatePropertyScript(highlightJsonClient, {
      duration: source.result.duration,
      style: source.result.style,
      floorplanAnalysis: record.analysis?.recognized || {},
      property: record.propertyFacts || {},
      enrichedDescription: record.analysis?.enrichedDescription
        || record.analysis?.objectiveDescription
        || "",
      factConfirmations: record.factConfirmations || [],
      manualHighlights: record.manualHighlights || [],
      refinementInstruction: instruction,
      requireModel: true,
      baseScript: source.result
    });
    const saved = propertyRecordStore.addScript(req.params.recordId, result, {
      derivedFromScriptId: source.id,
      refinementInstruction: instruction
    });
    res.json(saved);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || "脚本二次润色失败。" });
  }
});

app.post("/api/property-records/:recordId/scripts/:scriptId/skill-cases", (req, res) => {
  try {
    const record = propertyRecordStore.read(req.params.recordId);
    if (!record) return res.status(404).json({ error: "户型档案不存在。" });
    const script = record.scripts.find((item) => item.id === req.params.scriptId);
    if (!script) return res.status(404).json({ error: "脚本方案不存在。" });
    const saved = voiceoverCaseLibrary.add({
      recordId: record.id,
      script,
      metadata: {
        ...req.body,
        layoutType: record.analysis?.recognized?.layoutType || ""
      }
    });
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ error: error.message || "加入 Skill 案例库失败。" });
  }
});

app.get("/api/property-records", (_req, res) => {
  res.json({ records: propertyRecordStore.list() });
});

app.post("/api/property-records/:recordId/rooms/:roomId/visual", async (req, res) => {
  try {
    const record = propertyRecordStore.read(req.params.recordId);
    if (!record) return res.status(404).json({ error: "户型档案不存在。" });
    const room = record.analysis?.recognized?.rooms?.find(
      (item) => item.id === req.params.roomId
    );
    if (!room) return res.status(404).json({ error: "房间不存在。" });
    const { imageDataUrl, imageName } = req.body || {};
    if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
      return res.status(400).json({ error: "请上传有效的房间照片。" });
    }
    const analysis = normalizeRoomPhotoAnalysis(await recognizeRoomPhoto({
      imageDataUrl,
      imageName,
      room,
      floorplan: record.analysis.recognized
    }));
    const roomVisual = {
      image: {
        name: imageName || `${room.name || room.id}.jpg`,
        dataUrl: imageDataUrl,
        size: Math.round((imageDataUrl.length * 3) / 4)
      },
      analysis,
      analyzedAt: new Date().toISOString(),
      provider: "ark"
    };
    const updatedRoom = propertyRecordStore.setRoomVisual(
      req.params.recordId,
      req.params.roomId,
      roomVisual
    );
    res.json(updatedRoom);
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || "房间照片识别失败。" });
  }
});

app.delete("/api/property-records/:recordId/rooms/:roomId/visual", (req, res) => {
  try {
    if (!propertyRecordStore.deleteRoomVisual(req.params.recordId, req.params.roomId)) {
      return res.status(404).json({ error: "房间实景记录不存在。" });
    }
    res.json({ deleted: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/property-records/:recordId", (req, res) => {
  try {
    const record = propertyRecordStore.read(req.params.recordId);
    if (!record) return res.status(404).json({ error: "户型档案不存在。" });
    res.json(record);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/property-records/:recordId", (req, res) => {
  try {
    const record = propertyRecordStore.update(req.params.recordId, req.body || {});
    if (!record) return res.status(404).json({ error: "户型档案不存在。" });
    res.json(record);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/property-records/:recordId", (req, res) => {
  try {
    if (!propertyRecordStore.delete(req.params.recordId)) {
      return res.status(404).json({ error: "户型档案不存在。" });
    }
    res.json({ deleted: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/property-records/:recordId/scripts/:scriptId", (req, res) => {
  try {
    const script = propertyRecordStore.updateScript(
      req.params.recordId,
      req.params.scriptId,
      req.body || {}
    );
    if (!script) return res.status(404).json({ error: "脚本方案不存在。" });
    res.json(script);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/property-records/:recordId/scripts/:scriptId", (req, res) => {
  try {
    if (!propertyRecordStore.deleteScript(req.params.recordId, req.params.scriptId)) {
      return res.status(404).json({ error: "脚本方案不存在。" });
    }
    res.json({ deleted: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/highlight-agent/:threadId/confirm-queries", async (req, res) => {
  res.status(410).json({
    error: "关键词确认流程已停用，请直接重新启动 Agent 2。"
  });
});

app.get("/api/benchmark-case/:caseId", (req, res) => {
  const caseId = safeBaseName(req.params.caseId).replace(/\.json$/i, "");
  const filePath = path.join(generatedCaseDir, `${caseId}.json`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "还没有保存过这个 case。" });
    return;
  }
  res.json(readJsonIfExists(filePath));
});

app.post("/api/benchmark-case", (req, res) => {
  const { id, imagePath, recognized, title } = req.body || {};
  const caseId = safeBaseName(id).replace(/\.json$/i, "");

  if (!caseId) {
    res.status(400).json({ error: "缺少 case id。" });
    return;
  }
  if (!recognized || typeof recognized !== "object") {
    res.status(400).json({ error: "缺少要保存的识图结果。" });
    return;
  }

  const benchmarkCase = {
    id: caseId,
    title: title || `${caseId} 人工复核`,
    imagePath: imagePath || `benchmark/images/${caseId}.jpg`,
    layoutType: recognized.layoutType || "unknown",
    area: recognized.area || "unknown",
    orientation: recognized.orientation || "unknown",
    rooms: Array.isArray(recognized.rooms) ? recognized.rooms : [],
    features: recognized.features || {},
    pros: Array.isArray(recognized.pros) ? recognized.pros : [],
    cons: Array.isArray(recognized.cons) ? recognized.cons : [],
    suitableFor: Array.isArray(recognized.suitableFor) ? recognized.suitableFor : [],
    unknowns: Array.isArray(recognized.unknowns) ? recognized.unknowns : [],
    needsReview: Array.isArray(recognized.needsReview) ? recognized.needsReview : [],
    notes: "由半自动标注台保存"
  };

  const outputPath = path.join(generatedCaseDir, `${caseId}.json`);
  writeJson(outputPath, [benchmarkCase]);
  res.json({
    ok: true,
    path: outputPath.replaceAll("\\", "/"),
    case: benchmarkCase
  });
});

app.post("/api/guide", (_req, res) => {
  res.json({
    provider: "fallback",
    text: "当前主入口已切换为平面图讲解 Agent，请上传户型图生成结构化讲解。"
  });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API 接口不存在，请确认前后端已更新并重启服务。" });
});

app.use((error, req, res, next) => {
  if (!req.path.startsWith("/api")) return next(error);
  console.error(error);
  res.status(error?.status || 500).json({
    error: error instanceof SyntaxError
      ? "请求 JSON 格式无效。"
      : error?.message || "服务端处理失败。"
  });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`AI real-estate guide API listening on http://127.0.0.1:${port}`);
  });
}
