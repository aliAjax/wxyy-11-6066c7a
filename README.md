# 寺庙经卷修补借阅流转

## 快速开始

```bash
npm install
npm start
```

默认地址：http://localhost:3911

数据保存在`data/db.json`，后续可以继续增量迭代。

---

## 工程化命令速查

### 日常开发

| 命令 | 说明 |
|------|------|
| `npm start` | 启动服务（启动前自动检查 db.json 结构） |
| `npm run dev` | 启动开发模式（自动重启） |
| `npm run db:check` | 检查 db.json 数据结构是否合法 |
| `npm run db:backup [标签]` | 备份当前数据库到 data/backups/ |
| `npm run db:restore` | 交互式还原数据库（还原前自动备份当前数据） |

### 回归验证

| 命令 | 说明 |
|------|------|
| `npm test` | 运行全部测试（单元测试 + 接口测试） |
| `npm run test:unit` | 运行单元测试（借阅审批逻辑） |
| `npm run test:api` | 运行接口级集成测试（使用临时数据库，不污染真实数据） |
| `npm run verify` | **一键完整验证**：结构检查 + 单元测试 + 接口测试 |

### 首次克隆后一键验证

```bash
npm install
npm run verify
```

这会依次执行：数据结构检查 → 单元测试 → 接口集成测试，全部通过则说明项目处于可运行状态。

---

## 测试说明

### 单元测试 (`test/loan-regression.test.js`)
- 覆盖日期重叠检测、冲突检测、风险评估、可借阅性评估等核心逻辑
- 纯函数测试，不依赖服务器和数据库

### 接口集成测试 (`test/api.test.js`)
- 启动真实 Express 服务器，通过 HTTP 请求验证 API
- 测试时自动复制 `data/db.json` 为 `data/test-db.json` 作为测试库
- 测试结束后自动清理测试数据库，**不会污染真实数据**
- 覆盖基础接口、数据查询、冲突检测、风险评估、借阅 CRUD、权限控制等

---

## 数据备份与还原

### 备份

```bash
npm run db:backup
# 或带标签
npm run db:backup pre-migration
```

备份文件保存在 `data/backups/db-YYYYMMDD-HHMMSS[标签].json`。

### 还原

```bash
npm run db:restore
```

交互式选择备份文件还原。**还原前会自动备份当前数据**，可在 `data/backups/` 中找到 `db-before-restore-*.json`。

CI 环境下自动选择最新备份。

---

## 持续集成 (GitHub Actions)

项目已配置 GitHub Actions CI，在 push 和 PR 时自动运行：

- 数据库结构检查
- 单元测试
- 接口集成测试
- 多 Node 版本验证（18.x / 20.x）

配置文件：`.github/workflows/ci.yml`

---

## 目录结构

```
.
├── data/
│   ├── db.json              # 主数据库
│   └── backups/             # 数据库备份（.gitignore）
├── public/                  # 前端静态资源
├── scripts/
│   ├── backup-db.js         # 备份脚本
│   ├── restore-db.js        # 还原脚本
│   └── check-db-schema.js   # 结构检查脚本
├── test/
│   ├── loan-regression.test.js  # 单元测试
│   └── api.test.js              # 接口集成测试
├── .github/workflows/
│   └── ci.yml               # CI 配置
├── server.js                # Express 服务入口
├── loan-assess.js           # 借阅评估核心逻辑
├── project.config.js        # 项目配置
└── package.json
```

---

## 安全说明

- `data/db.json` 是真实业务数据，请勿提交到公共仓库
- `data/backups/` 和 `data/test-db.json` 已加入 `.gitignore`
- 接口测试使用独立的临时数据库，失败也不会影响真实数据
