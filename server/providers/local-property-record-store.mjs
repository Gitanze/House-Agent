import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class LocalPropertyRecordStore {
  constructor({ directory = path.resolve(".data/property-records") } = {}) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }

  file(id) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("档案 ID 不合法");
    return path.join(this.directory, `${id}.json`);
  }

  read(id) {
    const filePath = this.file(id);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  write(record) {
    fs.writeFileSync(this.file(record.id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return record;
  }

  list() {
    return fs.readdirSync(this.directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.read(name.replace(/\.json$/, "")))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ image, analysis, scripts, ...record }) => ({
        ...record,
        area: analysis?.recognized?.area || "",
        layoutType: analysis?.recognized?.layoutType || "",
        roomCount: analysis?.recognized?.rooms?.length || 0,
        scriptCount: scripts.length,
        imageName: image?.name || ""
      }));
  }

  create(payload) {
    const now = new Date().toISOString();
    const id = randomUUID();
    const record = {
      id,
      title: payload.title || payload.propertyFacts?.community || payload.image?.name || "未命名户型",
      createdAt: now,
      updatedAt: now,
      image: payload.image,
      propertyFacts: payload.propertyFacts || {},
      manualHighlights: payload.manualHighlights || [],
      factConfirmations: (payload.analysis?.warnings || []).map((question) => ({
        question,
        answer: "",
        source: "human_review",
        updatedAt: null
      })),
      analysis: payload.analysis,
      nextScriptSequence: 1,
      scripts: []
    };
    return this.write(record);
  }

  update(id, patch) {
    const current = this.read(id);
    if (!current) return null;
    const next = {
      ...current,
      ...(patch.title !== undefined ? { title: String(patch.title).trim() || current.title } : {}),
      ...(patch.propertyFacts ? { propertyFacts: patch.propertyFacts } : {}),
      ...(patch.manualHighlights ? { manualHighlights: patch.manualHighlights } : {}),
      ...(patch.factConfirmations ? { factConfirmations: patch.factConfirmations } : {}),
      ...(patch.analysis ? { analysis: { ...current.analysis, ...patch.analysis } } : {}),
      updatedAt: new Date().toISOString()
    };
    return this.write(next);
  }

  delete(id) {
    const filePath = this.file(id);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  addScript(id, script, metadata = {}) {
    const record = this.read(id);
    if (!record) return null;
    const now = new Date().toISOString();
    const sequence = record.nextScriptSequence || (
      record.scripts.reduce((max, item) => {
        const match = item.name?.match(/^方案(\d+)-/);
        return Math.max(max, match ? Number(match[1]) : 0);
      }, 0) + 1
    );
    const baseScript = metadata.derivedFromScriptId
      ? record.scripts.find((item) => item.id === metadata.derivedFromScriptId)
      : null;
    const refinementNumber = baseScript
      ? record.scripts.filter((item) => item.derivedFromScriptId === baseScript.id).length + 1
      : 0;
    const saved = {
      id: randomUUID(),
      name: baseScript
        ? `${baseScript.name} · 润色${refinementNumber}`
        : `方案${sequence}-${script.styleLabel}-${script.duration}秒`,
      createdAt: now,
      updatedAt: now,
      result: script,
      ...(baseScript ? {
        derivedFromScriptId: baseScript.id,
        refinementInstruction: String(metadata.refinementInstruction || "").trim(),
        generationType: "refinement"
      } : {})
    };
    record.scripts.push(saved);
    record.nextScriptSequence = sequence + 1;
    record.updatedAt = now;
    this.write(record);
    return saved;
  }

  updateScript(recordId, scriptId, patch) {
    const record = this.read(recordId);
    if (!record) return null;
    const index = record.scripts.findIndex((item) => item.id === scriptId);
    if (index < 0) return null;
    record.scripts[index] = {
      ...record.scripts[index],
      ...(patch.name !== undefined ? { name: String(patch.name).trim() || record.scripts[index].name } : {}),
      ...(patch.result ? { result: patch.result } : {}),
      updatedAt: new Date().toISOString()
    };
    record.updatedAt = new Date().toISOString();
    this.write(record);
    return record.scripts[index];
  }

  deleteScript(recordId, scriptId) {
    const record = this.read(recordId);
    if (!record) return false;
    const before = record.scripts.length;
    record.scripts = record.scripts.filter((item) => item.id !== scriptId);
    if (record.scripts.length === before) return false;
    record.updatedAt = new Date().toISOString();
    this.write(record);
    return true;
  }

  setRoomVisual(recordId, roomId, roomVisual) {
    const record = this.read(recordId);
    if (!record) return null;
    const rooms = record.analysis?.recognized?.rooms || [];
    const index = rooms.findIndex((room) => room.id === roomId);
    if (index < 0) return null;
    rooms[index] = { ...rooms[index], roomVisual };
    record.analysis.recognized.rooms = rooms;
    record.updatedAt = new Date().toISOString();
    this.write(record);
    return rooms[index];
  }

  deleteRoomVisual(recordId, roomId) {
    const record = this.read(recordId);
    if (!record) return false;
    const rooms = record.analysis?.recognized?.rooms || [];
    const index = rooms.findIndex((room) => room.id === roomId);
    if (index < 0 || !rooms[index].roomVisual) return false;
    const { roomVisual, ...room } = rooms[index];
    rooms[index] = room;
    record.updatedAt = new Date().toISOString();
    this.write(record);
    return true;
  }
}
