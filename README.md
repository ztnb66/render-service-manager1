## Render 服务管理系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/ssfun/render-service-manager)](https://github.com/ssfun/render-service-manager/graphs/commit-activity)

一个现代化的 Render 服务管理面板，让你能够集中管理多个 Render 账户中的 WEB_SERVICE 服务。提供服务监控、部署控制、环境变量管理和事件日志查看等完整功能。

![Render Service Manager Dashboard](https://github.com/ssfun/render-service-manager/blob/main/preview/Dashboard.png?raw=true "Dashboard Preview")

## 💡 特性

✨ **集中管理多个账户**
- 支持同时管理多个 Render 账户
- 清晰展示每个服务所属的账户

🛡️ **安全登录**
- 提供密码保护的登录页面
- 基于 Cookie 的会话管理
- 登录状态持久化

📊 **服务监控面板**
- 实时显示服务状态（运行中/已暂停）
- 服务统计信息（总数、运行中数量）
- 服务搜索过滤功能

🚀 **部署控制**
- 一键触发部署
- 部署按钮根据服务状态自动禁用
- 部署成功通知

🔧 **环境变量管理**
- 查看所有环境变量
- 在线编辑环境变量值
- 添加新的环境变量
- 删除现有环境变量
- 值的复制功能

📝 **事件日志**
- 查看最近5条事件日志
- 显示部署开始/结束状态
- 部署成功/失败状态标识
- 显示触发原因和用户信息

🎨 **现代化 UI**
- 响应式设计，支持移动端
- 漂亮的卡片式布局
- 流畅的交互动画
- 一致的设计风格

## 🚀 快速开始

点击下方按钮快速部署：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ssfun/render-service-manager)

### 方式 1: 通过 Wrangler CLI 部署（推荐）

1. **克隆仓库**：
   ```
   git clone https://github.com/ssfun/render-service-manager.git
   cd render-manager
   ```

2. **安装 Wrangler CLI**：
   ```
   npm install -g wrangler
   ```

3. **配置 wrangler.toml**：
   - 编辑 `wrangler.toml` 文件，添加 KV 命名空间和环境变量。
   - 示例：
     ```
     name = "render-manager"
     compatibility_date = "2023-01-01"
     workers_dev = true
     [vars]
     ADMIN_USERNAME = "admin"
     ADMIN_PASSWORD = "your-strong-password"
     RENDER_ACCOUNTS = '[{"id": "account1", "name": "Account 1", "apiKey": "rnd_xxx"}]'
     SESSION_SECRET = "your-random-secret"
     kv_namespaces = [
       { binding = "RENDER_KV", id = "你的KV_ID" }
     ]
     ```

4. **创建 KV 命名空间**（如果尚未创建）：
   ```
   npx wrangler kv:namespace create RENDER_KV
   ```
   - 将返回的 ID 添加到 wrangler.toml 的 kv_namespaces 中。

5. **登录并部署**：
   ```
   npx wrangler login
   npx wrangler deploy
   ```

### 方式 2: 手动部署（无需 Wrangler CLI）

如果您不想安装 CLI，可以直接在 Cloudflare 仪表盘中手动部署 Worker。

1. **登录 Cloudflare 账户**：
   - 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/) 并登录。

2. **创建 KV 命名空间**（如果不存在）：
   - 导航到 "Workers" > "KV"。
   - 点击 "Create a namespace"。
   - 输入名称（如 "RENDER_KV"），复制生成的 ID 备用。

3. **创建 Worker**：
   - 导航到 "Workers" > "Overview"。
   - 点击 "Create a Worker"。
   - 输入 Worker 名称（如 "render-manager"）。

4. **编辑脚本文档**：
   - 在 Worker 编辑器中，复制并粘贴本项目的完整 JavaScript 代码（从仓库的 index.js 文件中获取）。

5. **配置环境变量**：
   - 点击 "Settings" > "Variables"。
   - 添加以下环境变量：
     - ADMIN_USERNAME: "admin"
     - ADMIN_PASSWORD: "your-strong-password"
     - RENDER_ACCOUNTS: '[{"id": "account1", "name": "Account 1", "apiKey": "rnd_xxx"}]'
     - SESSION_SECRET: "your-random-secret"

6. **绑定 KV 命名空间**：
   - 在 "Settings" > "Bindings" > "KV Namespace Bindings" 部分。
   - 点击 "Add binding"。
   - 输入变量名称 "RENDER_KV"（必须与代码中的绑定名匹配）。
   - 选择步骤 2 中创建的 KV 命名空间。

7. **部署 Worker**：
   - 点击 "Save and Deploy"。
   - Worker 将立即可用，您可以通过提供的 URL 访问（例如: render-manager.your-subdomain.workers.dev）。


### 环境变量

| 变量名 | 说明 |
|--------|------|
| `ADMIN_USERNAME` | 管理员登录用户名 |
| `ADMIN_PASSWORD` | 管理员登录密码 |
| `RENDER_ACCOUNTS` | 账户配置的 JSON 字符串 |
| `SESSION_SECRET` | 会话签名密钥 |
| `KV_NAMESPACE` | 用于会话存储的 KV 命名空间 |

`RENDER_ACCOUNTS` 环境变量需要配置为 JSON 格式，示例：

```json
[
  {
    "id": "account1",
    "name": "主账户",
    "apiKey": "your-render-api-key-1"
  },
  {
    "id": "account2",
    "name": "测试账户",
    "apiKey": "your-render-api-key-2"
  }
]
```

## 🖼️ 界面预览

### 登录页面
![登录页面](https://github.com/ssfun/render-service-manager/blob/main/preview/Login.png?raw=true "登录页面")

### 仪表盘
![仪表盘](https://github.com/ssfun/render-service-manager/blob/main/preview/Dashboard.png?raw=true "仪表盘")

### 环境变量管理
![环境变量](https://github.com/ssfun/render-service-manager/blob/main/preview/Environment.png?raw=true "环境变量")

### 事件日志
![事件日志](https://github.com/ssfun/render-service-manager/blob/main/preview/Events.png?raw=true "事件日志")

## 🛡️ 安全说明

- 所有 API 请求都需要登录认证
- 会话数据存储在 Cloudflare KV 中
- 敏感信息在前端界面中被遮盖
- 使用 HTTPS 加密传输
- API 密钥通过环境变量存储，不会暴露在前端代码中

## 🙏 致谢

- [Render](https://render.com) - 提供优秀的部署平台
- [Cloudflare Workers](https://workers.cloudflare.com) - 提供无服务器计算平台
- [Tailwind CSS](https://tailwindcss.com) - 提供实用的 CSS 框架（灵感）

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE). 版权所有 © 2025 [sfun](https://github.com/ssfun)
