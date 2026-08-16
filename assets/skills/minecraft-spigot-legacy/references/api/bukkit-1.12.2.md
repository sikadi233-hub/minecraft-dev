# Bukkit API 参考（Minecraft 1.12.2）

- API 版本：spigot-api 1.12.2-R0.1-SNAPSHOT（hub.spigotmc.org snapshots + groups/public 可解析）。
- 核对基准（2026-08-16）：hub 下载 spigot-api-1.12.2-R0.1-20180712.012057-156.jar（构建 156，2018-07 后未再更新），javap 反编译核对。
- **铁律：签名一律查本文件，禁止凭记忆写签名。** 与 1.7.10 相同之处简述，**增量（1.8~1.12 新增）显式标注**；与 1.13+ 现代差异同样标注。

## 1. JavaPlugin 生命周期

- 与 1.7.10 完全一致（javap 实测）：`onLoad()` → `onEnable()` → `onDisable()`；`getLogger()`、`getDataFolder()`、`getConfig()`/`saveConfig()`/`saveDefaultConfig()`/`reloadConfig()`、`saveResource(String, boolean)`、`getResource(String)`、`getCommand(String)` → `PluginCommand`；`getPlugin(Class<T>)`/`getProvidingPlugin(Class)`。
- 1.12.2 仍有 `getDatabase()`（avaje ebean，1.13 移除，别用）；无其他新增生命周期方法。
- **服务端要求 Java 8**（1.12.2 起官方最低 Java 8；1.7.10 是 Java 7/8 皆可）。

## 2. 事件（EventListener + @EventHandler）

- 注册方式与注解同 1.7.10：`@EventHandler(priority = EventPriority.NORMAL, ignoreCancelled = false)`；`EventPriority` 顺序 `LOWEST < LOW < NORMAL < HIGH < HIGHEST < MONITOR`；`getServer().getPluginManager().registerEvents(listener, this)`。
- 1.7.10 全量事件仍在（PlayerJoin/Quit/Interact/Move、AsyncPlayerChatEvent、BlockBreak/Place、EntityDamageByEntity 等）。
- **1.9+ 新增（1.12.2 jar 实测）**：`PlayerSwapHandItemsEvent`（交换主副手）、`PlayerInteractAtEntityEvent`（对实体右键精确位置）、`PlayerArmorStandManipulateEvent`、`PlayerPickupArrowEvent`、`PlayerItemMendEvent`、`PlayerItemConsumeEvent`、`EntityBreedEvent`。
- **1.12 新增（实测）**：`PlayerAdvancementDoneEvent`（达成进度）、`PlayerLocaleChangeEvent`（客户端语言切换）、`PlayerResourcePackStatusEvent`（1.8.3 起）。
- 事件侧漏问题在混合服依旧存在（见 §9）。

## 3. 命令（CommandExecutor，1.13 前无 Brigadier）

- 签名与 1.7.10 相同（实测）：`boolean onCommand(CommandSender, Command, String label, String[] args)`；`getCommand("x").setExecutor(this)`；`CommandSender` 含 `sendMessage(String)`/`sendMessage(String[])`/`hasPermission(String)`/`getName()`。
- `TabCompleter.onTabComplete(CommandSender, Command, String, String[])` → `List<String>`；`PluginCommand.setTabCompleter()` 手动注册（同 1.7.10）。
- **现代差异**：无 Brigadier（1.13+）；无 `api-version` 声明；命令注册/补全流程与 1.7.10 完全相同。
- `Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "...")` 两线都有（实测 1.7.10）。

## 4. 文本与聊天（ChatColor 时代）

- `ChatColor` 常量集与 1.7.10 **完全相同**（16 色 + MAGIC/BOLD/STRIKETHROUGH/UNDERLINE/ITALIC/RESET，javap 实测两线常量表一致）。
- `ChatColor.translateAlternateColorCodes('&', s)`、`stripColor`、`getByChar`、`getLastColors` 均在。
- **现代差异**：仍无 hex 颜色（`#RRGGBB`/`&#` 1.16 起）；无 Adventure；聊天只能 `sendMessage(String)`。

## 5. 物品与方块（Material / ItemStack）

- `Material` 仍是拆分前状态：**无 `_LEGACY` 后缀**、无 1.13 flattening。1.7.10 的全部老常量在 1.12.2 仍在（`WOOD`、`LOG`、`SMOOTH_BRICK`、`THIN_GLASS`、`DIODE`、`HARD_CLAY`、`INK_SACK`…），唯一差异：`LOCKED_CHEST` 已删除（1.8 起）。
- **1.8~1.12 新增（1.12.2 相对 1.7.10，jar diff 实测 +121 个）**：`PRISMARINE`/`PRISMARINE_SHARD`/`SEA_LANTERN`、`SLIME_BLOCK`、`ARMOR_STAND`、`RABBIT`/`COOKED_RABBIT`/`RABBIT_STEW`、`MUTTON`/`COOKED_MUTTON`、`IRON_TRAPDOOR`、`SPRUCE/BIRCH/JUNGLE/ACACIA/DARK_OAK_*`（门/栅栏/栅栏门）、`CHORUS_*`/`PURPUR_*`/`END_ROD`/`END_BRICKS`（1.9 末地）、`BEETROOT*`、`ELYTRA`、`SHIELD`、`TOTEM`、`SPLASH_POTION`/`LINGERING_POTION`/`TIPPED_ARROW`/`SPECTRAL_ARROW`/`DRAGONS_BREATH`、`CONCRETE`/`CONCRETE_POWDER`/`*_GLAZED_TERRACOTTA`、`*_SHULKER_BOX`、`GRASS_PATH`、`OBSERVER`、`BONE_BLOCK`、`MAGMA`/`RED_NETHER_BRICK`/`NETHER_WART_BLOCK`、`DAYLIGHT_DETECTOR_INVERTED`、`RED_SANDSTONE*`、`BANNER`（`STANDING_BANNER`/`WALL_BANNER`）、`IRON_NUGGET`、`KNOWLEDGE_BOOK`、`END_CRYSTAL`、`BOAT_SPRUCE` 等染色木船、`STRUCTURE_*`。
- `ItemStack`（实测）：`getType()/setType(Material)`、`getTypeId()/setTypeId(int)`（仍存在，1.13 移除）、`getDurability()/setDurability(short)`、`getAmount()/setAmount(int)`、`isSimilar(ItemStack)`、`getItemMeta()/setItemMeta(ItemMeta)`。
- `ItemMeta`（实测）：1.7.10 全部方法 + **1.12 新增 `getLocalizedName()/setLocalizedName(String)`**；`isUnbreakable()/setUnbreakable(boolean)`（实测存在）。
- **1.9 新增**：`PlayerInventory.getItemInMainHand()/getItemInOffHand()`；`getItemInHand()` 仍存在且实测带 `@Deprecated` 注解（类文件验证）。`Particle` 枚举 + `Player#spawnParticle(Particle, ...)`（实测 1.12.2 存在）。
- **1.12 新增**：`org.bukkit.NamespacedKey`（实测；1.7.10 无此包）、`org.bukkit.advancement.Advancement` / `AdvancementProgress`，`Player#getAdvancementProgress(Advancement)`（实测）。
- 改名对照表见 bukkit-1.7.10.md §5（两线共享的老名字，1.13 才改）。

## 6. Scheduler

- 与 1.7.10 相同（实测）：`runTask`/`runTaskLater`/`runTaskTimer`/`runTaskAsynchronously`（+Timer 变体）；`BukkitRunnable`；`scheduleSyncDelayedTask` 等老方法仍在（弃用）。
- 异步任务注意事项不变：异步里禁止碰主线程 API（方块、物品栏、传送）；聊天事件 `AsyncPlayerChatEvent` 是异步触发。

## 7. Player / World / Block / Location / 配置

- 1.7.10 全部常用方法不变（`sendMessage`/`teleport`/`getInventory`/`hasPermission`/`getUniqueId`/`getItemInHand`…）。
- **1.12 新增（实测）**：`Player#getLocale()`（返回客户端语言，如 `"zh_cn"`；1.14 前唯一本地化途径）、`Player#getAdvancementProgress(Advancement)`。
- **1.9 新增**：`Player#spawnParticle(Particle, ...)` 多重重载、`Player#getHealthScale()`。
- **1.8 新增**：`Player#setResourcePack(String url)` / `(String, byte[])`（实测）；`World#getWorldBorder()` → `org.bukkit.WorldBorder`（实测）。
- `Server#getOnlinePlayers()` 返回 `Collection<? extends Player>`（实测；1.12.2 jar 中**无** 1.7.10 的 `_INVALID_getOnlinePlayers` 变体）。
- `World`/`Block`/`Location`/`ConfigurationSection`（config 访问器）与 1.7.10 完全一致，签名见 bukkit-1.7.10.md §7。

## 8. plugin.yml 字段表（1.12.2）

- 与 1.7.10 字段集相同：必填 `name`/`version`/`main`；可选 `description`/`author`/`authors`/`website`/`load`（STARTUP|POSTWORLD）/`depend`/`softdepend`/`prefix`/`commands`/`permissions`。
- `commands` 子字段：`description`/`usage`/`permission`/`permission-message`/`aliases`；`permissions` 子字段：`description`/`default`（true|false|op|not-op）/`children`。
- **无 `api-version`**（1.13 才引入；1.12.2 服务端会忽略未知字段，但规范上禁止写）。
- 1.12.2 服务端解析比 1.7.10 严格：`main` 类不存在/不继承 JavaPlugin 时直接拒绝加载并报 `Invalid plugin.yml` 类错误。

## 9. 混合服差异（1.12.2）

- **Mohist 1.12.2**（Thermos 系在 1.12.2 的继承，社区 EOL 但可用；插件兼容性评价较好，部分低版本 NMS 插件需适配）与 **CatServer 1.12.2**（国产 Forge+Bukkit+Spigot 混合服，声称兼容 95%+ 主流插件）为 1.12.2 线主要混合服；1.7.10 的 KCauldron/Thermos 不适用于 1.12.2。
- 插件照常进 `plugins/`；已知问题同 1.7.10 线：事件侧漏、NMS 差异、WorldEdit 需补丁版（`worldedit-forge-mohist` 分支）。
- 用混合服前先确认目标插件/模组在混合服的已知兼容清单；社区对混合服稳定性普遍持保留态度（查官方论坛/仓库 issue 确认具体版本行为）。

## 10. 核对来源

- 本文件签名：hub.spigotmc.org spigot-api-1.12.2-R0.1-SNAPSHOT（timestamped 20180712.012057-156）javap 反编译，2026-08-16 实测。所有条目均以类文件为准；个别行为性描述（如混合服兼容清单）以官方论坛/仓库 issue 为准。
