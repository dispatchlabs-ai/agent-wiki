import test from "node:test";
import assert from "node:assert/strict";
import { textWindow, textWindowOptions } from "../src/text-window.mjs";
test("optional windows reassemble exact Unicode text and leave full reads untouched", () => {
  const source = {
    id: "event",
    text: "A😀e\u0301\n漢字".repeat(1000),
    snapshot: "original",
    line: 12,
  };
  assert.equal(textWindow(source, {}), source);
  let offset = 0,
    result = "";
  while (offset !== null) {
    const part = textWindow(source, { textOffset: offset, textLimit: 17 });
    result += part.text;
    offset = part.textWindow.nextTextOffset;
    assert.equal(part.snapshot, source.snapshot);
  }
  assert.equal(result, source.text);
  const measure = textWindow(source, { textLimit: 0 });
  assert.equal(measure.text, "");
  assert.equal(measure.textWindow.totalChars, 7000);
  assert.equal(measure.textWindow.nextTextOffset, 0);
  assert.equal(
    textWindow(source, { textOffset: 2 }).text,
    Array.from(source.text).slice(2).join(""),
  );
  assert.deepEqual(
    textWindow(source, { textOffset: 8000, textLimit: 10 }).textWindow,
    {
      offset: 8000,
      returnedChars: 0,
      totalChars: 7000,
      nextTextOffset: null,
      unit: "unicode-code-points",
    },
  );
  assert.equal(
    textWindow({ text: "" }, { textLimit: 1 }).textWindow.nextTextOffset,
    null,
  );
  for (const q of [
    "textOffset=-1",
    "textLimit=-1",
    "textLimit=1.5",
    "textOffset=NaN",
    "textOffset=9007199254740992",
  ])
    assert.throws(() => textWindowOptions(new URLSearchParams(q)), /Invalid/);
});

test("optional chunks do not repeat large body copies in supplemental details", () => {
  const source = {
    text: "Original output",
    details: { alternate_recorded_text: "Original output".repeat(1000) },
    line: 4,
  };
  const chunk = textWindow(source, { textLimit: 3 });
  assert.equal(chunk.text, "Ori");
  assert.equal(chunk.details, undefined);
  assert.deepEqual(chunk.omittedFields, ["details"]);
  assert.equal(chunk.line, 4);
  assert.equal(textWindow(source, {}).details, source.details);
});
