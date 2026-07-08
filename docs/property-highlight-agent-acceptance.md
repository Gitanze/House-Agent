# 房源亮点策划 Agent 验收清单

> 当前验收以本地案例库模式为准。Agent 2 点击后直接读取
> `rednote/content_data/samples.json`、自动匹配最多 3 个案例并生成口播；
> rednote 采集和关键词确认流程暂时停用。

## 1. 启动主项目

```bash
npm run dev
```

打开 `http://127.0.0.1:5173`。

## 2. Agent 1

1. 上传户型图并运行识别。
2. 确认识图结果、空间特征和原有讲解仍然显示。
3. Agent 1 结果下方应出现“Agent 2 · 房源亮点策划 Agent”。

## 3. Agent 2 基础流程

1. 填写城市、板块/区域和小区名。
2. 人工亮点沿用页面上方“人工补充亮点”，每行一条。
3. 点击“开始亮点策划”。
4. 页面应生成 3–5 组小红书搜索关键词。
5. 编辑或确认关键词后点击“确认关键词并继续”。
6. 如果采集请求持续 5 秒仍未完成，页面会弹出 Chrome 登录提示。

## 4. 未启动 rednote

如果 `http://127.0.0.1:5000` 不可用：

- 页面应显示采集状态 `unavailable`。
- 显示 rednote 服务未启动的提示。
- 页面会提示在 rednote 打开的浏览器中登录小红书。
- Agent 仍可使用户型分析和人工亮点生成保守的 fallback 亮点策略与口播。

## 5. 启动 rednote

rednote 已集成到主项目，正常情况下运行 `npm run dev` 会一并启动。

```bash
npm run rednote
```

首次登录或 Cookie 失效时：

```bash
npm run rednote:login
```

rednote 会使用持久化浏览器目录和 `cookies.json` 保存登录态。

主项目检查接口：

```text
GET http://127.0.0.1:8787/api/highlight-agent/health
```

预期 `crawler.available` 为 `true`，地址为 `http://127.0.0.1:5000`。

## 6. 完整结果验收

Agent 2 输出应包含：

- 确认后的搜索关键词
- 入选参考笔记及热度
- 标题钩子、结构和关键词趋势
- 2–3 个核心房源亮点及来源
- 30 秒亮点口播
- 缓存命中数、采集状态和运行提示

口播要求：

- 开头直接说最强亮点
- 不流水账介绍户型
- 每个亮点说明生活价值
- 人工信息标注为“人工提供”
- 不复制参考笔记正文

## 7. 自动测试

```bash
npm run test:floorplan-agent
npm run test:highlight-agent
npm run build
```

预期：

- Agent 1：6 项测试通过
- Agent 2：6 项测试通过
- 前端构建成功

## 8. 页面滚动

- 上传区域和 Agent 1 在页面上方正常排列。
- Agent 2 紧接在 Agent 1 下方。
- 所有区域随页面自然滚动，不使用 sticky，不发生面板叠加。
