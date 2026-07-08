export class ModelJsonParseError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ModelJsonParseError";
    this.cause = details.cause;
    this.rawSnippet = details.rawSnippet || "";
    this.extractedSnippet = details.extractedSnippet || "";
  }
}

export function snippet(value, maxLength = 800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function extractFencedJson(text) {
  const fenced = String(text || "").match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : null;
}

export function extractJsonObjectText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  const fenced = extractFencedJson(trimmed);
  const source = fenced || trimmed;
  const start = source.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
}

export function parseModelJsonObject(text, label = "model") {
  const extracted = extractJsonObjectText(text);
  if (!extracted) {
    throw new ModelJsonParseError(`${label} did not return a JSON object`, {
      rawSnippet: snippet(text)
    });
  }

  try {
    return JSON.parse(extracted);
  } catch (error) {
    throw new ModelJsonParseError(`${label} returned invalid JSON`, {
      cause: error,
      rawSnippet: snippet(text),
      extractedSnippet: snippet(extracted)
    });
  }
}
