# OpenCode & OpenChamber 残留内容清单

> 状态：待清理  
> 记录时间：2026-03-28  
> 关联计划：[OpenChamber遗留内容拆除分级计划](./2026-03-27_OpenChamber遗留内容拆除分级计划.md)

---

## 概述

项目已完成更名（OpenChamber → ridge）且底层从 opencode 迁移到 pi，但代码库中仍存在多处 **opencode** 和 **openchamber** 相关引用。本文档全面梳理这些残留，供后续清理工作参考。

---

## 一、OpenChamber 品牌残留

### 1.1 主题文件

#### 📁 `packages/ui/src/lib/theme/themes/fields-of-the-shire-light.json`

| 字段 | 当前值 | 建议 |
|------|--------|------|
| `metadata.id` | `openchamber-light` | 改为 `ridge-light` 或 `fields-of-the-shire-light` |
| `metadata.author` | `OpenChamber` | 改为 `ridge` |

#### 📁 `packages/ui/src/lib/theme/themes/fields-of-the-shire-dark.json`

| 字段 | 当前值 | 建议 |
|------|--------|------|
| `metadata.id` | `openchamber-dark` | 改为 `ridge-dark` 或 `fields-of-the-shire-dark` |
| `metadata.author` | `OpenChamber` | 改为 `ridge` |

### 1.2 文档层

#### 📁 `packages/docs/content/docs/*.mdx`

| 文件 | 内容 | 建议 |
|------|------|------|
| `quickstart.mdx` | `openchamber --ui-password` 命令 | 改为 `ridge --ui-password` |
| `install.mdx` | GitHub URL `github.com/openchamber/openchamber` | 改为 `github.com/ridge/ridge` |
| `install.mdx` | `mkdir -p ~/.config/openchamber/themes` | 改为 `~/.config/ridge/themes` |
| `troubleshooting.mdx` | `openchamber --version`, `openchamber logs` 等命令 | 统一改为 `ridge` |
| `tunnels.mdx` | 多处 `openchamber tunnel` 命令引用 | 统一改为 `ridge tunnel` |
| `themes.mdx` | `~/.config/openchamber/themes/` 路径 | 改为 `~/.config/ridge/` |
| `themes.mdx` | GitHub 链接指向 `openchamber/openchamber` | 更新链接 |

#### 📁 `packages/docs/*.md`

| 文件 | 内容 | 建议 |
|------|------|------|
| `CONTRIBUTING.md` | 多处 `openchamber-website` 仓库引用 | 改为 `ridge-website` |
| `DEPLOYMENT.md` | `OPENCHAMBER_WEBSITE_REPO_TOKEN` 环境变量 | 改为 `RIDGE_WEBSITE_REPO_TOKEN` |
| `README.md` | `openchamber-website` 引用 | 改为 `ridge-website` |

### 1.3 Desktop README

#### 📁 `packages/desktop/README.md`

| 内容 | 问题 | 建议 |
|------|------|------|
| Logo URL | `btriapitsyn/openchamber` GitHub 引用 | 改为 `ridge` 组织 |
| GitHub stars badge | 指向旧仓库 | 更新链接 |
| 下载链接 | `btriapitsyn/openchamber/releases` | 更新链接 |
| 克隆命令 | `git clone https://github.com/btriapitsyn/openchamber.git` | 更新为 ridge 仓库 |
| 配置说明 | `Settings -> OpenChamber -> Remote Tunnel` | 改为 `Settings -> Ridge` |

### 1.4 配置层

#### 📁 `eslint.config.js`

```javascript
// 当前配置
globalIgnores(['dist', '.openchamber'])

// 建议改为
globalIgnores(['dist', '.ridge'])
```

**注意：** 检查是否有 `.openchamber` 目录实际被使用，如有需同步迁移为 `.ridge`

---

## 二、OpenCode 代码残留

---

## 一、源代码残留

### 1.1 UI 层 (TypeScript)

#### 📁 `packages/ui/src/stores/useAgentsStore.ts`

| 位置 | 内容 | 问题类型 | 建议处理 |
|------|------|----------|----------|
| `getCurrentDirectory()` | `opencodeDirectory` 变量名 | 命名残留 | 改为 `piDirectory` 或 `projectDirectory` |
| 多处 fetch header | `'x-opencode-directory'` | Header 残留 | 改为 `'x-ridge-directory'` |

**代码片段示例：**
```typescript
// 当前代码（需修改）
const opencodeDirectory = runtimeClient.getDirectory();
if (typeof opencodeDirectory === 'string' && opencodeDirectory.trim().length > 0) {
  return opencodeDirectory;
}

// HTTP Header
...(configDirectory ? { 'x-opencode-directory': configDirectory } : {})
```

#### 📁 `packages/ui/src/types/multirun.ts`

| 位置 | 内容 | 问题类型 | 建议处理 |
|------|------|----------|----------|
| 文件头部注释 | "each in its own git worktree and OpenCode session" | 注释残留 | 改为 "ridge session" |

---

### 1.2 Desktop 层 (Rust)

#### 📁 `packages/desktop/src-tauri/src/main.rs`

| 位置 | 内容 | 问题类型 | 严重程度 |
|------|------|----------|----------|
| `opencode_binary_from_settings` | 从 settings.json 读取 `opencodeBinary` 字段 | 配置残留 | 🔴 高 |
| 环境变量检测 | `RIDGE_OPENCODE_PATH`, `RIDGE_OPENCODE_BIN`, `OPENCODE_PATH`, `OPENCODE_BINARY` | 环境变量残留 | 🔴 高 |
| 路径检测 | `~/.opencode/bin` OpenCode 安装目录 | 路径硬编码 | 🔴 高 |
| 进程启动 | `OPENCODE_BINARY` 环境变量传递 | 运行时残留 | 🔴 高 |
| 密码配置 | `OPENCODE_SERVER_PASSWORD` 环境变量 | 配置残留 | 🟡 中 |

**关键代码区块：**
```rust
// 1. settings.json 中读取 opencodeBinary
let opencode_binary_from_settings: Option<String> = (|| {
    // ... 读取 "opencodeBinary" 字段
})();

// 2. 多环境变量检测
for var in [
    "RIDGE_OPENCODE_PATH",
    "RIDGE_OPENCODE_BIN", 
    "OPENCODE_PATH",
    "OPENCODE_BINARY",
] { ... }

// 3. OpenCode 默认安装路径
push_unique(format!("{home}/.opencode/bin"));

// 4. 进程启动时传递
if let Some(bin) = opencode_binary_from_settings.as_deref() {
    cmd = cmd.env("OPENCODE_BINARY", trimmed);
}
```

**处理建议：**
- 完全删除 opencode binary 查找逻辑
- 改为 pi 的启动方式（SDK 模式，无需外部 binary）
- 保留环境变量机制但更换名称（如 `RIDGE_PI_PATH` 等）
- `OPENCODE_SERVER_PASSWORD` 可暂时保留（服务端兼容）或改为 `RIDGE_SERVER_PASSWORD`

---

### 1.3 Scripts 层 (Node.js)

#### 📁 `packages/desktop/scripts/opencode-cli.mjs`

| 内容 | 问题 | 建议 |
|------|------|------|
| 整个脚本目的 | 启动/停止 opencode CLI 进程 | 🔴 **删除整个文件** |
| 状态文件 | `.opencode-cli-state.json` | 删除 |
| 环境变量 | `OPENCHAMBER_OPENCODE_PATH`, `OPENCHAMBER_OPENCODE_ARGS` 等 | 删除 |
| binary 查找 | `DEFAULT_BIN_CANDIDATES` 列表 | 删除 |

**依赖此脚本的地方：**
- `package.json` 中的 `desktop:start-cli` 和 `desktop:stop-cli` 命令
- Desktop 启动流程

#### 📁 `scripts/port-opencode-theme.ts`

| 内容 | 问题 | 建议 |
|------|------|------|
| 脚本功能 | 从 opencode 仓库导入主题 | 🟡 **评估后决定是否保留** |
| 硬编码路径 | `~/projects/opencode` 默认路径 | 如无 opencode 源码则失效 |

**评估意见：**
- 当前项目主题已独立，该脚本实用性存疑
- 建议保留脚本但清理命名（改为 `port-external-theme.ts`）
- 或完全删除，主题独立维护

---

## 三、配置残留

### 3.1 package.json

| 位置 | 内容 | 建议 |
|------|------|------|
| `keywords` | `"opencode"` | 删除 |
| `scripts.desktop:start-cli` | 调用 `opencode-cli.mjs start` | 🔴 删除 |
| `scripts.desktop:stop-cli` | 调用 `opencode-cli.mjs stop` | 🔴 删除 |
| `scripts.themes:port:opencode` | 调用 `port-opencode-theme.ts` | 🟡 评估后决定 |

### 3.2 Desktop Settings

用户本地 `settings.json` 中可能存在：
```json
{
  "opencodeBinary": "/path/to/opencode"
}
```

**处理建议：**
- 启动时忽略此字段
- 如需迁移，读取后自动删除并提示用户

---

## 四、清理优先级

```
🔴 P0 - 阻塞启动/运行（必须立即处理）
├── Desktop 层的环境变量和 binary 查找逻辑
├── package.json 中 desktop:*-cli 命令
└── opencode-cli.mjs 脚本删除

🟡 P1 - 影响用户体验（近期处理）
├── UI 层的 header 名称 (x-opencode-directory)
├── UI 层的变量命名
├── types 文件中的注释
├── 主题文件 metadata 中的 openchamber 命名
└── eslint.config.js 中的 .openchamber 目录

🟢 P2 - 技术债务（可延后）
├── port-opencode-theme.ts 脚本
├── package.json keywords
├── packages/docs/ 中的命令行文档
├── packages/desktop/README.md 的 GitHub 链接
└── 历史计划文档中的命名
```

---

## 五、关联文档

| 文档 | 内容 | 状态 |
|------|------|------|
| [2026-03-27_OpenChamber遗留内容拆除分级计划](./2026-03-27_OpenChamber遗留内容拆除分级计划.md) | 拆除整体规划 | 进行中 |
| [2026-03-27_删除OpenCode兼容并切换到Pi原生前端_方案](./2026-03-27_删除OpenCode兼容并切换到Pi原生前端_方案.md) | 前端迁移方案 | 已完成 |
| [2026-03-25_Pi前端OpenCode耦合清单](./2026-03-25_Pi前端OpenCode耦合清单.md) | 前端耦合分析 | 已完成 |

---

## 六、检查命令

如需再次检查全局残留，可使用以下命令：

```bash
# === 搜索 opencode ===
# 所有类型文件
rg -i "opencode" --type ts --type tsx --type rs --type js --type mjs -l

# 特定目录
rg -i "opencode" packages/ -l
rg -i "opencode" scripts/ -l

# 环境变量
rg -i "OPENCODE_" packages/ -l

# === 搜索 openchamber ===
# 代码文件
rg -i "openchamber" --type ts --type tsx --type rs --type js --type mjs -l

# 配置文件
rg -i "openchamber" --type json --type md -l

# 主题文件
rg -i "openchamber" packages/ui/src/lib/theme/ -l

# 文档
rg -i "openchamber" packages/docs/ -l
```

---

## 七、验收标准

### OpenCode 相关
- [ ] `packages/desktop/src-tauri/src/main.rs` 中无 opencode binary 查找逻辑
- [ ] `packages/desktop/scripts/opencode-cli.mjs` 文件已删除
- [ ] `package.json` 中无 `desktop:start-cli` / `desktop:stop-cli` 命令
- [ ] `packages/ui/src/stores/useAgentsStore.ts` 中 header 改为 `x-ridge-directory`
- [ ] 所有 `opencodeDirectory` 变量名已修改
- [ ] 环境变量名统一改为 `RIDGE_*` 前缀
- [ ] 用户 settings.json 迁移逻辑（如需要）

### OpenChamber 品牌相关
- [ ] 主题文件 `metadata.id` 已改为 ridge 相关命名
- [ ] 主题文件 `metadata.author` 已改为 `ridge`
- [ ] `packages/docs/content/docs/*.mdx` 中命令行示例统一改为 `ridge`
- [ ] `packages/docs/content/docs/*.mdx` 中 GitHub 链接已更新
- [ ] `packages/desktop/README.md` 中所有 GitHub 链接已更新
- [ ] `eslint.config.js` 中 `.openchamber` 已改为 `.ridge`
- [ ] 检查并迁移用户目录 `.openchamber` → `.ridge`（如有）

---

*最后更新：2026-03-28*
