import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DEEPSEEK_API_KEY = "test-key";

function createDeepseekResponse(content) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }]
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

const validRecognitionJson = JSON.stringify({
  layoutType: "2室1厅",
  area: "89㎡",
  orientation: "南向",
  rooms: [
    {
      id: "entrance",
      type: "entrance",
      name: "入户",
      position: "西侧",
      connectedTo: ["living_room"],
      hasWindow: "unknown",
      light: "unknown"
    },
    {
      id: "living_room",
      type: "living_room",
      name: "客厅",
      position: "中部",
      connectedTo: ["entrance"],
      hasWindow: true,
      light: "good"
    }
  ],
  unknowns: ["入户门位置"],
  needsReview: ["是否存在独立餐厅"]
});

test("floorplan recognition JSON parse calls DeepSeek repair for malformed arrays", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.match(payload.messages[1].content, /是否存在独立餐厅/);
    return createDeepseekResponse(validRecognitionJson);
  };

  try {
    const { parseFloorplanRecognitionJson } = await import("./index.mjs");
    const repaired = await parseFloorplanRecognitionJson(
      `{"layoutType":"2室1厅","area":"89㎡","orientation":"南向","rooms":[],"unknowns":["入户门位置"],"needsReview":["入户门位置", 是否存在独立餐厅"]}`
    );
    assert.equal(repaired.layoutType, "2室1厅");
    assert.deepEqual(repaired.needsReview, ["是否存在独立餐厅"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("floorplan brief falls back when DeepSeek returns invalid JSON", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => createDeepseekResponse("{\"talk30s\": [}");

  try {
    const { generateBrief } = await import("./index.mjs");
    const result = await generateBrief({
      recognized: JSON.parse(validRecognitionJson),
      familyType: "年轻家庭",
      focusTags: ["采光"],
      manualHighlights: []
    });
    assert.equal(result.provider, "fallback");
    assert.equal(typeof result.brief.talk30s, "string");
    assert.ok(result.brief.talk30s.length > 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
