# 提问矩阵：场景 × 必问项 × 默认值 × 不问时机

> 核对日期：2026-08。本表是 minecraft-intake 的唯一事实表；改表必须同步 SKILL.md 的场景速查。

## 1. 全表

| # | 场景 | 必问项 | 默认值（用户授权时） | 不问时机 |
|---|---|---|---|---|
| 1 | 新插件（Bukkit 系，现代线） | MC 版本；核心（Paper/Spigot/Purpur/Pufferfish/**Folia**）；功能需求（命令/事件/权限）；兼容插件列表 | Paper + 1.21.x 最新稳定线（2026-08 生态最稳） | 用户已给全；只写小工具类插件时功能需求可省略 |
| 2 | 老线插件（1.7.10/1.12.2） | 具体版本（1.7.10 vs 1.12.2 API 差异大）；**混合服核心**（纯 Spigot / KCauldron / Thermos / Mohist / CatServer）；JDK8 环境是否有 | 1.12.2 + 纯 Spigot（老线最大生态） | 用户已给全；纯单机小插件可不问混合服 |
| 3 | 新 mod（现代线） | 加载器（Forge / Fabric / NeoForge）；MC 版本；加载器版本（或"最新"） | NeoForge 或 Fabric + 最新稳定线（Forge 现代线已让位 NeoForge） | 用户已给全 |
| 4 | 老线 mod（1.7.10/1.12.2/1.16.5） | 时代（决定 ForgeGradle 2/3/5 与 wrapper 7.4.2/4.9/7.3.3）；Forge 版本；**是否混合服**（事件侧漏/NMS 差异） | 按时代钉选（ForgeGradle 与 MCP 映射矩阵见 minecraft-forge-mod） | 用户已给全 |
| 5 | 附属 addon（major mods） | 目标模组名；MC 版本；模组版本（fileId 查 references）；扩展点（注册什么：花/研究/配方/接口实现） | 目标模组该线最新版（坐标以 major-mods references 为准） | 用户已给全 |
| 6 | 跨服/群组 | 是否 BungeeCord / Velocity；是否 Folia（分区调度） | 单服 | 用户已给全 |
| 7 | 兼容性 | 必须兼容的插件/模组（softdepend 对象：MMOItems/WorldGuard/Vault/…） | 无 | 用户已给全 |
| 8 | 26.x 现代线 | 明确 26.2 还是 1.21.x（生态差异大：NeoForge beta/CIT fork/无 yarn）；客户端侧需求（渲染/CIT） | 1.21.x（26.x 生态跟进中） | 用户已给全 |
| 9 | 资源包（pack 任务，v0.7） | 目标 MC 版本；**包类型**（模型 / CIT / 纹理 / GUI / 字体 / 语言 / 音频 / 全功能）；**客户端前端**（OptiFine / citresewn fork / 纯原版——决定条件通道时代）；是否分版（1.7.10~26.2 多版本）；服务端侧（MMOItems 等自定义物品、是否需要服务端改名） | 按用户实际客户端（26.2 时代默认 citresewn fork） | 用户已给全 |

## 2. 默认值理由（回答"为什么这么选"）

- **Paper + 1.21.x**：1.21.x 是 2026-08 大多数服务器的稳定主流线；Paper 兼容 Bukkit 插件；Folia 是例外（调度模型不同），所以核心必问。
- **1.12.2 + 纯 Spigot（老线）**：1.12.2 是老线最大生态；混合服（Mohist/CatServer）行为差异大，先问再写。
- **NeoForge/Fabric（现代 mod）**：Forge 现代线已让位 NeoForge；Fabric 用 mojmap（26.x 起官方映射）；加载器版本按用户环境，问"最新"即可。
- **老线 mod 按时代钉选**：FG2/3/5 对应 wrapper 7.4.2/4.9/7.3.3 与 JDK8，错配直接构建失败——所以时代必问，不允许默认猜。

## 3. 必问项的硬前提（永远先定）

1. **MC 版本** → 决定 era、API、pack_format、JDK。
2. **平台/加载器** → 决定脚手架平台枚举（paper/fabric/forge/neoforge/spigot）。
3. **核心（Bukkit 系）/ 混合端** → 决定调度模型（Folia）、事件行为（混合服侧漏）、NMS 可用性。
4. **兼容对象** → 决定 softdepend/compileOnly 与参考文件选择。

## 4. 问法规范

- 一次调用 `ask_user_question`，问题数组 4–6 条；每条给 3–5 个选项，推荐项放第一并标 `(Recommended)`。
- 版本问题给选项而不是开放输入（降低拼写错误：1.21 与 1.20.1 是不同 era）。
- 用户消息中已出现的参数（哪怕不完整）不回问，只问缺的。

## 5. 资源包任务补充（v0.7）

资源包任务与插件/mod 的提问重点不同，多问三项：

1. **客户端前端**：OptiFine / citresewn（continuation fork）/ 纯原版——26.2 时代只有 citresewn fork 的 CIT 通道可用（lore 匹配已死，components 通道）；纯原版客户端则 CIT 类需求直接不成立。
2. **包类型**：模型 / CIT / 纹理 / GUI / 字体 / 语言 / 音频——决定走哪份 pack 技能与校验规则域（minecraft-pack-core 按目录内容自动激活规则，但语义判断需要类型信息）。
3. **服务端侧**：是否有 MMOItems 等自定义物品（影响 CIT 条件匹配与 damage/unbreakable 判断）、是否需要服务端改名（custom_name/item_name 是字面文本，资源包翻译不了——见 minecraft-pack-lang）。

其他沿用通用规则：目标 MC 版本必问（决定 pack_format 与格式断代）、分版需求（1.7.10~26.2 全时代还是单版本）、pack.config.json 的 names/syncGroups 是否需要预填。详情交叉引用：minecraft-pack-core（结构/矩阵）、minecraft-pack-cit（条件通道）、minecraft-pack-lang（服务端边界）。
