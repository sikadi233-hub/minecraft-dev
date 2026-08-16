# 模组 API 参考（Minecraft 1.7.10）

- 核对日期：2026-08-16（projectId 从 api.cfwidget.com 镜像实测（CF 直连 403）；fileId 等易变值以文件页「Curse Maven 代码」为准，R16）
- 本时代共性：Forge 10.13.x（1.7.10 线）、MCP 混淆名、无 RegistryEvent，事件基类 `cpw.mods.fml.common.eventhandler.Event`；`@Optional` 位于 `cpw.mods.fml.common.Optional`
- **铁律：开发附属前先查本文件，禁止凭记忆写坐标/类名。** 带「未实测」标注的条目须以 jar 反编译核对后再用。

## Thaumcraft 4（神秘时代4，azanor）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/thaumcraft（projectId **223628**，核实 2026-08-16：api.cfwidget.com JSON 实测）
- 官方 maven：无（azanor 从未发布 1.7.10 线到公共 maven）
- 仓库：`maven { url "https://cursemaven.com" }`
- curse.maven 示例：`compileOnly "curse.maven:thaumcraft-223628:<fileId>"`
  - fileId 获取（R16）：CF Files 页 → Game Version 过滤 1.7.10 → 点目标版本（如 4.2.3.5）→ 复制「Curse Maven 代码」框；本环境 CF 直连 403 未逐项核到 fileId，一律以文件页为准，禁止凭记忆填数字
- 本时代常用版本：4.2.3.5（2015 后 TC4 最终版，WebSearch 核实）
- API 入口：`thaumcraft.api`（官方独立 API jar 仓库 thaumcraft-api，分支 1.7.10，git 实测）：`ThaumcraftApi`、`ThaumcraftApiHelper`、`aspects/Aspect`、`aspects/AspectList`、`research/ResearchCategories`、`research/ResearchItem`、`research/ResearchPage`、`items/ItemApi`、`tiles/IInfusionStabiliser`、`IScanEventHandler`；基础要素常量实测：`Aspect.AIR/EARTH/FIRE/WATER/ORDER/ENTROPY/VOID/LIGHT`
- 软依赖检测写法（modid = `Thaumcraft`）：
```java
@Optional.Method(modid = "Thaumcraft")
public static void registerTC4() { /* 仅 TC4 加载时执行 */ }
// 初始化阶段：
if (Loader.isModLoaded("Thaumcraft")) registerTC4();
```
- 扩展点（全部为**模组自有 API**，静态方法注册，无专属 Forge 事件）：`ThaumcraftApi.registerObjectTag(ItemStack, AspectList)` 物品要素、`addCrucibleRecipe(...)` 坩埚、`addInfusionCraftingRecipe(...)` 注魔、`addSmeltingBonus(...)` 炼金增产、`ResearchCategories.registerCategory/addResearch` 研究树
- 最小示例（要素注册 + 坩埚配方，自写）：
```java
AspectList al = new AspectList().add(Aspect.FIRE, 4).add(Aspect.AURA, 2);
ThaumcraftApi.registerObjectTag(new ItemStack(MyItems.crystal), al);

ThaumcraftApi.addCrucibleRecipe("MY_ASH", new ItemStack(MyItems.ash),
    new ItemStack(Blocks.grass), new AspectList().add(Aspect.FIRE, 8));
```
- 最小示例（自定义研究条目，自写）：
```java
ResearchCategories.registerCategory("MYCAT", new ResourceLocation("mymod", "textures/gui/icon.png"), null);
ResearchItem r = new ResearchItem("MY_BASIC", "MYCAT",
    new AspectList().add(Aspect.FIRE, 5), -2, -2, 1, new ItemStack(MyItems.ash))
    .setPages(new ResearchPage("mymod.research.MY_BASIC.0"), new ResearchPage(new ItemStack(MyItems.ash)));
ResearchCategories.addResearch(r);
```
- 状态/注意：TC4 本体闭源（API jar 开源）；研究条目构造器重载较多，签名以 API jar 为准
- 核实来源：https://api.cfwidget.com/minecraft/mc-mods/thaumcraft 、https://github.com/azanor/Thaumcraft-api/tree/1.7.10 、WebSearch「Thaumcraft 4.2.3.5」

## Tinkers Construct（匠魂，mDiyo/bonii）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/tinkers-construct（projectId **74072**，核实 2026-08-16：api.cfwidget.com JSON 实测）
- 官方 maven：无（dvs1.progwml6.com / modmaven 仅 1.10+ 线，metadata 实测无 1.7.10）
- 仓库：`maven { url "https://cursemaven.com" }`
- curse.maven 示例：`compileOnly "curse.maven:tinkers-construct-74072:2264246"`
  - **fileId 2264246 已实测**（Modrinth API changelog 引用 CF files/2264246 → 即 1.7.10-1.8.8 文件）；此后新发布仍以文件页为准
- 本时代常用版本：1.7.10-1.8.8（1.7.10 线最终版，2026-08 实测；另有 1.7.10-1.8.7 等旧版）
- API 入口：`tconstruct.library`（git 克隆 branch 1.7.10_final 实测）：`TConstructRegistry`、`crafting/ToolBuilder`、`crafting/Smeltery`、`tools/ToolCore`、`tools/ToolMaterial`、`modifiers/ActiveToolMod`、`modifiers/ItemModifier`、`modifiers/IModifyable`、`event/`（Forge 事件：`ToolCraftEvent`、`ProjectileEvent`）
- 软依赖检测写法（modid = `TConstruct`）：`Loader.isModLoaded("TConstruct")` + `@Optional.Method(modid = "TConstruct")`
- 扩展点：**模组自有 API**——`TConstructRegistry`（registerToolPart/registerToolMaterial/registerModifier 等）、`Smeltery`（addMelting/addAlloyMixing/addSmelteryFuel）、`ToolBuilder.addNormalToolRecipe`；**Forge 事件**——`tconstruct.library.event.ToolCraftEvent`（`@HasResult`，合成后回调，可改 `evt.toolTag`）
- 最小示例（冶炼炉熔炼 + 合金，自写）：
```java
Smeltery.addMelting(new ItemStack(MyItems.ore), 800, new FluidStack(MyFluids.molten, 144));
Smeltery.addAlloyMixing(new FluidStack(MyFluids.moltenAlloy, 288),
    new FluidStack(MyFluids.moltenA, 144), new FluidStack(MyFluids.moltenB, 144));
Smeltery.addSmelteryFuel(new Fluid("liquid_myfuel"), 1000, 2400);
```
- 最小示例（工具合成后改 NBT，Forge 事件，自写）：
```java
@SubscribeEvent
public void onToolCraft(ToolCraftEvent.NormalTool evt) {
    evt.toolTag.getCompoundTag("InfiTool").setInteger("MyFlag", 1);
}
```
- 状态/注意：1.7.10 **没有** `TinkerRegistry` 类（该类是 1.8.8+ 引入），附属一律走 `TConstructRegistry`；`library/modifier` 为单数包名
- 核实来源：https://api.cfwidget.com/minecraft/mc-mods/tinkers-construct 、git 克隆 https://github.com/SlimeKnights/TinkersConstruct（branch 1.7.10_final）、https://api.modrinth.com/v2/project/tinkers-construct/version（fileId 2264246）

## Botania（植物魔法，Vazkii）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/botania（projectId **225643**，核实 2026-08-16：api.cfwidget.com JSON 实测）
- 官方 maven：无（maven.blamejared.com 自 r1.10-*（1.12 线）起，metadata 实测）
- 仓库：`maven { url "https://cursemaven.com" }`
- curse.maven 示例：`compileOnly "curse.maven:botania-225643:<fileId>"`（fileId 以 CF Files 页 1.7.10 过滤为准）
- 本时代常用版本：r1.8-249（1.7.10 线最终版，WebSearch 核实）
- API 入口：`vazkii.botania.api`（git 实测）：`BotaniaAPI`、`mana/`（IManaReceiver、IManaPool、IManaSpender、ManaItemHandler）、`recipe/`（RecipePetals、RecipePureDaisy、RecipeManaInfusion、RecipeElvenTrade、BrewRecipe）、`subTile/`（SubTileEntity、ISubTileContainer、TileSpecialFlower）、`lexicon/`（IAddonEntry）
- 软依赖检测写法（modid = `Botania`）：`Loader.isModLoaded("Botania")` + `@Optional.Method(modid = "Botania")`
- 扩展点（**模组自有 API**，BotaniaAPI 静态配方表 + 注册方法，无专属 Forge 事件）：`BotaniaAPI.petalRecipes/manaInfusionRecipes/pureDaisyRecipes/elvenTradeRecipes` 增删、`registerSubTile(String, Class)` + `addSubTileToCreativeMenu`、`registerBrew`
- 最小示例（花药合成 + 功能花注册，自写）：
```java
BotaniaAPI.petalRecipes.add(new RecipePetals(new ItemStack(MyItems.mysticFlower),
    "petalLime", "petalCyan", "petalWhite", "petalRed"));

BotaniaAPI.registerSubTile("myFlower", MySubTile.class); // 需继承 SubTileEntity
BotaniaAPI.addSubTileToCreativeMenu("myFlower");
```
- 状态/注意：完全开源，Vazkii 声明 API 向后稳定；r1.9 起转入 1.8.9+ 分支，勿用 r1.9+ 代码写 1.7.10 附属
- 核实来源：https://api.cfwidget.com/minecraft/mc-mods/botania 、git 克隆 https://github.com/Vazkii/Botania（1.7.10 分支）、WebSearch「Botania r1.8-249」

## The Twilight Forest（暮色森林，Benimatic）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/the-twilight-forest（projectId **227639**，核实 2026-08-16：api.cfwidget.com JSON 实测）
- 官方 maven：无（TF 从未发布 1.7.10 线到公共 maven）
- 仓库：`maven { url "https://cursemaven.com" }`
- curse.maven 示例：`compileOnly "curse.maven:the-twilight-forest-227639:<fileId>"`（fileId 以 CF Files 页为准）
- 本时代常用版本：2.3.5（1.7.10 线最终版，WebSearch 核实）
- API 入口：**无公开 API 包**（git 克隆 branch 1.7.10 实测，源码仅 `twilightforest` 主包）；可引用的公共锚点：`TwilightForestMod`（`public static final String ID = "TwilightForest"`、`backupdimensionID = -777`，源码实测）
- 软依赖检测写法（**modid 为大写 `TwilightForest`**，源码实测，勿照抄 1.12.2 的小写）：
```java
if (Loader.isModLoaded("TwilightForest")
    && player.dimension == TwilightForestMod.backupdimensionID) { /* 玩家在暮色维度 */ }
```
- 扩展点：无官方附属 API；联动只能走**Forge 标准事件**（如 `LivingDropsEvent`、`EntityJoinWorldEvent`）与维度/方块 ID 反射，无模组自有注册表
- 最小示例（击杀暮色生物判定 + 掉落，Forge 事件，自写）：
```java
@SubscribeEvent
public void onDrops(LivingDropsEvent evt) {
    Entity e = evt.entity;
    if (e.dimension == TwilightForestMod.backupdimensionID) {
        evt.drops.add(new EntityItem(e.worldObj, e.posX, e.posY, e.posZ, new ItemStack(MyItems.antler)));
    }
}
```
- 状态/注意：2.3.5 之后 TF 转入 1.8+ 分支（modid 转为小写）；1.7.10 附属面极小，先确认目标功能是否真需要直连 TF 类
- 核实来源：https://api.cfwidget.com/minecraft/mc-mods/the-twilight-forest 、git 克隆 https://github.com/TeamTwilight/twilightforest（branch 1.7.10）、WebSearch「Twilight Forest 2.3.5」

## Applied Energistics 2（应用能源，AlgorithmX2）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/applied-energistics-2（projectId **223794**，核实 2026-08-16：api.cfwidget.com JSON 实测）
- 官方 maven：无（rv2 时代官方 maven 已下线；curse.maven 唯一路径）
- 仓库：`maven { url "https://cursemaven.com" }`
- curse.maven 示例：`compileOnly "curse.maven:applied-energistics-2-223794:<fileId>"`（fileId 以 CF Files 页 1.7.10 过滤为准；**注意 rv6-stable-7 的 fileId 2747063 是 1.12.2 线的，勿用于 1.7.10**）
- 本时代常用版本：rv2-stable-10（1.7.10 线最终稳定版，openeye 实测）
- API 入口：`appeng.api`（git 克隆 branch rv2.stable.10 实测）：`IAppEngApi`（`AEApi.instance()` 取实例）、`storage/`（IExternalStorageRegistry、IExternalStorageHandler、IMEInventory、StorageChannel）、`crafting/`（ICraftingProvider、ICraftingProviderHelper）、`grid/`（IGridCacheRegistry、IGridCache）、`parts/`（IPart、IFacadeContainer、BusSupport）、`cells/`（ICellRegistry、ICellHandler）、`networking/`
- 软依赖检测写法（modid = `appliedenergistics2`）：`Loader.isModLoaded("appliedenergistics2")` + `@Optional.Method(modid = "appliedenergistics2")`
- 扩展点（**模组自有 API**，统一经 `AEApi.instance().registries()`，全部方法名 git 实测）：`externalStorage().addExternalStorageInterface(IExternalStorageHandler)`、`gridCache().registerGridCache(Class, Class)`、`cell().addCellHandler(ICellHandler)`、`crafting()` 体系（ICraftingProvider 走 ME 网络发布合成）；parts 无公开注册 API
- 最小示例（外部存储接入 ME 网络，签名实测，自写）：
```java
AEApi.instance().registries().externalStorage().addExternalStorageInterface(
    new IExternalStorageHandler() {
        @Override public boolean canHandle(TileEntity te, ForgeDirection d,
                StorageChannel channel, BaseActionSource src) { return te instanceof MyChest; }
        @Override public IMEInventory getInventory(TileEntity te, ForgeDirection d,
                StorageChannel channel, BaseActionSource src) { return myInv; }
    });
```
- 最小示例（自定义网络缓存/网格缓存扩展，自写）：
```java
AEApi.instance().registries().gridCache().registerGridCache(MyCache.class, MyGridCache.class);
// MyGridCache 实现 IGridCache（onUpdateTick/removeNode/addNode…）
```
- 状态/注意：rv2 API 与 rv6（1.12.2）差异极大（无 `IAppEngApi` 时代的旧写法勿混用）；`BaseActionSource` 位于 `appeng.api.storage` 同包
- 核实来源：https://api.cfwidget.com/minecraft/mc-mods/applied-energistics-2 、git 克隆 https://github.com/AppliedEnergistics/Applied-Energistics-2（branch rv2.stable.10）、openeye（rv2-stable-10）

## Mekanism（通用机械，aidancbrady）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/mekanism（projectId **268560**，核实 2026-08-16：api.cfwidget.com JSON 实测）
- 官方 maven：无（官方 README 的 modmaven 坐标仅 v10+（1.16.1 起）；1.7.10 v9 无公共 maven，2026-08 实测）
- 仓库：`maven { url "https://cursemaven.com" }`
- curse.maven 示例：`compileOnly "curse.maven:mekanism-268560:2426270"`（= 9.1.0.281，fileId 2426270 取自 CF 文件页 snippet，2026-08 记录；新发布以文件页为准）
- 本时代常用版本：9.1.0.281（1.7.10 线最终版；Mekanism-1.7.10-9.1.0.281.jar 存在性经 Minecraft Forum 支持帖核实）
- API 入口：`mekanism.api` 包（1.7.10 无 `:api` classifier，用完整 mod jar 当 compileOnly 且禁止打包进产物）；v9 同构 API 参考 mods-1.12.2.md 的 `gas/`（GasRegistry/GasStack）、`energy/`、`infuse/` 结构（**1.7.10 具体类清单未反编译核对，使用时以 jar 为准**）
- 软依赖检测写法（**modid 大小写存疑**：1.7.10 时代大小写混用，社区实测两写皆有，建议双写）：
```java
if (Loader.isModLoaded("Mekanism") || Loader.isModLoaded("mekanism")) { /* 按需初始化 */ }
```
- 联动范例：机器配方走 `MekanismAPI` 静态注册（方法签名与 1.12.2 线 v9 同构，**未实测，须反编译 jar 确认**）；管道/能量网络接口（IGasHandler 等）实现即接入，无 Forge 事件
- 状态/注意：本体 + MekanismGenerators（projectId 268566）+ MekanismTools（268567）+ MekanismAdditions（345425）多模块同发同版本；写附属只依赖本体 jar；开源 MIT
- 核实来源：https://api.cfwidget.com/minecraft/mc-mods/mekanism 、Minecraft Forum 支持帖（Mekanism-1.7.10-9.1.0.281.jar）、mods-1.12.2.md 同模组条目（v9 同构参照）

## IndustrialCraft 2（工业时代，Player/IC2 团队）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/industrial-craft（projectId **242638**，核实 2026-08-16：api.cfwidget.com JSON 实测）
- 官方 maven：无（maven.ic2.player.to metadata 实测仅 1.10+ 线，无 1.7.10）
- 仓库：`maven { url "https://cursemaven.com" }`
- curse.maven 示例：`compileOnly "curse.maven:industrial-craft-242638:<fileId>"`（fileId 以 CF Files 页为准）
- 本时代常用版本：2.2.828a（stable 线，mcmod.cn 版本表核实）/ 2.2.829-experimental（experimental 线最终，WebSearch 核实）
- API 入口：`ic2.api`（**本环境未能取得 1.7.10 源码**——IC2Dev 仓库已删、无 vendored 副本；以下类名基于 2.8.x 同构 API + AdvSolarPatch ClassTransformer 字节码证据 `ic2/api/recipe/IMachineRecipeManager`）：`ic2.api.energy.tile`（IEnergySink、IEnergySource、IEnergyTile）、`ic2.api.energy.EnergyNet`、`ic2.api.item`（IElectricItem）、`ic2.api.reactor`（IC2Reactor）、`ic2.api.recipe`（IMachineRecipeManager、IMachineRecipeManager.RecipeOutput）。**最终类清单/方法签名须反编译 2.2.829-experimental jar 确认，勿凭 2.8.x 记忆抄**
- 软依赖检测写法（modid = `IC2`，crashlog 实测）：`Loader.isModLoaded("IC2")` + `@Optional.Method(modid = "IC2")`
- 扩展点（**模组自有 API**）：实现 `IEnergySink`/`IEnergySource` 的 TileEntity 即被 EnergyNet 自动接入 EU 网络（无需注册）；机器配方经 `ic2.api.recipe` 各 Manager 的静态单例；无专属 Forge 公开事件
- 最小示例（EU 耗能设备骨架，签名以 jar 内 API 为准，自写）：
```java
public class MyMachine extends TileEntity implements IEnergySink {
    private double energy = 0;
    @Override public double getDemandedEnergy() { return 256 - energy; }
    @Override public int getSinkTier() { return 2; }
    @Override public double injectEnergy(Direction from, double amount, double voltage) {
        energy += amount; return 0; // 返回未接收部分
    }
    @Override public boolean acceptsEnergyFrom(TileEntity emitter, Direction dir) { return true; }
}
```
- 状态/注意：experimental 线 API 相对稳定但会变；1.7.10 附属生态普遍锁 2.2.828a 或 2.2.829-experimental；IC2 的 1.7.10 源码已不可得（历史仓库删除），写联动前务必以 jar 反编译核对
- 核实来源：https://api.cfwidget.com/minecraft/mc-mods/industrial-craft 、https://www.mcmod.cn/class/2.html（1.7.10 版本表）、WebSearch「IC2 2.2.828a / 2.2.829-experimental」、AdvSolarPatch 字节码（ic2/api/recipe 路径）

## Thermal Expansion 4（热力膨胀4，CoFH 团队）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/thermal-expansion（projectId **69163**，核实 2026-08-16：api.cfwidget.com JSON 实测）
- 官方 maven：无（maven.covers1624.net / modmaven.dev metadata 实测仅 1.10.2+ 线）
- 仓库：`maven { url "https://cursemaven.com" }`
- curse.maven 示例：`compileOnly "curse.maven:thermal-expansion-69163:<fileId>"`（fileId 以 CF Files 页 1.7.10 过滤为准）
- 本时代常用版本：TE4 4.0.x（1.7.10 线；**具体构建号（社区流传 4.0.3.24）本环境未能核实，须到 CF Files 页确认**，mcmod.cn 仅确认「1.7.10 : [TE4] 热力膨胀4」）
- API 入口：`cofh.api`（随 CoFHLib 提供，git 克隆 CoFHLib-1.7.10-Legacy 实测）：`energy/`（EnergyStorage、IEnergyHandler、IEnergyReceiver、IEnergyProvider、IEnergyConnection）、`tileentity/`（IRedstoneControl 等）、`item/`、`modhelpers/ThermalExpansionHelper`（机器配方静态注册）
- 软依赖检测写法（modid = `ThermalExpansion`，运行时依赖 CoFHCore）：`Loader.isModLoaded("ThermalExpansion")` + `@Optional.Method(modid = "ThermalExpansion")`
- 扩展点：**模组自有 API**——`cofh.api.energy` RF 接口（实现即接入 RF 传输，1.7.10 事实标准）、`ThermalExpansionHelper` 静态配方注册（addPulverizerRecipe/addSmelterRecipe/addSawmillRecipe…）；IRedstoneControl 控制红石行为
- 最小示例（RF 机器配方 + 能量存储，方法名 git 实测，自写）：
```java
ThermalExpansionHelper.addSmelterRecipe(3200, new ItemStack(Blocks.sand), new ItemStack(Items.coal),
    new ItemStack(MyItems.glassBlock), new ItemStack(MyItems.ash), 25); // 温度, 主/次入, 主/次出, 副产概率

public class MyRFMachine extends TileEntity implements IEnergyHandler {
    protected EnergyStorage storage = new EnergyStorage(32000, 200);
    @Override public int receiveEnergy(ForgeDirection from, int maxReceive, boolean simulate) { return storage.receiveEnergy(maxReceive, simulate); }
    @Override public int extractEnergy(ForgeDirection from, int maxExtract, boolean simulate) { return storage.extractEnergy(maxExtract, simulate); }
    @Override public int getEnergyStored(ForgeDirection from) { return storage.getEnergyStored(); }
    @Override public int getMaxEnergyStored(ForgeDirection from) { return storage.getMaxEnergyStored(); }
    @Override public boolean canConnectEnergy(ForgeDirection from) { return true; }
}
```
- 状态/注意：RF 系全家桶（TE4/CoFHCore/CoFHLib 4.0.x 同版本线，缺 CoFHCore 直接崩溃）；依赖走 curse.maven 时 CoFHCore（projectId 69162）需一并拉取
- 核实来源：https://api.cfwidget.com/minecraft/mc-mods/thermal-expansion 、git 克隆 https://github.com/CoFH/CoFHLib-1.7.10-Legacy 、https://www.mcmod.cn/class/357.html（1.7.10 : [TE4]）

## Draconic Evolution（龙之研究，brandon3055）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/draconic-evolution（projectId **223565**，核实 2026-08-16：api.cfwidget.com JSON 实测）
- 官方 maven：无（brandon3055 从未发布 1.7.10 线到公共 maven）
- 仓库：`maven { url "https://cursemaven.com" }`
- curse.maven 示例：`compileOnly "curse.maven:draconic-evolution-223565:<fileId>"`（fileId 以 CF Files 页为准）
- 本时代常用版本：1.0.2h（1.7.10 线最终版，WebSearch 核实）
- API 入口：`com.brandon3055.draconicevolution.api`（git 克隆 branch 1.7.10 实测，包面很小）：`IExtendedRFStorage`（long 容量存储：`getExtendedStorage()`/`getExtendedCapacity()`，另含已废弃的 `getEnergyStored()`/`getMaxEnergyStored()` 返回 double）、`GeneratorOverride`（发电机白名单/倍率，抽象类，签名以 jar 为准）
- 软依赖检测写法（modid = `DraconicEvolution`，源码实测）：`Loader.isModLoaded("DraconicEvolution")` + `@Optional.Method(modid = "DraconicEvolution")`
- 扩展点（**模组自有 API**，接口实现即识别，无注册调用）：`IExtendedRFStorage` 接 DE 的 RF 网络与无线能量；`GeneratorOverride` 控制 DE 发电机行为；无专属 Forge 事件
- 最小示例（长容量 RF 存储接入 DE，全部方法名 git 实测，自写）：
```java
public class MyCore extends TileEntity implements IExtendedRFStorage {
    private long ext = 0;
    @Override public long getExtendedStorage() { return ext; }
    @Override public long getExtendedCapacity() { return 10_000_000L; }
    @Override public double getEnergyStored() { return 0; }   // @Deprecated 旧 RF 兼容
    @Override public double getMaxEnergyStored() { return 0; }
}
```
- 状态/注意：1.0.2h 之后 DE 转入 1.8+ 分支；1.7.10 API 面极窄（模块系统/能量核心附件的注册不开放，别处无公开钩子）
- 核实来源：https://api.cfwidget.com/minecraft/mc-mods/draconic-evolution 、git 克隆 https://github.com/brandon3055/Draconic-Evolution（branch 1.7.10）、WebSearch「Draconic Evolution 1.0.2h」

## SlashBlade（拔刀剑，Dragon-Seeker）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/slashblade（projectId **241596**，核实 2026-08-16：api.cfwidget.com JSON 实测；社区流传 245703 为错，勿抄）
- 官方 maven：无
- 仓库：`maven { url "https://cursemaven.com" }`
- curse.maven 示例：`compileOnly "curse.maven:slashblade-241596:<fileId>"`（fileId 以 CF Files 页 1.7.10 过滤为准）
- 本时代常用版本：mc1.7.10-r77（1.7.10 线常见最终版，openeye 实测）
- API 入口：`mods.flammpfeil.slashblade.`（git 克隆 branch 1.7 实测）：`slashblade/SlashBlade`（拔刀剑 Item 类）、`ItemSlashBlade`、`util/SlashBladeHooks`（`public static final EventBus EventBus`，**模组自有总线**）、`util/SlashBladeEvent`（嵌套事件类：`SlashBladeEvent.ImpactEffectEvent`（字段 `sequence/target/user` 实测）等）
- 软依赖检测写法（modid = `flammpfeil.slashblade`）：`Loader.isModLoaded("flammpfeil.slashblade")` + `@Optional.Method(modid = "flammpfeil.slashblade")`
- 扩展点：**模组自有事件总线**（非 Forge）：`SlashBladeHooks.EventBus.register(listener)` 收 `SlashBladeEvent` 系事件（ImpactEffectEvent 等）；另有拔刀剑 NBT/合成结构配置，无公开合成注册 API
- 最小示例（命中特效扩展，自写）：
```java
public class MyBladeHandler {
    public void onImpact(SlashBladeEvent.ImpactEffectEvent evt) {
        evt.target.setFire(3); // evt.sequence 为当前连段序号
    }
}
// FMLInitializationEvent 中注册（注意不是 Forge 总线）：
SlashBladeHooks.EventBus.register(new MyBladeHandler());
```
- 状态/注意：闭源发布（GitHub 为旧版公开分支，与闭源发布物有差异，以 jar 反编译为准）；r77 之后转入 1.8+/1.12.2 分支，事件类包名结构可能不同
- 核实来源：https://api.cfwidget.com/minecraft/mc-mods/slashblade 、git 克隆 https://github.com/flammpfeil/SlashBlade（branch 1.7）、openeye（mc1.7.10-r77）
