import fs from "node:fs";
import path from "node:path";

const DEFAULT_CASES = "benchmark/cases/sample-cases.json";
const DEFAULT_PREDICTIONS = "benchmark/predictions/sample-predictions.json";
const LABELS_PATH = "benchmark/taxonomy/canonical-labels.json";

const weights = {
  roomRecognition: 0.3,
  spatialRelations: 0.25,
  featureJudgment: 0.2,
  interpretation: 0.15,
  hallucination: 0.1,
};

const featureKeys = [
  "northSouthVentilation",
  "dynamicStaticZoning",
  "kitchenDiningFlow",
  "bathroomPressure",
  "lighting",
  "storagePotential",
];

const roomTypeAliases = new Map([
  ["bedroom1", "bedroom"],
  ["bedroom2", "bedroom"],
  ["secondary_bedroom", "bedroom"],
  ["guest_bedroom", "bedroom"],
  ["second_bedroom", "bedroom"],
  ["master_bedroom", "primary_bedroom"],
  ["master_room", "primary_bedroom"],
  ["foyer", "entrance"],
  ["entry", "entrance"],
  ["hallway", "corridor"],
  ["wc", "bathroom"],
  ["toilet", "bathroom"],
]);

function loadCanonicalLabels() {
  if (!fs.existsSync(LABELS_PATH)) return {};
  return readJson(LABELS_PATH);
}

const canonicalLabels = loadCanonicalLabels();

function normalizeLabelText(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

function canonicalLabelMap(section) {
  const map = new Map();
  for (const item of canonicalLabels[section] ?? []) {
    map.set(normalizeLabelText(item.id), item.id);
    map.set(normalizeLabelText(item.label), item.id);
    for (const alias of item.aliases ?? []) {
      map.set(normalizeLabelText(alias), item.id);
    }
  }
  return map;
}

const labelMaps = {
  pros: canonicalLabelMap("pros"),
  cons: canonicalLabelMap("cons"),
  suitableFor: canonicalLabelMap("suitableFor"),
};

function readJson(filePath) {
  const absolutePath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function normalizeValue(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return roomTypeAliases.get(normalized) ?? normalized;
}

function countByType(rooms = []) {
  const counts = new Map();
  for (const room of rooms) {
    const type = normalizeValue(room.type);
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

function scoreCounts(expectedRooms = [], predictedRooms = []) {
  const expected = countByType(expectedRooms);
  const predicted = countByType(predictedRooms);
  let truePositive = 0;
  let expectedTotal = 0;
  let predictedTotal = 0;

  for (const count of expected.values()) expectedTotal += count;
  for (const count of predicted.values()) predictedTotal += count;

  for (const [type, count] of expected.entries()) {
    truePositive += Math.min(count, predicted.get(type) ?? 0);
  }

  return f1(truePositive, predictedTotal, expectedTotal);
}

function getRoomLookup(rooms = []) {
  const byId = new Map();
  for (const room of rooms) {
    if (room.id) byId.set(room.id, room);
  }
  return byId;
}

function roomTypeFor(roomId, lookup) {
  return normalizeValue(lookup.get(roomId)?.type || roomId);
}

function relationKey(a, b, lookup) {
  const left = roomTypeFor(a, lookup);
  const right = roomTypeFor(b, lookup);
  return [left, right].sort().join("--");
}

function relationSet(rooms = []) {
  const lookup = getRoomLookup(rooms);
  const edges = new Set();
  for (const room of rooms) {
    const from = room.id;
    if (!from || !Array.isArray(room.connectedTo)) continue;
    for (const to of room.connectedTo) {
      const edge = relationKey(from, to, lookup);
      if (!edge.includes("undefined") && !edge.startsWith("--")) {
        edges.add(edge);
      }
    }
  }
  return edges;
}

function scoreSet(expectedSet, predictedSet) {
  let truePositive = 0;
  for (const item of predictedSet) {
    if (expectedSet.has(item)) truePositive += 1;
  }
  return f1(truePositive, predictedSet.size, expectedSet.size);
}

function scoreFeatures(expected = {}, predicted = {}) {
  let scored = 0;
  let correct = 0;

  for (const key of featureKeys) {
    if (!(key in expected)) continue;
    scored += 1;
    if (normalizeValue(expected[key]) === normalizeValue(predicted[key])) {
      correct += 1;
    }
  }

  return scored === 0 ? 1 : correct / scored;
}

function normalizeTag(section, item) {
  const raw = String(item ?? "").trim();
  if (!raw) return "";
  const key = normalizeLabelText(raw);
  return labelMaps[section]?.get(key) ?? normalizeValue(raw);
}

function asTagSet(section, items = []) {
  return new Set(items.map((item) => normalizeTag(section, item)).filter(Boolean));
}

function scoreTags(section, expected = [], predicted = []) {
  return scoreSet(asTagSet(section, expected), asTagSet(section, predicted));
}

function scoreInterpretation(expected, predicted) {
  const pros = scoreTags("pros", expected.pros, predicted.pros);
  const cons = scoreTags("cons", expected.cons, predicted.cons);
  const suitableFor = scoreTags("suitableFor", expected.suitableFor, predicted.suitableFor);
  return (pros + cons + suitableFor) / 3;
}

function f1(truePositive, predictedTotal, expectedTotal) {
  if (expectedTotal === 0 && predictedTotal === 0) return 1;
  if (truePositive === 0) return 0;
  const precision = truePositive / Math.max(predictedTotal, 1);
  const recall = truePositive / Math.max(expectedTotal, 1);
  return (2 * precision * recall) / (precision + recall);
}

function difference(predictedSet, expectedSet) {
  return [...predictedSet].filter((item) => !expectedSet.has(item));
}

function isMarkedUncertain(prediction = {}) {
  return (
    (Array.isArray(prediction.unknowns) && prediction.unknowns.length > 0) ||
    (Array.isArray(prediction.needsReview) && prediction.needsReview.length > 0)
  );
}

function hallucinationScore(expected, predicted) {
  const expectedTypes = countByType(expected.rooms);
  const predictedTypes = countByType(predicted.rooms);
  const extraRooms = [];

  for (const [type, predictedCount] of predictedTypes.entries()) {
    const extraCount = predictedCount - (expectedTypes.get(type) ?? 0);
    for (let i = 0; i < extraCount; i += 1) extraRooms.push(type);
  }

  const extraRelations = difference(relationSet(predicted.rooms), relationSet(expected.rooms));
  const featureErrors = featureKeys.filter(
    (key) =>
      key in expected.features &&
      key in (predicted.features ?? {}) &&
      normalizeValue(expected.features[key]) !== normalizeValue(predicted.features[key]),
  );

  const uncertaintyCredit = isMarkedUncertain(predicted) ? 0.5 : 0;
  const rawPenalty = extraRooms.length * 0.12 + extraRelations.length * 0.06 + featureErrors.length * 0.04;
  const penalty = Math.max(0, rawPenalty - uncertaintyCredit * Math.min(rawPenalty, 0.12));

  return {
    score: Math.max(0, 1 - penalty),
    extraRooms,
    extraRelations,
    featureErrors,
  };
}

function weightedScore(scores) {
  return (
    scores.roomRecognition * weights.roomRecognition +
    scores.spatialRelations * weights.spatialRelations +
    scores.featureJudgment * weights.featureJudgment +
    scores.interpretation * weights.interpretation +
    scores.hallucination * weights.hallucination
  );
}

function pct(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function scoreCase(expected, predicted) {
  if (!predicted) {
    return {
      id: expected.id,
      title: expected.title,
      missingPrediction: true,
      scores: {
        roomRecognition: 0,
        spatialRelations: 0,
        featureJudgment: 0,
        interpretation: 0,
        hallucination: 0,
        overall: 0,
      },
      diagnostics: ["缺少该 case 的 prediction 输出。"],
    };
  }

  const hallucination = hallucinationScore(expected, predicted);
  const scores = {
    roomRecognition: scoreCounts(expected.rooms, predicted.rooms),
    spatialRelations: scoreSet(relationSet(expected.rooms), relationSet(predicted.rooms)),
    featureJudgment: scoreFeatures(expected.features, predicted.features ?? {}),
    interpretation: scoreInterpretation(expected, predicted),
    hallucination: hallucination.score,
  };
  scores.overall = weightedScore(scores);

  const diagnostics = [];
  if (hallucination.extraRooms.length) diagnostics.push(`疑似多识别房间: ${hallucination.extraRooms.join(", ")}`);
  if (hallucination.extraRelations.length) diagnostics.push(`疑似编造连接: ${hallucination.extraRelations.join(", ")}`);
  if (hallucination.featureErrors.length) diagnostics.push(`专业判断不一致: ${hallucination.featureErrors.join(", ")}`);

  return {
    id: expected.id,
    title: expected.title,
    scores,
    diagnostics,
  };
}

function average(results, key) {
  if (results.length === 0) return 0;
  return results.reduce((sum, result) => sum + result.scores[key], 0) / results.length;
}

function run() {
  const [casesPath = DEFAULT_CASES, predictionsPath = DEFAULT_PREDICTIONS] = process.argv.slice(2);
  const cases = readJson(casesPath);
  const predictions = readJson(predictionsPath);
  const predictionById = new Map(predictions.map((item) => [item.id, item]));

  const results = cases.map((testCase) => scoreCase(testCase, predictionById.get(testCase.id)));
  const summary = {
    cases: results.length,
    overall: average(results, "overall"),
    roomRecognition: average(results, "roomRecognition"),
    spatialRelations: average(results, "spatialRelations"),
    featureJudgment: average(results, "featureJudgment"),
    interpretation: average(results, "interpretation"),
    hallucination: average(results, "hallucination"),
  };

  console.log("Floorplan Benchmark v0");
  console.log(`Cases: ${summary.cases}`);
  console.log(`Overall: ${pct(summary.overall)}`);
  console.log(
    `Breakdown: rooms ${pct(summary.roomRecognition)} | relations ${pct(summary.spatialRelations)} | features ${pct(summary.featureJudgment)} | interpretation ${pct(summary.interpretation)} | anti-hallucination ${pct(summary.hallucination)}`,
  );
  console.log("");

  for (const result of results) {
    console.log(`${result.id} ${result.title}: ${pct(result.scores.overall)}`);
    console.log(
      `  rooms ${pct(result.scores.roomRecognition)}, relations ${pct(result.scores.spatialRelations)}, features ${pct(result.scores.featureJudgment)}, interpretation ${pct(result.scores.interpretation)}, anti-hallucination ${pct(result.scores.hallucination)}`,
    );
    if (result.diagnostics.length) {
      for (const item of result.diagnostics) console.log(`  - ${item}`);
    }
  }

  const output = {
    summary,
    results,
  };
  fs.mkdirSync("benchmark/results", { recursive: true });
  fs.writeFileSync("benchmark/results/latest.json", JSON.stringify(output, null, 2), "utf8");
  console.log("");
  console.log("Wrote benchmark/results/latest.json");
}

run();
