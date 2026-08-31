# 任务信息核对与主动提问（minecraft-intake）

> 前置：无。本技能是**开工前的第一步**——无论什么平台，信息不足先核对。
> **铁律：提问用 `ask_user_question` 一次性批量问（问题数组），禁止挤牙膏式逐条追问；用户已给的信息绝不重复问；用户说"你决定"时用 `references/api/intake-matrix.md` 的默认值并说明理由。**
> 核对日期：2026-08。

## 1. 定位与适用

- 本技能覆盖**需求澄清**：用户请求"写插件/mod/附属"但漏了关键信息（版本、平台/加载器、核心、兼容性、部署方式）时，按场景给出**必问清单**，一次问完。
- 什么时候触发：任务信息不足**且**即将开始脚手架/写代码/委派四子代理之前。
- 什么时候不触发：用户已提供完整信息（版本+平台+核心+兼容）→ 直接按既有流程走（读项目 → 加载平台技能 → mc_scaffold）。

## 2. 三条 UX 规则（v0.7 行为基线）

1. **一次问全**：多条问题放同一个 `ask_user_question` 调用（4–6 条一批），选项给全；超过的归入"功能细节"由用户后续补充。
2. **不重复问**：用户消息里已有的信息直接采用，不进问题列表。
3. **授权默认**：用户说"随便/你决定/你来定"→ 不再问，用矩阵默认值，回复开头一行说明选择与理由（如"按默认 Paper + 1.21.8 最新稳定线"）。

## 3. 场景速查（完整矩阵见 references/api/intake-matrix.md）

| 场景 | 必问（4–6 项） | 默认（用户授权时） |
|---|---|---|
| 新插件（Bukkit 系） | MC 版本、核心（Paper/Spigot/Purpur/Pufferfish/**Folia**）、功能需求 | Paper + 1.21.x 最新稳定线 |
| 老线插件 | 1.7.10 or 1.12.2、**混合服核心**（KCauldron/Thermos/Mohist/CatServer）、JDK8 环境 | 1.12.2 + 纯 Spigot |
| 新 mod | 加载器（Forge/Fabric/NeoForge）、MC 版本、加载器版本 | NeoForge 或 Fabric + 最新稳定线 |
| 老线 mod | 时代（FG2/3/5 决定 wrapper）、Forge 版本、**是否混合服** | 按时代钉选 |
| 附属 addon | 目标模组 + MC 版本 + 模组版本、扩展点 | 目标模组最新版本 |
| 资源包（pack） | 目标 MC 版本、**包类型**、**客户端前端**（OptiFine/citresewn/原版）、分版、服务端侧（自定义物品/改名） | 26.2 + citresewn（按实际客户端） |
| 跨服/群组 | BungeeCord/Velocity、是否 Folia | 单服 |
| 兼容性 | 必须兼容的插件/模组列表（softdepend） | 无 |

## 4. 问法示例（一次调用多条）

```text
问题数组（同一 ask_user_question 调用）：
1. MC 版本？→ 选项：1.21.8（Recommended）/ 1.20.1 / 26.2 / 1.12.2 / 1.7.10
2. 平台/核心？→ 选项：Paper（Recommended）/ Spigot / Purpur / Folia / 混合服（Mohist/CatServer）
3. 要兼容哪些插件/模组？（softdepend 列表，如 MMOItems/WorldGuard）
4. 部署？→ 单服（Recommended）/ 群组（BungeeCord/Velocity）
5. 功能需求简述（命令/事件/权限）
```

## 5. 与四子代理链的关系

- **委派 A→B→C→D 之前必须完成信息核对**：A 环的 "decide" 语义只在用户明确授权时使用；宿主不得把"信息不足"直接甩给 A 决定。
- 核对完成后，把确认的参数（版本/平台/Java）写进委派 prompt 与 PLAN.md。

## 6. 参考文件索引

- `references/api/intake-matrix.md` — 场景 × 必问项 × 默认值 × 不问时机 全表 + 默认值理由 + **资源包任务补充（v0.7）**
