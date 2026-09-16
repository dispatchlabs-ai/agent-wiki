// Optional text windows use Unicode code points; omitted options preserve full text.
export function textWindowOptions(params) {
  const has = (key) => params.has(key);
  if (!has("textOffset") && !has("textLimit")) return {};
  const textOffset = has("textOffset") ? Number(params.get("textOffset")) : 0;
  const textLimit = has("textLimit")
    ? Number(params.get("textLimit"))
    : undefined;
  if (
    !Number.isSafeInteger(textOffset) ||
    textOffset < 0 ||
    (textLimit !== undefined &&
      (!Number.isSafeInteger(textLimit) || textLimit < 0))
  )
    throw Error("Invalid text window");
  return { textOffset, textLimit };
}
export function textWindow(message, options) {
  if (options.textOffset === undefined && options.textLimit === undefined)
    return message;
  const text = message.text || "";
  const offset = options.textOffset ?? 0;
  const limit = options.textLimit;
  let total = 0,
    position = 0,
    start = text.length,
    end = text.length;
  for (const character of text) {
    if (total === offset) start = position;
    if (limit !== undefined && total - offset === limit) end = position;
    total++;
    position += character.length;
  }
  const returned = Math.max(0, Math.min(total - offset, limit ?? total));
  const { details, ...metadata } = message;
  return {
    ...metadata,
    ...(details !== undefined ? { omittedFields: ["details"] } : {}),
    text: text.slice(start, end),
    textWindow: {
      offset,
      returnedChars: returned,
      totalChars: total,
      nextTextOffset: offset + returned < total ? offset + returned : null,
      unit: "unicode-code-points",
    },
  };
}
