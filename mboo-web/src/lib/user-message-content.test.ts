import assert from "node:assert/strict";
import test from "node:test";

import { parseUserMessageContent } from "./user-message-content";

test("extracts a serialized Skill tag while preserving the following message", () => {
  assert.deepEqual(
    parseUserMessageContent("<skill>deep-design-with-docs</skill>准备开发一个子 agent 工具"),
    [
      { type: "skill", name: "deep-design-with-docs" },
      { type: "text", text: "准备开发一个子 agent 工具" },
    ],
  );
});

test("keeps multiple Skill tags and text in their original order", () => {
  assert.deepEqual(
    parseUserMessageContent("前文 <skill>frontend-design</skill> 中段 <skill>impeccable</skill> 后文"),
    [
      { type: "text", text: "前文 " },
      { type: "skill", name: "frontend-design" },
      { type: "text", text: " 中段 " },
      { type: "skill", name: "impeccable" },
      { type: "text", text: " 后文" },
    ],
  );
});

test("preserves malformed or unrelated tags as ordinary text", () => {
  const content = "<skill>Invalid_Name</skill> 与 <code>demo</code>";
  assert.deepEqual(parseUserMessageContent(content), [{ type: "text", text: content }]);
});
