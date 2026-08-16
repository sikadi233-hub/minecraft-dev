# Forge 1.7.10 API 参考（cpw.mods.fml 时代）

适用范围：Minecraft 1.7.10，Forge `10.13.4.1614-1.7.10`，ForgeGradle 1.2 fork（anatawa12）+ Gradle 7.4.2，映射为 MCP（无 mappings 行）。
> 核对来源：Forge 1.7.10 官方 javadoc/sources jar（`maven.minecraftforge.net/net/minecraftforge/forge/1.7.10-10.13.4.1614-1.7.10/`）、anatawa12/ForgeGradle-example（zip）、MCP 文档；在线核对日期 2026-08-16（与 V02_PLAN.md 附录一致）。
> 签名以本机依赖实际版本为准；标注「查官方 MDK」处为细节，写代码前先查对应时代 MDK/javadoc。

## 1. 模组入口与生命周期

主类注解 `cpw.mods.fml.common.Mod`（**属性形态**，无单参 value 形式）：

```java
@Mod(modid = MyMod.MODID, name = "My Mod", version = "0.1.0")
public class MyMod {
    public static final String MODID = "mymod";
}
```

常用属性：`modid`（必填，小写）、`name`、`version`、`dependencies`（如 `"required-after:anothermod"`）、`acceptedMinecraftVersions`（如 `"[1.7.10]"`）、`useMetadata`（true 时从 mcmod.info 读元数据）、`updateJSON`。

生命周期方法：方法上加 `cpw.mods.fml.common.Mod.EventHandler`，参数必须是恰好一个 FML 事件：

```java
import cpw.mods.fml.common.Mod.EventHandler;
import cpw.mods.fml.common.event.FMLPreInitializationEvent;
import cpw.mods.fml.common.event.FMLInitializationEvent;
import cpw.mods.fml.common.event.FMLPostInitializationEvent;
import cpw.mods.fml.common.event.FMLServerStartingEvent;

@EventHandler
public void preInit(FMLPreInitializationEvent event) { }
@EventHandler
public void init(FMLInitializationEvent event) { }
@EventHandler
public void postInit(FMLPostInitializationEvent event) { }
@EventHandler
public void serverStarting(FMLServerStartingEvent event) { }
```

（老教程里的 `@Mod.Init`/`@Mod.PreInit`/`@Mod.PostInit` 是 1.6.x 写法，1.7.10 一律用 `@Mod.EventHandler`。）

事件类（`cpw.mods.fml.common.event.*`）与关键签名：

| 事件 | 关键方法 |
|---|---|
| `FMLPreInitializationEvent` | `getModConfigurationDirectory()` → `File`；`getSuggestedConfigurationFile()` → `File`；`getModMetadata()` → `ModMetadata`；`getSide()` → `Side`（`Side.CLIENT`/`Side.SERVER`）；`getAsmData()` → `ASMDataTable` |
| `FMLInitializationEvent` | `getSide()` → `Side` |
| `FMLPostInitializationEvent` | `getSide()` → `Side` |
| `FMLServerStartingEvent` | `registerServerCommand(ICommand command)`；`getServer()` → `MinecraftServer` |
| `FMLServerStartedEvent` / `FMLServerStoppingEvent` / `FMLServerStoppedEvent` | `getServer()` → `MinecraftServer` |
| `FMLLoadCompleteEvent` | 无参数（全部 mod 加载完成后触发） |

## 2. 注册（GameRegistry）

`cpw.mods.fml.common.registry.GameRegistry`（静态方法，1.7.10 时代无注册事件）：

```java
import cpw.mods.fml.common.registry.GameRegistry;

// 物品：new Item() 链式 setter + registerItem(item, "名字")
Item myItem = new Item()
    .setUnlocalizedName("my_item")   // 1.7.10 用 setUnlocalizedName + setTextureName
    .setTextureName("mymod:my_item") // 只有 1.7.10 有；1.8+ 移除
    .setCreativeTab(CreativeTabs.tabMisc); // 1.7.10 小写静态字段
GameRegistry.registerItem(myItem, "my_item");

// 方块：new Block(Material.material)
Block myBlock = new Block(Material.rock)
    .setBlockName("my_block")
    .setBlockTextureName("mymod:my_block")
    .setCreativeTab(CreativeTabs.tabBlock);
GameRegistry.registerBlock(myBlock, "my_block");
// 带 ItemBlock：GameRegistry.registerBlock(myBlock, ItemBlock.class, "my_block");

// 其他
GameRegistry.registerTileEntity(MyTileEntity.class, "my_tile");
GameRegistry.registerWorldGenerator(new MyWorldGen(), 10); // int = 权重
GameRegistry.addShapedRecipe(...); // 配方（1.7.10 常用写法）
GameRegistry.addSmelting(...);
```

`CreativeTabs` 1.7.10 常量（小写）：`tabBlock`、`tabDecorations`、`tabRedstone`、`tabTransport`、`tabMisc`、`tabSearch`、`tabFood`、`tabTools`、`tabCombat`、`tabBrewing`、`tabMaterials`。

`IWorldGenerator`（`cpw.mods.fml.common.IWorldGenerator`）：

```java
void generate(Random random, int chunkX, int chunkZ, World world,
              IChunkProvider chunkGenerator, IChunkProvider chunkProvider);
```

## 3. 事件总线（Forge 事件，非生命周期）

`net.minecraftforge.common.MinecraftForge`：

```java
public static final EventBus EVENT_BUS; // 类型 cpw.mods.fml.common.eventhandler.EventBus
// EVENT_BUS.register(Object target);   // 扫描目标对象上的 @SubscribeEvent 方法
// EVENT_BUS.unregister(Object target);
// EVENT_BUS.post(Event event) → boolean
```

监听器写法（1.7.10/1.12.2 通用形态）：

```java
import cpw.mods.fml.common.eventhandler.SubscribeEvent;

public class MyForgeEvents {
    @SubscribeEvent
    public void onPlayerInteract(PlayerInteractEvent event) { }
}
// init 阶段：MinecraftForge.EVENT_BUS.register(new MyForgeEvents());
```

常用 Forge 事件（`net.minecraftforge.event.*`）：`PlayerInteractEvent`、`EntityEvent`/`LivingHurtEvent`、`TickEvent.ClientTickEvent`/`TickEvent.ServerTickEvent`（`getPhase()` → `TickEvent.Phase.START/END`）、`ServerChatEvent`、`LivingSpawnEvent`。写签名前查该时代 javadoc（1.7.10 事件字段多为 public 字段而非 getter，与 1.16.5+ 不同）。

## 4. 命令

1.7.10 **没有** CommandRegistryEvent；命令注册走 `FMLServerStartingEvent.registerServerCommand(ICommand)`：

```java
import net.minecraft.command.ICommand;
import net.minecraft.command.CommandBase;

@EventHandler
public void serverStarting(FMLServerStartingEvent event) {
    event.registerServerCommand(new MyCommand());
}

public class MyCommand extends CommandBase { // 继承 CommandBase 省事
    @Override public String getCommandName() { return "mycmd"; }
    @Override public String getCommandUsage(ICommandSender sender) { return "/mycmd"; }
    @Override public void processCommand(ICommandSender sender, String[] args) { }
}
```

`ICommand` 接口在 `net.minecraft.command.ICommand`（`getCommandName`/`getCommandUsage`/`processCommand`/`canCommandSenderUseCommand`/`addTabCompletionOptions`/`isUsernameIndex`）。

## 5. 客户端/服务端代理

`cpw.mods.fml.common.SidedProxy`：

```java
import cpw.mods.fml.common.SidedProxy;

@SidedProxy(clientSide = "com.example.proxy.ClientProxy",
            serverSide = "com.example.proxy.CommonProxy")
public static CommonProxy proxy;
```

`clientSide`/`serverSide` 为**全限定类名**；两处类存在但字段无默认值时，客户端加载服务端类会触发 `NoSuchFieldError`（缺字段的坑，代理类字段必须两边一致）。

## 6. 元数据（mcmod.info）

`src/main/resources/mcmod.info`，JSON 数组（每元素一个 mod）：

| 字段 | 说明 |
|---|---|
| `modid` | 必填，与 @Mod modid 一致 |
| `name` / `description` | 必填 |
| `version` | 模板里 `${version}`（processResources expand） |
| `mcversion` | 模板里 `${mcversion}` |
| `authorList` | 数组；`credits` / `url` / `updateUrl` / `logoFile` / `screenshots` 可选 |

1.7.10 时代**无 mods.toml、无 pack.mcmeta**（资源用 assets/ 文件夹结构）；`useDependencyInformation`/`dependencies` 数组是 1.8+ 引入，1.7.10 不识别。

## 7. 本时代专属坑

- `setTextureName`/`setBlockTextureName` 仅 1.7.10 有效（1.8+ 换成 JSON 模型）；`setUnlocalizedName` 需配合 `assets/<modid>/lang/en_US.lang` 里的 `item.my_item.name=` 翻译。
- 1.7.10 无 runClient 任务：构建产物 jar（FG1.x 自动 reobf）直接进 `mods/` 测试，或 `gradlew setupDevWorkspace` 后配 IDE（细节查 anatawa12/ForgeGradle-example 的 README）。
- 事件字段多为 public 字段（如 `PlayerInteractEvent.x/y/z`），不是 getter；`Side` 判断用 `event.getSide()`。
- 老线 JDK：Gradle 7.4.2 只能跑 JDK ≤18，建议 JDK 8 + `JAVA_HOME`（见 minecraft-java-build）。
