import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadVoiceoverSkill } from "./voiceover-skill-loader.mjs";

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "voiceover-skill-"));
  fs.mkdirSync(path.join(root, "references"));
  fs.writeFileSync(path.join(root, "SKILL.md"), [
    "# Skill",
    "## 写作规则", "规则A",
    "## 文本量", "长度A",
    "## 成稿检查", "检查A"
  ].join("\n"));
  fs.writeFileSync(path.join(root, "references", "style-and-structures.md"), [
    "# 参考",
    "## 共同语言风格", "共同示例A",
    "## 故事线选择",
    "### 1. 局部亮点型", "局部案例A",
    "### 2. 装修省心型", "装修案例B",
    "### 3. 业主个人叙述型", "业主案例C",
    "### 4. 看房人纠结型", "纠结案例D",
    "### 5. 搞笑抽象互动型", "搞笑案例E",
    "## 通用骨架", "骨架A",
    "## 改写原则", "改写A"
  ].join("\n"));
  return root;
}

test("loader reads fresh markdown and injects only selected style", () => {
  const root = fixtureRoot();
  const first = loadVoiceoverSkill("local_highlight", { root });
  assert.match(first.promptReference, /局部案例A/);
  assert.doesNotMatch(first.promptReference, /装修案例B/);

  fs.appendFileSync(path.join(root, "references", "style-and-structures.md"), "\n动态修改标记");
  const second = loadVoiceoverSkill("playful", { root });
  assert.match(second.promptReference, /搞笑案例E/);
  assert.notEqual(first.trace.reference.sha256, second.trace.reference.sha256);
  fs.rmSync(root, { recursive: true, force: true });
});

test("loader fails clearly when a required file is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "voiceover-missing-"));
  assert.throws(() => loadVoiceoverSkill("local_highlight", { root }), /文件不存在/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("loader injects only relevant approved cases", () => {
  const root = fixtureRoot();
  const loaded = loadVoiceoverSkill("local_highlight", {
    root,
    input: {
      style: "local_highlight",
      floorplanAnalysis: { layoutType: "三居室" },
      property: {},
      manualHighlights: ["采光"]
    },
    cases: [
      {
        caseId: "matched",
        title: "三居采光案例",
        style: "local_highlight",
        applicableTags: ["三居室"],
        highlightTags: ["采光"],
        storyPositioning: "围绕自然光组织生活",
        voiceover: "匹配案例正文",
        addedAt: "2026-01-02"
      },
      {
        caseId: "other",
        title: "无关案例",
        style: "playful",
        applicableTags: ["商铺"],
        highlightTags: ["临街"],
        voiceover: "不应注入",
        addedAt: "2026-01-01"
      }
    ]
  });
  assert.match(loaded.promptReference, /匹配案例正文/);
  assert.doesNotMatch(loaded.promptReference, /不应注入/);
  assert.deepEqual(loaded.trace.matchedCases, [{ caseId: "matched", title: "三居采光案例" }]);
  fs.rmSync(root, { recursive: true, force: true });
});
