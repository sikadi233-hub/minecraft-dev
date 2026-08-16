# NeoForge 模组入口与事件总线 API 参考（21.x 主形态）

> 核对来源：docs.neoforged.net（events 教程、gettingstarted）+ 官方 MDK-1.21.11-ModDevGradle zip 实测；本机访问 neoforged 域名受限，签名以 V02_PLAN.md 附录核实（2026-08-16）为准。
> 核对日期：2026-08。标注「查 docs.neoforged.net」的条目表示存疑/版本敏感，写代码前用 IDE 补全或官方文档再确认。

## 1. @Mod 入口类

```java
package com.example.myplugin;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import org.slf4j.Logger;
import com.mojang.logging.LogUtils;

@Mod(MyPlugin.MODID)
public class MyPlugin {
    public static final String MODID = "my-plugin";   // 与 neoforge.mods.toml 的 modId 一致（小写）
    private static final Logger LOGGER = LogUtils.getLogger();

    public MyPlugin(IEventBus modEventBus) {
        // 构造器唯一参数是 mod bus（IEventBus）。
        // mod bus 注册点：DeferredRegister.register(modEventBus)、生命周期事件监听。
        NeoForge.EVENT_BUS.register(this);            // game bus 注册本实例
    }

    @SubscribeEvent
    public void onServerStarting(ServerStartingEvent event) {
        LOGGER.info("{} server starting", MODID);
    }
}
```

- 注解：`net.neoforged.fml.common.Mod`，`@Mod("<modid>")` 单参数形式（21.x 唯一形式）。
- 构造器注入 mod bus：`public MyPlugin(IEventBus modEventBus)`。modid 与 `neoforge.mods.toml` 的 `modId` 必须一致（`^[a-z][a-z0-9_]{1,63}$`）。
- 日志：NeoForge 用 SLF4J；`org.slf4j.Logger` + `com.mojang.logging.LogUtils.getLogger()`（Mojang 包装，dev 环境可用）。

## 2. 两条事件总线

| 总线 | 获取方式 | 承载事件 | 注册方法 |
|---|---|---|---|
| **mod bus** | `@Mod` 构造器参数 `IEventBus` | 模组生命周期（FML*SetupEvent）、注册（RegisterEvent、DeferredRegister 内部注册） | `modEventBus.addListener(this::method)`；`modEventBus.register(this)` 也可启用该实例上的 `@SubscribeEvent` |
| **game bus** | `NeoForge.EVENT_BUS`（`net.neoforged.neoforge.common.NeoForge`） | 游戏运行期事件（ServerStartingEvent、EntityJoinLevelEvent、PlayerEvent.* 等） | `NeoForge.EVENT_BUS.register(this)` |

- 事件处理器两种写法：
  1. 实例方法 + `@SubscribeEvent`，对象需 `bus.register(this)`（上表两种总线均可）；
  2. 静态方法 + `@SubscribeEvent`，所在类标注 `@EventBusSubscriber(modid = ..., bus = EventBusSubscriber.Bus.GAME)`（`net.neoforged.fml.common.EventBusSubscriber`；bus 默认 GAME，写 MOD 则挂在 mod bus）。
- `@SubscribeEvent`：`net.neoforged.bus.api.SubscribeEvent`。方法必须 public、恰好一个事件参数；同一实例注册多个总线时注意事件归属（把 mod bus 事件写在 game bus 上永远不会触发）。

## 3. 常用事件签名（21.x）

mod bus 生命周期事件（包 `net.neoforged.fml.event.lifecycle`）：

```java
public void commonSetup(FMLCommonSetupEvent event)   // 通用初始化；event.enqueueWork(() -> { ... }) 把跨线程任务排入
public void clientSetup(FMLClientSetupEvent event)   // 仅客户端侧触发
public void dedicatedServerSetup(FMLDedicatedServerSetupEvent event) // 仅专用服务器侧触发
```

game bus 事件（包 `net.neoforged.neoforge.event.*`）：

```java
public void onServerStarting(ServerStartingEvent event)          // event.getServer() : MinecraftServer
public void onServerStarted(ServerStartedEvent event)
public void onServerStopping(ServerStoppingEvent event)
public void onServerStopped(ServerStoppedEvent event)
public void onEntityJoinLevel(EntityJoinLevelEvent event)        // net.neoforged.neoforge.event.entity.EntityJoinLevelEvent；getEntity() / getLevel()
public void onPlayerLoggedIn(PlayerEvent.PlayerLoggedInEvent event) // net.neoforged.neoforge.event.entity.player.PlayerEvent；getEntity() : Player
```

- 注册事件（mod bus）：`net.neoforged.neoforge.registries.RegisterEvent`。签名版本敏感（register(ResourceKey, Consumer<RegisterEvent.RegisterHelper<T>>) 等），**查 docs.neoforged.net / IDE 补全**；日常注册优先用 DeferredRegister（见 deferred-register.md），RegisterEvent 只在动态补注册时用。

## 4. 服务端/客户端 side 处理

- 21.x 服务端与客户端代码同属 `sourceSets.main`（无独立 client source set 默认配置），用 `@EventBusSubscriber(dist = Dist.CLIENT)`（`net.neoforged.api.distmarker.Dist`）把客户端专属监听器隔离；或 `event.getDist()` 判断。
- 更重型的方案：`@OnlyIn(Dist.CLIENT)`（同包）标注客户端专属方法/字段。
