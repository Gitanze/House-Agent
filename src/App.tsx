import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Database,
  Download,
  FileImage,
  Home,
  Loader2,
  MessageCircleQuestion,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  X
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

const focusOptions = ["采光", "动线", "收纳", "儿童房", "老人房", "改造潜力"];
const maxImageSize = 8 * 1024 * 1024;

async function readApiJson(response: Response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (/^\s*<!doctype/i.test(text) || /^\s*<html/i.test(text)) {
      throw new Error("后端没有加载到这个接口。请停止当前服务并重新运行 npm run dev，然后再试。");
    }
    throw new Error(`接口返回了非 JSON 内容（HTTP ${response.status}）。`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口返回的 JSON 格式无效（HTTP ${response.status}）。`);
  }
}
const featureOptions: Record<string, string[]> = {
  northSouthVentilation: ["true", "false", "unknown"],
  dynamicStaticZoning: ["good", "medium", "weak", "unknown"],
  kitchenDiningFlow: ["good", "medium", "weak", "unknown"],
  bathroomPressure: ["low", "medium", "high", "unknown"],
  lighting: ["good", "medium", "weak", "unknown"],
  storagePotential: ["good", "medium", "weak", "unknown"]
};

const roomTypeOptions = [
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
];

const roomLightOptions = ["good", "medium", "weak", "unknown"];

type Room = {
  id: string;
  type: string;
  name?: string;
  position?: string;
  areaAssessment?: string;
  geometry?: string;
  orientation?: string;
  connectedTo?: string[];
  hasWindow?: boolean | "unknown";
  light?: "good" | "medium" | "weak" | "unknown" | string;
  roomVisual?: {
    image: UploadedImage;
    provider: string;
    analyzedAt: string;
    analysis: {
      objectiveDescription?: string;
      visibleElements?: string[];
      spatialLayout?: string;
      finishAndCondition?: string;
      windowAndLighting?: string;
      storage?: string;
      scriptFacts?: string[];
      unknowns?: string[];
    };
  };
};

type RecognizedFloorplan = {
  layoutType?: string;
  area?: string;
  orientation?: string;
  rooms?: Room[];
  features?: Record<string, unknown>;
  pros?: string[];
  cons?: string[];
  suitableFor?: string[];
  unknowns?: string[];
  needsReview?: string[];
  basicRoute?: string;
};

type PropertyFacts = {
  community: string;
  city: string;
  district: string;
  buildingArea?: string;
  declaredLayout: string;
  decoration: string;
  elevator: string;
  schoolInfo: string;
  transitInfo: string;
  amenities: string;
};

type Brief = {
  talk30s: string;
  sellingPoints: string[];
  faqs: Array<{ question: string; answer: string }>;
  riskTip: string;
};

type AnalyzeResponse = {
  schemaVersion?: "property-facts/v1";
  floorplanSchemaVersion?: "floorplan-analysis/v1";
  status?: "completed";
  threadId?: string;
  provider: {
    vision?: string;
    description?: "deepseek" | "fallback";
    brief: "deepseek" | "fallback";
  };
  image?: BenchmarkImage;
  recognized: RecognizedFloorplan;
  manualHighlights?: string[];
  propertyFacts?: PropertyFacts;
  sources?: Array<{ field: string; source: "user" | "floorplan" | "manual"; status: string }>;
  warnings?: string[];
  objectiveDescription?: string;
  enrichedDescription?: string;
  brief: Brief;
  recordId?: string;
  recordTitle?: string;
};

type PendingReview = {
  status: "needs_review";
  threadId: string;
  review: {
    stage: "recognition" | "highlights";
    recognized: RecognizedFloorplan;
    highlights?: {
      pros: string[];
      cons: string[];
      suitableFor: string[];
      evidence: Array<{ id: string; evidence: string }>;
    };
  };
};

type HighlightAgentResult = {
  schemaVersion: "property-highlight-plan/v1";
  status: string;
  threadId: string;
  searchQueries: string[];
  sourceNotes: Array<{
    id: string;
    title: string;
    bodyExcerpt?: string;
    theme?: string;
    targetAudience?: string;
    hookType?: string;
    structure?: string;
    tone?: string;
    metrics?: Record<string, number>;
    ranking?: { heatScore?: number };
    relevance?: { reasons?: string[] };
  }>;
  trendPatterns: Array<{
    hook: string;
    structure: string;
    keywords: string[];
  }>;
  highlightStrategy?: {
    audience: string;
    angle: string;
    highlights: Array<{
      title: string;
      value: string;
      sourceType: "floorplan" | "manual";
      evidence: string;
    }>;
  };
  openingHook: string;
  talk30s: string;
  warnings: string[];
  runMetadata: {
    provider: string;
    contentModel: string;
    cacheHits: number;
    crawlerStatus: string;
    executionPath: string[];
  };
};

type PropertyScriptResult = {
  schemaVersion: "property-video-script/v1";
  provider: "deepseek" | "fallback";
  duration: 60 | 90;
  style: string;
  styleLabel: string;
  scriptVariant?: "matrix" | "legacy";
  targetAudience?: string;
  narrativeVoice?: "owner" | "viewer" | "abstract";
  narrativeVoiceLabel?: string;
  contentFocus?: "full_home" | "renovation" | "core_space";
  contentFocusLabel?: string;
  storyPositioning: string;
  voiceover: string;
  pendingConfirmations: string[];
  scenes: Array<{
    sceneNumber: number;
    durationSeconds: number;
    roomId: string;
    space: string;
    storyVoiceover: string;
    shot: {
      framing: string;
      cameraMove: string;
      focus: string;
      note: string;
    };
  }>;
  onSiteConfirmations: string[];
  generationTrace?: {
    skill: { path: string; modifiedAt: string; sha256: string };
    reference: { path: string; modifiedAt: string; sha256: string };
    selectedStyleSection: string;
    loadedAt: string;
    positiveOnlyOverride: boolean;
    matrixSelection?: {
      targetAudience: string;
      narrativeVoice: string;
      narrativeVoiceLabel: string;
      contentFocus: string;
      contentFocusLabel: string;
      scriptDirection?: string;
    } | null;
    manualHighlights: Array<{ highlight: string; included: boolean }>;
    matchedCases?: Array<{ caseId: string; title: string }>;
  };
  scriptId?: string;
  scriptName?: string;
};

type SavedScript = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  result: PropertyScriptResult;
  derivedFromScriptId?: string;
  refinementInstruction?: string;
  generationType?: "refinement";
};

type PropertyRecordSummary = {
  id: string;
  title: string;
  updatedAt: string;
  area: string;
  layoutType: string;
  roomCount: number;
  scriptCount: number;
  imageName: string;
};

type PropertyRecord = {
  id: string;
  title: string;
  updatedAt: string;
  image: UploadedImage;
  propertyFacts: PropertyFacts;
  manualHighlights: string[];
  factConfirmations: Array<{
    question: string;
    answer: string;
    source: "human_review";
    updatedAt: string | null;
  }>;
  analysis: AnalyzeResponse;
  scripts: SavedScript[];
};

type UploadedImage = {
  name: string;
  size: number;
  dataUrl: string;
};

type LabelItem = {
  id: string;
  label: string;
};

type LabelTaxonomy = {
  pros: LabelItem[];
  cons: LabelItem[];
  suitableFor: LabelItem[];
};

type BenchmarkImage = {
  id: string;
  fileName: string;
  imagePath: string;
  size: number;
  reviewed?: boolean;
};

type Mode = "brief" | "annotation";
type LabelSection = "pros" | "cons" | "suitableFor";

const emptyTaxonomy: LabelTaxonomy = { pros: [], cons: [], suitableFor: [] };

function formatSize(size: number) {
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function featureText(value: unknown) {
  if (value === true) return "是";
  if (value === false) return "否";
  if (value === undefined || value === null || value === "") return "unknown";
  return String(value);
}

function normalizeFeatureValue(value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function linesToArray(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function arrayToLines(value?: string[]) {
  return (value ?? []).join("\n");
}

function formatSrtTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const whole = Math.floor(safeSeconds);
  const milliseconds = Math.round((safeSeconds - whole) * 1000);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(milliseconds, 3)}`;
}

function buildSrtFromScript(result: PropertyScriptResult) {
  let cursor = 0;
  let index = 1;
  const blocks: string[] = [];
  result.scenes.forEach((scene) => {
    const duration = Math.max(1, Number(scene.durationSeconds) || 1);
    const text = String(scene.storyVoiceover || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    if (!text) return;
    blocks.push(`${index}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}`);
    index += 1;
  });
  return `${blocks.join("\n\n")}\n`;
}

function safeDownloadName(value: string, fallback: string) {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || fallback;
}

function downloadTextFile(fileName: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function nextRoomId(rooms: Room[]) {
  let index = rooms.length + 1;
  let id = `room_${index}`;
  const used = new Set(rooms.map((room) => room.id));
  while (used.has(id)) {
    index += 1;
    id = `room_${index}`;
  }
  return id;
}

export function App() {
  const [mode, setMode] = useState<Mode>("brief");
  const [annotationSubMode, setAnnotationSubMode] = useState<"labels" | "legacyScript">("labels");
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [propertyArea, setPropertyArea] = useState("");
  const [propertyFacts, setPropertyFacts] = useState<PropertyFacts>({
    community: "",
    city: "",
    district: "",
    declaredLayout: "",
    decoration: "",
    elevator: "",
    schoolInfo: "",
    transitInfo: "",
    amenities: ""
  });
  const [familyType, setFamilyType] = useState("年轻家庭");
  const [focusTags, setFocusTags] = useState<string[]>(["采光", "动线", "收纳"]);
  const [manualHighlightsText, setManualHighlightsText] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [editable, setEditable] = useState<RecognizedFloorplan | null>(null);
  const [taxonomy, setTaxonomy] = useState<LabelTaxonomy>(emptyTaxonomy);
  const [benchmarkImages, setBenchmarkImages] = useState<BenchmarkImage[]>([]);
  const [selectedCase, setSelectedCase] = useState<BenchmarkImage | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedConnectionRoomId, setSelectedConnectionRoomId] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [propertyRecords, setPropertyRecords] = useState<PropertyRecordSummary[]>([]);
  const [activeRecord, setActiveRecord] = useState<PropertyRecord | null>(null);
  const [recordTitle, setRecordTitle] = useState("");

  const canSubmit =
    Boolean(uploadedImage) &&
    Number.isFinite(Number(propertyArea)) &&
    Number(propertyArea) > 0 &&
    !isLoading;
  const activeRecognized = editable ?? result?.recognized ?? null;
  const roomSummary = useMemo(() => {
    const rooms = activeRecognized?.rooms ?? [];
    if (!rooms.length) return "等待识图";
    return rooms.map((room) => room.name || room.type).filter(Boolean).join("、");
  }, [activeRecognized]);

  useEffect(() => {
    void loadTaxonomy();
    void loadBenchmarkImages();
    void loadPropertyRecords();
  }, []);

  async function loadTaxonomy() {
    const response = await fetch("/api/label-taxonomy");
    setTaxonomy((await response.json()) as LabelTaxonomy);
  }

  async function loadBenchmarkImages() {
    const response = await fetch("/api/benchmark-images");
    const data = (await response.json()) as { images: BenchmarkImage[] };
    setBenchmarkImages(data.images);
  }

  async function loadPropertyRecords() {
    const response = await fetch("/api/property-records");
    if (!response.ok) return;
    const data = await response.json() as { records: PropertyRecordSummary[] };
    setPropertyRecords(data.records);
  }

  async function openPropertyRecord(id: string) {
    const response = await fetch(`/api/property-records/${id}`);
    const record = await response.json() as PropertyRecord;
    if (!response.ok) {
      setError((record as unknown as { error?: string }).error || "读取户型档案失败。");
      return;
    }
    setActiveRecord(record);
    setRecordTitle(record.title);
    setUploadedImage(record.image);
    setPropertyFacts(record.propertyFacts);
    setPropertyArea(String(record.analysis.recognized.area || "").replace(/㎡/g, ""));
    setManualHighlightsText(arrayToLines(record.manualHighlights));
    setResult({ ...record.analysis, recordId: record.id, recordTitle: record.title });
    setEditable(record.analysis.recognized);
    setMode("brief");
  }

  async function saveActiveRecord() {
    if (!activeRecord) return;
    const response = await fetch(`/api/property-records/${activeRecord.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: recordTitle,
        propertyFacts: { ...propertyFacts, buildingArea: `${propertyArea}㎡` },
        manualHighlights: linesToArray(manualHighlightsText),
        analysis: { ...result, recognized: editable ?? result?.recognized }
      })
    });
    const record = await response.json();
    if (!response.ok) {
      setError(record.error || "保存户型档案失败。");
      return;
    }
    setActiveRecord(record);
    setSaveMessage("户型档案已保存");
    await loadPropertyRecords();
  }

  async function deletePropertyRecord(id: string) {
    if (!window.confirm("删除后，该户型下的所有脚本方案也会一起删除。确定继续吗？")) return;
    const response = await fetch(`/api/property-records/${id}`, { method: "DELETE" });
    if (!response.ok) return;
    if (activeRecord?.id === id) {
      setActiveRecord(null);
      setRecordTitle("");
      setResult(null);
      setEditable(null);
      setUploadedImage(null);
    }
    await loadPropertyRecords();
  }

  function toggleFocus(tag: string) {
    setFocusTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError("");
    setResult(null);
    setEditable(null);

    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请上传 jpg、png 或 webp 格式的户型图。");
      return;
    }
    if (file.size > maxImageSize) {
      setError("图片超过 8MB，请压缩后再上传。");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setUploadedImage({ name: file.name, size: file.size, dataUrl });
    };
    reader.onerror = () => setError("图片读取失败，请重新选择文件。");
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!uploadedImage || isLoading) return;

    setIsLoading(true);
    setError("");
    setResult(null);
    setEditable(null);

    try {
      const response = await fetch("/api/floorplan-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: uploadedImage.dataUrl,
          imageName: uploadedImage.name,
          area: propertyArea,
          property: propertyFacts,
          familyType,
          focusTags,
          manualHighlights: linesToArray(manualHighlightsText)
        })
      });

      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "户型图分析失败。");
      if (data.status === "needs_review") {
        const review = data as PendingReview;
        setPendingReview(review);
        setEditable({
          ...review.review.recognized,
          pros: review.review.highlights?.pros ?? review.review.recognized.pros ?? [],
          cons: review.review.highlights?.cons ?? review.review.recognized.cons ?? [],
          suitableFor:
            review.review.highlights?.suitableFor ??
            review.review.recognized.suitableFor ??
            []
        });
        setSaveMessage("Agent 已暂停，请校正后继续");
        setMode("annotation");
        return;
      }
      setPendingReview(null);
      setResult(data as AnalyzeResponse);
      setEditable((data as AnalyzeResponse).recognized);
      if (data.recordId) {
        setRecordTitle(data.recordTitle || uploadedImage.name);
        await loadPropertyRecords();
        await openPropertyRecord(data.recordId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "户型图分析失败，请稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }

  async function selectBenchmarkImage(image: BenchmarkImage) {
    setSelectedCase(image);
    setResult(null);
    setEditable(null);
    setSelectedConnectionRoomId(null);
    setSaveMessage("");
    setError("");

    try {
      const response = await fetch(`/api/benchmark-case/${image.id}`);
      if (!response.ok) return;
      const saved = await response.json();
      const recognized = saved[0] ?? saved;
      setEditable(recognized as RecognizedFloorplan);
      setSaveMessage(`已加载 ${image.id} 的人工复核稿`);
    } catch {
      setSaveMessage("");
    }
  }

  async function analyzeSelectedCase() {
    if (!selectedCase || isLoading) return;
    setIsLoading(true);
    setSelectedConnectionRoomId(null);
    setError("");
    setSaveMessage("");

    try {
      const response = await fetch("/api/floorplan-analyze-case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: selectedCase.fileName,
          property: propertyFacts,
          familyType,
          focusTags,
          manualHighlights: linesToArray(manualHighlightsText)
        })
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "case 识图失败。");
      if (data.status === "needs_review") {
        const review = data as PendingReview;
        setPendingReview(review);
        setEditable({
          ...review.review.recognized,
          pros: review.review.highlights?.pros ?? review.review.recognized.pros ?? [],
          cons: review.review.highlights?.cons ?? review.review.recognized.cons ?? [],
          suitableFor:
            review.review.highlights?.suitableFor ??
            review.review.recognized.suitableFor ??
            []
        });
        setSaveMessage("Agent 已暂停，请校正后继续");
        return;
      }
      setPendingReview(null);
      setResult(data as AnalyzeResponse);
      setEditable((data as AnalyzeResponse).recognized);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "case 识图失败，请稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }

  function updateEditable(patch: Partial<RecognizedFloorplan>) {
    setEditable((current) => ({ ...(current ?? {}), ...patch }));
  }

  function updateFeature(key: string, value: string) {
    setEditable((current) => ({
      ...(current ?? {}),
      features: {
        ...(current?.features ?? {}),
        [key]: normalizeFeatureValue(value)
      }
    }));
  }

  function toggleLabel(section: LabelSection, id: string) {
    setEditable((current) => {
      const next = current ?? {};
      const currentList = next[section] ?? [];
      const nextList = currentList.includes(id)
        ? currentList.filter((item) => item !== id)
        : [...currentList, id];
      return { ...next, [section]: nextList };
    });
  }

  async function addTaxonomyLabel(section: LabelSection, label: string) {
    const cleanLabel = label.trim();
    if (!cleanLabel) return;
    setError("");
    setSaveMessage("");

    try {
      const response = await fetch("/api/label-taxonomy/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, label: cleanLabel })
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "新增标签失败。");
      setTaxonomy(data.taxonomy as LabelTaxonomy);
      const created = data.label as LabelItem;
      setEditable((current) => {
        const next = current ?? {};
        const currentList = next[section] ?? [];
        return { ...next, [section]: Array.from(new Set([...currentList, created.id])) };
      });
      setSaveMessage(`已新增标签：${created.label}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "新增标签失败，请稍后重试。");
    }
  }

  async function deleteTaxonomyLabel(section: LabelSection, id: string) {
    const item = taxonomy[section].find((entry) => entry.id === id);
    const label = item ? `${item.label} (${item.id})` : id;
    if (!window.confirm(`确定删除标签 ${label} 吗？它会同步从已保存 benchmark 中移除。`)) return;
    setError("");
    setSaveMessage("");

    try {
      const response = await fetch("/api/label-taxonomy/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, id })
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "删除标签失败。");
      setTaxonomy(data.taxonomy as LabelTaxonomy);
      setEditable((current) => {
        if (!current) return current;
        return { ...current, [section]: (current[section] ?? []).filter((itemId) => itemId !== id) };
      });
      setSaveMessage(`已删除标签，并同步 ${data.touchedCases ?? 0} 个 benchmark 文件`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除标签失败，请稍后重试。");
    }
  }

  function addRoom() {
    setEditable((current) => {
      const rooms = current?.rooms ?? [];
      const id = nextRoomId(rooms);
      const room: Room = {
        id,
        type: "unknown",
        name: "新房间",
        position: "unknown",
        connectedTo: [],
        hasWindow: false,
        light: "unknown"
      };
      return { ...(current ?? {}), rooms: [...rooms, room] };
    });
  }

  function updateRoom(roomId: string, patch: Partial<Room>) {
    setEditable((current) => ({
      ...(current ?? {}),
      rooms: (current?.rooms ?? []).map((room) => (room.id === roomId ? { ...room, ...patch } : room))
    }));
  }

  function deleteRoom(roomId: string) {
    setEditable((current) => ({
      ...(current ?? {}),
      rooms: (current?.rooms ?? [])
        .filter((room) => room.id !== roomId)
        .map((room) => ({ ...room, connectedTo: (room.connectedTo ?? []).filter((id) => id !== roomId) }))
    }));
    setSelectedConnectionRoomId((current) => (current === roomId ? null : current));
  }

  function toggleRoomConnection(roomId: string) {
    if (!editable?.rooms?.length) return;

    if (!selectedConnectionRoomId) {
      setSelectedConnectionRoomId(roomId);
      return;
    }

    if (selectedConnectionRoomId === roomId) {
      setSelectedConnectionRoomId(null);
      return;
    }

    const firstId = selectedConnectionRoomId;
    const secondId = roomId;

    setEditable((current) => {
      const rooms = current?.rooms ?? [];
      const firstRoom = rooms.find((room) => room.id === firstId);
      const alreadyConnected = firstRoom?.connectedTo?.includes(secondId) ?? false;

      const nextRooms = rooms.map((room) => {
        if (room.id !== firstId && room.id !== secondId) return room;
        const otherId = room.id === firstId ? secondId : firstId;
        const currentConnections = room.connectedTo ?? [];
        const nextConnections = alreadyConnected
          ? currentConnections.filter((id) => id !== otherId)
          : Array.from(new Set([...currentConnections, otherId]));
        return { ...room, connectedTo: nextConnections };
      });

      return { ...(current ?? {}), rooms: nextRooms };
    });

    setSelectedConnectionRoomId(null);
  }

  async function regenerateBrief() {
    if (!editable || isLoading) return;
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/floorplan-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recognized: editable,
          familyType,
          focusTags,
          manualHighlights: linesToArray(manualHighlightsText)
        })
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "重新生成讲解失败。");
      setResult((current) => ({
        provider: {
          vision: current?.provider.vision ?? "manual",
          brief: data.provider.brief
        },
        image: current?.image ?? selectedCase ?? undefined,
        recognized: editable,
        brief: data.brief
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重新生成讲解失败，请稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveBenchmarkCase() {
    if (!editable || !selectedCase || isSaving) return;
    setIsSaving(true);
    setError("");
    setSaveMessage("");

    try {
      const response = await fetch("/api/benchmark-case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedCase.id,
          title: `${selectedCase.id} 人工复核`,
          imagePath: selectedCase.imagePath,
          recognized: editable
        })
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "保存失败。");
      setSaveMessage(`已保存：${data.path}`);
      await loadBenchmarkImages();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  }

  async function resumeReview(action: "edit" | "approve") {
    if (!pendingReview || !editable || isLoading) return;
    setIsLoading(true);
    setError("");
    setSaveMessage("");

    try {
      const body =
        pendingReview.review.stage === "recognition"
          ? {
              recognized: editable,
              familyType,
              focusTags,
              manualHighlights: linesToArray(manualHighlightsText),
              property: propertyFacts
            }
          : action === "approve"
            ? {
                action: "approve",
                familyType,
                focusTags,
                manualHighlights: linesToArray(manualHighlightsText),
                property: propertyFacts
              }
            : {
                highlights: {
                  pros: editable.pros ?? [],
                  cons: editable.cons ?? [],
                  suitableFor: editable.suitableFor ?? [],
                  evidence: pendingReview.review.highlights?.evidence ?? []
                },
                familyType,
                focusTags,
                manualHighlights: linesToArray(manualHighlightsText),
                property: propertyFacts
              };
      const response = await fetch(
        `/api/floorplan-review/${pendingReview.threadId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "恢复 Agent 失败。");
      if (data.status === "needs_review") {
        const review = data as PendingReview;
        setPendingReview(review);
        setEditable({
          ...review.review.recognized,
          pros: review.review.highlights?.pros ?? [],
          cons: review.review.highlights?.cons ?? [],
          suitableFor: review.review.highlights?.suitableFor ?? []
        });
        setSaveMessage("修正后仍有待确认项，请继续复核");
        return;
      }
      setPendingReview(null);
      setResult(data as AnalyzeResponse);
      setEditable((data as AnalyzeResponse).recognized);
      setSaveMessage("人工复核完成，Agent 已从暂停位置继续并完成分析");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "恢复 Agent 失败。");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="agent-shell">
      <section className="workspace" aria-label="平面图讲解 Agent">
        <header className="hero">
          <div>
            <p className="eyebrow">Floorplan Brief Agent</p>
            <h1>{mode === "brief" ? "上传户型图，自动生成看房讲解" : "半自动标注台：点选标签沉淀 benchmark"}</h1>
          </div>
          <div className="mode-switch" aria-label="模式切换">
            <button className={mode === "brief" ? "active" : ""} onClick={() => setMode("brief")} type="button">
              讲解生成
            </button>
            <button
              className={mode === "annotation" ? "active" : ""}
              onClick={() => setMode("annotation")}
              type="button"
            >
              Benchmark 标注
            </button>
          </div>
        </header>

        {mode === "brief" && (
          <PropertyArchiveShelf
            records={propertyRecords}
            activeRecordId={activeRecord?.id ?? null}
            title={recordTitle}
            canSave={Boolean(activeRecord)}
            onTitleChange={setRecordTitle}
            onOpen={openPropertyRecord}
            onSave={saveActiveRecord}
            onDelete={deletePropertyRecord}
          />
        )}

        {mode === "brief" ? (
          <BriefMode
            uploadedImage={uploadedImage}
            propertyArea={propertyArea}
            propertyFacts={propertyFacts}
            manualHighlightsText={manualHighlightsText}
            result={result}
            activeRecord={activeRecord}
            editable={editable}
            error={error}
            isLoading={isLoading}
            canSubmit={canSubmit}
            roomSummary={roomSummary}
            onImageChange={handleImageChange}
            onPropertyAreaChange={setPropertyArea}
            onPropertyFactsChange={(patch) =>
              setPropertyFacts((current) => ({ ...current, ...patch }))
            }
            onManualHighlightsChange={setManualHighlightsText}
            onSubmit={submit}
            onRecordRefresh={() => activeRecord && openPropertyRecord(activeRecord.id)}
          />
        ) : (
          <AnnotationMode
            subMode={annotationSubMode}
            onSubModeChange={setAnnotationSubMode}
            records={propertyRecords}
            activeRecord={activeRecord}
            onOpenRecord={openPropertyRecord}
            images={benchmarkImages}
            selectedCase={selectedCase}
            familyType={familyType}
            focusTags={focusTags}
            result={result}
            editable={editable}
            taxonomy={taxonomy}
            error={error}
            saveMessage={saveMessage}
            isLoading={isLoading}
            isSaving={isSaving}
            roomSummary={roomSummary}
            selectedConnectionRoomId={selectedConnectionRoomId}
            pendingReview={pendingReview}
            onSelectCase={selectBenchmarkImage}
            onAnalyzeCase={analyzeSelectedCase}
            onFamilyTypeChange={setFamilyType}
            onToggleFocus={toggleFocus}
            onUpdateEditable={updateEditable}
            onUpdateFeature={updateFeature}
            onToggleLabel={toggleLabel}
            onAddLabel={addTaxonomyLabel}
            onDeleteLabel={deleteTaxonomyLabel}
            onAddRoom={addRoom}
            onUpdateRoom={updateRoom}
            onDeleteRoom={deleteRoom}
            onToggleRoomConnection={toggleRoomConnection}
            onRegenerateBrief={regenerateBrief}
            onSave={saveBenchmarkCase}
            onResumeReview={resumeReview}
          />
        )}
      </section>
    </main>
  );
}

function PropertyArchiveShelf(props: {
  records: PropertyRecordSummary[];
  activeRecordId: string | null;
  title: string;
  canSave: boolean;
  onTitleChange: (value: string) => void;
  onOpen: (id: string) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="record-shelf" aria-label="本地户型档案">
      <div className="record-shelf-head">
        <div>
          <p className="eyebrow">Local Floorplan Library</p>
          <h2>本地户型档案</h2>
        </div>
        {props.canSave && (
          <div className="active-record-editor">
            <input value={props.title} onChange={(event) => props.onTitleChange(event.target.value)} aria-label="当前档案名称" />
            <button type="button" onClick={props.onSave}><Save size={15} />保存当前修改</button>
          </div>
        )}
      </div>
      {props.records.length ? (
        <div className="record-card-list">
          {props.records.map((record) => (
            <article key={record.id} className={record.id === props.activeRecordId ? "record-card active" : "record-card"}>
              <button className="record-open" type="button" onClick={() => props.onOpen(record.id)}>
                <strong>{record.title}</strong>
                <span>{record.layoutType || "待确认户型"} · {record.area || "面积待确认"}</span>
                <small>{record.roomCount} 个空间 · {record.scriptCount} 个脚本方案</small>
              </button>
              <button className="record-delete" type="button" aria-label={`删除${record.title}`} onClick={() => props.onDelete(record.id)}>
                <Trash2 size={14} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="record-empty">首次识图完成后会自动保存在这里。</p>
      )}
    </section>
  );
}

function BriefMode(props: {
  uploadedImage: UploadedImage | null;
  propertyArea: string;
  propertyFacts: PropertyFacts;
  manualHighlightsText: string;
  result: AnalyzeResponse | null;
  activeRecord: PropertyRecord | null;
  editable: RecognizedFloorplan | null;
  error: string;
  isLoading: boolean;
  canSubmit: boolean;
  roomSummary: string;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPropertyAreaChange: (value: string) => void;
  onPropertyFactsChange: (patch: Partial<PropertyFacts>) => void;
  onManualHighlightsChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onRecordRefresh: () => void;
}) {
  return (
    <>
      <form className="input-panel" onSubmit={props.onSubmit}>
        <UploadBox uploadedImage={props.uploadedImage} onImageChange={props.onImageChange} />
        <div className="property-facts-grid">
          <label className="field">
            <span>小区名称</span>
            <input value={props.propertyFacts.community} onChange={(event) => props.onPropertyFactsChange({ community: event.target.value })} placeholder="例如：滨江花园" />
          </label>
          <label className="field">
            <span>城市</span>
            <input value={props.propertyFacts.city} onChange={(event) => props.onPropertyFactsChange({ city: event.target.value })} placeholder="例如：上海" />
          </label>
          <label className="field">
            <span>板块 / 区域</span>
            <input value={props.propertyFacts.district} onChange={(event) => props.onPropertyFactsChange({ district: event.target.value })} placeholder="例如：浦东金桥" />
          </label>
          <label className="field">
            <span>人工填写户型</span>
            <input value={props.propertyFacts.declaredLayout} onChange={(event) => props.onPropertyFactsChange({ declaredLayout: event.target.value })} placeholder="例如：3室2厅1卫" />
          </label>
          <label className="field">
            <span>装修情况</span>
            <input value={props.propertyFacts.decoration} onChange={(event) => props.onPropertyFactsChange({ decoration: event.target.value })} placeholder="例如：精装修、空置" />
          </label>
          <label className="field">
            <span>电梯</span>
            <input value={props.propertyFacts.elevator} onChange={(event) => props.onPropertyFactsChange({ elevator: event.target.value })} placeholder="例如：有电梯、两梯四户" />
          </label>
          <label className="field">
            <span>学区 / 学校信息</span>
            <textarea value={props.propertyFacts.schoolInfo} onChange={(event) => props.onPropertyFactsChange({ schoolInfo: event.target.value })} placeholder="未确认可留空" rows={2} />
          </label>
          <label className="field">
            <span>交通信息</span>
            <textarea value={props.propertyFacts.transitInfo} onChange={(event) => props.onPropertyFactsChange({ transitInfo: event.target.value })} placeholder="例如：距地铁站约800米" rows={2} />
          </label>
          <label className="field property-facts-wide">
            <span>周边配套</span>
            <textarea value={props.propertyFacts.amenities} onChange={(event) => props.onPropertyFactsChange({ amenities: event.target.value })} placeholder="例如：商场、医院、公园等已核实信息" rows={2} />
          </label>
        </div>
        <label className="field">
          <span>房屋面积（㎡）*</span>
          <input
            type="number"
            min="1"
            step="0.1"
            required
            value={props.propertyArea}
            onChange={(event) => props.onPropertyAreaChange(event.target.value)}
            placeholder="例如：89"
          />
          <small>面积以人工填写为准，不使用平面图估算。</small>
        </label>
        <label className="field">
          <span>人工补充亮点</span>
          <textarea
            value={props.manualHighlightsText}
            onChange={(event) => props.onManualHighlightsChange(event.target.value)}
            placeholder={"每行填写一条平面图看不出的信息\n例如：满五唯一、精装修交付、可看小区中庭"}
            rows={5}
          />
          <small>客观描述不会读取这些内容；补充版和后续讲解会标记为人工提供。</small>
        </label>
        <StatusMessages error={props.error} />
        <button className="primary-action" type="submit" disabled={!props.canSubmit}>
          {props.isLoading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          {props.isLoading ? "正在识图并生成讲解..." : "生成讲解"}
        </button>
      </form>
      <OutputPanel
        result={props.result}
        recognized={props.editable ?? props.result?.recognized ?? null}
        isLoading={props.isLoading}
        roomSummary={props.roomSummary}
      />
      {props.activeRecord && props.result?.warnings?.length ? (
        <FactConfirmationPanel
          record={props.activeRecord}
          warnings={props.result.warnings}
          onRefresh={props.onRecordRefresh}
        />
      ) : null}
      {props.activeRecord && (props.editable ?? props.result?.recognized)?.rooms?.length ? (
        <RoomVisualPanel
          recordId={props.activeRecord.id}
          rooms={(props.editable ?? props.result?.recognized)?.rooms ?? []}
          onRefresh={props.onRecordRefresh}
        />
      ) : null}
      {(props.editable ?? props.result?.recognized) && (
        <PropertyHighlightAgentPanel
          recognized={(props.editable ?? props.result?.recognized) as RecognizedFloorplan}
          propertyFacts={props.propertyFacts}
          enrichedDescription={props.result?.enrichedDescription ?? props.result?.objectiveDescription ?? ""}
          propertyRecordId={props.activeRecord?.id}
          savedScripts={props.activeRecord?.scripts ?? []}
          factConfirmations={props.activeRecord?.factConfirmations ?? []}
          onRecordRefresh={props.onRecordRefresh}
          manualHighlightsText={props.manualHighlightsText}
        />
      )}
    </>
  );
}

function FactConfirmationPanel(props: {
  record: PropertyRecord;
  warnings: string[];
  onRefresh: () => void;
}) {
  const initial = props.warnings.map((question) => {
    const saved = props.record.factConfirmations?.find((item) => item.question === question);
    return saved || { question, answer: "", source: "human_review" as const, updatedAt: null };
  });
  const [items, setItems] = useState(initial);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setItems(props.warnings.map((question) => {
      const saved = props.record.factConfirmations?.find((item) => item.question === question);
      return saved || { question, answer: "", source: "human_review" as const, updatedAt: null };
    }));
  }, [props.record.id, props.record.updatedAt, props.warnings.join("|")]);

  async function save() {
    setStatus("保存中...");
    const now = new Date().toISOString();
    const factConfirmations = items.map((item) => ({
      ...item,
      updatedAt: item.answer.trim() ? now : null
    }));
    const response = await fetch(`/api/property-records/${props.record.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factConfirmations })
    });
    if (!response.ok) {
      setStatus("保存失败");
      return;
    }
    setStatus("人工复核已保存，并会作为后续脚本信息来源");
    props.onRefresh();
  }

  return (
    <section className="fact-confirmation-panel" aria-label="待确认信息人工复核">
      <div className="highlight-agent-head">
        <div>
          <p className="eyebrow">Human Verification</p>
          <h2>待确认信息人工复核</h2>
          <p>每条补充都会保留“人工复核”来源，不会伪装成平面图或实景识别结论。</p>
        </div>
        <span className="agent-number">{items.filter((item) => item.answer.trim()).length}/{items.length}</span>
      </div>
      <div className="confirmation-list">
        {items.map((item, index) => (
          <label key={item.question} className={item.answer.trim() ? "confirmation-item completed" : "confirmation-item"}>
            <span><AlertTriangle size={15} />{item.question}</span>
            <textarea
              rows={2}
              value={item.answer}
              onChange={(event) => setItems((current) => current.map((entry, entryIndex) =>
                entryIndex === index ? { ...entry, answer: event.target.value } : entry
              ))}
              placeholder="填写现场核实、业主提供或资料确认后的客观信息"
            />
          </label>
        ))}
      </div>
      <div className="confirmation-footer">
        <small>{status}</small>
        <button type="button" onClick={save}><Save size={15} />保存人工复核</button>
      </div>
    </section>
  );
}

function RoomVisualPanel(props: {
  recordId: string;
  rooms: Room[];
  onRefresh: () => void;
}) {
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function uploadRoomPhoto(room: Room, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > maxImageSize) {
      setError("房间照片需为 jpg、png 或 webp，且不超过 8MB。");
      return;
    }
    setBusyRoomId(room.id);
    setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("图片读取失败。"));
        reader.readAsDataURL(file);
      });
      const response = await fetch(`/api/property-records/${props.recordId}/rooms/${room.id}/visual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl, imageName: file.name })
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "房间识别失败。");
      props.onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "房间识别失败。");
    } finally {
      setBusyRoomId(null);
    }
  }

  async function removeRoomPhoto(roomId: string) {
    const response = await fetch(`/api/property-records/${props.recordId}/rooms/${roomId}/visual`, { method: "DELETE" });
    if (response.ok) props.onRefresh();
  }

  return (
    <section className="room-visual-panel" aria-label="逐房实景识别">
      <div className="highlight-agent-head">
        <div>
          <p className="eyebrow">Room Reality Layer</p>
          <h2>逐房上传实景图</h2>
          <p>每个房间上传一张实景照片，识别结果会保存到户型档案，并作为后续脚本事实依据。</p>
        </div>
        <span className="agent-number">01+</span>
      </div>
      {error && <div className="error-message">{error}</div>}
      <div className="room-visual-grid">
        {props.rooms.map((room) => {
          const scriptFacts = Array.isArray(room.roomVisual?.analysis?.scriptFacts)
            ? room.roomVisual.analysis.scriptFacts
            : [];
          return (
          <article className="room-visual-card" key={room.id}>
            {room.roomVisual?.image?.dataUrl ? (
              <img src={room.roomVisual.image.dataUrl} alt={`${room.name || room.type}实景`} />
            ) : (
              <div className="room-photo-placeholder"><FileImage size={28} /><span>等待实景图</span></div>
            )}
            <div className="room-visual-body">
              <div className="room-visual-title">
                <strong>{room.name || room.type}</strong>
                <span>{room.roomVisual ? "已识别" : "未上传"}</span>
              </div>
              {room.roomVisual?.analysis?.objectiveDescription && <p>{room.roomVisual.analysis.objectiveDescription}</p>}
              {scriptFacts.length ? (
                <ul>{scriptFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
              ) : null}
              <div className="room-visual-actions">
                <label>
                  {busyRoomId === room.id ? <Loader2 className="spin" size={15} /> : <UploadCloud size={15} />}
                  {room.roomVisual ? "替换并重识别" : "上传并识别"}
                  <input type="file" accept="image/*" disabled={Boolean(busyRoomId)} onChange={(event) => uploadRoomPhoto(room, event.target.files?.[0])} />
                </label>
                {room.roomVisual && <button type="button" onClick={() => removeRoomPhoto(room.id)}><Trash2 size={14} />删除</button>}
              </div>
            </div>
          </article>
          );
        })}
      </div>
    </section>
  );
}

function PropertyHighlightAgentPanel(props: {
  variant?: "matrix" | "legacy";
  recognized: RecognizedFloorplan;
  propertyFacts: PropertyFacts;
  enrichedDescription: string;
  propertyRecordId?: string;
  savedScripts: SavedScript[];
  factConfirmations: PropertyRecord["factConfirmations"];
  onRecordRefresh: () => void;
  manualHighlightsText: string;
}) {
  const [duration, setDuration] = useState<60 | 90>(60);
  const [style, setStyle] = useState("buyer_dilemma");
  const [targetAudience, setTargetAudience] = useState("三口之家");
  const [narrativeVoice, setNarrativeVoice] = useState<"owner" | "viewer" | "abstract">("viewer");
  const [contentFocus, setContentFocus] = useState<"full_home" | "renovation" | "core_space">("full_home");
  const [scriptDirection, setScriptDirection] = useState("");
  const [result, setResult] = useState<PropertyScriptResult | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [scriptName, setScriptName] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [refinementInstruction, setRefinementInstruction] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [showCaseDialog, setShowCaseDialog] = useState(false);
  const [caseForm, setCaseForm] = useState({
    title: "",
    applicableTags: "",
    highlightTags: "",
    notes: ""
  });
  const [isAddingCase, setIsAddingCase] = useState(false);

  async function startAgent() {
    if (isRunning) return;
    setIsRunning(true);
    setError("");
    setResult(null);
    setStatus("正在生成故事线旁白，并按户型真实动线编排镜头...");
    try {
      const isLegacy = props.variant === "legacy";
      const response = await fetch(isLegacy ? "/api/script-agent/legacy/generate" : "/api/script-agent/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duration,
          ...(isLegacy ? { style, scriptVariant: "legacy" } : {
            scriptVariant: "matrix",
            targetAudience,
            narrativeVoice,
            contentFocus,
            scriptDirection
          }),
          floorplanAnalysis: {
            schemaVersion: "floorplan-analysis/v1",
            ...props.recognized
          },
          property: props.propertyFacts,
          enrichedDescription: props.enrichedDescription,
          propertyRecordId: props.propertyRecordId,
          factConfirmations: props.factConfirmations,
          manualHighlights: linesToArray(props.manualHighlightsText)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "脚本 Agent 启动失败。");
      setResult(data as PropertyScriptResult);
      setActiveScriptId(data.scriptId || null);
      setScriptName(data.scriptName || "");
      setIsDirty(false);
      props.onRecordRefresh();
      setStatus("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "脚本 Agent 启动失败。");
      setStatus("");
    } finally {
      setIsRunning(false);
    }
  }

  function loadSavedScript(script: SavedScript) {
    if (isDirty && !window.confirm("当前修改尚未保存，确定切换方案吗？")) return;
    setResult({
      ...script.result,
      scenes: script.result.scenes.map((scene) => {
        const legacy = scene as typeof scene & {
          shots?: Array<typeof scene.shot>;
          syncNarration?: string;
          narration?: string;
        };
        const { shots, syncNarration, narration, ...cleanScene } = legacy;
        return {
          ...cleanScene,
          shot: scene.shot || shots?.[0] || {
          framing: "全景",
          cameraMove: `从${scene.space}入口稳定前推，呈现空间全貌`,
          focus: "空间关系",
          note: ""
          }
        };
      }),
      scriptId: script.id,
      scriptName: script.name
    });
    setActiveScriptId(script.id);
    setScriptName(script.name);
    setRefinementInstruction("");
    setIsDirty(false);
    setStatus("");
  }

  async function saveScript() {
    if (!props.propertyRecordId || !activeScriptId || !result) return;
    const response = await fetch(`/api/property-records/${props.propertyRecordId}/scripts/${activeScriptId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: scriptName,
        result: {
          ...result,
          voiceover: result.scenes.map((scene) => scene.storyVoiceover).filter(Boolean).join("\n")
        }
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "保存脚本失败。");
      return;
    }
    setScriptName(data.name);
    setResult(data.result);
    setIsDirty(false);
    setStatus("脚本修改已保存");
    props.onRecordRefresh();
  }

  function exportVoiceoverSrt() {
    if (!result) return;
    const content = buildSrtFromScript(result);
    if (!content.trim()) {
      setError("当前脚本没有可导出的旁白内容。");
      return;
    }
    const baseName = safeDownloadName(scriptName || result.scriptName || result.styleLabel || "房源视频脚本", "房源视频脚本");
    downloadTextFile(`${baseName}.srt`, content, "application/x-subrip;charset=utf-8");
    setStatus("旁白字幕已导出为 SRT 文件");
  }

  async function deleteScript(scriptId: string) {
    if (!props.propertyRecordId || (activeScriptId === scriptId && isDirty && !window.confirm("该方案还有未保存修改，确定删除吗？")) || !window.confirm("确定删除这个脚本方案吗？")) return;
    const response = await fetch(`/api/property-records/${props.propertyRecordId}/scripts/${scriptId}`, { method: "DELETE" });
    if (!response.ok) return;
    if (activeScriptId === scriptId) {
      setActiveScriptId(null);
      setScriptName("");
      setResult(null);
    }
    props.onRecordRefresh();
  }

  function updateScene(sceneNumber: number, patch: Partial<PropertyScriptResult["scenes"][number]>) {
    setIsDirty(true);
    setResult((current) => current ? {
      ...current,
      scenes: current.scenes.map((scene) => scene.sceneNumber === sceneNumber ? { ...scene, ...patch } : scene)
    } : current);
  }

  function updateShot(sceneNumber: number, patch: Partial<PropertyScriptResult["scenes"][number]["shot"]>) {
    setIsDirty(true);
    setResult((current) => current ? {
      ...current,
      scenes: current.scenes.map((scene) => scene.sceneNumber === sceneNumber ? {
        ...scene,
        shot: { ...scene.shot, ...patch }
      } : scene)
    } : current);
  }

  async function refineScript() {
    if (!props.propertyRecordId || !activeScriptId || !refinementInstruction.trim() || isRefining) return;
    if (isDirty && !window.confirm("润色将以最近一次保存的内容为基础。当前修改尚未保存，是否继续？")) return;
    setIsRefining(true);
    setError("");
    setStatus("正在理解润色方向，并联动重写口播与运镜...");
    try {
      const response = await fetch(`/api/property-records/${props.propertyRecordId}/scripts/${activeScriptId}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: refinementInstruction.trim() })
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "二次润色失败。");
      setResult({ ...data.result, scriptId: data.id, scriptName: data.name });
      setActiveScriptId(data.id);
      setScriptName(data.name);
      setRefinementInstruction("");
      setIsDirty(false);
      setStatus("新版本已生成并保存，原方案仍保留");
      props.onRecordRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "二次润色失败。");
      setStatus("");
    } finally {
      setIsRefining(false);
    }
  }

  function openCaseDialog() {
    setCaseForm({
      title: scriptName,
      applicableTags: props.recognized.layoutType || "",
      highlightTags: linesToArray(props.manualHighlightsText).join("，"),
      notes: ""
    });
    setShowCaseDialog(true);
  }

  async function addToCaseLibrary(event: FormEvent) {
    event.preventDefault();
    if (!props.propertyRecordId || !activeScriptId || isAddingCase) return;
    setIsAddingCase(true);
    setError("");
    try {
      const response = await fetch(`/api/property-records/${props.propertyRecordId}/scripts/${activeScriptId}/skill-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(caseForm)
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "加入 Skill 案例库失败。");
      setShowCaseDialog(false);
      setStatus(`已沉淀到 Skill 案例库：${data.title}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加入 Skill 案例库失败。");
    } finally {
      setIsAddingCase(false);
    }
  }

  const activeSavedScript = props.savedScripts.find((script) => script.id === activeScriptId);
  const parentScript = activeSavedScript?.derivedFromScriptId
    ? props.savedScripts.find((script) => script.id === activeSavedScript.derivedFromScriptId)
    : null;
  const isLegacy = props.variant === "legacy";

  return (
    <section className="highlight-agent-panel" aria-label={isLegacy ? "稳定版房源视频脚本生成 Agent" : "内容矩阵房源视频脚本生成 Agent"}>
      <div className="highlight-agent-head">
        <div>
          <p className="eyebrow">{isLegacy ? "Legacy Voiceover × Shotlist" : "Content Matrix Voiceover × Shotlist"}</p>
          <h2>{isLegacy ? "稳定版房源视频脚本生成 Agent" : "内容矩阵脚本生成 Agent"}</h2>
          <p>{isLegacy ? "保留当前稳定版 skill 与案例库，适合需要回退或对照时使用。" : "按目标客户、口吻和讲解重点交叉生成，人工亮点会决定更细的展开方向。"}</p>
        </div>
        <span className="agent-number">02</span>
      </div>

      <div className="script-controls">
        {!isLegacy && (
          <>
            <label className="field">
              <span>目标客户</span>
              <input value={targetAudience} onChange={(event) => setTargetAudience(event.target.value)} placeholder="例如：三口之家" />
            </label>
            <label className="field">
              <span>叙事口吻</span>
              <select value={narrativeVoice} onChange={(event) => setNarrativeVoice(event.target.value as "owner" | "viewer" | "abstract")}>
                <option value="owner">业主口吻</option>
                <option value="viewer">看房人口吻</option>
                <option value="abstract">抽象口吻</option>
              </select>
            </label>
            <label className="field">
              <span>讲解重点</span>
              <select value={contentFocus} onChange={(event) => setContentFocus(event.target.value as "full_home" | "renovation" | "core_space")}>
                <option value="full_home">全屋讲解</option>
                <option value="renovation">改造/装修</option>
                <option value="core_space">核心空间</option>
              </select>
            </label>
            <label className="field property-facts-wide">
              <span>本条脚本希望侧重讲解的部分（可选）</span>
              <textarea
                value={scriptDirection}
                onChange={(event) => setScriptDirection(event.target.value)}
                placeholder="例如：多讲孩子上学和儿童房；重点突出衣帽间改造；用更抽象的爽感讲客厅和阳台。留空则按矩阵和人工亮点自动生成。"
                rows={3}
              />
              <small>这是创作方向，不会覆盖已确认房源事实；人工补充亮点仍是事实来源。</small>
            </label>
          </>
        )}
        <label className="field">
          <span>成片时长</span>
          <select value={duration} onChange={(event) => setDuration(Number(event.target.value) as 60 | 90)}>
            <option value={60}>约 60 秒</option>
            <option value={90}>约 90 秒</option>
          </select>
        </label>
        {isLegacy && (
          <label className="field">
            <span>故事风格模板</span>
            <select value={style} onChange={(event) => setStyle(event.target.value)}>
              <option value="local_highlight">局部亮点型</option>
              <option value="renovation_ready">装修省心型</option>
              <option value="owner_story">业主个人叙述型</option>
              <option value="buyer_dilemma">看房人纠结型</option>
              <option value="playful">搞笑抽象互动型</option>
            </select>
          </label>
        )}
      </div>

      <button className="primary-action" type="button" disabled={isRunning} onClick={startAgent}>
        {isRunning ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
        {isRunning ? "正在生成旁白与运镜..." : "生成视频脚本"}
      </button>

      {props.savedScripts.length > 0 && (
        <div className="saved-script-strip">
          <span>已保存方案</span>
          {props.savedScripts.map((script) => (
            <div key={script.id} className={script.id === activeScriptId ? "saved-script active" : "saved-script"}>
              <button type="button" onClick={() => loadSavedScript(script)}>{script.name}</button>
              <button type="button" aria-label={`删除${script.name}`} onClick={() => deleteScript(script.id)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {status && <div className="agent-status"><Loader2 className="spin" size={16} />{status}</div>}
      {error && <div className="error-message">{error}</div>}

      {result && (
        <div className="highlight-results script-results">
          {activeScriptId && (
            <div className="script-record-editor">
              <div className="version-identity">
                <input value={scriptName} onChange={(event) => { setScriptName(event.target.value); setIsDirty(true); }} aria-label="脚本方案名称" />
                <small>{parentScript ? `源自：${parentScript.name}` : "初始生成方案"}{isDirty ? " · 有未保存修改" : " · 已保存"}</small>
              </div>
              <button type="button" className="case-action" onClick={openCaseDialog}><BookOpen size={15} />加入 Skill 案例库</button>
              <button type="button" className="case-action" onClick={exportVoiceoverSrt}><Download size={15} />导出 SRT 字幕</button>
              <button type="button" onClick={saveScript} disabled={!isDirty}><Save size={15} />保存脚本修改</button>
            </div>
          )}
          {activeScriptId && (
            <div className="refinement-workbench">
              <div className="refinement-copy">
                <span>二次润色</span>
                <small>保留当前方案，生成一个可独立编辑的新版本</small>
              </div>
              <textarea
                value={refinementInstruction}
                onChange={(event) => setRefinementInstruction(event.target.value)}
                placeholder="例如：开头更有冲突感，减少销售话术，加强一家三口入住后的生活画面。"
                rows={3}
                disabled={isRefining}
              />
              <button type="button" onClick={refineScript} disabled={isRefining || !refinementInstruction.trim()}>
                {isRefining ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
                {isRefining ? "正在润色..." : "生成新版本"}
              </button>
            </div>
          )}
          <div className="provider-row">
            <span>内容模型：{result.provider}</span>
            <span>时长：{result.duration} 秒</span>
            <span>风格：{result.styleLabel}</span>
          </div>

          {result.generationTrace && <article className="brief-card generation-trace-card">
            <div className="card-title"><Database size={18} /><h2>本次口播参考来源</h2></div>
            <div className="trace-grid">
              {result.generationTrace.matrixSelection && (
                <div>
                  <strong>矩阵选择</strong>
                  <span>{result.generationTrace.matrixSelection.targetAudience}</span>
                  <small>{result.generationTrace.matrixSelection.narrativeVoiceLabel} · {result.generationTrace.matrixSelection.contentFocusLabel}</small>
                  {result.generationTrace.matrixSelection.scriptDirection && (
                    <small>侧重：{result.generationTrace.matrixSelection.scriptDirection}</small>
                  )}
                </div>
              )}
              <div>
                <strong>Skill 规则</strong>
                <span>{result.generationTrace.skill.path}</span>
                <small>更新于 {new Date(result.generationTrace.skill.modifiedAt).toLocaleString()} · {result.generationTrace.skill.sha256}</small>
              </div>
              <div>
                <strong>风格参考</strong>
                <span>{result.generationTrace.reference.path}</span>
                <small>{result.generationTrace.selectedStyleSection} · {result.generationTrace.reference.sha256}</small>
              </div>
            </div>
            {result.generationTrace.manualHighlights.length > 0 && (
              <div className="trace-highlight-list">
                {result.generationTrace.manualHighlights.map((item) => (
                  <span key={item.highlight} className={item.included ? "included" : "missing"}>
                    {item.included ? "已覆盖" : "遗漏"} · {item.highlight}
                  </span>
                ))}
              </div>
            )}
            {result.generationTrace.matchedCases && result.generationTrace.matchedCases.length > 0 && (
              <div className="matched-case-list">
                <strong>本次参考案例</strong>
                {result.generationTrace.matchedCases.map((item) => <span key={item.caseId}>{item.title}</span>)}
              </div>
            )}
          </article>}

          <article className="brief-card shotlist-card">
            <div className="card-title"><FileImage size={18} /><h2>旁白 × 运镜完整脚本</h2></div>
            <label className="script-positioning-editor">
              <span>故事线定位</span>
              <textarea
                value={result.storyPositioning}
                onChange={(event) => {
                  setResult((current) => current ? { ...current, storyPositioning: event.target.value } : current);
                  setIsDirty(true);
                }}
                rows={2}
              />
            </label>
            <div className="shot-table-wrap">
              <table className="shot-table">
                <thead><tr><th>#</th><th>时长</th><th>空间</th><th>口播故事</th><th>运镜方案</th></tr></thead>
                <tbody>
                  {result.scenes.map((scene) => (
                    <tr key={scene.roomId}>
                      <td>{scene.sceneNumber}</td>
                      <td>{scene.durationSeconds} 秒</td>
                      <td><strong>{scene.space}</strong></td>
                      <td className="scene-narration">
                        <div className="story-voiceover-segment">
                          <b>口播故事</b>
                          <textarea value={scene.storyVoiceover || ""} onChange={(event) => updateScene(scene.sceneNumber, {
                            storyVoiceover: event.target.value
                          })} rows={5} />
                        </div>
                      </td>
                      <td>
                        <div className="camera-plan-list">
                          <div>
                            <input value={scene.shot.framing} onChange={(event) => updateShot(scene.sceneNumber, { framing: event.target.value })} aria-label={`${scene.space}景别`} />
                            <textarea value={scene.shot.cameraMove} onChange={(event) => updateShot(scene.sceneNumber, { cameraMove: event.target.value })} rows={3} />
                            <input value={scene.shot.focus} onChange={(event) => updateShot(scene.sceneNumber, { focus: event.target.value })} aria-label={`${scene.space}镜头重点`} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          {[...result.pendingConfirmations, ...result.onSiteConfirmations].length > 0 && (
            <article className="brief-card warning-card">
              <h3>现场确认项</h3>
              <div className="pending-chip-list">
                {Array.from(new Set([...result.pendingConfirmations, ...result.onSiteConfirmations])).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </article>
          )}
        </div>
      )}
      {showCaseDialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowCaseDialog(false);
        }}>
          <form className="case-dialog" role="dialog" aria-modal="true" aria-labelledby="case-dialog-title" onSubmit={addToCaseLibrary}>
            <div className="case-dialog-head">
              <div>
                <small>RESIDENTIAL STORY VOICEOVER</small>
                <h2 id="case-dialog-title">沉淀为 Skill 案例</h2>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setShowCaseDialog(false)}><X size={18} /></button>
            </div>
            <p>保存当前成稿快照。后续生成会按风格、户型和标签自动选择相关案例。</p>
            <label><span>案例标题</span><input required value={caseForm.title} onChange={(event) => setCaseForm({ ...caseForm, title: event.target.value })} /></label>
            <label><span>适用户型 / 场景标签</span><input required placeholder="三居室，改善家庭，通勤" value={caseForm.applicableTags} onChange={(event) => setCaseForm({ ...caseForm, applicableTags: event.target.value })} /></label>
            <label><span>核心亮点标签</span><input required placeholder="采光，洄游动线，收纳" value={caseForm.highlightTags} onChange={(event) => setCaseForm({ ...caseForm, highlightTags: event.target.value })} /></label>
            <label><span>案例备注</span><textarea rows={3} placeholder="记录这个案例为什么有效，以及适合如何复用。" value={caseForm.notes} onChange={(event) => setCaseForm({ ...caseForm, notes: event.target.value })} /></label>
            <div className="case-dialog-actions">
              <button type="button" onClick={() => setShowCaseDialog(false)}>取消</button>
              <button type="submit" disabled={isAddingCase}>{isAddingCase ? <Loader2 className="spin" size={16} /> : <BookOpen size={16} />}确认入库</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function BenchmarkSubModeSwitch(props: {
  subMode: "labels" | "legacyScript";
  onSubModeChange: (mode: "labels" | "legacyScript") => void;
}) {
  return (
    <div className="benchmark-submode-switch" aria-label="Benchmark 子页切换">
      <button type="button" className={props.subMode === "labels" ? "active" : ""} onClick={() => props.onSubModeChange("labels")}>
        标注台
      </button>
      <button type="button" className={props.subMode === "legacyScript" ? "active" : ""} onClick={() => props.onSubModeChange("legacyScript")}>
        稳定版脚本
      </button>
    </div>
  );
}

function StableLegacyScriptMode(props: {
  records: PropertyRecordSummary[];
  activeRecord: PropertyRecord | null;
  onOpenRecord: (id: string) => void;
  subMode: "labels" | "legacyScript";
  onSubModeChange: (mode: "labels" | "legacyScript") => void;
}) {
  const recognized = props.activeRecord?.analysis?.recognized;
  return (
    <>
      <aside className="input-panel annotator-panel">
        <BenchmarkSubModeSwitch subMode={props.subMode} onSubModeChange={props.onSubModeChange} />
        <div className="case-list">
          <h2>选择本地户型档案</h2>
          <div className="case-buttons">
            {props.records.map((record) => (
              <button
                key={record.id}
                type="button"
                className={props.activeRecord?.id === record.id ? "active" : ""}
                onClick={() => props.onOpenRecord(record.id)}
              >
                <span>{record.title}</span>
                <small>{record.layoutType || "户型待确认"} · {record.area || "面积待确认"}</small>
              </button>
            ))}
          </div>
        </div>
        {!props.records.length && <div className="empty-case">先在“讲解生成”页完成一次户型识别，本地档案会出现在这里。</div>}
      </aside>

      <section className="output-panel annotator-output">
        {props.activeRecord && recognized ? (
          <PropertyHighlightAgentPanel
            variant="legacy"
            recognized={recognized}
            propertyFacts={props.activeRecord.propertyFacts}
            enrichedDescription={props.activeRecord.analysis?.enrichedDescription ?? props.activeRecord.analysis?.objectiveDescription ?? ""}
            propertyRecordId={props.activeRecord.id}
            savedScripts={props.activeRecord.scripts ?? []}
            factConfirmations={props.activeRecord.factConfirmations ?? []}
            onRecordRefresh={() => props.onOpenRecord(props.activeRecord!.id)}
            manualHighlightsText={(props.activeRecord.manualHighlights ?? []).join("\n")}
          />
        ) : (
          <div className="empty-result">
            <Database size={36} />
            <h2>稳定版脚本入口</h2>
            <p>选择左侧已保存户型档案后，可以继续使用旧版稳定 Agent 生成脚本。</p>
          </div>
        )}
      </section>
    </>
  );
}

function AnnotationMode(props: {
  subMode: "labels" | "legacyScript";
  onSubModeChange: (mode: "labels" | "legacyScript") => void;
  records: PropertyRecordSummary[];
  activeRecord: PropertyRecord | null;
  onOpenRecord: (id: string) => void;
  images: BenchmarkImage[];
  selectedCase: BenchmarkImage | null;
  familyType: string;
  focusTags: string[];
  result: AnalyzeResponse | null;
  editable: RecognizedFloorplan | null;
  taxonomy: LabelTaxonomy;
  error: string;
  saveMessage: string;
  isLoading: boolean;
  isSaving: boolean;
  roomSummary: string;
  selectedConnectionRoomId: string | null;
  pendingReview: PendingReview | null;
  onSelectCase: (image: BenchmarkImage) => void;
  onAnalyzeCase: () => void;
  onFamilyTypeChange: (value: string) => void;
  onToggleFocus: (tag: string) => void;
  onUpdateEditable: (patch: Partial<RecognizedFloorplan>) => void;
  onUpdateFeature: (key: string, value: string) => void;
  onToggleLabel: (section: LabelSection, id: string) => void;
  onAddLabel: (section: LabelSection, label: string) => void;
  onDeleteLabel: (section: LabelSection, id: string) => void;
  onAddRoom: () => void;
  onUpdateRoom: (roomId: string, patch: Partial<Room>) => void;
  onDeleteRoom: (roomId: string) => void;
  onToggleRoomConnection: (roomId: string) => void;
  onRegenerateBrief: () => void;
  onSave: () => void;
  onResumeReview: (action: "edit" | "approve") => void;
}) {
  if (props.subMode === "legacyScript") {
    return (
      <StableLegacyScriptMode
        records={props.records}
        activeRecord={props.activeRecord}
        onOpenRecord={props.onOpenRecord}
        subMode={props.subMode}
        onSubModeChange={props.onSubModeChange}
      />
    );
  }

  return (
    <>
      <aside className="input-panel annotator-panel">
        <BenchmarkSubModeSwitch subMode={props.subMode} onSubModeChange={props.onSubModeChange} />
        <div className="case-list">
          <h2>选择 case</h2>
          <div className="case-buttons">
            {props.images.map((image) => (
              <button
                key={image.id}
                type="button"
                className={props.selectedCase?.id === image.id ? "active" : ""}
                onClick={() => props.onSelectCase(image)}
              >
                <span>{image.id}</span>
                {image.reviewed && <b>已标</b>}
              </button>
            ))}
          </div>
        </div>

        {props.selectedCase ? (
          <div className="case-preview">
            <img src={`/api/benchmark-image/${props.selectedCase.fileName}`} alt={`${props.selectedCase.id} 户型图`} />
            <p>{props.selectedCase.fileName}</p>
          </div>
        ) : (
          <div className="empty-case">请选择一个 case 开始标注。</div>
        )}

        <ControlFields
          familyType={props.familyType}
          focusTags={props.focusTags}
          onFamilyTypeChange={props.onFamilyTypeChange}
          onToggleFocus={props.onToggleFocus}
        />

        <StatusMessages error={props.error} message={props.saveMessage} />

        <button className="primary-action" type="button" disabled={!props.selectedCase || props.isLoading} onClick={props.onAnalyzeCase}>
          {props.isLoading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          {props.isLoading ? "正在识图..." : "AI 识图填充"}
        </button>
      </aside>

      <section className="output-panel annotator-output">
        {props.editable ? (
          <>
            <EditorPanel
              recognized={props.editable}
              taxonomy={props.taxonomy}
              selectedConnectionRoomId={props.selectedConnectionRoomId}
              onUpdateEditable={props.onUpdateEditable}
              onUpdateFeature={props.onUpdateFeature}
              onToggleLabel={props.onToggleLabel}
              onAddLabel={props.onAddLabel}
              onDeleteLabel={props.onDeleteLabel}
              onAddRoom={props.onAddRoom}
              onUpdateRoom={props.onUpdateRoom}
              onDeleteRoom={props.onDeleteRoom}
              onToggleRoomConnection={props.onToggleRoomConnection}
            />
            <div className="annotation-actions">
              {props.pendingReview && (
                <>
                  <button type="button" onClick={() => props.onResumeReview("edit")} disabled={props.isLoading}>
                    {props.isLoading ? <Loader2 className="spin" size={16} /> : <BadgeCheck size={16} />}
                    提交修正并继续
                  </button>
                  {props.pendingReview.review.stage === "highlights" && (
                    <button type="button" onClick={() => props.onResumeReview("approve")} disabled={props.isLoading}>
                      人工确认保留
                    </button>
                  )}
                </>
              )}
              <button type="button" onClick={props.onRegenerateBrief} disabled={props.isLoading}>
                {props.isLoading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                重新生成讲解
              </button>
              <button type="button" onClick={props.onSave} disabled={!props.selectedCase || props.isSaving}>
                {props.isSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                保存为 Benchmark
              </button>
            </div>
            <OutputPanel
              result={props.result}
              recognized={props.editable}
              isLoading={false}
              roomSummary={props.roomSummary}
              compact
            />
          </>
        ) : (
          <div className="empty-result">
            <Database size={36} />
            <h2>等待标注</h2>
            <p>选择左侧 case 后可以加载已保存稿，或点击 AI 识图填充，再用标准标签快速校正并保存。</p>
          </div>
        )}
      </section>
    </>
  );
}

function UploadBox(props: {
  uploadedImage: UploadedImage | null;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className={`upload-zone ${props.uploadedImage ? "has-image" : ""}`}>
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={props.onImageChange} />
      {props.uploadedImage ? (
        <>
          <img src={props.uploadedImage.dataUrl} alt="已上传户型图预览" />
          <span className="file-badge">
            <FileImage size={16} />
            {props.uploadedImage.name} · {formatSize(props.uploadedImage.size)}
          </span>
        </>
      ) : (
        <span className="upload-empty">
          <UploadCloud size={34} />
          <strong>上传平面图</strong>
          <small>支持 jpg / png / webp，建议 8MB 内</small>
        </span>
      )}
    </label>
  );
}

function ControlFields(props: {
  familyType: string;
  focusTags: string[];
  onFamilyTypeChange: (value: string) => void;
  onToggleFocus: (tag: string) => void;
}) {
  return (
    <>
      <label className="field">
        <span>家庭类型</span>
        <input
          value={props.familyType}
          onChange={(event) => props.onFamilyTypeChange(event.target.value)}
          placeholder="年轻家庭"
        />
      </label>

      <fieldset className="focus-field">
        <legend>关注点</legend>
        <div className="focus-tags">
          {focusOptions.map((tag) => (
            <button
              key={tag}
              type="button"
              className={props.focusTags.includes(tag) ? "selected" : ""}
              onClick={() => props.onToggleFocus(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}

function StatusMessages(props: { error?: string; message?: string }) {
  return (
    <>
      {props.error && (
        <div className="error-box" role="alert">
          <AlertTriangle size={18} />
          <span>{props.error}</span>
        </div>
      )}
      {props.message && <div className="success-box">{props.message}</div>}
    </>
  );
}

function EditorPanel(props: {
  recognized: RecognizedFloorplan;
  taxonomy: LabelTaxonomy;
  selectedConnectionRoomId: string | null;
  onUpdateEditable: (patch: Partial<RecognizedFloorplan>) => void;
  onUpdateFeature: (key: string, value: string) => void;
  onToggleLabel: (section: LabelSection, id: string) => void;
  onAddLabel: (section: LabelSection, label: string) => void;
  onDeleteLabel: (section: LabelSection, id: string) => void;
  onAddRoom: () => void;
  onUpdateRoom: (roomId: string, patch: Partial<Room>) => void;
  onDeleteRoom: (roomId: string) => void;
  onToggleRoomConnection: (roomId: string) => void;
}) {
  return (
    <article className="editor-panel">
      <div className="recognition-head">
        <h2>识图结果校正</h2>
        <p>标签、房间和连接关系都可以在这里校准，保存后会写入 benchmark。</p>
      </div>
      <div className="edit-grid">
        <label className="field">
          <span>户型</span>
          <input
            value={props.recognized.layoutType ?? ""}
            onChange={(event) => props.onUpdateEditable({ layoutType: event.target.value })}
          />
        </label>
        <label className="field">
          <span>面积</span>
          <input
            value={props.recognized.area ?? ""}
            onChange={(event) => props.onUpdateEditable({ area: event.target.value })}
          />
        </label>
        <label className="field">
          <span>朝向</span>
          <input
            value={props.recognized.orientation ?? ""}
            onChange={(event) => props.onUpdateEditable({ orientation: event.target.value })}
          />
        </label>
      </div>

      <div className="feature-editor">
        <h3>专业判断</h3>
        {Object.entries(featureOptions).map(([key, values]) => (
          <label key={key}>
            <span>{key}</span>
            <select
              value={String(props.recognized.features?.[key] ?? "unknown")}
              onChange={(event) => props.onUpdateFeature(key, event.target.value)}
            >
              {values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <LabelSelector
        title="核心卖点 pros"
        section="pros"
        taxonomy={props.taxonomy}
        selected={props.recognized.pros ?? []}
        onToggle={props.onToggleLabel}
        onAdd={props.onAddLabel}
        onDelete={props.onDeleteLabel}
      />
      <LabelSelector
        title="短板 cons"
        section="cons"
        taxonomy={props.taxonomy}
        selected={props.recognized.cons ?? []}
        onToggle={props.onToggleLabel}
        onAdd={props.onAddLabel}
        onDelete={props.onDeleteLabel}
      />
      <LabelSelector
        title="适合人群 suitableFor"
        section="suitableFor"
        taxonomy={props.taxonomy}
        selected={props.recognized.suitableFor ?? []}
        onToggle={props.onToggleLabel}
        onAdd={props.onAddLabel}
        onDelete={props.onDeleteLabel}
      />

      <div className="edit-grid">
        <label className="field">
          <span>unknowns</span>
          <textarea
            value={arrayToLines(props.recognized.unknowns)}
            onChange={(event) => props.onUpdateEditable({ unknowns: linesToArray(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>needsReview</span>
          <textarea
            value={arrayToLines(props.recognized.needsReview)}
            onChange={(event) => props.onUpdateEditable({ needsReview: linesToArray(event.target.value) })}
          />
        </label>
      </div>

      <RoomConnectionGraph
        rooms={props.recognized.rooms ?? []}
        selectedRoomId={props.selectedConnectionRoomId}
        onAddRoom={props.onAddRoom}
        onUpdateRoom={props.onUpdateRoom}
        onDeleteRoom={props.onDeleteRoom}
        onToggleConnection={props.onToggleRoomConnection}
      />
    </article>
  );
}

function LabelSelector(props: {
  title: string;
  section: LabelSection;
  taxonomy: LabelTaxonomy;
  selected: string[];
  onToggle: (section: LabelSection, id: string) => void;
  onAdd: (section: LabelSection, label: string) => void;
  onDelete: (section: LabelSection, id: string) => void;
}) {
  const [draftLabel, setDraftLabel] = useState("");

  function submitNewLabel(event: FormEvent) {
    event.preventDefault();
    const label = draftLabel.trim();
    if (!label) return;
    props.onAdd(props.section, label);
    setDraftLabel("");
  }

  return (
    <div className="label-selector">
      <div className="label-admin">
        <h3>{props.title}</h3>
        <form className="label-add" onSubmit={submitNewLabel}>
          <input
            value={draftLabel}
            onChange={(event) => setDraftLabel(event.target.value)}
            placeholder="新增标准标签"
          />
          <button type="submit" aria-label={`新增 ${props.title} 标签`}>
            <Plus size={15} />
          </button>
        </form>
      </div>
      <div className="label-grid">
        {props.taxonomy[props.section].map((item) => (
          <div key={item.id} className={`label-card ${props.selected.includes(item.id) ? "selected" : ""}`}>
            <button type="button" className="label-pick" onClick={() => props.onToggle(props.section, item.id)}>
              <b>{item.label}</b>
              <span>{item.id}</span>
            </button>
            <button
              type="button"
              className="label-delete"
              aria-label={`删除标签 ${item.label}`}
              onClick={() => props.onDelete(props.section, item.id)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoomConnectionGraph(props: {
  rooms: Room[];
  selectedRoomId: string | null;
  onAddRoom: () => void;
  onUpdateRoom: (roomId: string, patch: Partial<Room>) => void;
  onDeleteRoom: (roomId: string) => void;
  onToggleConnection: (roomId: string) => void;
}) {
  const rooms = props.rooms.filter((room) => room.id);
  const nodePositions = rooms.map((room, index) => {
    const count = Math.max(rooms.length, 1);
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const radius = rooms.length <= 4 ? 30 : 38;
    return {
      room,
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius
    };
  });
  const byId = new Map(nodePositions.map((node) => [node.room.id, node]));
  const edges = new Map<string, { from: string; to: string }>();

  for (const room of rooms) {
    for (const targetId of room.connectedTo ?? []) {
      if (!byId.has(targetId)) continue;
      const key = [room.id, targetId].sort().join("--");
      edges.set(key, { from: room.id, to: targetId });
    }
  }

  return (
    <div className="connection-editor">
      <div className="connection-head">
        <div>
          <h3>房间连接关系</h3>
          <p>
            {props.selectedRoomId
              ? `已选中：${byId.get(props.selectedRoomId)?.room.name || props.selectedRoomId}，再点一个房间建立/取消连接`
              : "点击两个房间建立或取消连接"}
          </p>
        </div>
        <div className="connection-actions">
          <span>{edges.size} 条连接</span>
          <button type="button" onClick={props.onAddRoom}>
            <Plus size={15} />
            新增房间
          </button>
        </div>
      </div>

      <div className="connection-canvas">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {[...edges.values()].map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {nodePositions.map((node) => {
          const selected = props.selectedRoomId === node.room.id;
          return (
            <button
              key={node.room.id}
              type="button"
              className={`room-node ${selected ? "selected" : ""} room-${node.room.type || "unknown"}`}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
              onClick={() => props.onToggleConnection(node.room.id)}
            >
              <strong>{node.room.name || node.room.type}</strong>
              <span>{node.room.type}</span>
            </button>
          );
        })}
      </div>

      <div className="connection-list">
        {rooms.map((room) => (
          <div key={room.id} className="room-edit-row">
            <div className="room-edit-title">
              <b>{room.id}</b>
              <button type="button" aria-label={`删除 ${room.name || room.id}`} onClick={() => props.onDeleteRoom(room.id)}>
                <Trash2 size={14} />
              </button>
            </div>
            <div className="room-edit-fields">
              <label>
                <span>名称</span>
                <input
                  value={room.name ?? ""}
                  onChange={(event) => props.onUpdateRoom(room.id, { name: event.target.value })}
                />
              </label>
              <label>
                <span>类型</span>
                <select value={room.type || "unknown"} onChange={(event) => props.onUpdateRoom(room.id, { type: event.target.value })}>
                  {roomTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>位置</span>
                <input
                  value={room.position ?? ""}
                  onChange={(event) => props.onUpdateRoom(room.id, { position: event.target.value })}
                />
              </label>
              <label>
                <span>采光</span>
                <select value={room.light || "unknown"} onChange={(event) => props.onUpdateRoom(room.id, { light: event.target.value })}>
                  {roomLightOptions.map((light) => (
                    <option key={light} value={light}>
                      {light}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>窗</span>
                <select
                  value={room.hasWindow === true ? "true" : room.hasWindow === false ? "false" : "unknown"}
                  onChange={(event) =>
                    props.onUpdateRoom(room.id, {
                      hasWindow:
                        event.target.value === "unknown"
                          ? "unknown"
                          : event.target.value === "true"
                    })
                  }
                >
                  <option value="true">有窗</option>
                  <option value="false">无窗</option>
                  <option value="unknown">未知</option>
                </select>
              </label>
            </div>
            <p>{(room.connectedTo ?? []).filter((id) => byId.has(id)).join("、") || "未连接"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function OutputPanel(props: {
  result: AnalyzeResponse | null;
  recognized: RecognizedFloorplan | null;
  isLoading: boolean;
  roomSummary: string;
  compact?: boolean;
}) {
  if (!props.result && !props.isLoading && !props.recognized) {
    return (
      <section className="output-panel">
        <div className="empty-result">
          <Home size={36} />
          <h2>等待户型图</h2>
          <p>上传平面图后，系统会先识别户型结构，再生成面试展示用的讲解内容。</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={[
        props.compact ? "nested-output" : "output-panel"
      ].filter(Boolean).join(" ")}
      aria-label="讲解输出"
    >
      {props.isLoading && (
        <div className="loading-card">
          <Loader2 className="spin" size={30} />
          <h2>正在完成两步分析</h2>
          <p>方舟视觉模型识别户型结构，随后 DeepSeek 生成讲解词、卖点、FAQ 和风险提示。</p>
        </div>
      )}

      {props.result && (
        <>
          <div className="provider-row">
            <span>识图：{props.result.provider.vision ?? "manual"}</span>
            <span>房源描述：{props.result.provider.description ?? "fallback"}</span>
            <span>讲解：{props.result.provider.brief}</span>
          </div>

          <div className="description-grid">
            <article className="brief-card objective-description">
              <div className="card-title">
                <Home size={18} />
                <h2>基础房源客观描述</h2>
              </div>
              <p>{props.result.objectiveDescription || "客观描述待生成。"}</p>
              <small>仅使用人工填写的房源事实与平面图识别结果。</small>
            </article>

            <article className="brief-card enriched-description">
              <div className="card-title">
                <BadgeCheck size={18} />
                <h2>加入人工补充后的描述</h2>
              </div>
              <p>{props.result.enrichedDescription || props.result.objectiveDescription || "补充描述待生成。"}</p>
              <small>人工补充内容不作为识图结论，并建议结合现场或材料核验。</small>
            </article>
          </div>

          {props.result.warnings && props.result.warnings.length > 0 && (
            <article className="brief-card pending-facts">
              <div className="card-title">
                <AlertTriangle size={18} />
                <h2>待确认信息</h2>
              </div>
              <div className="pending-chip-list">
                {props.result.warnings.map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            </article>
          )}

          {props.result.manualHighlights && props.result.manualHighlights.length > 0 && (
            <article className="brief-card">
              <div className="card-title">
                <BadgeCheck size={18} />
                <h2>人工补充亮点</h2>
              </div>
              <ul>
                {props.result.manualHighlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          )}

          <article className="brief-card hero-brief">
            <div className="card-title">
              <Sparkles size={18} />
              <h2>30秒讲解词</h2>
            </div>
            <p>{props.result.brief.talk30s}</p>
          </article>

          <div className="result-grid">
            <article className="brief-card">
              <div className="card-title">
                <BadgeCheck size={18} />
                <h2>三个核心卖点</h2>
              </div>
              <ol>
                {props.result.brief.sellingPoints.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </article>

            <article className="brief-card">
              <div className="card-title">
                <AlertTriangle size={18} />
                <h2>风险提示</h2>
              </div>
              <p>{props.result.brief.riskTip}</p>
            </article>
          </div>

          <article className="brief-card faq-card">
            <div className="card-title">
              <MessageCircleQuestion size={18} />
              <h2>三个常见问题回答</h2>
            </div>
            <div className="faq-list">
              {props.result.brief.faqs.map((faq) => (
                <div className="faq-item" key={faq.question}>
                  <strong>{faq.question}</strong>
                  <p>{faq.answer}</p>
                </div>
              ))}
            </div>
          </article>
        </>
      )}

      {props.recognized && (
        <article className="recognition-panel">
          <div className="recognition-head">
            <h2>识图结果对照</h2>
            <p>{props.roomSummary}</p>
          </div>
          <div className="metric-row">
            <span>户型：{props.recognized.layoutType || "unknown"}</span>
            <span>面积：{props.recognized.area || "unknown"}</span>
            <span>朝向：{props.recognized.orientation || "unknown"}</span>
          </div>

          <div className="facts-grid">
            <div>
              <h3>features</h3>
              {Object.entries(props.recognized.features ?? {}).map(([key, value]) => (
                <p key={key}>
                  <span>{key}</span>
                  <b>{featureText(value)}</b>
                </p>
              ))}
            </div>
            <div>
              <h3>需复核</h3>
              {[...(props.recognized.unknowns ?? []), ...(props.recognized.needsReview ?? [])].slice(0, 6).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
        </article>
      )}
    </section>
  );
}
