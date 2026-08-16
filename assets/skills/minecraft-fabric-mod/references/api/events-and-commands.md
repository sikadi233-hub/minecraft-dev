# Fabric 事件与命令 API 参考

> 核对日期：2026-08。签名核对来源：
> - CommandRegistrationCallback：fabric-api 源码 `fabric-command-api-v2`（https://github.com/FabricMC/fabric-api ）与官方 javadoc（https://fabricmc.net/develop/ 的 Javadoc 入口）
> - Fabric Wiki「Creating Commands」：https://wiki.fabricmc.net/tutorial:commands
> - 生命周期事件：https://docs.fabricmc.net/develop/events 与 fabric-api 源码
>
> 以下全部为 mojmap 名（本项目用 `loom.officialMojangMappings()`）。

## 1. 事件机制（Event<T>）

fabric-api 的事件都是 `Event<T>`：`SOME_EVENT.register(回调)` 注册、`SOME_EVENT.invoker().xxx()` 触发。回调是函数式接口，可用 Lambda。多个监听者都会执行（非 cancel 全部）——与 Forge 的总线模型不同，Fabric 没有全局事件总线，事件按模块静态字段挂。

## 2. 服务器生命周期事件（速查，完整见 entrypoints-and-lifecycle.md）

```java
ServerLifecycleEvents.SERVER_STARTING.register(server -> { ... });   // MinecraftServer 参数
ServerLifecycleEvents.SERVER_STARTED.register(server -> { ... });
ServerWorldEvents.LOAD.register((server, world) -> { ... });         // world: ServerLevel（mojmap）
```

## 3. 命令注册（fabric-command-api-v2）

### 3.1 回调签名

```java
// net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback
@FunctionalInterface
public interface CommandRegistrationCallback {
    void register(CommandDispatcher<ServerCommandSource> dispatcher,   // Yarn 名
                  CommandRegistryAccess registryAccess,
                  CommandManager.RegistrationEnvironment environment);
    Event<CommandRegistrationCallback> EVENT = ...;
}
```

mojmap 工程里参数类型对应为：
- `CommandDispatcher<CommandSourceStack>`（brigadier：`com.mojang.brigadier.CommandDispatcher`）
- `CommandBuildContext`（`net.minecraft.commands.CommandBuildContext`）
- `Commands.CommandSelection`（`net.minecraft.commands.Commands.CommandSelection`，枚举 `COMMON`/`INTEGRATED`/`DEDICATED`）

### 3.2 最小命令（在 onInitialize() 里注册）

```java
@Override
public void onInitialize() {
    CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> {
        dispatcher.register(Commands.literal("hello")
            .executes(ctx -> {
                ctx.getSource().sendSuccess(() -> Component.literal("Hello from {{name}}"), false);
                return 1;  // Command.SINGLE_SUCCESS
            }));
    });
}
```

要点：
- `Commands.literal(...)` / `Commands.argument(...)` 来自 `net.minecraft.commands.Commands`（mojmap；Yarn 名 `CommandManager`）。**建议静态导入** `Commands.literal` / `Commands.argument`，避免泛型推断问题（brigadier 的 S 必须显式为 `CommandSourceStack`）。
- `ctx.getSource()` 返回 `CommandSourceStack`（mojmap）；`sendSuccess(Supplier<Component>, boolean)` —— 1.20.2 起第一个参数是 `Supplier<Component>`，1.20.1 直接传 `Component`。
- `Component.literal(String)` 构造文本（mojmap `net.minecraft.network.chat.Component`；1.21.5 起 `MutableComponent` 更名为 `Component`）。
- 命令只在服务端注册生效（单机开档的局域网/单人也有 CommandSourceStack 侧命令）；客户端命令用 `ClientCommandRegistrationCallback`（`fabric-command-api-v2`，参数 `(dispatcher, registryAccess)`，来源类型 `FabricClientCommandSource`），按需再查。

### 3.3 带参数的命令骨架

```java
dispatcher.register(Commands.literal("giveitem")
    .requires(source -> source.hasPermission(2))
    .then(Commands.argument("item", ItemArgument.item(registryAccess))
        .executes(ctx -> {
            ItemStack stack = ItemArgument.getItem(ctx, "item");
            ctx.getSource().getPlayerOrException().getInventory().add(stack);
            return 1;
        })));
```

- 参数类型在 `net.minecraft.commands.arguments` 包（`ItemArgument`、`EntityArgument`、`BlockPosArgument` 等），构造时一般要传 `registryAccess`/`context`（即回调的第二个参数），数据包兼容的关键。
- 权限：`source.hasPermission(2)`（2=管理员）。

## 4. 其他常用事件（先查 javadoc 再写，以下只列位置）

| 模块 | 事件类（net.fabricmc.fabric.api.event.*） | 用途 |
|---|---|---|
| fabric-lifecycle-events-v1 | `ServerLifecycleEvents`、`ServerWorldEvents`、`ServerTickEvents` | 生命周期/tick |
| fabric-events-interaction-v1 | `AttackBlockCallback`、`UseBlockCallback`、`UseItemCallback`、`PlayerBlockBreakEvents` | 玩家交互 |
| fabric-item-group-api-v1 | `ItemGroupEvents` | 创造栏 |
| fabric-entity-events-v1 | `EntityElytraEvents`、`ServerEntityEvents` 等 | 实体相关 |
| fabric-networking-api-v1 | `ServerPlayNetworking`、`ClientPlayNetworking`（payload 注册 `PayloadTypeRegistry`） | 网络包 |
| fabric-command-api-v2 | `CommandRegistrationCallback`、`ClientCommandRegistrationCallback` | 命令 |

> 各回调的精确签名（参数类型/顺序）因版本而异：写之前查所钉 fabric-api 版本 javadoc（https://fabricmc.net/develop/ 的 Javadoc 入口）；
> 写完之后拿不准就在 IDE 里编译验证，不要凭记忆硬写。
