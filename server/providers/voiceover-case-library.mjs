import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function normalizeTags(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[,，\n]/);
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

export class VoiceoverCaseLibrary {
  constructor({ filePath = path.resolve("residential-story-voiceover/cases/library.json") } = {}) {
    this.filePath = filePath;
  }

  load() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  write(cases) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(cases, null, 2)}\n`, "utf8");
  }

  add({ recordId, script, metadata }) {
    const cases = this.load();
    if (cases.some((item) => item.sourceScriptId === script.id)) {
      throw new Error("该脚本已经加入 Skill 案例库。");
    }
    const title = String(metadata.title || "").trim();
    if (!title) throw new Error("请填写案例标题。");
    const applicableTags = normalizeTags(metadata.applicableTags);
    const highlightTags = normalizeTags(metadata.highlightTags);
    if (!applicableTags.length) throw new Error("请至少填写一个适用场景标签。");
    if (!highlightTags.length) throw new Error("请至少填写一个核心亮点标签。");

    const saved = {
      caseId: randomUUID(),
      title,
      style: script.result.style,
      styleLabel: script.result.styleLabel,
      duration: script.result.duration,
      applicableTags,
      highlightTags,
      notes: String(metadata.notes || "").trim(),
      layoutType: String(metadata.layoutType || "").trim(),
      sourceRecordId: recordId,
      sourceScriptId: script.id,
      addedAt: new Date().toISOString(),
      storyPositioning: script.result.storyPositioning,
      voiceover: script.result.voiceover,
      scenes: script.result.scenes
    };
    cases.push(saved);
    this.write(cases);
    return saved;
  }
}

export function matchVoiceoverCases(cases, input, limit = 3) {
  const text = [
    input.floorplanAnalysis?.layoutType,
    input.floorplanAnalysis?.area,
    input.property?.community,
    input.objectiveDescription,
    ...(input.manualHighlights || [])
  ].filter(Boolean).join(" ");

  return cases
    .map((item) => {
      const tags = [...(item.applicableTags || []), ...(item.highlightTags || [])];
      const score = (item.style === input.style ? 10 : 0)
        + (item.layoutType && text.includes(item.layoutType) ? 4 : 0)
        + tags.filter((tag) => text.includes(tag)).length;
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.item.addedAt.localeCompare(a.item.addedAt))
    .slice(0, limit)
    .map(({ item }) => item);
}
