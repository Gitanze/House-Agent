import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const imagePath = process.argv[2];
const outPathArg = process.argv[3];

if (!imagePath) {
  console.error("Usage: npm run recognize:floorplan -- benchmark/images/case_001.jpg [output.json]");
  process.exit(1);
}

const provider = process.env.VISION_PROVIDER || "ark";
const arkApiKey = process.env.ARK_API_KEY;
const arkBaseUrl = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const arkModel = process.env.ARK_VISION_MODEL || "doubao-seed-2-0-mini-260428";
const labelsPath = "benchmark/taxonomy/canonical-labels.json";

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function caseIdFromPath(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function extractJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1].trim());

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  throw new Error("Model did not return parseable JSON");
}

function labelOptions(section) {
  const labels = readJsonIfExists(labelsPath);
  return (labels?.[section] ?? []).map((item) => `${item.id}: ${item.label}`).join("\n");
}

function buildPrompt(id) {
  return `你是一个房产户型图识别 Agent。请只根据图片中能看到的户型图信息输出 JSON，不要输出 Markdown。

目标：识别房间、连接关系、采光通风、动静分区、优点、短板、适合人群。没有证据的信息必须写 unknown 或放进 unknowns，不要编造。

pros/cons/suitableFor 必须只输出下面固定标签 ID，不要输出中文自由短语。

可选 pros 标签：
${labelOptions("pros")}

可选 cons 标签：
${labelOptions("cons")}

可选 suitableFor 标签：
${labelOptions("suitableFor")}

输出必须是单个 JSON object，字段如下：
{
  "id": "${id}",
  "layoutType": "例如 3室2厅1卫，无法确认写 unknown",
  "rooms": [
    {
      "id": "英文稳定 id，例如 living, kitchen, bedroom_a",
      "type": "living_room | dining_room | kitchen | primary_bedroom | bedroom | child_room | study | bathroom | balcony | entrance | corridor | storage",
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
1. 房间类型只能使用上面列出的 type。
2. connectedTo 必须使用 rooms 里存在的 id。
3. 看不到窗户、阳台或朝向证据时，不要推断南北通透。
4. 不要输出价格、楼层、学区、噪音、承重墙等户型图无法证明的信息。
5. 优缺点必须基于 rooms 和 features 中的事实。
6. 如果图中有中文房间名和面积，优先读取图中文字。
7. pros/cons/suitableFor 只能选固定标签 ID；如果没有合适标签，少选，不要自造新标签。`;
}

function imageToDataUrl(filePath) {
  const imageBytes = fs.readFileSync(path.resolve(filePath));
  return `data:${mimeType(filePath)};base64,${imageBytes.toString("base64")}`;
}

function arkResponsesUrl() {
  const normalized = arkBaseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/responses")) return normalized;
  return `${normalized}/responses`;
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

async function recognizeWithArk({ id, dataUrl }) {
  if (!arkApiKey) {
    throw new Error("Missing ARK_API_KEY in .env");
  }

  const response = await fetch(arkResponsesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${arkApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: arkModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: dataUrl },
            { type: "input_text", text: buildPrompt(id) },
          ],
        },
      ],
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Ark recognition failed with ${response.status}: ${responseText.slice(0, 800)}`);
  }

  const data = JSON.parse(responseText);
  const content = extractArkText(data);
  if (!content) throw new Error("Ark recognition returned an empty message");

  return extractJson(content);
}

async function run() {
  if (provider !== "ark") {
    throw new Error(`Unsupported VISION_PROVIDER "${provider}". This script currently supports "ark".`);
  }

  const id = caseIdFromPath(imagePath);
  const outPath = outPathArg || `benchmark/predictions/${id}-agent.json`;
  const dataUrl = imageToDataUrl(imagePath);
  const prediction = await recognizeWithArk({ id, dataUrl });
  prediction.id = prediction.id || id;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify([prediction], null, 2), "utf8");

  console.log(`Recognized ${imagePath}`);
  console.log(`Provider: ark`);
  console.log(`Model: ${arkModel}`);
  console.log(`Wrote ${outPath}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
