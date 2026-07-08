export class DeepseekJsonClient {
  constructor({
    apiKey = process.env.DEEPSEEK_API_KEY,
    baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    fetchImpl = fetch
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.fetch = fetchImpl;
  }

  get available() {
    return Boolean(this.apiKey);
  }

  async generate(messages) {
    if (!this.apiKey) return null;
    const url = this.baseUrl.endsWith("/chat/completions")
      ? this.baseUrl
      : `${this.baseUrl}/chat/completions`;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retryMessages = attempt === 0
        ? messages
        : [
            ...messages,
            {
              role: "user",
              content:
                "上一次输出不是完整有效的 JSON。请重新输出完整 JSON 对象，不要使用 Markdown 代码块，不要省略或截断任何字段。"
            }
          ];
      const response = await this.fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          messages: retryMessages,
          temperature: attempt === 0 ? 0.35 : 0.1,
          max_tokens: 7000,
          response_format: { type: "json_object" }
        })
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`DeepSeek ${response.status}: ${text.slice(0, 300)}`);
      }
      const data = JSON.parse(text);
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        lastError = new Error("DeepSeek 返回内容为空");
        continue;
      }
      try {
        const clean = content
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        return JSON.parse(clean);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("DeepSeek 未返回有效 JSON");
  }
}
