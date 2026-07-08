import assert from "node:assert/strict";
import test from "node:test";
import {
  auditVoiceoverLayout,
  auditNarrativeVoice,
  buildPropertyUnderstanding,
  buildShotlistContext,
  buildShotlistMessages,
  buildVoiceoverMessages,
  resolveScriptFacts,
  generatePropertyScript
} from "./property-script-agent.mjs";

const input = {
  duration: 60,
  style: "buyer_dilemma",
  property: { community: "示例小区" },
  floorplanAnalysis: {
    layoutType: "2室1厅",
    area: "68㎡",
    rooms: [
      { id: "living", type: "living_room", name: "客厅", connectedTo: ["bedroom"] },
      { id: "bedroom", type: "bedroom", name: "卧室", connectedTo: ["living"] }
    ],
    unknowns: ["卫生间窗户待确认"],
    needsReview: []
  },
  manualHighlights: ["装修保持较好"],
  factConfirmations: [{
    question: "卫生间窗户待确认",
    answer: "现场确认卫生间有外窗",
    source: "human_review"
  }]
};

test("voiceover stage follows selected duration and style", () => {
  const messages = JSON.stringify(buildVoiceoverMessages(input));
  assert.match(messages, /看房人纠结型/);
  assert.match(messages, /280—380/);
  assert.match(messages, /装修保持较好/);
  assert.match(messages, /现场确认卫生间有外窗/);
  assert.match(messages, /人工复核/);
  assert.match(messages, /只写可确认的正向信息/);
  assert.match(messages, /禁止使用/);
  assert.match(messages, /这里还要重点说一句/);
});

test("matrix owner voice rejects viewer perspective drift", () => {
  const matrixInput = {
    ...input,
    scriptVariant: "matrix",
    targetAudience: "三口之家",
    narrativeVoice: "owner",
    contentFocus: "renovation"
  };
  const messages = JSON.stringify(buildVoiceoverMessages(matrixInput));
  assert.match(messages, /业主口吻/);
  assert.match(messages, /禁止写成看房人/);
  const audit = auditNarrativeVoice(
    matrixInput,
    "这套房我原本只是随便看看。\n看了很多套以后，\n它让我停下来。"
  );
  assert.equal(audit.valid, false);
  assert.match(audit.reason, /看房人口吻/);
});

test("property understanding organizes objective, relationships, reviews and room photos", () => {
  const enrichedInput = structuredClone(input);
  enrichedInput.objectiveDescription = "这是基础房源客观描述";
  enrichedInput.floorplanAnalysis.rooms[0].roomVisual = {
    analysis: {
      objectiveDescription: "客厅实景可见沙发与窗户",
      scriptFacts: ["客厅设有沙发区"]
    }
  };
  const understanding = buildPropertyUnderstanding(enrichedInput);
  assert.equal(understanding.baseObjectiveDescription, "这是基础房源客观描述");
  assert.deepEqual(understanding.layoutUnderstanding.roomRelationships[0].connectedTo, ["卧室"]);
  assert.equal(understanding.humanReviewedFacts[0].source, "人工复核");
  assert.deepEqual(understanding.roomReality[0].roomStoryDetails.usableDetails, ["客厅设有沙发区"]);
  assert.equal(understanding.roomReality[0].photoRecognizedFacts, undefined);
});

test("human-reviewed layout overrides declared and recognized layouts", () => {
  const conflictingInput = structuredClone(input);
  conflictingInput.enrichedDescription = "加入人工补充后的完整房源描述";
  conflictingInput.property.declaredLayout = "3室2厅1卫";
  conflictingInput.floorplanAnalysis.layoutType = "2室1厅";
  conflictingInput.factConfirmations.push({
    question: "户型厅室数量待确认",
    answer: "现场确认为4室2厅2卫",
    source: "human_review"
  });
  const facts = resolveScriptFacts(conflictingInput);
  assert.equal(facts.authoritativeLayout, "4室2厅2卫");
  assert.equal(facts.layoutStatus, "confirmed");
  assert.equal(facts.enrichedPropertyDescription, "加入人工补充后的完整房源描述");
  const messages = JSON.stringify(buildVoiceoverMessages(conflictingInput));
  assert.match(messages, /加入人工补充后的完整房源描述/);
  assert.match(messages, /4室2厅2卫/);
});

test("layout audit rejects recognized guesses and accepts only human-confirmed layout", () => {
  const unconfirmed = structuredClone(input);
  assert.equal(auditVoiceoverLayout(unconfirmed, "这是一套2室1厅的房子").valid, false);
  assert.equal(auditVoiceoverLayout(unconfirmed, "这里有客厅和两个休息空间").valid, true);

  const confirmed = structuredClone(input);
  confirmed.property.declaredLayout = "3室2厅1卫";
  assert.equal(auditVoiceoverLayout(confirmed, "这套三室两厅适合一家人").valid, true);
  assert.equal(auditVoiceoverLayout(confirmed, "这套2室1厅适合一家人").valid, false);
});

test("shotlist stage receives recognized floorplan and generated voiceover", () => {
  const messages = JSON.stringify(buildShotlistMessages(input, "测试旁白"));
  assert.match(messages, /客厅/);
  assert.match(messages, /测试旁白/);
  assert.match(messages, /60秒/);
});

test("shotlist context removes uploaded image data but keeps recognized facts", () => {
  const enrichedInput = structuredClone(input);
  enrichedInput.floorplanAnalysis.rooms[0].roomVisual = {
    image: {
      dataUrl: `data:image/jpeg;base64,${"A".repeat(10000)}`,
      name: "living.jpg"
    },
    analysis: {
      objectiveDescription: "客厅有落地窗",
      scriptFacts: ["落地窗带来自然采光"]
    }
  };
  const context = buildShotlistContext(enrichedInput);
  const messages = JSON.stringify(buildShotlistMessages(enrichedInput, "测试口播"));
  assert.equal(messages.includes("data:image/jpeg"), false);
  assert.equal(messages.includes("A".repeat(100)), false);
  assert.match(messages, /落地窗带来自然采光/);
  assert.deepEqual(context.rooms[0].roomCameraDetails.focusHints, ["落地窗带来自然采光"]);
  assert.equal(context.rooms[0].photoRecognizedFacts, undefined);
});

test("fallback script contains voiceover and exactly one executable shot per room", async () => {
  const result = await generatePropertyScript(null, input);
  assert.equal(result.schemaVersion, "property-video-script/v1");
  assert.equal(result.generationTrace.selectedStyleSection, "4. 看房人纠结型");
  assert.equal(result.generationTrace.manualHighlights[0].included, true);
  assert.match(result.voiceover, /68㎡/);
  assert.equal(result.scenes.length, 2);
  assert.deepEqual(result.scenes.map((scene) => scene.space), ["客厅", "卧室"]);
  assert.equal(result.scenes.every((scene) => scene.shot.cameraMove), true);
  assert.equal(result.scenes.every((scene) => !("syncNarration" in scene) && !("shots" in scene)), true);
  assert.equal(result.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0), 60);
  assert.match(result.voiceover, /装修保持较好/);
  assert.match(result.scenes[0].storyVoiceover, /这套房/);
});

test("refinement prompts preserve source content and user direction", () => {
  const refinedInput = {
    ...input,
    refinementInstruction: "加强家庭生活画面，减少销售感",
    baseScript: {
      storyPositioning: "原始定位",
      voiceover: "原始口播内容",
      scenes: [{ roomId: "living", storyVoiceover: "原口播分段", shot: { framing: "全景", cameraMove: "原运镜", focus: "空间", note: "" } }]
    }
  };
  assert.match(JSON.stringify(buildVoiceoverMessages(refinedInput)), /加强家庭生活画面/);
  assert.match(JSON.stringify(buildVoiceoverMessages(refinedInput)), /原始口播内容/);
  assert.match(JSON.stringify(buildShotlistMessages(refinedInput, "新口播")), /原运镜/);
  assert.doesNotMatch(JSON.stringify(buildShotlistMessages(refinedInput, "新口播")), /同步旁白/);
});

test("refinement requiring DeepSeek never silently falls back", async () => {
  await assert.rejects(
    generatePropertyScript({
      available: true,
      async generate() {
        throw new Error("DeepSeek unavailable");
      }
    }, {
      ...input,
      requireModel: true,
      refinementInstruction: "加强节奏",
      baseScript: { storyPositioning: "原定位", voiceover: "原口播", scenes: [] }
    }),
    /DeepSeek unavailable/
  );
});

test("wrong AI layout is corrected before the script can be saved", async () => {
  let call = 0;
  const correctedInput = structuredClone(input);
  correctedInput.property.declaredLayout = "3室2厅";
  correctedInput.manualHighlights = [];
  const result = await generatePropertyScript({
    available: true,
    async generate() {
      call += 1;
      if (call === 1) {
        return {
          storyPositioning: "家庭生活",
          voiceover: "这是一套2室1厅的房子，公共空间和休息区域衔接得很顺手。",
          highlightCoverage: [],
          pendingConfirmations: []
        };
      }
      if (call === 2) {
        return {
          storyPositioning: "家庭生活",
          voiceover: "这套3室2厅，把公共活动和安静休息自然分开。",
          highlightCoverage: [],
          pendingConfirmations: []
        };
      }
      return {
        scenes: correctedInput.floorplanAnalysis.rooms.map((room) => ({
          roomId: room.id,
          space: room.name,
          shot: {
            framing: "全景",
            cameraMove: `从${room.name}入口前推`,
            focus: "空间关系",
            note: ""
          }
        })),
        onSiteConfirmations: []
      };
    }
  }, correctedInput);
  assert.equal(call, 3);
  assert.match(result.voiceover, /3室2厅/);
  assert.doesNotMatch(result.voiceover, /2室1厅/);
});

test("missing AI rooms are repaired and story length controls duration", async () => {
  let call = 0;
  const result = await generatePropertyScript({
    available: true,
    async generate() {
      call += 1;
      if (call === 1) {
        return {
          storyPositioning: "正向空间体验",
          voiceover: "客厅先承接回家的第一幕。\n沙发旁留出家人聊天的位置。\n窗边自然光进入公共空间。\n卧室回到安静的休息节奏。",
          highlightCoverage: input.manualHighlights,
          pendingConfirmations: []
        };
      }
      return {
        scenes: [{
          roomId: "living",
          space: "客厅",
          shot: {
            framing: "全景",
            cameraMove: "从入口稳定前推，呈现客厅全貌",
            focus: "公共空间",
            note: ""
          }
        }],
        onSiteConfirmations: []
      };
    }
  }, input);

  assert.deepEqual(result.scenes.map((scene) => scene.roomId), ["living", "bedroom"]);
  assert.equal(result.scenes[0].shot.cameraMove, "从入口稳定前推，呈现客厅全貌");
  assert.equal(result.scenes[0].durationSeconds > result.scenes[1].durationSeconds, true);
  assert.equal(result.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0), 60);
});
