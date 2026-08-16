# Paper 调度与配置 API 参考

> 适用：Paper/Spigot 1.20.x / 1.21.x / 26.x。
> 核对来源：Bukkit javadoc + docs.papermc.io（Folia 章节）；核对日期：2026-08。

## 1. BukkitRunnable（推荐写法）

```java
import org.bukkit.scheduler.BukkitRunnable;

// 一次性，延迟 100 tick（5 秒）后执行
new BukkitRunnable() {
    @Override
    public void run() {
        getLogger().info("延迟执行");
    }
}.runTaskLater(this, 100L);

// 循环任务：延迟 20 tick，每 40 tick（2 秒）执行一次
new BukkitRunnable() {
    @Override
    public void run() {
        // 主线程逻辑
    }
}.runTaskTimer(this, 20L, 40L);

// 异步版本（禁止碰任何 Bukkit API/世界/玩家对象！）
new BukkitRunnable() {
    @Override
    public void run() {
        // 只做网络/IO 计算
    }
}.runTaskAsynchronously(this);

// 取消：保存任务引用后
task.cancel();
```

参数单位是 **tick（1 tick = 50ms，20 tick = 1 秒）**。

## 2. Bukkit.getScheduler() 静态方式

```java
BukkitRunnable task = new BukkitRunnable() { ... };
task.runTask(plugin);                    // 下一 tick 主线程
task.runTaskAsynchronously(plugin);
task.runTaskLater(plugin, long delay);
task.runTaskTimer(plugin, long delay, long period);

// 批量管理
Bukkit.getScheduler().cancelTasks(plugin);      // 取消插件全部任务
Bukkit.getScheduler().isPrimaryThread();        // 当前是否主线程（1.21 正式名）
```

## 3. 主线程铁律

- **所有世界/方块/实体/物品栏修改必须在主线程**。异步任务里碰它们轻则异常（1.14+ 直接报 `IllegalPluginAccess`），重则崩服。
- 异步 → 主线程回切模式：

```java
new BukkitRunnable() {
    @Override
    public void run() {
        String data = fetchFromWeb();                    // 异步安全
        new BukkitRunnable() {
            @Override
            public void run() {
                player.sendMessage(data);                // 主线程安全
            }
        }.runTask(plugin);
    }
}.runTaskAsynchronously(plugin);
```

- **Folia 例外**：Folia 没有全局主线程，按区域调度（`entityScheduler`/`regionScheduler`/`globalRegionScheduler`）。写 Folia 兼容插件才需要处理，普通 Paper 插件用上面写法即可，但 Folia 上 `runTask` 会抛异常——文档里声明兼容范围。

## 4. 配置文件（config.yml）

### 默认值 + 加载

```java
// 插件 jar 内放 config.yml 时，首次启动自动复制到 data 目录：
saveDefaultConfig();                       // 存在则不覆盖
reloadConfig();                             // 重读磁盘
FileConfiguration cfg = getConfig();        // 持有当前配置
getDataFolder();                            // plugins/<name>/ 目录
```

### 读取

```java
cfg.getString("prefix");                          // 缺省返回 null
cfg.getString("path.key", "默认值");
cfg.getInt("amount");        cfg.getInt("amount", 10);
cfg.getBoolean("enabled");   cfg.getDouble("ratio");
cfg.getStringList("blocked-worlds");              // List<String>
cfg.getConfigurationSection("sections.name");     // 子节
cfg.isSet("key");                                 // 是否存在
cfg.set("key", value);  cfg.save();               // 运行时写入
```

### config.yml 示例

```yaml
prefix: "[MyPlugin] "
welcome-message: 欢迎加入服务器!
limits:
  max-homes: 5
blocked-worlds:
  - world_nether
```

## 5. 常见坑

- **tick 单位**：`runTaskLater` 的 delay 是 tick 不是毫秒——写"延迟 5 秒"要传 `100L`。
- **忘了 cancel**：循环任务在 `onDisable` 不 cancel 会热重载残留。
- **异步回调直接改世界**：按第 3 节回切。
- **配置热改**：玩家命令改配置后要 `cfg.save()` 才会落盘。
