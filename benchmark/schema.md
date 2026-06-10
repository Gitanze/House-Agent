# Benchmark v0 标注规范

## 样本结构

每个 case 是一张户型图及其人工标准答案：

```json
{
  "id": "case_001",
  "title": "南向客厅三居",
  "imagePath": "benchmark/images/case_001.png",
  "layoutType": "3室2厅1卫",
  "rooms": [],
  "features": {},
  "pros": [],
  "cons": [],
  "suitableFor": [],
  "notes": ""
}
```

## 房间标注

`rooms` 中每个房间建议包含：

```json
{
  "id": "living",
  "type": "living_room",
  "name": "客厅",
  "position": "南侧中部",
  "connectedTo": ["balcony", "dining"],
  "hasWindow": true,
  "light": "good"
}
```

常用 `type`：

- `living_room`
- `dining_room`
- `kitchen`
- `primary_bedroom`
- `bedroom`
- `child_room`
- `study`
- `bathroom`
- `balcony`
- `entrance`
- `corridor`
- `storage`

## 连接关系

`connectedTo` 只标注能从图上确认的直接连接关系。评分时会转成无向边，例如：

```text
living_room-balcony
living_room-dining_room
dining_room-kitchen
```

如果图中只是靠近但没有明确门洞或通行关系，不要标注。

## 专业判断字段

`features` 当前建议字段：

```json
{
  "northSouthVentilation": true,
  "dynamicStaticZoning": "good",
  "kitchenDiningFlow": "good",
  "bathroomPressure": "medium",
  "lighting": "good",
  "storagePotential": "medium"
}
```

可选值建议：

- 布尔：`true`、`false`、`"unknown"`
- 分级：`"good"`、`"medium"`、`"weak"`、`"unknown"`

## 解读标签

`pros`、`cons`、`suitableFor` 用短标签，便于稳定评分：

```json
"pros": ["南向客厅", "餐厨动线顺", "动静分区清晰"]
"cons": ["单卫压力", "玄关收纳弱"]
"suitableFor": ["年轻家庭", "三口之家"]
```

## 不确定性

Agent 输出中允许包含：

```json
{
  "unknowns": ["未能确认北向卧室窗户"],
  "needsReview": ["卫生间是否干湿分离需要人工复核"]
}
```

原则：没有证据就标记不确定。不要为了让解说完整而编造朝向、面积、承重墙、学区、价格、噪音等信息。
