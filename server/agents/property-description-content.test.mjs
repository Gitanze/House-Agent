import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEnrichedDescriptionMessages,
  buildObjectiveDescriptionMessages
} from "./property-description-content.mjs";

test("objective description prompt cannot see manual highlights", () => {
  const secretHighlight = "独家人工亮点：可看江景";
  const messages = buildObjectiveDescriptionMessages(
    { city: "上海", buildingArea: "89㎡" },
    { layoutType: "3室2厅1卫", rooms: [] }
  );

  assert.doesNotMatch(JSON.stringify(messages), new RegExp(secretHighlight));
  assert.match(JSON.stringify(messages), /89㎡/);
});

test("enriched description prompt labels and includes manual information", () => {
  const messages = buildEnrichedDescriptionMessages(
    "该房源建筑面积89㎡。",
    ["可看江景"]
  );
  const serialized = JSON.stringify(messages);

  assert.match(serialized, /人工补充信息/);
  assert.match(serialized, /可看江景/);
  assert.match(serialized, /不得夸大/);
});
