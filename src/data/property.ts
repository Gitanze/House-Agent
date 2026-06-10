export type InterestKey =
  | "采光"
  | "收纳"
  | "孩子"
  | "动线"
  | "办公"
  | "安全"
  | "预算";

export type Hotspot = {
  id: string;
  label: string;
  kind: "measure" | "route" | "view" | "feature";
  x: number;
  y: number;
};

export type Room = {
  id: string;
  name: string;
  area: string;
  orientation: string;
  view: string;
  cropClass: string;
  floorX: number;
  floorY: number;
  highlights: string[];
  concerns: string[];
  familyFit: string;
  defaultFocus: InterestKey[];
  hotspots: Hotspot[];
};

export const buyerProfile = {
  label: "年轻三口之家",
  budget: "总价敏感，但愿意为采光、动线和儿童成长空间多付一点",
  family: "两位上班族父母，一个学龄前孩子，偶尔有老人短住",
  preferences: ["采光", "收纳", "孩子", "动线", "安全"] as InterestKey[]
};

export const floorPlanAnalysis = [
  "整体是三房两厅一卫一阳台，客餐厅位于中轴，卧室分布在两侧，动静分区比较清楚。",
  "客厅和阳台形成主要采光面，餐厨靠近入户与餐桌，日常买菜、做饭、吃饭的路径短。",
  "儿童房与主卧距离适中，晚上照看孩子方便，又不会完全牺牲父母的私密性。",
  "需要注意的是只有一个卫生间，早高峰一家三口同时使用时要靠动线和收纳规划来缓解。"
];

export const rooms: Room[] = [
  {
    id: "living",
    name: "客厅",
    area: "约 25㎡",
    orientation: "南向连阳台",
    view: "沙发面向电视墙，阳台采光进入客厅",
    cropClass: "crop-living",
    floorX: 48,
    floorY: 58,
    highlights: ["南向大面宽", "客厅与阳台连通", "沙发和电视墙尺度规整"],
    concerns: ["开间不算奢侈，大家具需要控制尺寸"],
    familyFit: "适合把客厅做成亲子活动区，孩子玩耍时父母在餐厨区也能看见。",
    defaultFocus: ["采光", "孩子", "动线"],
    hotspots: [
      { id: "height", label: "层高 2.70m", kind: "measure", x: 50, y: 26 },
      { id: "width", label: "开间 3.60m", kind: "measure", x: 58, y: 54 },
      { id: "window", label: "查看窗景", kind: "view", x: 66, y: 43 },
      { id: "balcony", label: "阳台路线", kind: "route", x: 50, y: 61 },
      { id: "sofa", label: "亲子活动区", kind: "feature", x: 53, y: 67 }
    ]
  },
  {
    id: "kitchen",
    name: "餐厨",
    area: "约 12㎡",
    orientation: "东南侧采光",
    view: "餐桌连接开放式厨房岛台",
    cropClass: "crop-kitchen",
    floorX: 40,
    floorY: 40,
    highlights: ["餐厨距离短", "窗边自然光好", "冰箱和操作台形成顺手三角区"],
    concerns: ["开放式厨房要控制油烟和台面杂物"],
    familyFit: "适合一家人早餐和亲子烘焙，餐桌也能临时承担孩子手工区。",
    defaultFocus: ["动线", "收纳", "孩子"],
    hotspots: [
      { id: "table", label: "餐桌 4-6人", kind: "feature", x: 48, y: 63 },
      { id: "cookline", label: "备餐动线", kind: "route", x: 67, y: 47 },
      { id: "window", label: "东南采光", kind: "view", x: 26, y: 34 },
      { id: "storage", label: "高柜收纳", kind: "feature", x: 84, y: 44 }
    ]
  },
  {
    id: "primary",
    name: "主卧",
    area: "约 15㎡",
    orientation: "南向窗景",
    view: "床头靠墙，窗边留出梳妆和阅读角",
    cropClass: "crop-primary",
    floorX: 74,
    floorY: 35,
    highlights: ["床柜布局完整", "窗景开阔", "离客厅有一定缓冲"],
    concerns: ["衣柜要做顶天立地，否则换季收纳压力较大"],
    familyFit: "父母休息区相对安静，适合保留一角做临时办公或睡前阅读。",
    defaultFocus: ["收纳", "办公", "采光"],
    hotspots: [
      { id: "bed", label: "1.8m床位", kind: "measure", x: 43, y: 63 },
      { id: "wardrobe", label: "整墙衣柜", kind: "feature", x: 77, y: 54 },
      { id: "desk", label: "办公角", kind: "feature", x: 75, y: 38 },
      { id: "window", label: "南向窗景", kind: "view", x: 56, y: 33 }
    ]
  },
  {
    id: "kids",
    name: "儿童房",
    area: "约 10㎡",
    orientation: "北向明窗",
    view: "床、书桌、玩具收纳集中在一面墙",
    cropClass: "crop-kids",
    floorX: 20,
    floorY: 32,
    highlights: ["书桌靠窗", "玩具收纳位明确", "离主卧不远"],
    concerns: ["面积紧凑，二胎或大床方案会压缩活动区"],
    familyFit: "适合学龄前到小学阶段，能同时放下睡眠、学习和玩具收纳。",
    defaultFocus: ["孩子", "安全", "收纳"],
    hotspots: [
      { id: "desk", label: "学习区", kind: "feature", x: 73, y: 61 },
      { id: "toy", label: "玩具收纳", kind: "feature", x: 36, y: 72 },
      { id: "window", label: "明窗采光", kind: "view", x: 56, y: 35 },
      { id: "safe", label: "安全边角", kind: "measure", x: 61, y: 77 }
    ]
  },
  {
    id: "bath",
    name: "卫生间",
    area: "约 5㎡",
    orientation: "明卫",
    view: "干湿区靠玻璃隔断分离",
    cropClass: "crop-bath",
    floorX: 42,
    floorY: 25,
    highlights: ["明卫通风", "淋浴隔断清楚", "台盆旁可加镜柜"],
    concerns: ["全屋单卫，早高峰需要错峰"],
    familyFit: "对孩子洗澡和老人短住都友好，建议加防滑和低位置物。",
    defaultFocus: ["安全", "收纳", "动线"],
    hotspots: [
      { id: "wet", label: "干湿分离", kind: "feature", x: 45, y: 43 },
      { id: "mirror", label: "镜柜收纳", kind: "feature", x: 72, y: 58 },
      { id: "window", label: "明卫通风", kind: "view", x: 51, y: 31 },
      { id: "safe", label: "防滑区", kind: "measure", x: 57, y: 76 }
    ]
  },
  {
    id: "balcony",
    name: "阳台",
    area: "约 8㎡",
    orientation: "南向景观",
    view: "外看小区绿化和城市天际线",
    cropClass: "crop-balcony",
    floorX: 49,
    floorY: 85,
    highlights: ["南向日照足", "景观开阔", "可兼顾洗晒和休闲"],
    concerns: ["如果全做休闲区，洗晒功能要另行安排"],
    familyFit: "可以一半洗晒一半亲子植物角，也能提升客厅的通透感。",
    defaultFocus: ["采光", "孩子", "动线"],
    hotspots: [
      { id: "view", label: "查看窗景", kind: "view", x: 63, y: 36 },
      { id: "sun", label: "南向日照", kind: "measure", x: 47, y: 47 },
      { id: "laundry", label: "洗晒位", kind: "feature", x: 30, y: 73 },
      { id: "plant", label: "亲子植物角", kind: "feature", x: 72, y: 75 }
    ]
  }
];

export const quickQuestions = [
  "这个客厅适合怎么布置？",
  "孩子以后上小学，儿童房够用吗？",
  "这个户型收纳会不会不够？",
  "如果我经常居家办公，哪里最适合改？"
];
