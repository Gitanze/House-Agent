import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const referenceFiles = [
  "voice-rules.md",
  "audience-rules.md",
  "voice-types.md",
  "focus-types.md",
  "matrix-composition.md"
];

function loadCaseLibrary(casePath) {
  if (!fs.existsSync(casePath)) return [];
  try {
    const value = JSON.parse(fs.readFileSync(casePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function matchMatrixCases(cases, input, limit = 3) {
  if (!input) return [];
  const matrixText = [
    input.targetAudience,
    input.narrativeVoice,
    input.contentFocus,
    input.floorplanAnalysis?.layoutType,
    input.floorplanAnalysis?.area,
    input.property?.community,
    input.property?.district,
    input.enrichedDescription,
    ...(input.manualHighlights || [])
  ].filter(Boolean).join(" ");

  return cases
    .map((item) => {
      const tags = [
        item.narrativeVoice,
        item.contentFocus,
        ...(item.applicableTags || []),
        ...(item.highlightTags || [])
      ].filter(Boolean);
      const score = (item.narrativeVoice && item.narrativeVoice === input.narrativeVoice ? 12 : 0)
        + (item.contentFocus && item.contentFocus === input.contentFocus ? 10 : 0)
        + tags.filter((tag) => matrixText.includes(tag)).length
        + ((item.applicableTags || []).some((tag) => matrixText.includes(tag)) ? 2 : 0);
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || String(b.item.addedAt || "").localeCompare(String(a.item.addedAt || "")))
    .slice(0, limit)
    .map(({ item }) => item);
}

function fileInfo(filePath, content) {
  const stat = fs.statSync(filePath);
  return {
    path: path.relative(process.cwd(), filePath).replace(/\\/g, "/"),
    modifiedAt: stat.mtime.toISOString(),
    sha256: createHash("sha256").update(content).digest("hex").slice(0, 16)
  };
}

function readRequired(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`内容矩阵口播 Skill 缺少${label}：${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

export function loadContentMatrixSkill({
  root = path.resolve("residential-content-matrix-voiceover"),
  input,
  cases
} = {}) {
  const skillPath = path.join(root, "SKILL.md");
  const skillMarkdown = readRequired(skillPath, "入口文件");
  const references = referenceFiles.map((fileName) => {
    const filePath = path.join(root, "references", fileName);
    const content = readRequired(filePath, `参考文件 ${fileName}`);
    return {
      fileName,
      filePath,
      content,
      info: fileInfo(filePath, content)
    };
  });
  const combinedReference = references
    .map((item) => `# ${item.fileName}\n\n${item.content}`)
    .join("\n\n---\n\n");
  const combinedHash = createHash("sha256")
    .update([skillMarkdown, combinedReference].join("\n\n"))
    .digest("hex")
    .slice(0, 16);
  const casePath = path.join(root, "cases", "library.json");
  const availableCases = cases || loadCaseLibrary(casePath);
  const matchedCases = matchMatrixCases(Array.isArray(availableCases) ? availableCases : [], input);
  const caseReference = matchedCases.length
    ? [
        "# 内容矩阵已审核案例",
        "以下案例只学习口吻强度、结构节奏和空间展开方式，不得复制案例中的具体房源事实：",
        ...matchedCases.map((item, index) => [
          `## 案例 ${index + 1}：${item.title}`,
          `矩阵：${item.targetAudience || ""} × ${item.narrativeVoiceLabel || item.narrativeVoice || ""} × ${item.contentFocusLabel || item.contentFocus || ""}`,
          `标签：${[...(item.applicableTags || []), ...(item.highlightTags || [])].join("、")}`,
          `定位：${item.storyPositioning || ""}`,
          `口播：\n${item.voiceover || ""}`
        ].join("\n"))
      ].join("\n\n")
    : "";

  return {
    promptReference: [
      "# residential-content-matrix-voiceover",
      skillMarkdown,
      combinedReference,
      caseReference
    ].join("\n\n"),
    trace: {
      skill: fileInfo(skillPath, skillMarkdown),
      reference: {
        path: "residential-content-matrix-voiceover/references/*.md",
        modifiedAt: references
          .map((item) => item.info.modifiedAt)
          .sort()
          .at(-1),
        sha256: combinedHash
      },
      selectedStyleSection: "内容矩阵：目标客户 × 口吻 × 重点",
      loadedAt: new Date().toISOString(),
      positiveOnlyOverride: true,
      matchedCases: matchedCases.map((item) => ({
        caseId: item.caseId,
        title: item.title
      })),
      referenceFiles: references.map((item) => item.info)
    }
  };
}
