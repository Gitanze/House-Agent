import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { matchVoiceoverCases } from "../providers/voiceover-case-library.mjs";

const styleHeadings = {
  local_highlight: "1. 局部亮点型",
  renovation_ready: "2. 装修省心型",
  owner_story: "3. 业主个人叙述型",
  buyer_dilemma: "4. 看房人纠结型",
  playful: "5. 搞笑抽象互动型"
};

function section(markdown, heading, nextLevel = "##") {
  const marker = `${nextLevel} ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) throw new Error(`口播 Skill 缺少章节：${heading}`);
  const contentStart = start + marker.length;
  const rest = markdown.slice(contentStart);
  const nextPattern = new RegExp(`\\n${nextLevel.replace(/#/g, "\\#")}\\s+`);
  const next = rest.search(nextPattern);
  return `${marker}${next < 0 ? rest : rest.slice(0, next)}`.trim();
}

function selectedStyleSection(markdown, style) {
  const heading = styleHeadings[style];
  if (!heading) throw new Error(`不支持的口播风格：${style}`);
  const marker = `### ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) throw new Error(`口播风格参考缺少章节：${heading}`);
  const rest = markdown.slice(start + marker.length);
  const next = rest.search(/\n#{2,3}\s+/);
  return {
    heading,
    content: `${marker}${next < 0 ? rest : rest.slice(0, next)}`.trim()
  };
}

function fileInfo(filePath, content) {
  const stat = fs.statSync(filePath);
  return {
    path: path.relative(process.cwd(), filePath).replace(/\\/g, "/"),
    modifiedAt: stat.mtime.toISOString(),
    sha256: createHash("sha256").update(content).digest("hex").slice(0, 16)
  };
}

export function loadVoiceoverSkill(style, {
  root = path.resolve("residential-story-voiceover"),
  input,
  cases
} = {}) {
  const skillPath = path.join(root, "SKILL.md");
  const referencePath = path.join(root, "references", "style-and-structures.md");
  if (!fs.existsSync(skillPath)) {
    throw new Error(`口播 Skill 文件不存在：${skillPath}`);
  }
  if (!fs.existsSync(referencePath)) {
    throw new Error(`口播风格参考文件不存在：${referencePath}`);
  }

  const skillMarkdown = fs.readFileSync(skillPath, "utf8");
  const referenceMarkdown = fs.readFileSync(referencePath, "utf8");
  const selected = selectedStyleSection(referenceMarkdown, style);
  const skillRules = [
    section(skillMarkdown, "写作规则"),
    section(skillMarkdown, "文本量"),
    section(skillMarkdown, "成稿检查")
  ].join("\n\n");
  const commonReference = section(referenceMarkdown, "共同语言风格");
  const commonSkeleton = [
    section(referenceMarkdown, "通用骨架"),
    section(referenceMarkdown, "改写原则")
  ].join("\n\n");
  const casePath = path.join(root, "cases", "library.json");
  let availableCases = cases;
  if (!availableCases) {
    try {
      availableCases = fs.existsSync(casePath)
        ? JSON.parse(fs.readFileSync(casePath, "utf8"))
        : [];
    } catch {
      availableCases = [];
    }
  }
  const matchedCases = input
    ? matchVoiceoverCases(Array.isArray(availableCases) ? availableCases : [], input)
    : [];
  const caseReference = matchedCases.length
    ? [
        "# 已审核成稿案例",
        "以下案例只用于学习结构、节奏和表达，不得复制案例中的房源事实：",
        ...matchedCases.map((item, index) => [
          `## 案例 ${index + 1}：${item.title}`,
          `定位：${item.storyPositioning || ""}`,
          `标签：${[...(item.applicableTags || []), ...(item.highlightTags || [])].join("、")}`,
          `口播：\n${item.voiceover || ""}`
        ].join("\n"))
      ].join("\n\n")
    : "";

  return {
    promptReference: [
      "# Skill 写作规则",
      skillRules,
      "# 共同语言与示例",
      commonReference,
      "# 当前风格参考",
      selected.content,
      "# 通用骨架与改写",
      commonSkeleton,
      caseReference
    ].join("\n\n"),
    trace: {
      skill: fileInfo(skillPath, skillMarkdown),
      reference: fileInfo(referencePath, referenceMarkdown),
      selectedStyleSection: selected.heading,
      loadedAt: new Date().toISOString(),
      positiveOnlyOverride: true,
      matchedCases: matchedCases.map((item) => ({
        caseId: item.caseId,
        title: item.title
      }))
    }
  };
}
