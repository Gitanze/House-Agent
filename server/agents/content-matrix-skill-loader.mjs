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
  root = path.resolve("residential-content-matrix-voiceover")
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

  return {
    promptReference: [
      "# residential-content-matrix-voiceover",
      skillMarkdown,
      combinedReference
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
      matchedCases: [],
      referenceFiles: references.map((item) => item.info)
    }
  };
}
