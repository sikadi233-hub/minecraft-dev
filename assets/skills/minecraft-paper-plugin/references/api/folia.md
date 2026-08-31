# Folia 专属参考（调度模型与兼容写法）

> 适用：Paper 家族 Folia 分支（分区调度，无 Bukkit 同步调度器）。
> 核对日期：2026-08。机制来源：PaperMC/Folia patch `0003-Require-plugins-to-be-explicitly-marked-as-Folia-supported`（api-version ≥1.19.4 = 显式标记）；API 签名以 docs.papermc.io 与 folia-api javadoc 为准。

## 1. 一句话

Folia 没有"主线程"——世界按**区域（region）**分线程调度，实体/方块归属各自区域线程。**写插件前必须确认服务器是否 Folia**（intake 必问项）：普通 Paper 插件在 Folia 上调用 Bukkit 同步调度器会直接抛异常。

## 2. 加载门槛（显式标记机制）

- Folia 只加载**显式标记支持**的插件：plugin.yml 的 `api-version` ≥ **1.19.4**（这就是 Folia 的标记机制，patch 名即证据；旧插件直接拒绝加载）。
- 写法：`api-version: "1.19.4"`（1.x 时代主次版本格式；26.x 服务器按 Paper 规则写 major.minor）。
- 想同时兼容 Paper 与 Folia：api-version 声明满足 Folia，代码用运行时检测（§6）分流。

## 3. 生命周期事件（Folia 入口）

```java
import io.papermc.paper.threadedregions.RegionizedServerInitEvent;

@EventHandler
public void onInit(RegionizedServerInitEvent event) {
    // Folia 的"onEnable"级入口：此时可安全初始化全局状态
}
```

- 普通 `onEnable()` 在 Folia 上仍会调用，但**禁止在里面用 Bukkit 同步调度器**。
- 插件主类/监听器结构不变；仅调度与线程语义不同。

## 4. 调度器三件套（替代 Bukkit 同步调度器）

| 调度器 | 获取 | 用途 |
|---|---|---|
| 全局区域调度器 | `Bukkit.getGlobalRegionScheduler()` | 跨区域全局任务（世界无关逻辑、延时/周期任务） |
| 区域调度器 | `Bukkit.getRegionScheduler()` | 在**指定位置所在区域**执行任务 |
| 异步调度器 | `Bukkit.getAsyncScheduler()` | 异步计算（替代 runTaskAsynchronously） |

```java
// 全局延时/周期任务（替代 runTaskTimer）
Bukkit.getGlobalRegionScheduler().runDelayed(plugin, task -> {
    // 全局逻辑（不碰具体实体/方块）
}, 20L);

// 在某个位置所在区域执行（替代 runTask 但绑定区域）
Bukkit.getRegionScheduler().run(plugin, location, task -> {
    world.setBlockState(...); // 该区域的方块操作安全
});

// 异步（替代 runTaskAsynchronously）
Bukkit.getAsyncScheduler().runNow(plugin, task -> {
    // 网络/IO/计算
});
```

- 实体侧：`entity.getScheduler().run(plugin, task -> {...})`（EntityScheduler，实体归属区域线程执行，自动处理卸载）。
- **取消**：各调度器返回 `ScheduledTask`，`task.cancel()`；`Bukkit.getGlobalRegionScheduler().cancelTasks(plugin)` 全清。

## 5. 区域线程规则（写代码时的心智模型）

- 每个区域一个线程：**只能安全操作当前区域线程拥有的实体/方块**；跨区域碰别人区域的实体 = 数据竞争/崩溃。
- 不要持有实体引用跨 tick 使用（区域可能卸载/迁移）；需要持久数据用 `RegionizedData`（实体/方块附加数据，自动按区域隔离）：
  ```java
  import io.papermc.paper.threadedregions.RegionizedData;
  RegionizedData<MyData> data = entity.getOrCreatePersistentData(...); // 语义：区域隔离的插件数据
  ```
- 世界级操作（如全服广播、全局变量）放全局区域调度器；区块加载用 `ChunkLoadRequest`/异步预加载（Folia 无同步 chunk 加载保证）。
- 事件监听器：绝大多数 Bukkit 事件在 Folia 上照常触发，但事件抛出的线程是**所在区域线程**——监听器里直接改世界安全（同区域），跨区域逻辑要小心。

## 6. 运行时检测（一 jar 兼容两端的写法）

```java
public static boolean isFolia() {
    try {
        Class.forName("io.papermc.paper.threadedregions.RegionizedServerInitEvent");
        return true;
    } catch (ClassNotFoundException e) {
        return false;
    }
}
```

- 调度封装：`isFolia()` ? 用 §4 调度器 : 用 BukkitRunnable。
- 声明兼容：plugin.yml `api-version: "1.19.4"`（Folia 门槛）+ 服务器文档注明"Paper 与 Folia 均支持"。

## 7. 常见坑（Folia 专属）

- **直接调 Bukkit 同步调度器** → 运行时异常（Folia 上 runTask/runTaskLater 不可用）。
- **跨区域碰实体** → 偶发崩溃/数据竞争，难复现（写代码时就按 §5 隔离）。
- **onEnable 里做世界操作** → 区域尚未初始化，行为未定义；用 RegionizedServerInitEvent。
- **热重载**：Folia 社区同样不推荐 /reload（与 Paper 一致）。
- **api-version 过低** → Folia 拒绝加载（连警告都未必有，检查 plugin.yml）。
