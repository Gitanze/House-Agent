import { randomUUID } from "node:crypto";
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt
} from "@langchain/langgraph";
import {
  auditResultSchema,
  featureAnalysisSchema,
  highlightAnalysisSchema,
  validateFloorplanRecognition
} from "./floorplan-schema.mjs";

/**
 * The shared state carried through the floorplan analysis graph.
 *
 * Step 1 intentionally keeps the state small. Later steps will add validated
 * recognition, feature analysis, highlights, audit results and review status.
 */
export const FloorplanAgentState = Annotation.Root({
  imageDataUrl: Annotation(),
  imageName: Annotation(),
  suppliedArea: Annotation(),
  recognized: Annotation(),
  validatedRecognition: Annotation(),
  recognitionValid: Annotation(),
  validationErrors: Annotation(),
  features: Annotation(),
  highlights: Annotation(),
  auditResult: Annotation(),
  reviewStage: Annotation(),
  humanApproved: Annotation(),
  repairAttempts: Annotation(),
  skipHighlightReview: Annotation(),
  repairLog: Annotation({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  needsHumanReview: Annotation(),
  executionPath: Annotation({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  })
});

/**
 * Build the graph with the model call injected as a dependency.
 *
 * Dependency injection lets the graph be tested without making a real API
 * request and keeps provider-specific code outside the workflow definition.
 */
export function createFloorplanAgentGraph({
  recognizeFloorplan,
  analyzeFeatures,
  generateHighlights
}, options = {}) {
  if (typeof recognizeFloorplan !== "function") {
    throw new TypeError("recognizeFloorplan must be a function");
  }
  if (typeof analyzeFeatures !== "function") {
    throw new TypeError("analyzeFeatures must be a function");
  }
  if (typeof generateHighlights !== "function") {
    throw new TypeError("generateHighlights must be a function");
  }

  async function recognizeNode(state) {
    const recognitionInput = {
      imageDataUrl: state.imageDataUrl,
      imageName: state.imageName
    };
    if (state.suppliedArea) recognitionInput.suppliedArea = state.suppliedArea;
    const recognized = await recognizeFloorplan(recognitionInput);

    return {
      recognized,
      executionPath: ["recognize"]
    };
  }

  function validateRecognitionNode(state) {
    const validation = validateFloorplanRecognition(state.recognized);

    return {
      validatedRecognition: validation.data,
      recognitionValid: validation.success,
      validationErrors: validation.errors,
      executionPath: ["validate_recognition"]
    };
  }

  function repairRecognitionNode(state) {
    const recognized =
      state.recognized && typeof state.recognized === "object"
        ? structuredClone(state.recognized)
        : state.recognized;
    const repairLog = [];

    if (recognized && Array.isArray(recognized.rooms)) {
      const roomIds = new Set(
        recognized.rooms
          .map((room) => room?.id)
          .filter((id) => typeof id === "string" && id.length > 0)
      );

      recognized.rooms = recognized.rooms.map((room) => {
        if (!room || typeof room !== "object") return room;
        if (!Array.isArray(room.connectedTo)) return room;

        const repairedConnections = Array.from(
          new Set(
            room.connectedTo.filter(
              (connectedId) =>
                connectedId !== room.id && roomIds.has(connectedId)
            )
          )
        );

        if (repairedConnections.length !== room.connectedTo.length) {
          repairLog.push(
            `已清理房间 ${room.id || "unknown"} 的无效或重复连接`
          );
        }

        return {
          ...room,
          connectedTo: repairedConnections
        };
      });
    }

    if (repairLog.length === 0) {
      repairLog.push("没有发现可以安全自动修复的结构问题");
    }

    return {
      recognized,
      repairAttempts: (state.repairAttempts || 0) + 1,
      repairLog,
      executionPath: ["repair_recognition"]
    };
  }

  function prepareRecognitionReviewNode() {
    return {
      needsHumanReview: true,
      reviewStage: "recognition",
      executionPath: ["prepare_recognition_review"]
    };
  }

  function prepareHighlightReviewNode() {
    return {
      needsHumanReview: true,
      reviewStage: "highlights",
      executionPath: ["prepare_highlight_review"]
    };
  }

  function humanReviewNode(state) {
    const response = interrupt({
      stage: state.reviewStage,
      recognized: state.validatedRecognition || state.recognized,
      highlights: state.highlights,
      validationErrors: state.validationErrors,
      audit: state.auditResult
    });

    if (state.reviewStage === "recognition") {
      if (!response?.recognized || typeof response.recognized !== "object") {
        throw new Error("人工复核必须返回修正后的 recognized");
      }
      return {
        recognized: response.recognized,
        needsHumanReview: false,
        executionPath: ["human_review_resumed"]
      };
    }

    if (response?.action === "approve") {
      return {
        humanApproved: true,
        needsHumanReview: false,
        executionPath: ["human_review_resumed"]
      };
    }

    return {
      highlights: highlightAnalysisSchema.parse(response?.highlights),
      humanApproved: false,
      needsHumanReview: false,
      executionPath: ["human_review_resumed"]
    };
  }

  function routeAfterHumanReview(state) {
    if (state.reviewStage === "recognition") return "validate";
    return state.humanApproved ? "approved" : "audit";
  }

  async function analyzeFeaturesNode(state) {
    const features = featureAnalysisSchema.parse(
      await analyzeFeatures(state.validatedRecognition)
    );
    return {
      features,
      executionPath: ["analyze_features"]
    };
  }

  async function generateHighlightsNode(state) {
    const highlights = highlightAnalysisSchema.parse(
      await generateHighlights({
        recognized: state.validatedRecognition,
        features: state.features
      })
    );
    return {
      highlights,
      validatedRecognition: {
        ...state.validatedRecognition,
        features: state.features,
        pros: highlights.pros,
        cons: highlights.cons,
        suitableFor: highlights.suitableFor
      },
      executionPath: ["generate_highlights"]
    };
  }

  function auditResultNode(state) {
    const selectedIds = [
      ...state.highlights.pros,
      ...state.highlights.cons,
      ...state.highlights.suitableFor
    ];
    const evidenceIds = new Set(
      state.highlights.evidence
        .filter((item) => item.evidence.trim().length > 0)
        .map((item) => item.id)
    );
    const rooms = state.validatedRecognition.rooms;
    const features = state.features;
    const bedrooms = rooms.filter((room) =>
      ["primary_bedroom", "bedroom", "child_room"].includes(room.type)
    );
    const bathrooms = rooms.filter((room) => room.type === "bathroom");

    const factChecks = {
      good_lighting: () => features.lighting === "good",
      clear_zoning: () => features.dynamicStaticZoning === "good",
      kitchen_dining_flow_good: () => features.kitchenDiningFlow === "good",
      living_balcony_connected: () =>
        rooms.some(
          (room) =>
            room.type === "living_room" &&
            room.connectedTo.some((connectedId) =>
              rooms.some(
                (candidate) =>
                  candidate.id === connectedId && candidate.type === "balcony"
              )
            )
        ),
      dual_bathroom_convenient: () => bathrooms.length >= 2,
      single_bath_pressure: () =>
        features.bathroomPressure === "high" ||
        (bathrooms.length === 1 && bedrooms.length >= 3),
      weak_lighting_room: () =>
        features.lighting === "weak" ||
        rooms.some((room) => room.light === "weak"),
      corridor_area_loss: () =>
        rooms.some((room) => room.type === "corridor"),
      multi_room_need: () => bedrooms.length >= 3,
      three_person_family: () => bedrooms.length >= 2,
      single_or_couple: () => bedrooms.length <= 2
    };

    const unsupportedIds = selectedIds.filter((id) => {
      if (!evidenceIds.has(id)) return true;
      const check = factChecks[id];
      return check ? !check() : false;
    });
    const warnings = unsupportedIds.map(
      (id) => `标签 ${id} 缺少证据或与识别事实不一致`
    );
    const auditResult = auditResultSchema.parse({
      passed: warnings.length === 0,
      warnings,
      unsupportedIds
    });

    return {
      auditResult,
      executionPath: ["audit_result"]
    };
  }

  function routeAfterAudit(state) {
    return state.auditResult.passed || state.skipHighlightReview
      ? "approved"
      : "human_review";
  }

  function routeAfterValidation(state) {
    if (state.recognitionValid) return "valid";
    if ((state.repairAttempts || 0) < 1) return "repair";
    return "human_review";
  }

  return new StateGraph(FloorplanAgentState)
    .addNode("recognize", recognizeNode)
    .addNode("validate_recognition", validateRecognitionNode)
    .addNode("repair_recognition", repairRecognitionNode)
    .addNode("prepare_recognition_review", prepareRecognitionReviewNode)
    .addNode("prepare_highlight_review", prepareHighlightReviewNode)
    .addNode("human_review", humanReviewNode)
    .addNode("analyze_features", analyzeFeaturesNode)
    .addNode("generate_highlights", generateHighlightsNode)
    .addNode("audit_result", auditResultNode)
    .addEdge(START, "recognize")
    .addEdge("recognize", "validate_recognition")
    .addConditionalEdges("validate_recognition", routeAfterValidation, {
      valid: "analyze_features",
      repair: "repair_recognition",
      human_review: "prepare_recognition_review"
    })
    .addEdge("repair_recognition", "validate_recognition")
    .addEdge("analyze_features", "generate_highlights")
    .addEdge("generate_highlights", "audit_result")
    .addConditionalEdges("audit_result", routeAfterAudit, {
      approved: END,
      human_review: "prepare_highlight_review"
    })
    .addEdge("prepare_recognition_review", "human_review")
    .addEdge("prepare_highlight_review", "human_review")
    .addConditionalEdges("human_review", routeAfterHumanReview, {
      validate: "validate_recognition",
      audit: "audit_result",
      approved: END
    })
    .compile({ checkpointer: options.checkpointer || new MemorySaver() });
}

export async function runFloorplanAgent(graph, input, options = {}) {
  const threadId = options.threadId || randomUUID();
  const result = await graph.invoke({
    imageDataUrl: input.imageDataUrl,
    imageName: input.imageName || "未命名户型图",
    suppliedArea: input.suppliedArea,
    repairAttempts: 0,
    skipHighlightReview: Boolean(input.skipHighlightReview),
    repairLog: [],
    needsHumanReview: false,
    executionPath: []
  }, {
    configurable: { thread_id: threadId }
  });
  return { ...result, threadId };
}

export async function resumeFloorplanAgent(graph, { threadId, resume }) {
  const result = await graph.invoke(new Command({ resume }), {
    configurable: { thread_id: threadId }
  });
  return { ...result, threadId };
}
