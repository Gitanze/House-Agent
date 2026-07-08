import fs from "node:fs";
import path from "node:path";

function normalizeQuery(query) {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export class XhsNoteCache {
  constructor({
    filePath = ".data/xhs-note-cache.json",
    ttlMs = 7 * 24 * 60 * 60 * 1000
  } = {}) {
    this.filePath = filePath;
    this.ttlMs = ttlMs;
  }

  readAll() {
    if (!fs.existsSync(this.filePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return {};
    }
  }

  getMany(queries, now = Date.now()) {
    const data = this.readAll();
    const hits = {};
    const missing = [];
    for (const query of queries) {
      const entry = data[normalizeQuery(query)];
      if (entry && now - entry.fetchedAt <= this.ttlMs) {
        hits[query] = entry.notes || [];
      } else {
        missing.push(query);
      }
    }
    return { hits, missing };
  }

  setMany(queryNotes, now = Date.now()) {
    const data = this.readAll();
    for (const [query, notes] of Object.entries(queryNotes)) {
      data[normalizeQuery(query)] = { fetchedAt: now, notes };
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

export class MemoryXhsNoteCache {
  constructor({ ttlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.data = {};
  }

  getMany(queries, now = Date.now()) {
    const hits = {};
    const missing = [];
    for (const query of queries) {
      const entry = this.data[normalizeQuery(query)];
      if (entry && now - entry.fetchedAt <= this.ttlMs) hits[query] = entry.notes;
      else missing.push(query);
    }
    return { hits, missing };
  }

  setMany(queryNotes, now = Date.now()) {
    for (const [query, notes] of Object.entries(queryNotes)) {
      this.data[normalizeQuery(query)] = { fetchedAt: now, notes };
    }
  }
}

