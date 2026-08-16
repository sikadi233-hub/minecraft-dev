# Forge 1.12.2 API 参考（net.minecraftforge.fml.common 时代）

适用范围：Minecraft 1.12.2，Forge `14.23.5.2860`，ForgeGradle 3.0.197 + Gradle 4.9，映射 MCP snapshot `20171003-1.12`。
> 核对来源：Forge 1.12.2 官方 javadoc/sources jar 与 MDK zip（`maven.minecraftforge.net/net/minecraftforge/forge/1.12.2-14.23.5.2860/forge-1.12.2-14.23.5.2860-mdk.zip`，实测解包）、Forge 文档（docs.minecraftforge.net 1.12.x 版本）；在线核对日期 2026-08-16（与 V02_PLAN.md 附录一致）。
> 签名以本机依赖实际版本为准；标注「查官方 MDK」处为细节，写代码前先查对应时代 MDK/javadoc。

## 1. 模组入口与生命周期

主类注解 `net.minecraftforge.fml.common.Mod`（**属性形态**）：

```java
@Mod(modid = MyMod.MODID, name = "My Mod", version = "0.1.0",
     acceptedMinecraftVersions = "[1.12.2]")
public class MyMod {
    public static final String MODID = "mymod";
}
```

常用属性：`modid`（必填，小写）、`name`、`version`、`dependencies`（`"required-after:xxx"`）、`acceptedMinecraftVersions`、`useMetadata`（true 时读 mcmod.info 的 name/description/authorList）、`updateJSON`、`certificateFingerprint`。

生命周期（`@Mod.EventHandler` + FML 三阶段，包 `net.minecraftforge.fml.common.event`）：

```java
import net.minecraftforge.fml.common.Mod.EventHandler;
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;
import net.minecraftforge.fml.common.event.FMLPostInitializationEvent;

@EventHandler
public void preInit(FMLPreInitializationEvent event) { }
@EventHandler
public void init(FMLInitializationEvent event) { }
@EventHandler
public void postInit(FMLPostInitializationEvent event) { }
```

关键方法：`FMLPreInitializationEvent.getModConfigurationDirectory()` → `File`、`getSuggestedConfigurationFile()` → `File`、`getModMetadata()` → `ModMetadata`、`getSide()` → `Side`（`Side.CLIENT`/`Side.SERVER`）、`getAsmData()`。还有 `FMLServerStartingEvent`（`registerServerCommand(ICommand)`、`getServer()` → `MinecraftServer`）、`FMLServerStartedEvent` 等（`net.minecraftforge.fml.common.event.*`）。

## 2. 注册（RegistryEvent + ForgeRegistries）

1.12.2 正解是注册事件（`net.minecraftforge.event.RegistryEvent`），GameRegistry.register 已废弃：

```java
import net.minecraftforge.event.RegistryEvent;
import net.minecraftforge.registries.IForgeRegistry;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;

@SubscribeEvent
public void registerBlocks(RegistryEvent.Register<Block> event) {
    // T extends IForgeRegistryEntry<T>；event.getRegistry() → IForgeRegistry<T>
    event.getRegistry().registerAll(
        new Block(Material.ROCK)
            .setUnlocalizedName("my_block")                 // 1.12.2 用 setUnlocalizedName
            .setRegistryName(MyMod.MODID, "my_block")       // setRegistryName 必填，否则注册崩
            .setCreativeTab(CreativeTabs.BUILDING_BLOCKS)
    );
}

@SubscribeEvent
public void registerItems(RegistryEvent.Register<Item> event) {
    event.getRegistry().registerAll(
        new Item().setUnlocalizedName("my_item")
            .setRegistryName(MyMod.MODID, "my_item")
            .setCreativeTab(CreativeTabs.MISC)
    );
}
```

`IForgeRegistry<T>`（`net.minecraftforge.registries.IForgeRegistry<T>`）关键方法：`register(T value)`、`registerAll(T... values)`、`getValue(ResourceLocation)`、`getKey(T)`、`containsKey(ResourceLocation)`、`getKeys()`。

`ForgeRegistries`（`net.minecraftforge.registries.ForgeRegistries`）常量表（均 `IForgeRegistry`）：`BLOCKS`、`ITEMS`、`ENTITIES`、`TILE_ENTITIES`、`BIOMES`、`RECIPES`、`POTIONS`、`POTION_TYPES`、`ENCHANTMENTS`、`SOUND_EVENTS`、`VILLAGER_PROFESSIONS`。

`IForgeRegistryEntry<T>.setRegistryName`：`setRegistryName(String modid, String name)` / `setRegistryName(ResourceLocation)`。方块/物品注册名与 `RegistryName` 一致时还会自动生成 `minecraft:<name>` 形式纹理路径（对应 `assets/<modid>/models/item/<name>.json`）。

其他注册：`GameRegistry.registerTileEntity(MyTile.class, "my_tile")`、`GameRegistry.registerWorldGenerator(new MyWorldGen(), 10)`（`net.minecraftforge.fml.common.registry.GameRegistry`，仍可用但 `register(Block/Item)` 已废弃，走 §2 注册事件）。配方用 `RegistryEvent.Register<IRecipe>` 或 `GameRegistry.addShapedRecipe`（废弃警告）。

`CreativeTabs` 1.12.2 常量（大写）：`BUILDING_BLOCKS`、`DECORATIONS`、`REDSTONE`、`TRANSPORTATION`、`MISC`、`SEARCH`、`FOOD`、`TOOLS`、`COMBAT`、`BREWING`、`MATERIALS`、`INVENTORY`。

## 3. 事件总线

- 生命周期：`@Mod.EventHandler`（§1）。
- 游戏事件（非生命周期）：`@SubscribeEvent`（`net.minecraftforge.fml.common.eventhandler.SubscribeEvent`）挂 `MinecraftForge.EVENT_BUS`：

```java
import net.minecraftforge.common.MinecraftForge;
// public static final EventBus EVENT_BUS;   // net.minecraftforge.fml.common.eventhandler.EventBus
// EVENT_BUS.register(Object target);
// EVENT_BUS.unregister(Object target);
// EVENT_BUS.post(Event event) → boolean
```

- 1.12.2 **尚无** mod bus 概念（mod bus 是 1.16.5+ 引入的 `IEventBus`/`FMLJavaModLoadingContext`）。
- 监听器注册点：preInit 或 @Mod 类内静态 `@SubscribeEvent` 方法 + `MinecraftForge.EVENT_BUS.register(this)`；也可用 `@Mod.EventBusSubscriber(modid = MODID)`（1.12.2 已有，包 `net.minecraftforge.fml.common.Mod.EventBusSubscriber`）。

常用事件（写签名前查 1.12.2 javadoc）：`net.minecraftforge.event.CommandRegistryEvent`；`net.minecraftforge.event.entity.player.PlayerEvent`（`PlayerLoggedInEvent` 等，`getEntityPlayer()` → `EntityPlayer`）；`net.minecraftforge.event.entity.living.LivingHurtEvent`（`getAmount()`/`setAmount(float)`/`getSource()` → `DamageSource`）；`net.minecraftforge.event.TickEvent.ClientTickEvent/ServerTickEvent`（`getPhase()` → `TickEvent.Phase`）。

## 4. 命令

1.12.2 有 `net.minecraftforge.event.CommandRegistryEvent`：

```java
import net.minecraftforge.event.CommandRegistryEvent;

@SubscribeEvent
public void onCommandRegistry(CommandRegistryEvent event) {
    // getRegistry() → net.minecraft.command.CommandHandler
    event.getRegistry().registerCommand(new MyCommand());
}
```

或沿用 1.7.10 方式：`FMLServerStartingEvent.registerServerCommand(ICommand)`。命令类建议继承 `net.minecraft.command.CommandBase`（`getName()`、`getUsage(ICommandSender)`、`execute(MinecraftServer, ICommandSender, String[])`——1.12.2 已是新签名，与 1.7.10 的 `getCommandName`/`processCommand` 不同）。

## 5. 客户端/服务端代理

`net.minecraftforge.fml.common.SidedProxy`（与 1.7.10 同形态）：

```java
@SidedProxy(clientSide = "com.example.proxy.ClientProxy",
            serverSide = "com.example.proxy.CommonProxy")
public static CommonProxy proxy;
```

字段 `proxy` 两边类必须都有，否则服务端/客户端缺字段报错。客户端渲染（模型注册）走 `ClientRegistry.bindTileEntitySpecialRenderer`、`ModelLoader.setCustomModelResourceLocation` 等（`net.minecraftforge.client.*`，仅客户端可调，放 proxy 的 client 类里）。

## 6. 元数据（mcmod.info + pack.mcmeta）

`mcmod.info` 结构与 1.7.10 相同（JSON 数组），1.12.2 支持 `dependencies` 数组：

```json
{
  "modid": "mymod",
  "name": "My Mod",
  "description": "...",
  "version": "${version}",
  "mcversion": "${mcversion}",
  "authorList": ["YourName"],
  "dependencies": [
    { "modid": "requiredmod", "mandatory": true, "versionRange": "[1.0,2.0)", "ordering": "NONE" }
  ]
}
```

`${version}`/`${mcversion}` 由 build.gradle 的 processResources expand（模板已配）。`pack.mcmeta` 存在，`pack_format` 为 3。**无 mods.toml**（1.13 起才引入）。

## 7. 本时代专属坑

- **reobfJar**：1.12.2 必须 `jar.finalizedBy('reobfJar')`（FG3 起 reobf 独立任务，1.7.10 是自动的）；上传产物必须 reobf 后，dev 产物进正式客户端 NoSuchMethodError。
- 映射：MCP snapshot `20171003-1.12` 是 1.12.2 最后快照；dev 名（func_xxx→语义名）与运行时 SRG 由 reobf 处理。
- `setRegistryName` 漏写：注册事件里 `registerAll` 的对象没有 registry name 会直接崩（IllegalArgumentException）。
- Gradle 4.9 只能跑 JDK 8~10（Java 11+ 报 "Unsupported class file major version"），先装 JDK 8 设 `JAVA_HOME`（minecraft-java-build）。
- `runClient`/`runServer` 可用（FG3 有 runs 块）；首次启动反编译慢（R9）。
