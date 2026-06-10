import type { InterestKey, Room } from "../data/property";

export type ChatMessage = {
  role: "agent" | "user";
  content: string;
  roomId?: string;
};

export type InterestScore = Record<InterestKey, number>;

export const initialScores: InterestScore = {
  采光: 2,
  收纳: 2,
  孩子: 3,
  动线: 2,
  办公: 0,
  安全: 2,
  预算: 1
};

const keywordMap: Record<InterestKey, string[]> = {
  采光: ["采光", "阳光", "朝向", "南向", "日照", "明亮", "窗"],
  收纳: ["收纳", "柜", "储物", "衣柜", "杂物", "换季"],
  孩子: ["孩子", "儿童", "上学", "学习", "玩具", "亲子", "二胎"],
  动线: ["动线", "方便", "顺路", "做饭", "老人", "通行", "路线"],
  办公: ["办公", "书房", "在家工作", "电脑", "会议", "工作"],
  安全: ["安全", "防滑", "边角", "老人", "小孩", "护栏"],
  预算: ["预算", "价格", "贵", "总价", "性价比", "贷款"]
};

export function updateInterestScores(
  scores: InterestScore,
  text: string,
  room?: Room
): InterestScore {
  const next = { ...scores };
  const normalized = text.toLowerCase();

  Object.entries(keywordMap).forEach(([key, words]) => {
    if (words.some((word) => normalized.includes(word.toLowerCase()))) {
      next[key as InterestKey] += 2;
    }
  });

  room?.defaultFocus.forEach((key) => {
    next[key] += 0.4;
  });

  return next;
}

export function topInterests(scores: InterestScore, limit = 4): InterestKey[] {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key as InterestKey);
}

export function composeFallbackGuide(
  room: Room,
  scores: InterestScore,
  latestQuestion?: string
) {
  const interests = topInterests(scores, 3);
  const concern = room.concerns[0];
  const lead = latestQuestion
    ? `你刚问“${latestQuestion}”，看这个${room.name}我会重点看${interests.join("、")}。`
    : `现在这个视角是${room.name}，${room.view}。`;

  return `${lead}${room.highlights[0]}是优势，${room.familyFit}但要注意${concern}。`;
}
