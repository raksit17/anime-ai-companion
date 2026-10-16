import assert from "node:assert/strict";
import test from "node:test";
import { buildAnimationPlan, parseDialogue } from "../src/animation/dialogue-parser";

test("one response becomes ordered speech/action/speech", () => {
  const plan = buildAnimationPlan("m1", "yuna", "พูดได้ค่ะ *ยิ้มบางๆ* แต่ยังเขินนะคะ", "neutral");
  assert.equal(plan.version, 1);
  assert.deepEqual(plan.segments.map(s => s.type), ["speech", "action", "speech"]);
  assert.equal(plan.segments[1]?.type === "action" && plan.segments[1].motion, null);
  assert.equal(plan.segments[2]?.type === "speech" && plan.segments[2].emotion, "happy");
});
test("unclosed action markers remain text", () => {
  const segments = parseDialogue("พูดได้ค่ะ *ยิ้มบาง");
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.type === "speech" && segments[0].text, "พูดได้ค่ะ *ยิ้มบาง");
});
test("plain chat is one speech segment", () => {
  assert.deepEqual(parseDialogue("สวัสดีค่ะ").map(s => s.type), ["speech"]);
});
