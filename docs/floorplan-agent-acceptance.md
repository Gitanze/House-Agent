# 平面图识别 Agent 验收清单

## 启动

```bash
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。

## 正常流程

1. 在“讲解生成”页上传一张清晰的户型图。
2. 点击“生成讲解”。
3. 结果应包含户型、面积、朝向、房间、空间特征、亮点、短板和适合人群。
4. 接口结果应包含：
   - `schemaVersion: "floorplan-analysis/v1"`
   - `provider.workflow: "langgraph"`
   - `executionPath`
   - `validation.valid: true`
   - `evidence`
   - `audit.passed: true`

典型执行路径：

```text
recognize
→ validate_recognition
→ analyze_features
→ generate_highlights
→ audit_result
```

## 自动修复流程

如果模型返回重复连接或指向不存在房间的连接：

1. `executionPath` 中应出现 `repair_recognition`。
2. `repairLog` 应说明清理了无效或重复连接。
3. 修复后会再次执行 `validate_recognition`。

## 人工复核流程

如果识别结构或亮点审核无法自动通过：

1. 页面应自动进入标注界面。
2. 页面提示“Agent 已暂停，请校正后继续”。
3. 修改房间、连接关系、特征或标签。
4. 点击“提交修正并继续”。
5. 亮点审核阶段也可以点击“人工确认保留”。
6. 完成后应提示 Agent 已从暂停位置继续。

暂停接口返回：

```json
{
  "status": "needs_review",
  "threadId": "本次流程的存档编号",
  "review": {
    "stage": "recognition 或 highlights"
  }
}
```

恢复接口：

```text
POST /api/floorplan-review/:threadId
```

## 自动检查

```bash
npm run test:floorplan-agent
npm run build
```

预期：Agent 测试全部通过，前端构建成功。

