const defaultBaseUrl =
  process.env.REDNOTE_BASE_URL || "http://127.0.0.1:5000";

function metric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function parsedTimestamp(value) {
  const timestamp = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function normalizeRednoteNote(item) {
  return {
    id: String(item["笔记ID"] || ""),
    title: String(item["标题"] || ""),
    body: String(item["正文摘要"] || ""),
    url: String(item["帖子链接"] || ""),
    publishedAt: parsedTimestamp(item["抓取时间"]),
    sourceKeyword: String(item["关键词"] || ""),
    author: {
      id: "",
      nickname: String(item["作者"] || "")
    },
    metrics: {
      likes: metric(item["点赞数"]),
      collections: metric(item["收藏数"]),
      comments: metric(item["评论数"]),
      shares: 0
    }
  };
}

export class RednoteProvider {
  constructor({ baseUrl = defaultBaseUrl, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  async request(path, options) {
    const response = await this.fetch(`${this.baseUrl}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.detail || `rednote ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async health() {
    try {
      const data = await this.request("/api/scrape/status");
      return {
        available: true,
        baseUrl: this.baseUrl,
        running: Boolean(data.running),
        error: data.error || null
      };
    } catch (error) {
      return {
        available: false,
        baseUrl: this.baseUrl,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async search(queries, { maxNotes = 30, timeoutMs = 10 * 60 * 1000 } = {}) {
    const health = await this.health();
    if (!health.available) {
      const error = new Error(
        "rednote 服务不可用，请先启动 rednote/app.py。"
      );
      error.code = "MEDIA_CRAWLER_UNAVAILABLE";
      throw error;
    }

    if (!health.running) {
      const pages = Math.max(1, Math.min(3, Math.ceil(maxNotes / 20)));
      await this.request("/api/scrape/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: queries.join(","),
          pages,
          batch_size: 2,
          sort_type: "popularity_descending"
        })
      });
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.request("/api/scrape/status");
      if (status.error) throw new Error(status.error);
      if (!status.running) {
        if (!status.result_file) return [];
        const rows = await this.request(
          `/api/data?file=${encodeURIComponent(status.result_file)}`
        );
        return (Array.isArray(rows) ? rows : [])
          .map(normalizeRednoteNote)
          .filter((note) => note.id);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("rednote 采集超时");
  }
}

