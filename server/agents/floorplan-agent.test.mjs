import assert from "node:assert/strict";
import test from "node:test";
import {
  createFloorplanAgentGraph,
  resumeFloorplanAgent,
  runFloorplanAgent
} from "./floorplan-agent.mjs";

function createTestGraph(recognizeFloorplan) {
  return createFloorplanAgentGraph({
    recognizeFloorplan,
    analyzeFeatures: async (recognized) => recognized.features,
    generateHighlights: async () => ({
      pros: [],
      cons: [],
      suitableFor: [],
      evidence: []
    })
  });
}

test("valid recognition follows recognize -> validate -> END", async () => {
  const calls = [];
  const expected = {
    layoutType: "3室2厅1卫",
    area: "89㎡",
    orientation: "南向",
    rooms: [
      {
        id: "primary_bedroom",
        type: "primary_bedroom",
        name: "主卧",
        position: "南侧",
        connectedTo: ["corridor"],
        hasWindow: true,
        light: "good"
      },
      {
        id: "bedroom_a",
        type: "bedroom",
        name: "次卧A",
        position: "北侧",
        connectedTo: ["corridor"],
        hasWindow: true,
        light: "medium"
      },
      {
        id: "bedroom_b",
        type: "bedroom",
        name: "次卧B",
        position: "东侧",
        connectedTo: ["corridor"],
        hasWindow: true,
        light: "medium"
      },
      {
        id: "corridor",
        type: "corridor",
        name: "走廊",
        position: "中部",
        connectedTo: ["primary_bedroom", "bedroom_a", "bedroom_b"],
        hasWindow: false,
        light: "weak"
      }
    ],
    features: {
      northSouthVentilation: "unknown",
      dynamicStaticZoning: "good",
      kitchenDiningFlow: "unknown",
      bathroomPressure: "unknown",
      lighting: "medium",
      storagePotential: "unknown"
    },
    unknowns: [],
    needsReview: []
  };

  const graph = createTestGraph(async (input) => {
      calls.push(input);
      return expected;
  });

  const result = await runFloorplanAgent(graph, {
    imageDataUrl: "data:image/png;base64,example",
    imageName: "case.png"
  });

  assert.deepEqual(calls, [
    {
      imageDataUrl: "data:image/png;base64,example",
      imageName: "case.png"
    }
  ]);
  assert.deepEqual(result.recognized, expected);
  assert.equal(result.recognitionValid, true);
  assert.deepEqual(result.validatedRecognition, {
    ...expected,
    pros: [],
    cons: [],
    suitableFor: []
  });
  assert.deepEqual(result.validationErrors, []);
  assert.deepEqual(result.executionPath, [
    "recognize",
    "validate_recognition",
    "analyze_features",
    "generate_highlights",
    "audit_result"
  ]);
});

test("user supplied area is passed to the recognition node", async () => {
  const calls = [];
  const graph = createTestGraph(async (input) => {
    calls.push(input);
    return {
      layoutType: "unknown",
      area: "89㎡",
      orientation: "南向",
      rooms: [{
        id: "living_room",
        type: "living_room",
        name: "客厅",
        position: "南侧",
        connectedTo: [],
        hasWindow: true,
        light: "good"
      }],
      features: {
        northSouthVentilation: "unknown",
        dynamicStaticZoning: "unknown",
        kitchenDiningFlow: "unknown",
        bathroomPressure: "unknown",
        lighting: "good",
        storagePotential: "unknown"
      },
      unknowns: [],
      needsReview: []
    };
  });

  await runFloorplanAgent(graph, {
    imageDataUrl: "data:image/png;base64,example",
    imageName: "case.png",
    suppliedArea: "89㎡"
  });

  assert.equal(calls[0].suppliedArea, "89㎡");
});

test("graph construction requires a recognition dependency", () => {
  assert.throws(
    () => createFloorplanAgentGraph({}),
    /recognizeFloorplan must be a function/
  );
});

test("validation node records semantic errors instead of trusting model JSON", async () => {
  const graph = createTestGraph(async () => ({
      layoutType: "1室1厅",
      area: "unknown",
      orientation: "unknown",
      rooms: [
        {
          id: "living",
          type: "living_room",
          name: "客厅",
          position: "中部",
          connectedTo: ["missing_room"],
          hasWindow: "unknown",
          light: "unknown"
        }
      ],
      features: {
        northSouthVentilation: "unknown",
        dynamicStaticZoning: "unknown",
        kitchenDiningFlow: "unknown",
        bathroomPressure: "unknown",
        lighting: "unknown",
        storagePotential: "unknown"
      },
      unknowns: [],
      needsReview: []
  }));

  const result = await runFloorplanAgent(graph, {
    imageDataUrl: "data:image/png;base64,invalid",
    imageName: "invalid.png"
  });

  assert.equal(result.recognitionValid, false);
  assert.equal(result.validatedRecognition, null);
  assert.equal(result.needsHumanReview, true);
  assert.equal(result.repairAttempts, 1);
  assert.ok(
    result.validationErrors.some((error) =>
      error.message.includes("房间列表识别出 0 个卧室")
    )
  );
  assert.ok(
    result.repairLog.some((message) =>
      message.includes("无效或重复连接")
    )
  );
  assert.deepEqual(result.executionPath, [
    "recognize",
    "validate_recognition",
    "repair_recognition",
    "validate_recognition",
    "prepare_recognition_review"
  ]);
  assert.equal(result.__interrupt__[0].value.stage, "recognition");
});

test("repair node removes a dangling connection and validation passes", async () => {
  const graph = createTestGraph(async () => ({
      layoutType: "1室1厅",
      area: "56㎡",
      orientation: "南向",
      rooms: [
        {
          id: "primary_bedroom",
          type: "primary_bedroom",
          name: "主卧",
          position: "南侧",
          connectedTo: ["corridor", "missing_room", "corridor"],
          hasWindow: true,
          light: "good"
        },
        {
          id: "corridor",
          type: "corridor",
          name: "走廊",
          position: "中部",
          connectedTo: ["primary_bedroom"],
          hasWindow: false,
          light: "weak"
        }
      ],
      features: {
        northSouthVentilation: "unknown",
        dynamicStaticZoning: "medium",
        kitchenDiningFlow: "unknown",
        bathroomPressure: "unknown",
        lighting: "medium",
        storagePotential: "unknown"
      },
      unknowns: [],
      needsReview: []
  }));

  const result = await runFloorplanAgent(graph, {
    imageDataUrl: "data:image/png;base64,repairable",
    imageName: "repairable.png"
  });

  assert.equal(result.recognitionValid, true);
  assert.equal(result.needsHumanReview, false);
  assert.equal(result.repairAttempts, 1);
  assert.deepEqual(
    result.validatedRecognition.rooms[0].connectedTo,
    ["corridor"]
  );
  assert.match(result.repairLog[0], /无效或重复连接/);
  assert.deepEqual(result.executionPath, [
    "recognize",
    "validate_recognition",
    "repair_recognition",
    "validate_recognition",
    "analyze_features",
    "generate_highlights",
    "audit_result"
  ]);
});

test("feature and highlight nodes enrich objective recognition", async () => {
  const graph = createFloorplanAgentGraph({
    recognizeFloorplan: async () => ({
      layoutType: "1室1厅1卫",
      area: "60㎡",
      orientation: "南向",
      rooms: [
        {
          id: "living",
          type: "living_room",
          name: "客厅",
          position: "南侧",
          connectedTo: ["balcony"],
          hasWindow: true,
          light: "good"
        },
        {
          id: "balcony",
          type: "balcony",
          name: "阳台",
          position: "南侧",
          connectedTo: ["living"],
          hasWindow: true,
          light: "good"
        },
        {
          id: "bedroom",
          type: "bedroom",
          name: "卧室",
          position: "北侧",
          connectedTo: [],
          hasWindow: true,
          light: "medium"
        }
      ],
      unknowns: [],
      needsReview: []
    }),
    analyzeFeatures: async () => ({
      northSouthVentilation: "unknown",
      dynamicStaticZoning: "medium",
      kitchenDiningFlow: "unknown",
      bathroomPressure: "unknown",
      lighting: "good",
      storagePotential: "unknown"
    }),
    generateHighlights: async () => ({
      pros: ["good_lighting", "living_balcony_connected"],
      cons: [],
      suitableFor: ["single_or_couple"],
      evidence: [
        { id: "good_lighting", evidence: "客厅有窗且采光标记为 good" },
        { id: "living_balcony_connected", evidence: "客厅直接连接阳台" },
        { id: "single_or_couple", evidence: "识别出一个卧室" }
      ]
    })
  });

  const result = await runFloorplanAgent(graph, {
    imageDataUrl: "data:image/png;base64,enrich",
    imageName: "enrich.png"
  });

  assert.deepEqual(result.validatedRecognition.pros, [
    "good_lighting",
    "living_balcony_connected"
  ]);
  assert.equal(result.highlights.evidence.length, 3);
  assert.equal(result.auditResult.passed, true);
});

test("audit sends an unsupported highlight to human review", async () => {
  const graph = createFloorplanAgentGraph({
    recognizeFloorplan: async () => ({
      layoutType: "1室1厅",
      area: "50㎡",
      orientation: "unknown",
      rooms: [
        {
          id: "bedroom",
          type: "bedroom",
          name: "卧室",
          position: "北侧",
          connectedTo: [],
          hasWindow: "unknown",
          light: "weak"
        }
      ],
      unknowns: [],
      needsReview: []
    }),
    analyzeFeatures: async () => ({
      northSouthVentilation: "unknown",
      dynamicStaticZoning: "unknown",
      kitchenDiningFlow: "unknown",
      bathroomPressure: "unknown",
      lighting: "weak",
      storagePotential: "unknown"
    }),
    generateHighlights: async () => ({
      pros: ["good_lighting"],
      cons: [],
      suitableFor: [],
      evidence: [
        { id: "good_lighting", evidence: "模型声称采光好" }
      ]
    })
  });

  const result = await runFloorplanAgent(graph, {
    imageDataUrl: "data:image/png;base64,audit",
    imageName: "audit.png"
  });

  assert.equal(result.auditResult.passed, false);
  assert.deepEqual(result.auditResult.unsupportedIds, ["good_lighting"]);
  assert.equal(result.needsHumanReview, true);
  assert.deepEqual(result.executionPath.slice(-2), [
    "audit_result",
    "prepare_highlight_review"
  ]);
  assert.equal(result.__interrupt__[0].value.stage, "highlights");

  const resumed = await resumeFloorplanAgent(graph, {
    threadId: result.threadId,
    resume: { action: "approve" }
  });
  assert.equal(resumed.needsHumanReview, false);
  assert.equal(resumed.humanApproved, true);
  assert.equal(
    resumed.executionPath.at(-1),
    "human_review_resumed"
  );

  const nonBlockingResult = await runFloorplanAgent(graph, {
    imageDataUrl: "data:image/png;base64,audit-non-blocking",
    imageName: "audit-non-blocking.png",
    skipHighlightReview: true
  });
  assert.equal(nonBlockingResult.auditResult.passed, false);
  assert.equal(nonBlockingResult.__interrupt__, undefined);
  assert.equal(nonBlockingResult.skipHighlightReview, true);
  assert.equal(nonBlockingResult.executionPath.at(-1), "audit_result");
});
