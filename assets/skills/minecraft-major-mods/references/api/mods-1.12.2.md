# 模组 API 参考（Minecraft 1.12.2）

- 核对日期：2026-08-16。projectId 当日在线核实：cfwidget API（https://api.cfwidget.com/minecraft/mc-mods/<slug> 返回 JSON 的 `id` 字段）逐项实测 + 与 V03_PLAN 附录 JSON-LD 实测值交叉一致；各 modid 从对应 GitHub 分支源码 `@Mod` 注解实测；maven 坐标逐个 curl 实测 metadata；API 类签名从 GitHub 分支源码与 maven 下到的 jar 内 `.class`（javap）实测。
- **铁律：开发附属前先查本文件，禁止凭记忆写坐标/类名。** fileId 等易变值一律以 CurseForge 文件页为准（R16）。
- curse.maven 通用写法：build.gradle 加 `repositories { maven { url 'https://cursemaven.com' } }`，依赖写 `compileOnly "curse.maven:<slug>-<projectId>:<fileId>"`（1.12.2 ForgeGradle 3 下常配 `fg.deobf(...)`）。**fileId 获取：到 CurseForge 项目 Files 页（https://www.curseforge.com/minecraft/mc-mods/<slug>/files）点目标版本，右侧「Curse Maven 代码」复制数字**；CurseForge 迁移文件时 fileId 会变，本文数字仅供参考、不可写死。
- 1.12.2 附属构建基线：Forge 14.23.5.x + ForgeGradle 3 + Java 8；模组发布 jar 多带 SRG 混淆，compileOnly 优先官方 maven 的 dev/deobf/api classifier，其次 curse.maven + `fg.deobf`。

## Thaumcraft（神秘时代，azanor）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/thaumcraft（projectId 223628，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/thaumcraft）
- 简介：老牌魔法模组，灵气（aura）、要素（aspect）、研究、坩埚/注魔/奥术合成。1.12.2 线为 TC6，Forge 14.23.5.2768+，前置 Baubles>=1.5.2（两者均实测自 `@Mod` 依赖注解）；azanor 于 2019-01 停更，**6.1.BETA26（另有 BETA26-hotfix1）即最终版**。注意 B25 有 Forge 兼容问题。
- 官方 maven：无（TC6 无公开发布仓库，2026-08-16 复核）
- curse.maven 示例：`compileOnly "curse.maven:thaumcraft-223628:<fileId>"`（fileId 从 https://www.curseforge.com/minecraft/mc-mods/thaumcraft/files 复制；本文未锁定）
- 本时代常用版本：6.1.BETA26 / 6.1.BETA26-hotfix1（1.12.2）
- API 入口（包 `thaumcraft.api`，TC6 源码实测）：
  - `ThaumcraftApi`：`addArcaneCraftingRecipe(ResourceLocation, IArcaneRecipe)`、`addInfusionCraftingRecipe(ResourceLocation, InfusionRecipe)`、`addCrucibleRecipe(ResourceLocation, CrucibleRecipe)`、`registerObjectTag(ItemStack, AspectList)`（给物品登记要素）、`addWarpToItem`、`addLootBagItem`、`addSmeltingBonus`
  - `research`：`ResearchCategories.registerCategory(String key, String researchkey, AspectList formula, ResourceLocation icon, ResourceLocation background)`、`ResearchEntry`（阶段式研究）、`ResearchEvent`（Forge 事件，子类 `ResearchEvent.Knowledge` / `ResearchEvent.Research`，后者有 `getResearchKey()`）
  - `aspects`：`Aspect`、`AspectRegistryEvent`（Forge 事件，附属在此注册自定义要素）；`capabilities`：`IPlayerKnowledge`、`IPlayerWarp`（经 `ThaumcraftCapabilities` 获取）
  - `crafting`：`CrucibleRecipe(String researchKey, ItemStack result, Object catalyst, AspectList tags)`、`InfusionRecipe`、`IThaumcraftRecipe`；`items`：`ItemsTC`；`casters`：施法者手套的 `FocusNode`/`FocusEffect` 体系
  - 注意：TC6.1 研究本体为数据驱动（mod jar 内 `assets/thaumcraft/research/<分类>.json`），附属加研究既可资源包注入 JSON，也可代码注册 category + 事件
- 软依赖检测写法：`Loader.isModLoaded("thaumcraft")` + `@Optional.Method(modid = "thaumcraft")`
- 联动范例（自写最小示例）：
```java
// 1) 给物品登记要素 + 坩埚配方（均在 preInit/init 阶段调用）
ThaumcraftApi.registerObjectTag(new ItemStack(Items.IRON_INGOT),
        new AspectList().add(Aspect.METAL, 8));
ThaumcraftApi.addCrucibleRecipe(new ResourceLocation("myaddon", "cruc_foo"),
        new CrucibleRecipe("MY_RESEARCH", myOutput, new ItemStack(Items.FIRE_CHARGE),
                new AspectList().add(Aspect.FIRE, 4)));

// 2) 监听玩家完成研究（Forge EVENT_BUS）
@SubscribeEvent
public static void onResearchDone(ResearchEvent.Research evt) {
    if ("MY_RESEARCH".equals(evt.getResearchKey()))
        // 给完成研究的玩家发奖励
        evt.getPlayer().inventory.addItemStackToInventory(myReward);
}
```
- 状态/注意：TC6 闭源且已停更（GitHub 无官方仓库；反编译源码仅供学习）；依赖 Baubles；邪术（Eldritch）线未完成
- 官方/参考链接：API 镜像 https://github.com/nvchks/thaumcraft-api （b25/b26 1.12.2 转换）、反编译源码 https://github.com/TheDarkTower314/Thaumcraft-6-Source-Code 、FTB Wiki https://ftb.fandom.com/wiki/Thaumcraft_6
- 核实来源：cfwidget API（id 223628）；`@Mod` 依赖注解与 API 类均实测自上述源码仓库

## Tinkers Construct（匠魂2，SlimeKnights：mDiyo/bonii）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/tinkers-construct（projectId 74072，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/tinkers-construct 与 mcmod.cn 词条交叉）
- 简介：工具铸造与冶炼炉模组（材料/部件/强化体系）。1.12.2 线为 TiC2，Forge 14.23.x；前置 Mantle。1.12.2 线已于 2020-08 冻结，最终版 **1.12.2-2.13.0.190**。
- 官方 maven：有 — https://dvs1.progwml6.com/files/maven （modmaven.dev 同源镜像）；`compileOnly "slimeknights:TConstruct:1.12.2-2.13.0.190"`（2026-08-16 实测 metadata 200，POM 无传递依赖，无需另拉 Mantle 即可编译）；Mantle 官方坐标见 https://slimeknights.github.io/docs/guides/gradle/ （dvs1 上 Mantle metadata 404，拉不到就从 curse.maven 兜底）
- curse.maven 兜底：`compileOnly "curse.maven:tinkers-construct-74072:<fileId>"`（fileId 从 Files 页复制）
- 本时代常用版本：1.12.2-2.13.0.190（终版；此前稳定版 2.12.x 系列，如 1.12.2-2.12.0.157）
- 版本线注意：1.12.2 与 1.11/1.10 不通用坐标，1.7.10 老线（匠魂 1）坐标与 API 完全不同，见 mods-1.7.10.md
- API 入口（包 `slimeknights.tconstruct.library`，1.12 分支源码实测）：
  - `TinkerRegistry`：`registerModifier(IModifier)`、`addMaterial(Material, IMaterialStats, ITrait)`、`addMaterialStats`、`addMaterialTrait`、`registerTool(ToolCore)`、`registerToolPart(IToolPart)`、`registerMelting(ItemStack/Block/String oredict, Fluid, int amount)`、`registerAlloy(FluidStack result, FluidStack... inputs)`、`registerTableCasting(ItemStack output, ItemStack cast, Fluid fluid, int amount)`、`registerBasinCasting(...)`、`registerSmelteryFuel(FluidStack, int)`、`registerHeadDrop(Class, Function<EntityLivingBase, ItemStack>)`、`addPatternForItem(Item)`、`addCastForItem(Item)`
  - `materials`：`Material`、`IMaterialStats`；`modifiers`：`IModifier`（核心方法 `canApply(ItemStack, ItemStack)`、`apply(ItemStack)`、`apply(NBTTagCompound)`、`applyEffect(NBTTagCompound, NBTTagCompound)`、`getTooltip`、`updateNBT`）；`traits`：`ITrait`；`tools`：`ToolCore`/`IToolPart`；`smeltery`：`SmelteryRecipe`/`AlloyRecipe`
- 软依赖检测写法：`Loader.isModLoaded("tconstruct")` + `@Optional.Method(modid = "tconstruct")`
- 联动范例（自写最小示例，签名均实测）：
```java
// 1) 冶炼炉：熔炼 + 合金（Molten 流体自行注册）
TinkerRegistry.registerMelting(new ItemStack(Items.IRON_INGOT), moltenIron, 144);
TinkerRegistry.registerAlloy(new FluidStack(moltenBronze, 288),
        new FluidStack(moltenCopper, 144), new FluidStack(moltenTin, 144));
TinkerRegistry.registerTableCasting(myPartStack, myCastStack, moltenIron, 144);

// 2) 注册强化（IModifier 需实现上述全部方法，此处示意登记）
TinkerRegistry.registerModifier(new MyModifier());   // MyModifier implements IModifier

// 3) 生物掉落物可被工具部件复制：注册头颅掉落
TinkerRegistry.registerHeadDrop(EntityZombie.class,
        e -> new ItemStack(Items.SKULL, 1, 2));
```
- 说明：`IModifier` 完整方法集（分支 1.12 源码实测）：`matches(NonNullList<ItemStack>)`、`canApply(ItemStack, ItemStack)`、`apply(ItemStack)`、`apply(NBTTagCompound)`、`updateNBT`、`applyEffect`、`getTooltip`、`hasTexturePerMaterial`、`equalModifier`——附属实现时应全部实现或继承现成基类（`slimeknights.tconstruct.library.modifiers` 下实测有 `Modifier`/`ModifierTrait`/`ProjectileModifierTrait`，无 `AbstractModifier`）
- 状态/注意：开源（MIT，仓库 LICENSE）；1.12.2 线冻结；`registerModifier` 的强化需同时处理工具 NBT 与客户端 Tooltip 才能显示；材料用 `addMaterial(Material, IMaterialStats, ITrait)` 注册后自动出现在部件/强化 GUI
- 官方/参考链接：源码 https://github.com/SlimeKnights/TinkersConstruct （分支 `1.12`，API 在 src/main/java/slimeknights/tconstruct/library）；官方 Gradle 指南 https://slimeknights.github.io/docs/guides/gradle/
- 核实来源：cfwidget API（id 74072）；maven metadata https://dvs1.progwml6.com/files/maven/slimeknights/TConstruct/maven-metadata.xml ；TinkerRegistry/IModifier 源码分支 1.12

## Botania（植物魔法，Vazkii）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/botania（projectId 225643，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/botania 与 Modrinth 镜像交叉）
- 简介：自然魔力主题的"魔法科技"模组（产能花/功能花/魔力网络/盖亚挑战）。1.12.2 线 r1.10-364.x，前置 Baubles（饰品栏）；终版 **r1.10-364.4**（maven 另有 r1.10-364.5 等构建）。VazkiiMods 维护，1.12.2 线已冻结。
- 官方 maven：有 — https://maven.blamejared.com ；`compileOnly "vazkii.botania:Botania:r1.10-364.5"`（2026-08-16 实测 POM 200、无传递依赖）；Baubles 同仓库 `com.azanor:Baubles:1.11-1.4.3` 备用
- curse.maven 兜底：`compileOnly "curse.maven:botania-225643:<fileId>"`（fileId 从 Files 页复制）
- 本时代常用版本：r1.10-364.4 / r1.10-364.5（1.12.2）
- API 入口（包 `vazkii.botania.api`，1.12-final 分支源码实测）：
  - `BotaniaAPI`：`registerSubTile(String key, Class<? extends SubTileEntity>)`（自定义花的核心入口）、`registerSubTileSignature`、`addSubTileToCreativeMenu(String)`、`addEntry(LexiconEntry, LexiconCategory)`、`addCategory(LexiconCategory)`、`addOreWeight(String, int)`、`registerDisposableBlock(String oreDict)`、`registerModWiki(String, IWikiProvider)`
  - `subtile`：`SubTileEntity`（普通类、非 TileEntity——内置 `protected TileEntity supertile` 桥接与 `getWorld()`/`getPos()`/`sync()`；`onUpdate()` 默认空实现）、`SubTileFunctional`（功能花，`public int mana` + `getMaxMana()`/`getColor()`/`addMana(int)`）、`SubTileGenerating`（产能花，`protected int mana`，`addMana(int)` 封顶式加魔力）
  - `recipe`：`RecipePetals`/`RecipeManaInfusion`/`RecipePureDaisy`/`RecipeRuneAltar`/`RecipeElvenTrade`/`RecipeBrew`（花药台、魔力灌注等配方类）；`mana`：`IManaPool`/`IManaReceiver` 等魔力接口；`lexicon`（辞典条目）、`brew`、`corporea`、`wand`、`boss`（盖亚）
- 软依赖检测写法：`Loader.isModLoaded("botania")` + `@Optional.Method(modid = "botania")`
- 联动范例（自写最小示例，签名均实测）：
```java
public class MyFlower extends SubTileFunctional {
    @Override public void onUpdate() {                       // 每 tick
        super.onUpdate();
        if (mana >= 10 && getWorld().getTotalWorldTime() % 20 == 0) { // 每 20 tick 消耗 10 mana 做一件事
            mana -= 10;                                       // SubTileFunctional 公有字段，直接扣
            sync();                                           // 同步给客户端（SubTileEntity.sync，public）
        }
    }
    @Override public int getMaxMana() { return 1000; }
    @Override public int getColor()  { return 0x66CCFF; }     // 粒子/HUD 颜色

    public static void init() {
        BotaniaAPI.registerSubTile("myflower", MyFlower.class);
        BotaniaAPI.addSubTileToCreativeMenu("myflower");
        BotaniaAPI.addEntry(new LexiconEntry("myflower", BotaniaAPI.categoryFunctionalFlowers),
                BotaniaAPI.categoryFunctionalFlowers);
    }
}
```
- 状态/注意：开源（Botania License，源文件头实测）；1.12.2 线冻结；`categoryFunctionalFlowers` 等分类常量以 BotaniaAPI 源码为准；自定义花还需提供渲染（默认模型可用）
- 官方/参考链接：官网 https://botaniamod.net 、源码 https://github.com/VazkiiMods/Botania （分支 `1.12-final`）
- 核实来源：cfwidget API（id 225643）；maven metadata https://maven.blamejared.com/vazkii/botania/Botania/maven-metadata.xml ；BotaniaAPI/SubTileFunctional 源码分支 1.12-final

## The Twilight Forest（暮色森林，Benimatic/TeamTwilight）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/the-twilight-forest（projectId 227639，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/the-twilight-forest）
- 简介：经典维度冒险模组（暮色森林维度 + 结构 + Boss）。1.12.2 线最终版 **4.3.2508**；TeamTwilight 维护，1.12.2 线已冻结。
- 官方 maven：无（2026-08-16 复核）
- curse.maven 示例：`compileOnly "curse.maven:the-twilight-forest-227639:5468648"`（= 4.3.2508，2026-08-16 实测下载 200、23.3MB；新版 fileId 以 https://www.curseforge.com/minecraft/mc-mods/the-twilight-forest/files 为准）
- 本时代常用版本：4.3.2508（1.12.2 终版）
- API 入口：**无公开 API 包**（1.12.x 分支源码树零 `api/` 目录，2026-08-16 实测；`RegisterBlockEvent` 等是模组内部注册事件，非公开 API）。稳定可用面：
  - `TwilightForestMod.dimType`（public static `DimensionType`，维度 id 取自配置 `TFConfig.dimension.dimensionID`）、`twilightforest.world.WorldProviderTwilightForest`
  - 物品/方块经 ForgeRegistries 查询（如 `twilightforest:maze_map`）；`twilightforest.enchantment.TFEnchantment` 为内部基类
  - 生态整合路径：软依赖检测 + 物品/维度交互 + 资源包（魔镜、地图等不提供注册 API）
- 软依赖检测写法：`Loader.isModLoaded("twilightforest")` + `@Optional.Method(modid = "twilightforest")`
- 联动范例（自写最小示例）：
```java
// 检测实体是否身处暮色维度
if (Loader.isModLoaded("twilightforest") && entity.dimension == TwilightForestMod.dimType.getId()) {
    // 在暮色维度内：例如替换怪物掉落为暮色物品
    entity.entityDropItem(new ItemStack(Item.getByNameOrId("twilightforest:naga_scale")), 0.0F);
}
```
- 联动补充（无 API 时的替代路径）：
  - a) 物品引用走 `ForgeRegistries.ITEMS.getValue(new ResourceLocation("twilightforest:magic_beans"))`（物品注册名实测为 `naga_scale`/`magic_beans` 这类短名，见 `item/TFItems.java` 的 `@GameRegistry.ObjectHolder`），存在性用 null 判断：
```java
if (Loader.isModLoaded("twilightforest")) {
    Item magicBeans = ForgeRegistries.ITEMS.getValue(
        new ResourceLocation("twilightforest:magic_beans"));
    if (magicBeans != null) { /* 加合成配方等 */ }
}
```
  - b) 给暮色方块/实体做自定义交互时用通用 Forge 事件（`RightClickBlock`/`LivingDrops`）并以维度 id 或方块所属模组过滤；c) 需要改结构/Boss 行为只能反射或 Mixin（1.12.2 无 Mixin 时用 CoreMod），不建议依赖内部类名
- 状态/注意：开源（TeamTwilight/twilightforest）；1.12.2 线冻结；维度 id 可在配置中改（默认注册为 7 号位，勿硬编码）；本体类名不稳定，跨小版本可能变，引用前用 javap 复核；`dimType` 在 preInit 阶段才赋值，初始化时序早于它的代码会拿到 null
- 官方/参考链接：源码 https://github.com/TeamTwilight/twilightforest （分支 `1.12.x`）、FTB Wiki 词条
- 核实来源：cfwidget API（id 227639）；curse.maven 下载实测 200；分支 1.12.x 源码树（无 api 目录、dimType 字段、@Mod 注解）

## Applied Energistics 2（应用能源，AlgorithmX2）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/applied-energistics-2（projectId 223794，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/applied-energistics-2）
- 简介：物品/流体物流与 ME 存储网络模组。1.12.2 线为 rv6，终版 **rv6-stable-7**；实测 `@Mod` 依赖声明需要 CTM（after:ctm）。rv6 已冻结（现代 1.16+ 线坐标改为 `org.appliedenergistics:appliedenergistics2`）。
- 官方 maven：无（rv6 时代官方 maven 已下线，2026-08-16 复核；勿用旧坐标 `appeng:appliedenergistics2:rv6-stable-7:dev`）
- curse.maven 示例：`compileOnly "curse.maven:applied-energistics-2-223794:2747063"`（= rv6-stable-7，2026-08-16 实测下载 200、4.06MB，且 jar 内 `appeng.api` 类为未混淆可读，javap 实测）；fileId 以 Files 页为准
- 本时代常用版本：rv6-stable-7（另有 rv6-stable-6、rv5 等）
- API 入口（包 `appeng.api`，rv6-1.12 分支 + 实测 jar 签名）：
  - 单例：`AEApi.instance()`（枚举）→ `IAppEngApi`：`registries()`、`storage()`、`grid()`（`IGridHelper`）、`partHelper()`、`definitions()`、`client()`
  - `IRegistryContainer`（`registries()` 返回）：`gridCache()`（`IGridCacheRegistry.registerGridCache(Class<? extends IGridCache>, Class<? extends IGridCache>)`）、`cell()`（`ICellRegistry.addCellHandler(ICellHandler)`）、`inscriber()`（`IInscriberRegistry.addRecipe`，builder 链 `withInputs/withTopOptional/withBottomOptional/withOutput/withProcessType/build`）、`grinder()`、`wireless()`、`movable()`、`players()`、`p2pTunnel()`、`matterCannon()`、`worldgen()`
  - **`@appeng.api.AEPlugin`**：标注在附属类上，AE2 初始化阶段自动实例化并**按构造器参数注入** `@AEInjectable` 接口（`IAppEngApi`、`IRegistryContainer` 等，PluginLoader 源码实测）
  - `networking`：`IGrid`/`IGridNode`/`IGridCache`、`crafting`：`ICraftingProvider.provideCrafting(ICraftingProviderHelper)`（机器向 ME 网络供应合成配方）、`storage`：`ICellHandler`/`IStorageCell`；`networking/events`：`MENetworkEvent` 系列 + `@MENetworkEventSubscribe`
- 软依赖检测写法：`Loader.isModLoaded("appliedenergistics2")` + `@Optional.Method(modid = "appliedenergistics2")`
- 联动范例（自写最小示例，签名均 javap 实测）：
```java
// 1) 插件类：AE2 启动时自动实例化，注册自定义网格缓存与存储单元
@AEPlugin
public class MyAEPlugin {
    public MyAEPlugin(IRegistryContainer registries) {
        registries.gridCache().registerGridCache(MyGridCache.class, MyGridCacheImpl.class);
        registries.cell().addCellHandler(new MyCellHandler());   // MyCellHandler implements ICellHandler
    }
}

// 2) 压印机配方（Inscriber，如给模板压印）
IInscriberRegistry reg = AEApi.instance().registries().inscriber();
reg.addRecipe(reg.builder()
        .withInputs(java.util.Collections.singletonList(myTemplate))
        .withTopOptional(myPress)
        .withOutput(myPrinted)
        .build());
```
- 状态/注意：开源（API 文件头 LGPL，实测）；rv6 冻结、需 CTM；`fg.deobf` 下编译最稳（API 虽未混淆，其余主类已 SRG 化）
- 官方/参考链接：源码 https://github.com/AppliedEnergistics/Applied-Energistics-2 （分支 `rv6-1.12`，API 在 `src/api/java/appeng/api`）、DeepWiki 开发文档
- 核实来源：cfwidget API（id 223794）；curse.maven 下载 200 + javap 实测（AEApi/IAppEngApi/IRegistryContainer/IInscriberRegistry/ICellRegistry/ICraftingProvider/AEPlugin/AEInjectable/PluginLoader）

## Mekanism（通用机械，aidancbrady）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/mekanism（projectId 268560，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/mekanism）
- 简介：高科自动化模组（多相能量/气体/管道/工厂/多方块）。1.12.2 线为 v9，终版 **9.8.3.390**（2022-05 发布；同版本提供 `-api` 附加文件 Mekanism-1.12.2-9.8.3.390-api.jar，~102KB）；另需 MekanismGenerators（projectId 268566）等模块可选。
- 官方 maven：无（v9 只发布 LOCAL_MAVEN，无公共仓库；modmaven.dev 的 `:api` classifier 仅 v10+/1.16.1 起，2026-08-16 实测 metadata 无 9.x）
- curse.maven 示例：`compileOnly "curse.maven:mekanism-268560:<fileId>"`（fileId 从 https://www.curseforge.com/minecraft/mc-mods/mekanism/files 复制；本文未锁定 v9 的 fileId——CF 上 9.8.3.390 的 -api.jar 是附加文件，也可直接下到本地 `compileOnly files(...)`）
- 本时代常用版本：9.8.3.390（1.12.2 终版；此前 9.8.2/9.8.1/9.1.x）；1.7.10 老线见 mods-1.7.10.md（9.1.0.281，curse.maven fileId 2426270）
- 多模块注意：Mekanism 本体 + MekanismGenerators（268566）+ MekanismTools（268567）+ MekanismAdditions（345425）四件套同版本同发；写附属只依赖本体 jar 即可，气体/配方 API 都在本体
- API 入口（包 `mekanism.api`，1.12 分支源码实测）：
  - `MekanismAPI`：`recipeHelper()`（返回 `MekanismRecipeHelper`）、`addBoxBlacklist(Block, int)`、嵌套 **`MekanismAPI.BoxBlacklistEvent`**（Forge 事件）；`API_VERSION` 常量（9.8.1）
  - `MekanismRecipeHelper`（接口，`MekanismAPI.recipeHelper()` 获取）：`addEnrichmentChamberRecipe(ItemStack, ItemStack)`、`addCrusherRecipe`、`addCombinerRecipe`、`addPurificationChamberRecipe`、`addPrecisionSawmillRecipe(ItemStack, ItemStack, ItemStack, double)`、`addMetallurgicInfuserRecipe(InfuseType, int, ItemStack, ItemStack)`、`addChemicalInfuserRecipe(GasStack, GasStack, GasStack)`、`addChemicalOxidizerRecipe(ItemStack, GasStack)`、`addPRCRecipe(...)`、`addThermalEvaporationRecipe(FluidStack, FluidStack)` 等
  - `gas`：`Gas`/`GasStack`/`GasRegistry`/`GasTank`/`IGasHandler`/`IGasItem`/`ITubeConnection`；`energy`：`IStrictEnergyAcceptor`/`IStrictEnergyOutputter`/`IStrictEnergyStorage`/`IEnergizedItem`/`EnergizedItemManager`；`infuse`：`InfuseRegistry`/`InfuseType`；`transmitters`：`ITransmitter`/`TransmissionType`/`DynamicNetwork`/`TransmitterNetworkRegistry`（自定义管道/线缆网络的钩子）；`lasers`：`ILaserReceptor`
- 软依赖检测写法：`Loader.isModLoaded("mekanism")` + `@Optional.Method(modid = "mekanism")`
- 联动范例（自写最小示例，签名均实测）：
```java
// 机器配方：富集仓 + 精密锯木机
MekanismAPI.recipeHelper().addEnrichmentChamberRecipe(myOreStack, myDustStack);
MekanismAPI.recipeHelper().addPrecisionSawmillRecipe(myLogStack, myPlankStack,
        mySawdustStack, 0.5D);

// 2) 黑名单框选（多方块结构判定时不把某方块算进去）
MekanismAPI.addBoxBlacklist(Blocks.BEDROCK, 0);

// 3) 自定义方块接入气体网络：TileEntity 实现 IGasHandler（存/取 GasStack），
//    再实现 ITubeConnection 声明可被管道接管；接口方法签名以 mekanism/api/gas 源码为准
```
- 气体侧补充（签名均实测自 1.12 分支）：`GasRegistry.register(Gas)` 定义新气体后即可用 `GasStack(gas, amount)` 参与配方与管道传输；灌注配方（`addMetallurgicInfuserRecipe(InfuseType, int, ItemStack, ItemStack)`）的 InfuseType 经 `InfuseRegistry.get("REDSTONE")` 取内置类型，自定义类型用 `InfuseRegistry.registerInfuseType(new InfuseType("MYTYPE", resourceLocation))`，物品映射用 `registerInfuseObject(ItemStack, InfuseObject)`
- 状态/注意：开源 MIT（Modrinth 版本页实测）；v9 冻结；1.12.2 无 `:api` classifier，用完整 mod jar 当 compileOnly 且**禁止打包进产物**（运行时以服务器 mods/ 内的本体为准）；自定义管道另需注册 `TransmitterNetworkRegistry`；能量接口 v9 为 `IStrictEnergy*` 系列（J 值），与现代 `IEnergyContainer` 命名不同
- 官方/参考链接：源码 https://github.com/mekanism/Mekanism （分支 `1.12`）、官方 README Maven 段（说明 `:api` 仅 v10+）
- 核实来源：cfwidget API（id 268560）；MekanismAPI/MekanismRecipeHelper 源码分支 1.12；Modrinth 9.8.3.390 页面（版本与 MIT 许可）

## IndustrialCraft 2（工业时代，IC2 团队）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/industrial-craft（projectId 242638，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/industrial-craft）
- 简介：2011 年至今的老牌科技模组（EU 电网、机器、作物、核反应堆）。1.12.2 线为 experimental 2.8.x-ex112，最新 **2.8.222-ex112**（2022-06，maven metadata 实测；另有 2.8.170-ex112 等稳定点）。
- 官方 maven：有 — https://maven.ic2.player.to ；三类产物（目录实测）：`compileOnly "net.industrial-craft:industrialcraft-2:2.8.222-ex112:api"`（仅 API jar，2026-08-16 实测下载 200，含 298 个 `ic2/api` 类）；`:dev` 为反混淆开发 jar（拉完整主类）；无 classifier 为发行 jar（SRG 混淆）
- curse.maven 兜底：`compileOnly "curse.maven:industrial-craft-242638:<fileId>"`（fileId 需到 https://www.curseforge.com/minecraft/mc-mods/industrial-craft/files 页面确认——IC2 各版本的 fileId 未在本文件锁定，勿凭记忆填写）
- 本时代常用版本：2.8.222-ex112（最新）/ 2.8.170-ex112（2020 前后常见稳定点）
- API 入口（包 `ic2.api`，api jar javap 实测）：
  - `recipe`：`Recipes` 类静态管理器——`macerator`、`compressor`、`extractor`、`centrifuge`、`blastfurnace`、`metalformerExtruding/Cutting/Rolling`、`cannerBottle`、`fermenter`、`electrolyzer`、`matterAmplifier`、`scrapboxDrops`、`recyclerBlacklist/Whitelist`（`addRecipe(IRecipeInput, NBTTagCompound, boolean, ItemStack...)`；`Recipes.inputFactory.forOreDict(String)`/`forStack(ItemStack)` 构造输入）
  - `crops`：`CropCard`（抽象：`getId`/`getOwner`/`getProperties`/`getMaxSize`）、**`Crops.CropRegisterEvent`**（Forge 事件，`register(CropCard...)`——附属注册作物标准入口）、`Crops.instance.registerCrop(CropCard)`
  - `energy`：`EnergyNet.instance`（public static 字段）→ `IEnergyNet`（javap 实测方法：`addTile(T extends TileEntity & IEnergyTile)`、`removeTile`、`getTile(World, BlockPos)`、`getNodeStats`；**无 `getForWorld`**）、`IEnergySink`/`IEnergySource`（机器侧接口）
  - `event`：`LaserEvent`（`LaserShootEvent`/`LaserHitsBlockEvent`/`LaserHitsEntityEvent`/`LaserExplodesEvent`）、`ExplosionEvent`、`RetextureEvent`、`TeBlockFinalCallEvent`；`item`：`ICustomElectricItem` 等；`reactor`：`IReactorComponent`；`upgrade`：`IUpgradeModule`（自定义升级件）；`network`/`tile`/`transport` 为 Tile/网络数据接口
- 软依赖检测写法：`Loader.isModLoaded("ic2")` + `@Optional.Method(modid = "ic2")`
- 联动范例（自写最小示例，签名均 javap 实测）：
```java
// 1) 打粉机配方（oreDict 输入）
Recipes.macerator.addRecipe(Recipes.inputFactory.forOreDict("oreCopper"),
        null, false, new ItemStack(myCopperDust));

// 2) 注册自定义作物（Forge EVENT_BUS）
@SubscribeEvent
public static void onCropRegister(Crops.CropRegisterEvent evt) {
    evt.register(new MyCropCard());   // MyCropCard extends CropCard，实现 getId/getOwner/getProperties/getMaxSize
}

// 3) 自定义机器接入 EU 电网：TileEntity 实现 IEnergySink（injectEnergy 供能），
//    再经 EnergyNet.instance.addTile(this) 挂网（addTile 直接收 tile 自身，无 world 参数；init 阶段调用）
```
- 说明：`Recipes.*.addRecipe` 的第三参 `boolean` 为"覆盖已有配方"，传入 false 仅追加；输入用 `Recipes.inputFactory`（`forStack`/`forExactStack`/`forOreDict`/`forAny`）构造，勿直接 new IRecipeInput
- 状态/注意：闭源（源码未公开，api jar 为官方发布的唯一开发面）；2.8.x-ex112 冻结；EU 能量单位为 EU/t；自定义机器 tile 走 `ic2.api.tile` 接口 + EnergyNet 接入；IC2 的 `ExplosionEvent`/`LaserEvent` 与 Forge 同名事件无关，均挂 `MinecraftForge.EVENT_BUS`
- 官方/参考链接：maven 仓库 https://maven.ic2.player.to （版本目录 https://maven.ic2.player.to/net/industrial-craft/industrialcraft-2/2.8.222-ex112/ ）、CurseForge 项目页
- 核实来源：cfwidget API（id 242638）；maven metadata 与 `-api.jar` 下载 200 + javap 实测（Recipes/CropCard/Crops/EnergyNet/LaserEvent/IBasicMachineRecipeManager/IRecipeInputFactory）

## SlashBlade（拔刀剑，flammpfeil/Dragon-Seeker）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/slashblade（projectId **241596**，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/slashblade 返回 `"id":241596`。**社区流传的 245703 为错，勿抄**）
- 简介：DMC 风格太刀动作模组（连击 SA/SB、拔刀架势、刀鞘）。1.12.2 线终版 **SlashBlade-mc1.12-r33**（r32 亦常见，部分附属硬性要求 r32）；1.18.2 等新线独立版本（如 0.0.9）。modid：`flammpfeil.slashblade`（@Mod 注解实测）。
- 官方 maven：无（2026-08-16 复核）
- curse.maven 示例：`compileOnly "curse.maven:slashblade-241596:<fileId>"`（fileId 从 https://www.curseforge.com/minecraft/mc-mods/slashblade/files 复制；本文未锁定）
- 本时代常用版本：r33 / r32（1.12.2）
- API 入口（包 `mods.flammpfeil.slashblade`，分支 1.12.2 源码实测）：
  - `item.ItemSlashBlade`：全部刀的基础 Item 类，公开 API 含 `setComboSequence(NBTTagCompound, ComboSequence)`/`getComboSequence(NBTTagCompound)`、`setImpactEffect(ItemStack, EntityLivingBase, EntityLivingBase, ComboSequence)`、`updateKillCount(ItemStack, EntityLivingBase, EntityLivingBase)`、`setDaunting`、`canUseShield`；常量 `RefineBase = 10.0F`、`AnvilRepairBonus`；`item.ItemSlashBladeNamed` 为命名刀基类
  - `util.SlashBladeEvent`：Forge 事件（**挂 MinecraftForge.EVENT_BUS**），子类均 @Cancelable，公共字段实测：`OnUpdateEvent`（`blade`/`world`/`entity`/`indexOfMainSlot`/`isCurrent`——每 tick 对持刀者触发）、`ImpactEffectEvent`（`target`/`user`/`sequence`）、`OnEntityBladeStandUpdateEvent`、`BladeStandAttack`
  - 主类 `SlashBlade`：`registerCustomItemStack(String, ItemStack)`（注册命名剑物品）
- 软依赖检测写法：`Loader.isModLoaded("flammpfeil.slashblade")` + `@Optional.Method(modid = "flammpfeil.slashblade")`
- 联动范例（自写最小示例，字段/方法均实测）：
```java
// 1) 监听拔刀每 tick 更新：给当前主手刀附加自定义 NBT
@SubscribeEvent
public static void onBladeUpdate(SlashBladeEvent.OnUpdateEvent evt) {
    if (!evt.isCurrent || evt.blade.isEmpty()) return;      // 只处理主手持刀
    NBTTagCompound tag = evt.blade.getTagCompound();
    if (tag != null && ItemSlashBlade.getComboSequence(tag) != null) {
        // 例如：连击计数 > N 时给刀附魔效果（示意，勿照搬）
        evt.blade.addEnchantment(Enchantments.SHARPNESS, 1);
    }
}

// 2) 注册自定义命名剑（配合 ItemSlashBladeNamed 子类在 init 阶段调用）
SlashBlade.registerCustomItemStack("myaddon.myblade", new ItemStack(myBladeItem));
```
- 说明：`ImpactEffectEvent` 在刀命中目标时触发（字段 `target`/`user`/`sequence`），可 @Cancelable 拦截；`BladeStandAttack` 为刀架攻击事件；自定义刀的最简路径是继承 `ItemSlashBlade` 注册进 ForgeRegistries，进阶再继承 `ItemSlashBladeNamed` 并挂模型纹理（`getModelTexture(ItemStack)`）
- 状态/注意：源码公开于 GitHub（flammpfeil/SlashBlade，分支 1.12.2），本体长期未大更、生态由附属（日系附属包、SlashBladeCraftTweaker 等）填充；1.12.2 分支有已知 BUG（如部分妖化断刀自动修复不触发）；拔刀 NBT 结构（killCount、SA 等键）随版本变动，深度集成前以 1.12.2 分支源码为准；事件全部 @Cancelable，订阅方注意与本体 handler 的执行顺序
- 官方/参考链接：源码 https://github.com/flammpfeil/SlashBlade （分支 `1.12.2`）、mcmod.cn 词条与附属索引
- 核实来源：cfwidget API（id 241596）；分支 1.12.2 源码（SlashBladeEvent 字段/子类、ItemSlashBlade 方法、@Mod modid、registerCustomItemStack）；mcmod.cn 下载页（r33 为 1.12.2 最高版）
