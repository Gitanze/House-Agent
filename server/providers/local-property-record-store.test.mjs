import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalPropertyRecordStore } from "./local-property-record-store.mjs";

test("property records persist editable analyses and multiple named scripts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "property-records-"));
  const store = new LocalPropertyRecordStore({ directory });
  const record = store.create({
    image: { name: "plan.png", dataUrl: "data:image/png;base64,AA==" },
    propertyFacts: { community: "测试小区" },
    analysis: { recognized: { area: "89㎡", layoutType: "3室2厅", rooms: [{ id: "living" }] } }
  });
  assert.equal(store.list()[0].scriptCount, 0);
  store.update(record.id, { title: "可编辑档案" });
  const first = store.addScript(record.id, { styleLabel: "局部亮点型", duration: 60 });
  const second = store.addScript(record.id, { styleLabel: "装修省心型", duration: 90 });
  assert.equal(first.name, "方案1-局部亮点型-60秒");
  assert.equal(second.name, "方案2-装修省心型-90秒");
  store.updateScript(record.id, first.id, { name: "客厅版本" });
  assert.equal(store.read(record.id).scripts[0].name, "客厅版本");
  const refinement = store.addScript(record.id, {
    styleLabel: "局部亮点型",
    duration: 60
  }, {
    derivedFromScriptId: first.id,
    refinementInstruction: "加强家庭生活画面"
  });
  assert.equal(refinement.derivedFromScriptId, first.id);
  assert.equal(refinement.generationType, "refinement");
  assert.match(refinement.name, /润色1/);
  assert.equal(store.deleteScript(record.id, second.id), true);
  const room = store.setRoomVisual(record.id, "living", {
    analysis: { objectiveDescription: "客厅可见沙发和采光窗" }
  });
  assert.match(room.roomVisual.analysis.objectiveDescription, /采光窗/);
  assert.equal(store.deleteRoomVisual(record.id, "living"), true);
  assert.equal(store.delete(record.id), true);
  assert.equal(store.list().length, 0);
  fs.rmSync(directory, { recursive: true, force: true });
});
