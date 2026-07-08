export function buildObjectiveDescriptionMessages(propertyFacts, recognized) {
  return [
    {
      role: "system",
      content:
        "你是房源客观描述节点。只能复述输入中的房源事实与户型识别结果；不得加入卖点、适合人群、营销判断或任何未提供的信息。待确认项不得推断。输出 JSON。"
    },
    {
      role: "user",
      content: `房源字段：\n${JSON.stringify(propertyFacts, null, 2)}\n\n户型识别：\n${JSON.stringify(recognized, null, 2)}\n\n输出 {"description":"一段层次清楚、克制的中文客观描述"}。`
    }
  ];
}

export function buildEnrichedDescriptionMessages(
  objectiveDescription,
  manualHighlights
) {
  return [
    {
      role: "system",
      content:
        "你是房源信息补充描述节点。在给定客观描述的基础上加入人工补充信息，可以克制说明直接生活价值，但不得夸大、承诺或把人工信息说成识图结论。输出 JSON。"
    },
    {
      role: "user",
      content: `客观描述：\n${objectiveDescription}\n\n人工补充信息：\n${manualHighlights.map((item) => `- ${item}`).join("\n")}\n\n输出 {"description":"加入人工补充信息后的中文描述，并明确这是人工补充信息"}。`
    }
  ];
}
