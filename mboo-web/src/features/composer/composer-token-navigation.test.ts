import assert from "node:assert/strict";
import test from "node:test";

import { getNextSkillSuggestionIndex } from "./composer-token-navigation";

test("wraps keyboard navigation at both ends of the Skill suggestion list", () => {
  assert.equal(getNextSkillSuggestionIndex(2, 3, "down"), 0);
  assert.equal(getNextSkillSuggestionIndex(0, 3, "up"), 2);
});

test("keeps the active index stable when the suggestion list is empty", () => {
  assert.equal(getNextSkillSuggestionIndex(0, 0, "down"), 0);
});
