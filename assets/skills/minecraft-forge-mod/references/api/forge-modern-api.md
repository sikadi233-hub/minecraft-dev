# Forge 现代 API 参考（1.16.5 / 1.20.1）

适用范围：Minecraft 1.16.5（Forge `36.2.39`，ForgeGradle 5.1.77 + Gradle 7.3.3）与 1.20.1（Forge `47.3.0`，ForgeGradle 6.0.54 + Gradle 8.8），映射 official（mojmap），元数据 mods.toml。
> 核对来源：Forge 官方 MDK zip（`maven.minecraftforge.net/net/minecraftforge/forge/forge-{1.16.5-36.2.39,1.20.1-47.3.0}-mdk.zip`，实测解包）、docs.minecraftforge.net（1.16.5/1.20.1 版本文档）、Forge javadoc（maven.minecraftforge.net）；在线核对日期 2026-08-16（与 V02_PLAN.md 附录一致）。
> 签名以本机依赖实际版本为准；标注「查官方 MDK」处为细节，写代码前先查对应时代 MDK/javadoc。

## 1. 模组入口

`net.minecraftforge.fml.common.Mod`，**单参 value 形态**（属性形态在 1.16 起废弃，1.20.1 只写单参）：

```java
@Mod(MyMod.MODID)
public class MyMod {
    public static final String MODID = "mymod"; // 与 mods.toml 的 modId 一致

    public MyMod() {
        // 构造器 = 1.16.5+ 的初始化入口（替代 @Mod.EventHandler）
        IEventBus modBus = FMLJavaModLoadingContext.get().getModEventBus();
        // TODO: DeferredRegister 注册（mod bus）+ 游戏事件（MinecraftForge.EVENT_BUS）
    }
}
```

1.16.5/1.20.1 **没有** FMLPreInitializationEvent 等生命周期事件；初始化全部在构造器内完成（mod bus 事件见 §2）。

## 2. 事件总线：mod bus vs game bus

1.16.5+ 双总线，类型都是 `net.minecraftforge.eventbus.api.IEventBus`：

| 总线 | 获取方式 | 用途 |
|---|---|---|
| **mod bus**（加载期） | `FMLJavaModLoadingContext.get().getModEventBus()` | 注册（DeferredRegister）、数据生成（GatherDataEvent）、加载期事件 |
| **game bus**（运行时） | `MinecraftForge.EVENT_BUS`（`net.minecraftforge.common.MinecraftForge` 的 `static final IEventBus`） | 游戏内事件：ServerStartingEvent、PlayerEvent、TickEvent 等 |

```java
// IEventBus 常用方法
bus.register(Object target);                       // 扫描 @SubscribeEvent 方法
bus.addListener(Consumer<? extends Event> c);      // 直接挂 lambda
bus.post(Event event) → boolean;

// game bus
MinecraftForge.EVENT_BUS.register(new MyEvents());
MinecraftForge.EVENT_BUS.addListener(MyEvents::onServerStarting);
```

`@SubscribeEvent` 包名：**`net.minecraftforge.eventbus.api.SubscribeEvent`**（1.16.5 起，老时代的 `fml.common.eventhandler.SubscribeEvent` 不存在了）。

`@EventBusSubscriber`（`net.minecraftforge.fml.common.Mod.EventBusSubscriber`，静态监听器类）：

```java
@Mod.EventBusSubscriber(modid = MyMod.MODID, bus = Mod.EventBusSubscriber.Bus.FORGE)
public class MyGameEvents {
    @SubscribeEvent
    public static void onServerStarting(ServerStartingEvent event) { }
}
// Bus.FORGE = game bus（默认）；Bus.MOD = mod bus；side = Dist.CLIENT 时仅客户端加载
```

常用 game bus 事件签名（1.16.5 与 1.20.1 一致，包 `net.minecraftforge.event.*`）：

| 事件 | 关键方法 |
|---|---|
| `server.ServerStartingEvent` | `getServer()` → `MinecraftServer` |
| `server.ServerStartedEvent` / `ServerStoppingEvent` / `ServerStoppedEvent` | `getServer()` → `MinecraftServer` |
| `RegisterCommandsEvent` | `getDispatcher()` → `CommandDispatcher<CommandSourceStack>`；`getEnvironment()` → `Commands.CommandSelection` |
| `entity.player.PlayerEvent.PlayerLoggedInEvent` | `getPlayer()` → `Player`（子事件按 javadoc） |
| `entity.living.LivingHurtEvent` | `getSource()` → `DamageSource`；`getAmount()`/`setAmount(float)`；`getEntity()` → `LivingEntity` |
| `TickEvent.ServerTickEvent` | 1.16.5：`getServer()`、`getPhase()` → `TickEvent.Phase`；1.20.1 拆分为 `ServerTickEvent.Pre`/`Post` 子类（查 MDK/javadoc） |

## 3. 注册（DeferredRegister + RegistryObject）

`net.minecraftforge.registries.DeferredRegister`（1.16.5 与 1.20.1 通用写法）：

```java
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;
import net.minecraftforge.eventbus.api.IEventBus;

public class MyMod {
    public static final String MODID = "mymod";

    public static final DeferredRegister<Block> BLOCKS =
        DeferredRegister.create(ForgeRegistries.BLOCKS, MODID);
    public static final DeferredRegister<Item> ITEMS =
        DeferredRegister.create(ForgeRegistries.ITEMS, MODID);

    public static final RegistryObject<Block> MY_BLOCK = BLOCKS.register("my_block",
        () -> new Block(AbstractBlock.Properties.of(Material.STONE).strength(2.0F)));
    public static final RegistryObject<Item> MY_ITEM = ITEMS.register("my_item",
        () -> new Item(new Item.Properties().tab(CreativeModeTab.TAB_MISC)));

    public MyMod() {
        IEventBus modBus = FMLJavaModLoadingContext.get().getModEventBus();
        BLOCKS.register(modBus);  // 挂到 mod bus 才生效
        ITEMS.register(modBus);
    }
}
```

- `DeferredRegister.create(IForgeRegistry<T> registry, String modid)`：1.16.5~1.20.1 都可用；1.20.1 另有 `create(RegistryKey<Registry<T>>, String modid)`（如 `ForgeRegistries.Keys.BLOCKS`）。
- `RegistryObject<T>`：`get()`、`isPresent()`、`getId()`、`getKey()` → `ResourceLocation`、`asOptional()`。
- 方块构造 1.16.5：`AbstractBlock.Properties.of(Material.STONE).strength(...)`（1.17+ 改名 `BlockBehaviour.Properties.of()`）；1.16.5 注册前需 `setRegistryName(ResourceLocation)`，1.20.1 由 DeferredRegister 自动设置注册名。
- 物品：1.16.5/1.20.1 都是 `new Item(new Item.Properties().tab(CreativeModeTab.TAB_MISC))`；`CreativeModeTab.TAB_*` 常量（1.20.1 存在，1.21 移除，NeoForge 时代另说）。
- 方块物品联动：1.16.5/1.20.1 均可用 `RegistryObject<Item>` 手动注册，或用 `ITEMS.register("my_block", () -> new BlockItem(MY_BLOCK.get(), new Item.Properties().tab(...)))`（查官方 MDK 的 ExampleMod）。

## 4. 命令（RegisterCommandsEvent + brigadier）

```java
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraft.commands.Commands;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;

@SubscribeEvent
public static void onRegisterCommands(RegisterCommandsEvent event) {
    CommandDispatcher<CommandSourceStack> dispatcher = event.getDispatcher();
    dispatcher.register(Commands.literal("mycmd")
        .then(Commands.argument("arg", StringArgumentType.string())
            .executes(ctx -> {
                // ctx.getSource() → CommandSourceStack
                // ctx.getSource().getPlayerOrException() → ServerPlayer
                return 1; // 返回值 = 命令执行结果
            })));
}
```

## 5. 客户端/服务端（DistExecutor / @OnlyIn）

1.16.5+ 替代 @SidedProxy：

```java
import net.minecraftforge.fml.DistExecutor;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.api.distmarker.OnlyIn;

// 构造器或初始化处按 side 分流：
DistExecutor.unsafeRunWhenOn(Dist.CLIENT, () -> () -> {
    // 客户端专用初始化（lambda 内写具体逻辑）
});

// safe 变体：DistExecutor.safeRunWhenOn(Dist.CLIENT, () -> SomeClientOnlyClass::new)
// 取值变体：DistExecutor.unsafeCallWhenOn(Dist.CLIENT, () -> () -> someClientValue)
```

`@OnlyIn(Dist.CLIENT)`（`net.minecraftforge.api.distmarker.OnlyIn`）标记客户端专用方法/字段；`Dist` 枚举：`CLIENT`、`DEDICATED_SERVER`。客户端渲染注册（模型/粒子/按键）必须在 Dist.CLIENT 分流里做，否则服务端崩溃。

## 6. 数据生成（runData / GatherDataEvent）

- 构建：`gradlew runData`，输出 `src/generated/resources/`（模板已把该目录加进 sourceSets resources）；runData 再配合 `gradlew build` 或 `runClient` 使用。
- 事件挂 **mod bus**：`GatherDataEvent`（包名两时代不同：1.16.5 为 `net.minecraftforge.event.GatherDataEvent`，1.20.1 为 `net.minecraftforge.data.event.GatherDataEvent`——写时代代码时以对应 javadoc 为准）。

```java
@Mod.EventBusSubscriber(modid = MyMod.MODID, bus = Mod.EventBusSubscriber.Bus.MOD)
public class DataGenerators {
    @SubscribeEvent
    public static void gatherData(GatherDataEvent event) {
        DataGenerator generator = event.getGenerator();
        // event.getExistingFileHelper() → ExistingFileHelper
        // generator.addProvider(new MyProvider(generator));  // 实现 net.minecraft.data.DataProvider
    }
}
```

`DataProvider` 的 `run` 缓存参数随版本变（1.16.5 `DirectoryCache` → 1.20.1 `FixedCache` 等），实现细节**查官方 MDK**（MDK 的 DataGenerators/ModBlockStateProvider 等为权威示例）。

## 7. 元数据（mods.toml）

`src/main/resources/META-INF/mods.toml`（TOML）。字段表：

| 区块 | 字段 | 说明 |
|---|---|---|
| 顶层 | `modLoader` | `"javafml"`（两时代均必填） |
| 顶层 | `loaderVersion` | 1.16.5 `"[36,)"`；1.20.1 `${loader_version_range}` = `[47,)` |
| 顶层 | `license` | 必填（1.20.1 模板 `${mod_license}`） |
| 顶层 | `issueTrackerURL` | 可选 |
| `[[mods]]` | `modId` | 必填，小写；模板 `{{name}}`/`${mod_id}` |
| `[[mods]]` | `version` | 1.16.5 `${file.jarVersion}`（读 jar manifest）；1.20.1 `${mod_version}` |
| `[[mods]]` | `displayName` / `description` / `authors` | 建议必填（authors 为数组，1.16.5 可写 `authorList` 字符串数组的兼容写法——以 MDK 为准） |
| `[[dependencies.<modId>]]` | `modId`/`versionRange`/`mandatory` | forge：`[36,)` 或 `${forge_version_range}`；minecraft：`[1.16.5,1.17)` 或 `${minecraft_version_range}` |

`${file.jarVersion}` 机制：加载器读 jar manifest 的 `Implementation-Version`（模板 jar 块已写）；`${mod_id}` 等由 build.gradle processResources expand（与 scaffold `{{}}` 渲染互不冲突，R12）。pack.mcmeta：1.16.5 为 `pack_format` 6，1.20.1 为 15。

## 8. 本时代专属坑

- **reobfJar**：两时代均需 `jar.finalizedBy('reobfJar')`；official（mojmap）名在开发环境，运行时是混淆名，reobf 负责转换。
- 1.16.5 编译级别 8（官方客户端 Java 8）；1.20.1 toolchain 17（foojay 自动装）。
- 事件/注册只能挂在正确的 bus：DeferredRegister 忘了 `register(modBus)` 则注册不生效且不报错；`@EventBusSubscriber` 的 `bus` 写错（FORGE/MOD）则监听不触发。
- 1.16.5 与 1.20.1 混用签名（如把 1.20.1 的 `BlockBehaviour` 写进 1.16.5）编译期报错明显；运行时崩溃多为注册名缺失或映射不匹配（mappings 版本必须等于 MC 版本）。
- 服务端首次启动停在 EULA：改 `run/eula.txt` 的 `eula=true`（runData/runServer 都要求）。
