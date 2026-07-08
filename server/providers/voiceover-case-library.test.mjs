import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VoiceoverCaseLibrary } from "./voiceover-case-library.mjs";

test("approved scripts persist once with normalized metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "voiceover-cases-"));
  const library = new VoiceoverCaseLibrary({ filePath: path.join(root, "library.json") });
  const script = {
    id: "script-1",
    result: {
      style: "local_highlight",
      styleLabel: "局部亮点型",
      duration: 60,
      storyPositioning: "采光生活",
      voiceover: "完整口播",
      scenes: []
    }
  };
  const saved = library.add({
    recordId: "record-1",
    script,
    metadata: {
      title: "采光案例",
      applicableTags: "三居室，改善家庭",
      highlightTags: "采光,收纳",
      layoutType: "三居室"
    }
  });
  assert.equal(saved.sourceScriptId, "script-1");
  assert.deepEqual(saved.highlightTags, ["采光", "收纳"]);
  assert.equal(library.load().length, 1);
  assert.throws(() => library.add({
    recordId: "record-1",
    script,
    metadata: { title: "重复", applicableTags: "三居室", highlightTags: "采光" }
  }), /已经加入/);
  fs.rmSync(root, { recursive: true, force: true });
});
