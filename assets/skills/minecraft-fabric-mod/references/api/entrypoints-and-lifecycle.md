# Fabric 入口点与生命周期 API 参考

> 核对日期：2026-08。签名核对来源：
> - 入口点接口：fabric-loader 源码 `net.fabricmc.api`（https://github.com/FabricMC/fabric-loader ）与 Fabric Wiki「Entrypoints」（https://wiki.fabricmc.net/documentation:entrypoint ）
> - 生命周期事件：fabric-api 源码 `fabric-lifecycle-events-v1`（https://github.com/FabricMC/fabric-api ）与官方 javadoc（https://fabricmc.net/develop/ 的 Javadoc 入口，Yarn 名）
> - 版本差异与改名：https://docs.fabricmc.net/develop/porting/ 与官方 porting 文档（26.x 线）
>
> 命名约定：本技能项目用 `loom.officialMojangMappings()`（mojmap），以下签名全部为 **mojmap 名**；
> 括号里标注的 Yarn 名是社区教程/官方 javadoc 常见写法，**mojmap 工程里不要混用**。

## 1. 入口点接口（net.fabricmc.api，fabric-loader 自带，无需 fabric-api）

fabric.mod.json 的 `entrypoints` 声明的类会被 loader 在对应时机实例化并调用（要求：类有公共无参构造器）。

| 入口点 key | 接口 | 方法 | 执行环境 |
|---|---|---|---|
| `"main"` | `net.fabricmc.api.ModInitializer` | `void onInitialize()` | 客户端 + 服务端都执行（最先） |
| `"client"` | `net.fabricmc.api.ClientModInitializer` | `void onInitializeClient()` | 仅客户端 |
| `"server"` | `net.fabricmc.api.DedicatedServerModInitializer` | `void onInitializeServer()` | 仅专用服务端 |
| `"preLaunch"` | `net.fabricmc.api.PreLaunchEntrypoint` | `void onPreLaunch()` | 游戏启动前（一般不用） |

```java
// 最小写法（本项目模板即如此）
public class ExampleMod implements ModInitializer, ClientModInitializer {
    @Override
    public void onInitialize() { /* 双端通用注册放这里 */ }
    @Override
    public void onInitializeClient() { /* 仅客户端注册放这里 */ }
}
```

- 三个接口都是 `@FunctionalInterface`（单方法），Lambda 或类实现均可，但 fabric.mod.json 里必须给类全限定名。
- 建议 `main` / `client` 用**独立类**：同一类同时进 main+client 时，服务端仍可能加载该类（引用客户端专用类如 `Screen`、`GuiGraphics` 会 `ClassNotFound`）。模板里主类只打日志是安全的，加客户端逻辑后应拆分。
- 物品/方块/事件/命令等注册一律放 `onInitialize()`，**不要**在字段初始化/静态块里注册（顺序无保证，且注册须在游戏 registry 冻结前）。

## 2. 服务器生命周期事件（net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents）

需要 fabric-api 的 `fabric-lifecycle-events-v1` 模块（我们依赖整个 fabric-api，已含）。
注册方式：`ServerLifecycleEvents.SERVER_STARTING.register(server -> { ... });`

```java
public final class ServerLifecycleEvents {
    public static final Event<ServerLifecycleEvents.ServerStarting> SERVER_STARTING;
    public static final Event<ServerLifecycleEvents.ServerStarted>   SERVER_STARTED;
    public static final Event<ServerLifecycleEvents.ServerStopping>  SERVER_STOPPING;
    public static final Event<ServerLifecycleEvents.ServerStopped>   SERVER_STOPPED;
    public static final Event<ServerLifecycleEvents.ServerExiting>   SERVER_EXITING;   // 1.19.3+ 有

    // 嵌套函数式接口（参数均为 MinecraftServer）：
    @FunctionalInterface public interface ServerStarting { void onServerStarting(MinecraftServer server); }
    @FunctionalInterface public interface ServerStarted   { void onServerStarted(MinecraftServer server); }
    @FunctionalInterface public interface ServerStopping  { void onServerStopping(MinecraftServer server); }
    @FunctionalInterface public interface ServerStopped   { void onServerStopped(MinecraftServer server); }
    @FunctionalInterface public interface ServerExiting   { void onServerExiting(MinecraftServer server); }
}
```

时序语义（官方 javadoc 说明）：
- `SERVER_STARTING`：服务端启动中，**PlayerManager 与所有世界尚未加载**。
- `SERVER_STARTED`：启动完成，即将进入第一个 tick，所有世界已就绪。
- `SERVER_STOPPING`：开始关闭，网络通道未关、玩家未断开，世界仍可修改。
- `SERVER_STOPPED`：已停止，世界已关闭。

另有两个常用于数据包/存档的（签名各版本略有出入，用时查所钉版本 javadoc）：
- `ServerLifecycleEvents.SYNC_DATA_PACK_CONTENTS`：登录或 `/reload` 后向玩家同步数据包前触发，参数为玩家。
- `ServerLifecycleEvents.BEFORE_SAVE` / `AFTER_SAVE`：存档保存前后。

## 3. 世界加载事件（ServerWorldEvents，Yarn 名）

```java
public final class ServerWorldEvents {
    public static final Event<ServerWorldEvents.Load>   LOAD;   // 世界加载完成后
    public static final Event<ServerWorldEvents.Unload> UNLOAD; // 世界卸载前

    @FunctionalInterface public interface Load   { void onWorldLoad(MinecraftServer server, ServerWorld world); }
    @FunctionalInterface public interface Unload { void onWorldUnload(MinecraftServer server, ServerWorld world); }
}
```

mojmap 名对照：`ServerWorld` → `net.minecraft.server.level.ServerLevel`。因此 mojmap 工程里写：

```java
ServerWorldEvents.LOAD.register((server, world) -> { ... });   // world 参数类型为 ServerLevel
```

- 26.x 注意：fabric-api 在 26.x 已将此类改名为 `ServerLevelEvents`（`net.fabricmc.fabric.api.event.lifecycle.v1.ServerLevelEvents`），参数类型同步为 `ServerLevel`。迁移时 `ServerWorldEvents` → `ServerLevelEvents` 全局改名即可。
- 老版本（1.18.2 之前）的 `ServerLifecycleEvents.SERVER_WORLD_LOAD / SERVER_WORLD_UNLOAD` 已废弃/移除，新代码用上面两个字段。

## 4. 其他常用事件速查（完整清单以官方 javadoc 为准）

| 事件（类名都在 net.fabricmc.fabric.api.event.lifecycle.v1 或 .server 包） | 用途 |
|---|---|
| `ServerTickEvents.START_SERVER_TICK / END_SERVER_TICK`（参数 MinecraftServer） | 每 tick 回调（不推荐做重活） |
| `ServerTickEvents.START_WORLD_TICK / END_WORLD_TICK`（MinecraftServer, ServerWorld/ServerLevel） | 每世界每 tick |
| `ServerLifecycleEvents.SERVER_STARTING` 等见上 | 生命周期 |
| `ServerEntityEvents.ENTITY_LOAD` / `ENTITY_UNLOAD` | 实体加载/卸载（签名查 javadoc） |

> 签名不确定时：一律查所钉 fabric-api 版本的 javadoc（https://fabricmc.net/develop/ 的 Javadoc 入口，选对应版本），
> 不要凭记忆写。Yarn 名 javadoc 与 mojmap 工程名的对照见第 5 节。

## 5. Yarn 名 ↔ mojmap 名对照（本技能工程用 mojmap）

fabric-api 源码与官方 javadoc 都是 Yarn 名，教程（wiki.fabricmc.net）也多用 Yarn 名；
我们的工程是 mojmap，看到 Yarn 名要能翻译，**不要混用两种命名**：

| 概念 | Yarn 名 | mojmap 名（本项目用） |
|---|---|---|
| 世界类 | `net.minecraft.server.world.ServerWorld` | `net.minecraft.server.level.ServerLevel` |
| 注册表实例常量 | `net.minecraft.registry.Registries`（Registry<Item> 实例） | `net.minecraft.core.registries.BuiltInRegistries` |
| 注册表 key 常量 | `net.minecraft.registry.RegistryKeys` | `net.minecraft.core.registries.Registries`（`Registries.ITEM` 是 ResourceKey） |
| 资源标识符 | `net.minecraft.util.Identifier` | 1.20.1：`net.minecraft.resources.ResourceLocation`；1.21.11+：`net.minecraft.resources.Identifier` |
| 物品设置 | `Item.Settings` | `Item.Properties` |
| 命令分发器 | `CommandDispatcher<ServerCommandSource>` | `CommandDispatcher<CommandSourceStack>` |
| 命令工厂 | `CommandManager.literal/argument` | `Commands.literal/argument`（`net.minecraft.commands.Commands`） |

> 26.1 起 Minecraft 不再混淆（Mojang 官方名直接可用，yarn 停更），mojmap 名即官方名；
> 26.x 下 `net.minecraft.resources.Identifier`（1.21.11 起 mojmap 由 ResourceLocation 改名而来）。
