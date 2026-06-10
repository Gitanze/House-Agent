import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";

const app = express();
const port = Number(process.env.PORT || 8787);
const labelsPath = "benchmark/taxonomy/canonical-labels.json";
const benchmarkImageDir = "benchmark/images";
const generatedCaseDir = "benchmark/cases/generated";

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
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("Model did not return parseable JSON");
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

function buildRecognitionPrompt(imageName) {
  return `你是一个房产户型图识别 Agent。请只根据图片中能看到的户型图信息输出 JSON，不要输出 Markdown。

图片文件名：${imageName || "未命名户型图"}

目标：识别户型、面积、朝向、房间、连接关系、采光通风、动静分区、优点、短板、适合人群。没有证据的信息必须写 unknown 或放进 unknowns，不要编造。

pros/cons/suitableFor 必须只输出下面固定标签 ID，不要输出中文自由短语。

可选 pros 标签：
${labelOptions("pros")}

可选 cons 标签：
${labelOptions("cons")}

可选 suitableFor 标签：
${labelOptions("suitableFor")}

输出必须是单个 JSON object，字段如下：
{
  "layoutType": "例如 3室2厅1卫，无法确认写 unknown",
  "area": "例如 89㎡，无法确认写 unknown",
  "orientation": "例如 南向/东向/南北通透，无法确认写 unknown",
  "rooms": [
    {
      "id": "英文稳定 id，例如 living_room, kitchen, bedroom_a",
      "type": "living_room | dining_room | kitchen | primary_bedroom | bedroom | child_room | study | bathroom | balcony | entrance | corridor | storage | unknown",
      "name": "图中中文房间名",
      "position": "相对位置，例如 北侧/南侧中部/东南侧",
      "connectedTo": ["只写能确认直接门洞或开口连接的房间 id"],
      "hasWindow": true,
      "light": "good | medium | weak | unknown"
    }
  ],
  "features": {
    "northSouthVentilation": true,
    "dynamicStaticZoning": "good | medium | weak | unknown",
    "kitchenDiningFlow": "good | medium | weak | unknown",
    "bathroomPressure": "low | medium | high | unknown",
    "lighting": "good | medium | weak | unknown",
    "storagePotential": "good | medium | weak | unknown"
  },
  "pros": ["只能填 pros 标签 ID"],
  "cons": ["只能填 cons 标签 ID"],
  "suitableFor": ["只能填 suitableFor 标签 ID"],
  "unknowns": ["无法确认但重要的信息"],
  "needsReview": ["需要人工复核的判断"]
}

规则：
1. connectedTo 必须使用 rooms 里存在的 id。
2. 看不到窗户、阳台或朝向证据时，不要推断南北通透。
3. 不要输出价格、楼层、学区、噪音、承重墙等户型图无法证明的信息。
4. 如果图中有中文房间名、面积、指北针或尺寸，优先读取图中文字。`;
}

async function recognizeFloorplan({ imageDataUrl, imageName }) {
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
            { type: "input_text", text: buildRecognitionPrompt(imageName) }
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
  return extractJson(content);
}

function normalizeList(list, fallbackItems, count = 3) {
  const items = Array.isArray(list) ? list.filter(Boolean).map(String) : [];
  return [...items, ...fallbackItems].slice(0, count);
}

function fallbackBrief(recognized, familyType, focusTags) {
  const layout = recognized.layoutType && recognized.layoutType !== "unknown" ? recognized.layoutType : "这套户型";
  const rooms = Array.isArray(recognized.rooms) ? recognized.rooms : [];
  const roomNames = rooms.slice(0, 5).map((room) => room.name || room.type).filter(Boolean);
  const pros = normalizeList(
    (recognized.pros || []).map((id) => labelName(id, "pros")),
    ["空间功能清晰", "主要生活区容易讲解", "适合按关注点继续现场核对"]
  );
  const cons = normalizeList(
    (recognized.cons || []).map((id) => labelName(id, "cons")),
    ["部分信息需要现场确认"]
  );
  const focus = focusTags?.length ? focusTags.join("、") : "采光、动线和收纳";

  return {
    talk30s: `${layout}可以先按${familyType || "年轻家庭"}的生活方式来看。图上能看到${roomNames.join("、") || "主要功能空间"}，讲解重点建议放在${focus}。目前比较明确的卖点是${pros.slice(0, 2).join("、")}；同时要提醒客户，${cons[0]}，最好结合现场采光和家具尺度再确认。`,
    sellingPoints: pros,
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

function buildBriefPrompt(recognized, familyType, focusTags) {
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

async function generateBrief({ recognized, familyType, focusTags }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return { provider: "fallback", brief: fallbackBrief(recognized, familyType, focusTags) };

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
        messages: buildBriefPrompt(recognized, familyType, focusTags),
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
        talk30s: parsed.talk30s || fallbackBrief(recognized, familyType, focusTags).talk30s,
        sellingPoints: normalizeList(parsed.sellingPoints, fallbackBrief(recognized, familyType, focusTags).sellingPoints),
        faqs: normalizeList(parsed.faqs, fallbackBrief(recognized, familyType, focusTags).faqs),
        riskTip: parsed.riskTip || fallbackBrief(recognized, familyType, focusTags).riskTip
      }
    };
  } catch (error) {
    console.error(error);
    return { provider: "fallback", brief: fallbackBrief(recognized, familyType, focusTags) };
  }
}

app.get("/api/label-taxonomy", (_req, res) => {
  res.json(readJsonIfExists(labelsPath) || { pros: [], cons: [], suitableFor: [] });
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
  const { imageDataUrl, imageName, familyType = "年轻家庭", focusTags = [] } = req.body || {};

  if (!imageDataUrl || typeof imageDataUrl !== "string") {
    res.status(400).json({ error: "请先上传户型图。" });
    return;
  }

  if (!imageDataUrl.startsWith("data:image/")) {
    res.status(400).json({ error: "图片格式不正确，请上传 jpg、png 或 webp。" });
    return;
  }

  try {
    const recognized = await recognizeFloorplan({ imageDataUrl, imageName });
    const generated = await generateBrief({ recognized, familyType, focusTags });
    res.json({
      provider: { vision: "ark", brief: generated.provider },
      recognized,
      brief: generated.brief
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || "户型图识别失败，请稍后重试。" });
  }
});

app.post("/api/floorplan-analyze-case", async (req, res) => {
  const { fileName, familyType = "年轻家庭", focusTags = [] } = req.body || {};

  try {
    const safeName = safeBaseName(fileName);
    const imageDataUrl = imageFileToDataUrl(safeName);
    const recognized = await recognizeFloorplan({ imageDataUrl, imageName: safeName });
    const generated = await generateBrief({ recognized, familyType, focusTags });
    res.json({
      provider: { vision: "ark", brief: generated.provider },
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
  const { recognized, familyType = "年轻家庭", focusTags = [] } = req.body || {};

  if (!recognized || typeof recognized !== "object") {
    res.status(400).json({ error: "缺少已校正的户型识别结果。" });
    return;
  }

  const generated = await generateBrief({ recognized, familyType, focusTags });
  res.json({
    provider: { brief: generated.provider },
    brief: generated.brief
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

app.listen(port, () => {
  console.log(`AI real-estate guide API listening on http://127.0.0.1:${port}`);
});
