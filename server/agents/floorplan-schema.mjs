import { z } from "zod";

export const roomTypeSchema = z.enum([
  "living_room",
  "dining_room",
  "kitchen",
  "primary_bedroom",
  "bedroom",
  "child_room",
  "study",
  "bathroom",
  "balcony",
  "entrance",
  "corridor",
  "storage",
  "unknown"
]);

const judgmentSchema = z.enum(["good", "medium", "weak", "unknown"]);

export const featureAnalysisSchema = z.object({
  northSouthVentilation: z.union([z.boolean(), z.literal("unknown")]),
  dynamicStaticZoning: judgmentSchema,
  kitchenDiningFlow: judgmentSchema,
  bathroomPressure: z.enum(["low", "medium", "high", "unknown"]),
  lighting: judgmentSchema,
  storagePotential: judgmentSchema
});

const evidenceItemSchema = z.object({
  id: z.string().min(1),
  evidence: z.string().min(1)
});

export const highlightAnalysisSchema = z.object({
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  suitableFor: z.array(z.string()),
  evidence: z.array(evidenceItemSchema)
});

export const auditResultSchema = z.object({
  passed: z.boolean(),
  warnings: z.array(z.string()),
  unsupportedIds: z.array(z.string())
});

export const roomSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, "房间 ID 必须是稳定的英文 snake_case"),
  type: roomTypeSchema,
  name: z.string().min(1),
  position: z.string().min(1),
  areaAssessment: z.string().optional(),
  geometry: z.string().optional(),
  orientation: z.string().optional(),
  connectedTo: z.array(z.string()).default([]),
  hasWindow: z.union([z.boolean(), z.literal("unknown")]),
  light: judgmentSchema
});

export const floorplanRecognitionSchema = z
  .object({
    layoutType: z.string().min(1),
    area: z.string().min(1),
    orientation: z.string().min(1),
    rooms: z.array(roomSchema).min(1, "至少需要识别出一个房间"),
    features: featureAnalysisSchema.default({
      northSouthVentilation: "unknown",
      dynamicStaticZoning: "unknown",
      kitchenDiningFlow: "unknown",
      bathroomPressure: "unknown",
      lighting: "unknown",
      storagePotential: "unknown"
    }),
    unknowns: z.array(z.string()).default([]),
    needsReview: z.array(z.string()).default([]),
    basicRoute: z.string().optional(),

    // These fields remain in the public shape for frontend compatibility.
    // The vision node no longer generates them; a later reasoning node will.
    pros: z.array(z.string()).default([]),
    cons: z.array(z.string()).default([]),
    suitableFor: z.array(z.string()).default([])
  })
  .superRefine((value, context) => {
    const roomIds = new Set();

    value.rooms.forEach((room, index) => {
      if (roomIds.has(room.id)) {
        context.addIssue({
          code: "custom",
          path: ["rooms", index, "id"],
          message: `房间 ID 重复：${room.id}`
        });
      }
      roomIds.add(room.id);
    });

    value.rooms.forEach((room, roomIndex) => {
      room.connectedTo.forEach((connectedId, connectionIndex) => {
        if (connectedId === room.id) {
          context.addIssue({
            code: "custom",
            path: ["rooms", roomIndex, "connectedTo", connectionIndex],
            message: `房间 ${room.id} 不能连接自己`
          });
        } else if (!roomIds.has(connectedId)) {
          context.addIssue({
            code: "custom",
            path: ["rooms", roomIndex, "connectedTo", connectionIndex],
            message: `连接引用了不存在的房间：${connectedId}`
          });
        }
      });
    });

    const layoutBedroomMatch = value.layoutType.match(/(\d+)\s*室/);
    if (layoutBedroomMatch) {
      const expectedBedrooms = Number(layoutBedroomMatch[1]);
      const recognizedBedrooms = value.rooms.filter((room) =>
        ["primary_bedroom", "bedroom", "child_room"].includes(room.type)
      ).length;

      if (expectedBedrooms !== recognizedBedrooms) {
        context.addIssue({
          code: "custom",
          path: ["layoutType"],
          message: `户型写明 ${expectedBedrooms} 室，但房间列表识别出 ${recognizedBedrooms} 个卧室`
        });
      }
    }
  });

export function validateFloorplanRecognition(value) {
  const result = floorplanRecognitionSchema.safeParse(value);

  if (result.success) {
    return {
      success: true,
      data: result.data,
      errors: []
    };
  }

  return {
    success: false,
    data: null,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }))
  };
}
