import fs from "node:fs";
import path from "node:path";

const inputDirs = ["benchmark/cases", "benchmark/predictions"];
const outputPath = "benchmark/taxonomy/labels.json";
const reviewPath = "benchmark/results/prediction-review-summary.json";

const canonicalRules = {
  pros: [
    { id: "good_lighting", label: "采光较好", patterns: ["采光好", "采光良好", "明亮", "南向", "阳台提升采光", "采光面"] },
    { id: "large_living_room", label: "客厅尺度较好", patterns: ["客厅面积大", "客厅尺度", "宽厅", "客厅开间", "客厅宽敞"] },
    { id: "living_balcony_connected", label: "客厅连接阳台", patterns: ["阳台连接客厅", "客厅外接阳台", "客厅带阳台", "阳台与客厅"] },
    { id: "kitchen_dining_flow_good", label: "餐厨动线顺", patterns: ["餐厨", "厨房与客厅相邻", "厨房与餐厅", "动线便捷", "动线顺畅"] },
    { id: "clear_zoning", label: "动静分区清晰", patterns: ["动静分区清晰", "动静分区合理", "功能分区清晰", "分区明确"] },
    { id: "storage_good", label: "收纳潜力较好", patterns: ["储物", "收纳", "独立储物", "储物间实用", "收纳空间"] },
    { id: "multi_bedroom_flexible", label: "多房间弹性强", patterns: ["多卧室", "三室", "四房", "多人口", "弹性"] },
    { id: "large_kitchen", label: "厨房尺度较好", patterns: ["厨房面积大", "厨房尺度", "厨房宽敞"] },
  ],
  cons: [
    { id: "weak_lighting_room", label: "局部房间采光弱", patterns: ["采光弱", "采光不足", "无直接采光", "无对外窗", "暗卫", "暗厨", "暗"] },
    { id: "single_bath_pressure", label: "单卫使用压力", patterns: ["单卫", "仅设1间卫浴", "卫生间压力", "卫浴易拥挤"] },
    { id: "weak_zoning", label: "动静分区一般", patterns: ["动静分区不够清晰", "动静分区弱", "分区弱"] },
    { id: "weak_entrance_storage", label: "入户收纳弱", patterns: ["门厅空间较狭小", "玄关收纳弱", "入户收纳弱", "门厅狭小"] },
    { id: "storage_weak", label: "收纳空间不足", patterns: ["收纳不足", "储物不足", "缺少储物", "收纳弱"] },
    { id: "combined_living_dining", label: "客餐厅功能复合", patterns: ["客厅兼餐厅", "客餐一体", "餐客厅", "客餐厅"] },
    { id: "corridor_area_loss", label: "过道占用面积", patterns: ["过道", "走廊", "交通面积"] },
    { id: "small_room_or_space", label: "局部空间偏紧凑", patterns: ["局促", "紧凑", "较小", "小空间"] },
  ],
  suitableFor: [
    { id: "young_family", label: "年轻家庭", patterns: ["年轻家庭", "小家庭", "首次置业", "年轻情侣", "刚需"] },
    { id: "three_person_family", label: "三口之家", patterns: ["三口之家", "三口", "一家三口"] },
    { id: "storage_focused_family", label: "重视收纳家庭", patterns: ["重视收纳", "收纳家庭"] },
    { id: "multi_room_need", label: "多房间需求家庭", patterns: ["多房间需求", "多卧室", "多人口", "大家庭"] },
    { id: "multi_generation_family", label: "多代同住", patterns: ["三代", "多代", "老人"] },
    { id: "improvement_family", label: "改善家庭", patterns: ["改善", "改善型"] },
    { id: "single_or_couple", label: "单身或二人居住", patterns: ["单身", "情侣", "二人"] },
  ],
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(dir, file));
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

function canonicalize(section, label) {
  const normalized = normalizeText(label);
  for (const rule of canonicalRules[section] ?? []) {
    if (rule.patterns.some((pattern) => normalized.includes(normalizeText(pattern)))) {
      return { id: rule.id, label: rule.label };
    }
  }

  return {
    id: `unmapped_${Buffer.from(normalized).toString("hex").slice(0, 16)}`,
    label: normalized,
  };
}

function addLabel(store, section, label, source) {
  if (!label) return;
  const canonical = canonicalize(section, label);
  const key = canonical.id;
  if (!store[section].has(key)) {
    store[section].set(key, {
      id: key,
      label: canonical.label,
      count: 0,
      rawLabels: {},
      sources: [],
    });
  }

  const item = store[section].get(key);
  item.count += 1;
  item.rawLabels[label] = (item.rawLabels[label] ?? 0) + 1;
  item.sources.push(source);
}

function simplifyRoom(room) {
  return {
    id: room.id,
    type: room.type,
    name: room.name,
    position: room.position,
    connectedTo: room.connectedTo ?? [],
    light: room.light,
  };
}

function run() {
  const store = {
    pros: new Map(),
    cons: new Map(),
    suitableFor: new Map(),
  };
  const review = [];

  for (const dir of inputDirs) {
    for (const filePath of listJsonFiles(dir)) {
      const items = readJson(filePath);
      const records = Array.isArray(items) ? items : [items];
      for (const record of records) {
        const source = {
          file: filePath.replaceAll("\\", "/"),
          caseId: record.id,
        };

        for (const section of ["pros", "cons", "suitableFor"]) {
          for (const label of record[section] ?? []) {
            addLabel(store, section, label, source);
          }
        }

        if (filePath.includes("benchmark/predictions")) {
          review.push({
            id: record.id,
            file: filePath.replaceAll("\\", "/"),
            layoutType: record.layoutType,
            rooms: (record.rooms ?? []).map(simplifyRoom),
            features: record.features ?? {},
            pros: record.pros ?? [],
            cons: record.cons ?? [],
            suitableFor: record.suitableFor ?? [],
            unknowns: record.unknowns ?? [],
            needsReview: record.needsReview ?? [],
          });
        }
      }
    }
  }

  const taxonomy = {
    generatedAt: new Date().toISOString(),
    note: "初版标签体系由 cases 和 predictions 自动提取。unmapped_* 标签需要人工合并或改名。",
    labels: Object.fromEntries(
      Object.entries(store).map(([section, map]) => [
        section,
        [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN")),
      ]),
    ),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(taxonomy, null, 2), "utf8");
  fs.writeFileSync(reviewPath, JSON.stringify(review.sort((a, b) => a.id.localeCompare(b.id)), null, 2), "utf8");

  console.log(`Wrote ${outputPath}`);
  console.log(`Wrote ${reviewPath}`);
  console.log(
    `Labels: pros ${taxonomy.labels.pros.length}, cons ${taxonomy.labels.cons.length}, suitableFor ${taxonomy.labels.suitableFor.length}`,
  );
}

run();
