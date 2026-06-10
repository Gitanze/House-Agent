import {
  AlertTriangle,
  BadgeCheck,
  Database,
  FileImage,
  Home,
  Loader2,
  MessageCircleQuestion,
  Save,
  Sparkles,
  UploadCloud
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

const focusOptions = ["采光", "动线", "收纳", "儿童房", "老人房", "改造潜力"];
const maxImageSize = 8 * 1024 * 1024;
const featureOptions: Record<string, string[]> = {
  northSouthVentilation: ["true", "false", "unknown"],
  dynamicStaticZoning: ["good", "medium", "weak", "unknown"],
  kitchenDiningFlow: ["good", "medium", "weak", "unknown"],
  bathroomPressure: ["low", "medium", "high", "unknown"],
  lighting: ["good", "medium", "weak", "unknown"],
  storagePotential: ["good", "medium", "weak", "unknown"]
};

type Room = {
  id: string;
  type: string;
  name?: string;
  position?: string;
  connectedTo?: string[];
  hasWindow?: boolean;
  light?: "good" | "medium" | "weak" | "unknown" | string;
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
};

type Brief = {
  talk30s: string;
  sellingPoints: string[];
  faqs: Array<{ question: string; answer: string }>;
  riskTip: string;
};

type AnalyzeResponse = {
  provider: {
    vision?: string;
    brief: "deepseek" | "fallback";
  };
  image?: BenchmarkImage;
  recognized: RecognizedFloorplan;
  brief: Brief;
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

export function App() {
  const [mode, setMode] = useState<Mode>("brief");
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [familyType, setFamilyType] = useState("年轻家庭");
  const [focusTags, setFocusTags] = useState<string[]>(["采光", "动线", "收纳"]);
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

  const canSubmit = Boolean(uploadedImage) && !isLoading;
  const activeRecognized = editable ?? result?.recognized ?? null;
  const roomSummary = useMemo(() => {
    const rooms = activeRecognized?.rooms ?? [];
    if (!rooms.length) return "等待识图";
    return rooms.map((room) => room.name || room.type).filter(Boolean).join("、");
  }, [activeRecognized]);

  useEffect(() => {
    void loadTaxonomy();
    void loadBenchmarkImages();
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
          familyType,
          focusTags
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "户型图分析失败。");
      setResult(data as AnalyzeResponse);
      setEditable((data as AnalyzeResponse).recognized);
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
          familyType,
          focusTags
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "case 识图失败。");
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
          focusTags
        })
      });
      const data = await response.json();
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败。");
      setSaveMessage(`已保存：${data.path}`);
      await loadBenchmarkImages();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
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

        {mode === "brief" ? (
          <BriefMode
            uploadedImage={uploadedImage}
            familyType={familyType}
            focusTags={focusTags}
            result={result}
            editable={editable}
            error={error}
            isLoading={isLoading}
            canSubmit={canSubmit}
            roomSummary={roomSummary}
            onImageChange={handleImageChange}
            onFamilyTypeChange={setFamilyType}
            onToggleFocus={toggleFocus}
            onSubmit={submit}
          />
        ) : (
          <AnnotationMode
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
            onSelectCase={selectBenchmarkImage}
            onAnalyzeCase={analyzeSelectedCase}
            onFamilyTypeChange={setFamilyType}
            onToggleFocus={toggleFocus}
            onUpdateEditable={updateEditable}
            onUpdateFeature={updateFeature}
            onToggleLabel={toggleLabel}
            onToggleRoomConnection={toggleRoomConnection}
            onRegenerateBrief={regenerateBrief}
            onSave={saveBenchmarkCase}
          />
        )}
      </section>
    </main>
  );
}

function BriefMode(props: {
  uploadedImage: UploadedImage | null;
  familyType: string;
  focusTags: string[];
  result: AnalyzeResponse | null;
  editable: RecognizedFloorplan | null;
  error: string;
  isLoading: boolean;
  canSubmit: boolean;
  roomSummary: string;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFamilyTypeChange: (value: string) => void;
  onToggleFocus: (tag: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <>
      <form className="input-panel" onSubmit={props.onSubmit}>
        <UploadBox uploadedImage={props.uploadedImage} onImageChange={props.onImageChange} />
        <ControlFields
          familyType={props.familyType}
          focusTags={props.focusTags}
          onFamilyTypeChange={props.onFamilyTypeChange}
          onToggleFocus={props.onToggleFocus}
        />
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
    </>
  );
}

function AnnotationMode(props: {
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
  onSelectCase: (image: BenchmarkImage) => void;
  onAnalyzeCase: () => void;
  onFamilyTypeChange: (value: string) => void;
  onToggleFocus: (tag: string) => void;
  onUpdateEditable: (patch: Partial<RecognizedFloorplan>) => void;
  onUpdateFeature: (key: string, value: string) => void;
  onToggleLabel: (section: LabelSection, id: string) => void;
  onToggleRoomConnection: (roomId: string) => void;
  onRegenerateBrief: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <aside className="input-panel annotator-panel">
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
              onToggleRoomConnection={props.onToggleRoomConnection}
            />
            <div className="annotation-actions">
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
  onToggleRoomConnection: (roomId: string) => void;
}) {
  return (
    <article className="editor-panel">
      <div className="recognition-head">
        <h2>识图结果校正</h2>
        <p>只改标准化判断，房间列表先展示不编辑。</p>
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

      <LabelSelector title="核心卖点 pros" section="pros" taxonomy={props.taxonomy} selected={props.recognized.pros ?? []} onToggle={props.onToggleLabel} />
      <LabelSelector title="短板 cons" section="cons" taxonomy={props.taxonomy} selected={props.recognized.cons ?? []} onToggle={props.onToggleLabel} />
      <LabelSelector
        title="适合人群 suitableFor"
        section="suitableFor"
        taxonomy={props.taxonomy}
        selected={props.recognized.suitableFor ?? []}
        onToggle={props.onToggleLabel}
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
}) {
  return (
    <div className="label-selector">
      <h3>{props.title}</h3>
      <div className="label-grid">
        {props.taxonomy[props.section].map((item) => (
          <button
            key={item.id}
            type="button"
            className={props.selected.includes(item.id) ? "selected" : ""}
            onClick={() => props.onToggle(props.section, item.id)}
          >
            <b>{item.label}</b>
            <span>{item.id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RoomConnectionGraph(props: {
  rooms: Room[];
  selectedRoomId: string | null;
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
        <span>{edges.size} 条连接</span>
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
          <p key={room.id}>
            <b>{room.name || room.type}</b>
            <span>{(room.connectedTo ?? []).filter((id) => byId.has(id)).join("、") || "未连接"}</span>
          </p>
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
    <section className={props.compact ? "nested-output" : "output-panel"} aria-label="讲解输出">
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
            <span>讲解：{props.result.provider.brief}</span>
          </div>

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
