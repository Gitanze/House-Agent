import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelJsonParseError,
  extractJsonObjectText,
  parseModelJsonObject
} from "./model-json.mjs";

test("extracts the first complete JSON object from fenced or mixed model output", () => {
  assert.equal(
    extractJsonObjectText("说明文字\n```json\n{\"ok\":true}\n```\n尾巴"),
    "{\"ok\":true}"
  );
  assert.deepEqual(
    parseModelJsonObject("前缀 {\"items\":[\"入户门位置\",\"是否存在独立餐厅\"]} 后缀"),
    { items: ["入户门位置", "是否存在独立餐厅"] }
  );
});

test("invalid model JSON keeps a safe raw snippet for logs", () => {
  assert.throws(
    () => parseModelJsonObject("{\"items\":[\"入户门位置\", 是否存在独立餐厅\"]}", "vision"),
    (error) => {
      assert.equal(error instanceof ModelJsonParseError, true);
      assert.match(error.rawSnippet, /入户门位置/);
      assert.match(error.rawSnippet, /是否存在独立餐厅/);
      return true;
    }
  );
});
