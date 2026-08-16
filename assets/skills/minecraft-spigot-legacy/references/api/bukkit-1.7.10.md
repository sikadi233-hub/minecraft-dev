# Bukkit API 参考（Minecraft 1.7.10）

- API 版本：spigot-api 1.7.10-R0.1-SNAPSHOT（无公共 maven，模板走 vendored 服务端 jar）。
- 核对基准（2026-08-16）：maven.enginehub.org 上 `org.bukkit:bukkit:1.7.10-R0.1-SNAPSHOT`（build 20140817.175650-8）的 jar + javadoc jar，javap 反编译核对。1.7.10 时代 spigot-api 与 bukkit API 类集相同（服务端 jar 未混淆），签名以此为准。
- **铁律：签名一律查本文件，禁止凭记忆写签名。** 与 1.13+ 现代 API 的差异在每节显式标注。

## 1. JavaPlugin 生命周期（org.bukkit.plugin.java.JavaPlugin）

- 主类 `public final class X extends JavaPlugin`；服务端从 plugin.yml 的 `main:` 定位。
- 调用顺序：构造 → `onLoad()`（加载 jar 后立刻）→ 服务器启动完成时 `onEnable()` → 关闭/reload 时 `onDisable()`。`onEnable()` 里做注册事件/命令/加载配置；`onDisable()` 里取消任务、关连接。
- 核心方法（javap 实测）：`getLogger()` → `java.util.logging.Logger`（`getLogger().info()` 输出带 `[插件名]` 前缀）；`getDataFolder()` → `File`；`getConfig()` → `FileConfiguration`；`saveConfig()`/`saveDefaultConfig()`（默认配置需先放 `src/main/resources/config.yml`）/`reloadConfig()`；`saveResource(String path, boolean replace)`；`getResource(String)` → `InputStream`；`getCommand(String)` → `PluginCommand`。
- JavaPlugin 自身就声明 `onCommand(CommandSender, Command, String, String[])` 与 `onTabComplete(...)`（默认委托给 setExecutor 注册的对象），所以主类可以直接 `implements CommandExecutor` 被设进去。
- 老线特有：`getDatabase()` → `com.avaje.ebean.EbeanServer`（avaje ebean 数据库，1.13 移除，别用）。
- **现代差异**：1.13 起才有 `getLogger().info` 之外的 adventure；`getPlugin(Class<T>)`/`getProvidingPlugin(Class)` 两线都有（实测）。

## 2. 事件（EventListener + @EventHandler）

- 监听器类 `implements Listener`（空标记接口）+ 方法加 `@EventHandler`，注册：`getServer().getPluginManager().registerEvents(new XListener(), this);`。
- `@EventHandler`（实测）：`EventPriority priority()` 默认 `NORMAL`；`boolean ignoreCancelled()` 默认 `false`。
- `EventPriority` 常量（顺序即调用顺序）：`LOWEST < LOW < NORMAL < HIGH < HIGHEST < MONITOR`。MONITOR 仅供记录，禁止改事件结果。
- 常用事件（1.7.10 jar 实测存在）：`PlayerJoinEvent` / `PlayerQuitEvent` / `PlayerLoginEvent` / `PlayerInteractEvent` / `PlayerMoveEvent` / `PlayerChatEvent`（**同步，@Deprecated**）/ `AsyncPlayerChatEvent`（异步，推荐）/ `PlayerCommandPreprocessEvent` / `PlayerDeathEvent` / `PlayerRespawnEvent` / `PlayerDropItemEvent` / `PlayerPickupItemEvent` / `BlockBreakEvent` / `BlockPlaceEvent` / `EntityDamageByEntityEvent` / `EntityDeathEvent` / `CreatureSpawnEvent` / `InventoryClickEvent` / `ServerCommandEvent`。
- 取被取消状态：`e.isCancelled()` / `e.setCancelled(true)`（Cancellable 子接口）。
- **现代差异**：1.8.3 前的教程只讲 `PlayerChatEvent`；`AsyncPlayerChatEvent` 在 1.7.10 已存在（本 jar 实测）。事件基类名与注册方式与现代一致，别的方法签名以本文件为准。

## 3. 命令（CommandExecutor，无 Brigadier）

- plugin.yml 声明 commands（见 §8）→ `getCommand("mycmd").setExecutor(this)`（主类 `implements CommandExecutor`）。
- 签名（实测）：`public boolean onCommand(CommandSender sender, Command command, String label, String[] args)`。返回 `true` = 处理完；`false` = 服务端显示 plugin.yml 里的 `usage:`。
- `CommandSender`：`sendMessage(String)` / `sendMessage(String[])` / `getServer()` / `getName()` / `hasPermission(String)`（继承自 `Permissible`）。
- **tab 补全**：`org.bukkit.command.TabCompleter` 接口 1.7.10 就存在（1.4.6 引入），签名 `public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args)`；经 `PluginCommand.setTabCompleter()` 手动注册（实测 PluginCommand 有 setExecutor/getExecutor/setTabCompleter/getTabCompleter）。
- **现代差异**：1.13 起才有 Brigadier 与 Paper 的命令 API；老线没有 `CommandSendEvent` 之类（查官方确认）以外的命令事件，补全全靠 TabCompleter。

## 4. 文本与聊天（ChatColor 时代，无 Adventure）

- `org.bukkit.ChatColor` 常量（实测，16 色 + 格式码）：`BLACK DARK_BLUE DARK_GREEN DARK_AQUA DARK_RED DARK_PURPLE GOLD GRAY DARK_GRAY BLUE GREEN AQUA RED LIGHT_PURPLE YELLOW WHITE MAGIC BOLD STRIKETHROUGH UNDERLINE ITALIC RESET`。
- 用法：`ChatColor.translateAlternateColorCodes('&', "&a绿字 &l加粗")` → § 码；`String.valueOf(ChatColor.RED)` = `"§c"`。
- 其他静态方法（实测）：`stripColor(String)`、`getByChar(char)`、`getByChar(String)`、`getLastColors(String)`。
- **现代差异**：无 hex 颜色（`&#RRGGBB` 与 `#RRGGBB` 均 1.16+）；无 Adventure 组件；`sendMessage(String)` 只能纯文本。

## 5. 物品与方块（Material / ItemStack，拆分前状态）

- `Material` 老常量（1.7.10 jar 实测，1.13 前的名字一直用到 1.12.2）：`WOOD`（木板）、`LOG`、`LEAVES`、`SMOOTH_BRICK`（石砖）、`THIN_GLASS`（玻璃板）、`IRON_FENCE`（铁栏杆）、`NETHER_FENCE`、`STEP`/`DOUBLE_STEP`（石台阶）、`WOOD_STEP`、`STONE_PLATE`/`WOOD_PLATE`/`GOLD_PLATE`/`IRON_PLATE`（压力板）、`DIODE`（中继器）、`COMMAND`（命令方块）、`HARD_CLAY`/`STAINED_CLAY`（陶瓦）、`INK_SACK`、`RAW_FISH`/`COOKED_FISH`、`SULPHUR`（火药）、`NETHER_STALK`（地狱疣）、`SEEDS`、`WATCH`（时钟）、`EYE_OF_ENDER`、`SPECKLED_MELON`、`IRON_DOOR_BLOCK` + `IRON_DOOR`、`SKULL_ITEM`、`BREWING_STAND_ITEM`、`CAULDRON_ITEM`、`FLOWER_POT_ITEM`、`CARROT_ITEM`/`POTATO_ITEM`、`GOLD_RECORD`… 1.7.10 **没有** `COBBLESTONE_WALL`（1.8 起）；有 `LOCKED_CHEST`（1.8 起删除）；有 `REDSTONE_COMPARATOR`。
- 1.13 改名对照（老代码迁移现代时用）：`WOOD→OAK_PLANKS`、`LOG→OAK_LOG`、`SMOOTH_BRICK→STONE_BRICKS`、`THIN_GLASS→GLASS_PANE`、`IRON_FENCE→IRON_BARS`、`STEP→STONE_SLAB`、`DIODE→REPEATER`、`COMMAND→COMMAND_BLOCK`、`HARD_CLAY→TERRACOTTA`、`STAINED_CLAY→<色>_TERRACOTTA`、`INK_SACK→INK_SAC`、`RAW_FISH→COD`、`SULPHUR→GUNPOWDER`、`SEEDS→WHEAT_SEEDS`、`WATCH→CLOCK`、`WOOD_*→WOODEN_*`、`IRON_SPADE→IRON_SHOVEL`。**老线项目里写现代名直接编译不过。**
- `Material.matchMaterial(String)` / `Material.valueOf(String)` 与 1.13 同名（现代差异：1.13 起 matchMaterial 可解析新名并弃用旧名）。
- `ItemStack`（实测）：`new ItemStack(Material.X)`（另有 `(Material, int amount)`、`(Material, int, short damage)`）；`getType()/setType(Material)`；`getTypeId()/setTypeId(int)`（**1.13 移除**，老线保留）；`getAmount()/setAmount(int)`；`getDurability()/setDurability(short)`；`isSimilar(ItemStack)`（忽略数量比较）；`getItemMeta()/setItemMeta(ItemMeta)`。
- `ItemMeta`（实测）：`hasDisplayName()/getDisplayName()/setDisplayName(String)`、`hasLore()/getLore()/setLore(List<String>)`、`hasEnchants()/addEnchant(Enchantment, int, boolean)/removeEnchant(...)`；子接口 `SkullMeta`（`setOwner(String)`）等。
- **现代差异**：无 `getItemInMainHand()`（1.9 起才有），1.7.10 只有 `PlayerInventory.getItemInHand()/setItemInHand(ItemStack)`（实测）。

## 6. Scheduler

- `Bukkit.getScheduler()` → `org.bukkit.scheduler.BukkitScheduler`。
- 推荐（实测）：`runTask(Plugin, Runnable)` → 下一 tick 主线程；`runTaskLater(Plugin, Runnable, long delay)`；`runTaskTimer(Plugin, Runnable, long delay, long period)`；`runTaskAsynchronously(Plugin, Runnable)`（异步，禁止碰主线程 API）。
- 老方法 `scheduleSyncDelayedTask` / `scheduleSyncRepeatingTask` / `scheduleAsyncDelayedTask` 存在但已弃用，别写新代码用。
- `org.bukkit.scheduler.BukkitRunnable`（实测存在）：`extends Runnable` 的抽象类，`run()` 里放逻辑，`cancel()` 取消，`getTaskId()`。配 `runTask(this)` 时第一个参数传插件实例。

## 7. Player / World / Block / Location / 配置

- `Player`（实测关键签名）：`sendMessage(String)`；`teleport(Location)` → `boolean`（还有带 `PlayerTeleportEvent.TeleportCause` 的重载）；`getLocation()` → `Location`；`getInventory()` → `PlayerInventory`；`hasPermission(String)`；`getUniqueId()`；`isOp()`；`getDisplayName()`/`getPlayerListName()`；`getItemInHand()`；`kickPlayer(String)`；`playSound(Location, Sound, float, float)`；`getExp()/setExp(float)`、`getLevel()/setLevel(int)`、`getHealth()/setHealth(double)`；成就/统计：`awardAchievement(Achievement)`、`getStatistic(Statistic)`（实测 1.7.10 已有）。
- `World`（实测）：`getBlockAt(int x, int y, int z)` / `getBlockAt(Location)`；`dropItem(Location, ItemStack)` / `dropItemNaturally(...)` → `org.bukkit.entity.Item`；`getPlayers()` → `List<Player>`；`getSpawnLocation()`；`getTime()/setTime(long)`；`getName()`；`getWorldType()`。
- `Block`（实测）：`getType()/setType(Material)`；`getData()/setData(byte)`（数据值时代，1.13 后 setData 移除）；`getLocation()`；`getWorld()`；`getX()/getY()/getZ()`。
- `Location`：构造 `new Location(World, double, double, double)` 或 `(World, double, double, double, float yaw, float pitch)`；`getWorld()/getX()/getY()/getZ()/getYaw()/getPitch()/getBlock()`。
- 配置（实测 `ConfigurationSection`）：`getString(path)`/`getString(path, def)`、`getInt`、`getBoolean`、`getDouble`（均带默认值重载）、`getStringList(path)`、`getList`、`set(path, value)`、`contains(path)`、`getKeys(boolean deep)`、`createSection(path)`、`getConfigurationSection(path)`。
- `Server`（实测）：`getOnlinePlayers()` → **`Collection<? extends Player>`**（同时有 `@Deprecated` 的 `_INVALID_getOnlinePlayers()` 返回 `Player[]`，别用）；`getPlayer(String)`/`getPlayer(UUID)`；`getPluginManager()`；`getScheduler()`；`getVersion()`/`getBukkitVersion()`；`getMotd()`。`Bukkit` 静态：`Bukkit.getServer()`、`Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "cmd")`、`Bukkit.broadcastMessage(String)`。
- **现代差异**：`getOnlinePlayers()` 返回类型两线相同（都是 Collection），但老插件常按 `Player[]` 写，`toArray(new Player[0])` 转换。

## 8. plugin.yml 字段表（1.7.10）

- 必填：`name` / `version` / `main`（全限定类名）。
- 可选：`description` / `author` / `authors`（列表）/ `website` / `load`（`STARTUP`|`POSTWORLD`，默认 POSTWORLD）/ `depend`（列表）/ `softdepend` / `prefix`（日志前缀）/ `commands` / `permissions` / `database`（avaje ebean，别用）。
- `commands` 子字段：`description` / `usage` / `permission` / `permission-message` / `aliases`。
- `permissions` 子字段：`description` / `default`（`true`|`false`|`op`|`not-op`）/ `children`。
- **无 `api-version`**（1.13 才引入；老线写它无益）。
- 1.7.10 服务端解析宽松，字段最小集（name/version/main）即可加载。

## 9. 混合服差异（Cauldron / KCauldron / Thermos）

- 插件照常进 `plugins/`，plugin.yml 与纯 Spigot 一致。
- 已知问题：部分 Forge 事件不触发 Bukkit 监听器（事件侧漏）；NMS（net.minecraft.server）引用在混合服可能不兼容；WorldEdit 类插件需要混合服补丁版。KCauldron 需 Java 7、Thermos 需 Java 8（插件按 8 编译即可跑 Thermos）。
- 模组联动（软依赖检测、Forge 侧 API）见 minecraft-major-mods 技能。

## 10. 核对来源

- 本文件签名：enginehub `org.bukkit:bukkit:1.7.10-R0.1-SNAPSHOT`（build 20140817.175650-8）javap/javadoc，2026-08-16 实测。
- 标注"查官方"的条目（如 §3 备注的 CommandSendEvent 外的事件）：以官方 javadoc 或 vendored jar 反编译为准，勿凭记忆。
