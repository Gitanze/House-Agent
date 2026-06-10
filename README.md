# AI房产经纪人VR看房Demo

一个 Web 手机端 demo，用静态房间视角模拟 VR 看房界面。用户可以在当前房间视角里提问，AI 会结合房间、视角、户型数据、用户偏好和历史对话，在左下角以直播弹幕式气泡输出解说。

## 运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。

## DeepSeek配置

在项目根目录的 `.env` 中填写：

```bash
DEEPSEEK_API_KEY=你的DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
PORT=8787
```

前端只请求本地 `/api/guide`，API key 只在 `server/index.mjs` 里读取。未配置 key 或接口失败时，系统会自动使用本地 fallback 解说，demo 仍然可以演示。

## 已实现能力

- VR 看房式手机竖屏界面
- 房间内视角全屏背景
- 顶部房源 HUD、指南针、右上角户型图
- 当前视角热点标注和房间切换
- 左下角 AI 直播弹幕式回复
- 底部输入框和 VR 工具栏
- DeepSeek 后端代理与本地 fallback
