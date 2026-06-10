# 户型图识图 Benchmark v0

这个目录用于先建立一套小规模、可复跑的户型图识图评估基准。目标不是 CAD 级测量精度，而是评估 AI 是否具备“房产经纪人级”的户型理解和解读能力。

## 目录结构

- `schema.md`：人工标注规范和 Agent 输出格式。
- `cases/sample-cases.json`：示例 benchmark 标准答案。
- `predictions/sample-predictions.json`：示例 Agent 输出，用于演示评分。
- `run-benchmark.mjs`：自动评分脚本。

## 怎么运行

```bash
npm run benchmark
```

也可以指定自己的文件：

```bash
node benchmark/run-benchmark.mjs benchmark/cases/sample-cases.json benchmark/predictions/sample-predictions.json
```

## 怎么让视觉模型生成识图 JSON

在 `.env` 中配置火山方舟视觉模型：

```bash
VISION_PROVIDER=ark
ARK_API_KEY=你的火山方舟 API Key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VISION_MODEL=doubao-seed-2-0-mini-260428
```

然后运行：

```bash
npm run recognize:floorplan -- benchmark/images/case_001.jpg benchmark/predictions/case_001-agent.json
```

再和人工标准答案评分：

```bash
node benchmark/run-benchmark.mjs benchmark/cases/sample-cases.json benchmark/predictions/case_001-agent.json
```

## 怎么生成固定标签体系

扫描 `benchmark/cases` 和 `benchmark/predictions` 里的 `pros`、`cons`、`suitableFor`，生成统一标签候选：

```bash
npm run labels:taxonomy
```

输出：

- `benchmark/taxonomy/labels.json`：固定标签候选，`unmapped_*` 需要人工合并。
- `benchmark/results/prediction-review-summary.json`：每个 Agent 识图结果的复核摘要。

## 正式固定标签 ID

正式标签表在：

```bash
benchmark/taxonomy/canonical-labels.json
```

`recognize:floorplan` 会要求模型的 `pros`、`cons`、`suitableFor` 只输出这些标签 ID。`run-benchmark` 也会优先按标签 ID 打分，并兼容少量旧中文别名。

人工标准答案建议这样写：

```json
"pros": ["clear_zoning", "large_living_room", "dual_bathroom_convenient"],
"cons": ["weak_lighting_room", "corridor_area_loss"],
"suitableFor": ["three_person_family", "improvement_family"]
```

## 怎么扩展到真实数据

1. 把户型图放到 `benchmark/images/`。
2. 在 `benchmark/cases/*.json` 里新增样本，并填写 `imagePath`。
3. 人工标注 `rooms`、`features`、`pros`、`cons`、`suitableFor`。
4. 让 Agent 对同一批图片输出 prediction JSON。
5. 运行 `npm run benchmark` 看分数和扣分项。

建议第一批先做 20-50 张，覆盖常见两居、三居、南北通透、暗卫、长走廊、餐厨弱连接、动静分区差等情况。

## 评分维度

- 房间识别：按房间类型数量计算 F1。
- 空间关系：比较房间连接边，例如 `living_room-balcony`。
- 专业判断：比较采光、通风、动静分区、餐厨动线、卫生间压力等字段。
- 解读质量：优点、短板、适合人群的类别覆盖。
- 幻觉惩罚：预测出标准答案不存在且未标记不确定的房间、关系或判断，会扣分。

Agent 不确定时应该写入 `unknowns` 或 `needsReview`，不要编造。
