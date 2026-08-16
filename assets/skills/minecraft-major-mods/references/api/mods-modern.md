# 模组 API 参考（Minecraft 现代线：1.20.1 Forge / 1.21.1 NeoForge / 26.x NeoForge）

- 核对日期：2026-08-16。projectId 当日在线核实：api.cfwidget.com 镜像（CF 直连 403）`GET /minecraft/mc-mods/<id>` 返回 JSON `id` 逐项实测（10 项全部通过）；maven 坐标逐个 curl 实测 metadata/目录；API 类/扩展点从 GitHub 分支源码（git trees + raw 文件）实测，发现与旧线不同的以源码为准。
- **铁律：开发附属前先查本文件，禁止凭记忆写坐标/类名。** fileId 等易变值一律以 CurseForge 文件页为准（R16）。
- curse.maven 通用写法：build.gradle 加 `repositories { maven { url 'https://cursemaven.com' } }`，依赖写 `compileOnly "curse.maven:<slug>-<projectId>:<fileId>"`（ModDevGradle / ForgeGradle 下视需要 `fg.deobf(...)` 或原样）。**fileId 获取：到 CurseForge 项目 Files 页（https://www.curseforge.com/minecraft/mc-mods/<slug>/files）点目标版本，右侧「Curse Maven 代码」复制数字**；CurseForge 迁移文件时 fileId 会变，本文一律不锁定，以 Files 页为准。
- 本时代共性（现代线三时代，与老线 mods-1.7.10.md / mods-1.12.2.md 不通用）：
  - 三时代：1.20.1 = Forge 主线；1.21.1 = NeoForge；26.x = NeoForge（Fabric 线不在本文件覆盖，走 minecraft-fabric-mod 技能）。每个条目分别给出三时代版本号，无对应时代版本时注明「未见」。
  - 软依赖检测现代写法：`ModList.get().isLoaded("<modid>")` + mods.toml / neoforge.mods.toml 的 `optional` modDependencies；**`@Optional`（net.minecraftforge.fml.common.Optional）已废弃，仅老线使用**。
  - 构建侧：1.20.1 仍可用 ForgeGradle `fg.deobf(...)`；1.21.1+ / 26.x 走 ModDevGradle（见 minecraft-forge-mod / minecraft-neoforge-mod 技能）。

## Create（机械动力，simibubi / Creators-of-Create）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/create（projectId 328085，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/328085 返回 `"id":328085`）
- 简介：动能科技模组（传动、活动结构、流体、列车）。三时代：1.20.1 线 6.0.x（Forge 与 NeoForge 双 loader 支持）；1.21.1 线 6.0.x（NeoForge）；**26.x 未见**（maven.createmod.net 无 create-1.21.8/26.x 目录，GitHub 亦无 1.21.8+ 分支，2026-08-16 实测）。modid：`create`。
- 官方 maven：有 — https://maven.createmod.net （0.5.1 老线仓库 maven.tterrag.com 已下线——2026-08-16 复核根目录 200 但 /releases 仓库与 create 目录均已移除，勿引用；老档走 curse.maven/Modrinth）。坐标（目录+metadata 实测）：
  - 1.20.1：`compileOnly("com.simibubi.create:create-1.20.1:6.0.8-291") { transitive = false }`（1.21.1 线同式 `create-1.21.1:6.0.11-295`）
  - **无裸 jar**：只有 `-all` / `-slim` / `-sources` / `-javadoc` classifier，compileOnly 用 `:all` + `transitive = false`
- curse.maven 兜底：`compileOnly "curse.maven:create-328085:<fileId>"`（fileId 从 https://www.curseforge.com/minecraft/mc-mods/create/files 复制）
- 本时代常用版本：1.20.1 = 6.0.8-291（另有老档 0.5.1.f-java17）；1.21.1 = 6.0.11-295
- API 入口（包 `com.simibubi.create.api`，6.0 起官方 API 包、随本体 jar 提供；mc1.20.1/dev 与 mc1.21.1/dev 分支树实测）：
  - `behaviour.movement.MovementBehaviour`：活动结构方块行为接口，`SimpleRegistry<Block, MovementBehaviour> REGISTRY`（以 Block 为 key 注册，javadoc 实测「Blocks may be associated with a behavior through REGISTRY」）；`behaviour.interaction.MovingInteractionBehaviour`（右键交互）
  - `data.recipe`：`CompactingRecipeGen`（extends `ProcessingRecipeGen`，构造器 `(PackOutput, String defaultNamespace)` 实测）等 datagen 基类
  - `event`（事件）、`registrate`（CreateRegistrate，附属自建实例、勿用 `Create.REGISTRATE`）、`registry/registrate`、`contraption`（含 `contraption.storage` 活动结构容器）、`equipment/goggles`
- 软依赖检测：`ModList.get().isLoaded("create")` + mods.toml `[modDependencies.create] modId="create" optional=true`（0.5.1 老线无稳定 API：内部包 + Forge 事件，勿引）
- 扩展点：机关/活动结构上的自定义方块行为（MovementBehaviour / MovingInteractionBehaviour via REGISTRY）、动力配方 datagen（继承 api/data/recipe 基类）、自建 CreateRegistrate 注册内容、api/event 事件
- 联动范例（自写最小示例）：
```java
// 1) 活动结构上让方块有特殊行为：注册 Block → 行为（接口方法签名以 6.0.x API jar 为准）
public static void init() {
    MovementBehaviour.REGISTRY.register(MyBlocks.MAGIC_COG, new MyMovingBehaviour());
    // MyMovingBehaviour implements MovementBehaviour；接口含默认实现，可只覆写需要的 tick 等
}

// 2) 动力配方 datagen：继承本体基类（构造器签名实测 (PackOutput, String)），随数据生成器输出
public class MyCompactingRecipes extends CompactingRecipeGen {
    public MyCompactingRecipes(PackOutput output) { super(output, "myaddon"); }
    @Override protected void generate() {
        // 基类提供 compacting(...) 系 build 方法（方法集以 CompactingRecipeGen/ProcessingRecipeGen 源码为准）
    }
}
```
- 状态/注意：开源（MIT，LICENSE 实测）；1.20.1 线 6.0.x 同时支持 Forge/NeoForge；`-all` jar 只用于编译期，禁止打包进产物；26.x 线未见、勿猜测坐标
- 官方/参考链接：源码 https://github.com/Creators-of-Create/Create （分支 `mc1.20.1/dev` / `mc1.21.1/dev`，API 在 src/main/java/com/simibubi/create/api）、Wiki https://create.fandom.com/wiki/Create
- 核实来源：cfwidget API（id 328085）；maven.createmod.net metadata（6.0.8-291 / 6.0.11-295）+ 无 26.x 目录；GitHub 分支树（MovementBehaviour.REGISTRY、MovingInteractionBehaviour、CompactingRecipeGen extends ProcessingRecipeGen、无 1.21.8+/26.x 分支）

## Botania（植物魔法，Vazkii）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/botania（projectId 225643，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/225643 返回 `"id":225643`）
- 简介：自然魔力主题的「魔法科技」模组。**1.20.1 是终线**（maven metadata 实测无任何 1.21+ 版本；GitHub 有 1.21.1-porting 移植分支但无发布版本）；FORGE 与 FABRIC 同版本并存。老线见 mods-1.7.10.md（r1.8-249）/ mods-1.12.2.md（r1.10-364.4）。modid：`botania`。
- 官方 maven：有 — https://maven.blamejared.com ；`compileOnly "vazkii.botania:Botania:1.20.1-454-FORGE"`（release 实测；另有 -455-FORGE-SNAPSHOT）
- curse.maven 兜底：`compileOnly "curse.maven:botania-225643:<fileId>"`（fileId 从 Files 页复制）
- 本时代常用版本：1.20.1-454-FORGE / 1.20.1-454-FABRIC（1.20.1）；1.21.1+ 未见
- API 入口（包 `vazkii.botania.api`，分支 1.20.x 的 Xplat 模块源码实测）——**注册模型与 1.12.2 完全不同**：
  - `BotaniaAPI` 是接口（`BotaniaAPI.instance()`，非老线静态方法类）；**`registerSubTile` 已移除**（1.20.x 源码实测无此方法、无 subtile 包），老教程代码不适用
  - instance() 可用：`registerPaintableBlock(Block, Function<DyeColor, Block>)`、`registerCorporeaNodeDetector(CorporeaNodeDetector)`、`getManaNetworkInstance()`（internal.ManaNetwork）、`getBrewRegistry()`（brew）、`getConfigData()`（configdata.ConfigDataManager，数据包配置）
  - `block_entity`：`FunctionalFlowerBlockEntity` / `GeneratingFlowerBlockEntity` / `SpecialFlowerBlockEntity`（自定义花在此体系下继承）
  - `recipe`（数据驱动配方接口清单实测）：PetalApothecaryRecipe、ManaInfusionRecipe、RunicAltarRecipe、PureDaisyRecipe、ElvenTradeRecipe、BotanicalBreweryRecipe、OrechidRecipe、TerrestrialAgglomerationRecipe
- 软依赖检测：`ModList.get().isLoaded("botania")` + optional modDependencies
- 扩展点：自定义功能花/产能花（正常注册 Block + BlockEntityType，无 Botania 专用注册 API）、可染色方块（registerPaintableBlock）、corporea 节点（registerCorporeaNodeDetector / corporea 包）、数据包配置（ConfigDataManager）、配方（数据包 JSON）
- 联动范例（自写最小示例）：
```java
// 1) 自定义功能花：Block/BlockEntityType 照常 DeferredRegister 注册，BlockEntity 继承功能花基类
//    基类/接口方法（tick、mana 逻辑）签名以 api/block_entity/FunctionalFlowerBlockEntity.java 为准
public class MyFlowerBlockEntity extends FunctionalFlowerBlockEntity {
    @Override public void tick() {
        super.tick();
        // 与魔力网络交互：BotaniaAPI.instance().getManaNetworkInstance()（internal/ManaNetwork）
    }
}

// 2) 给盆栽方块注册可染色转换（instance() 实测签名）
BotaniaAPI.instance().registerPaintableBlock(MyBlocks.MY_POTTED_PLANT,
        color -> MyBlocks.MY_POTTED_PLANT.getColoredVariant(color)); // 具体 Block 形态自定
```
- 状态/注意：开源（Botania License，源文件头实测）；1.20.1 终线、1.21.1 移植分支未发布，写 1.21+ 附属前先查 maven metadata；无 registerSubTile——自定义花走标准注册流程
- 官方/参考链接：官网 https://botaniamod.net 、源码 https://github.com/VazkiiMods/Botania （分支 `1.20.x`，API 在 Xplat/src/main/java/vazkii/botania/api）
- 核实来源：cfwidget API（id 225643）；maven.blamejared.com/vazkii/botania/Botania metadata（1.20.1-454-FORGE release / 455-SNAPSHOT、无 1.21+）；GitHub 1.20.x 分支树（BotaniaAPI 接口+instance()、无 subtile 包、block_entity 三类花基类、recipe 接口清单）

## Applied Energistics 2（应用能源2，AppliedEnergistics 团队）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/applied-energistics-2（projectId 223794，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/223794 返回 `"id":223794`）
- 简介：ME 存储网络物流模组。三时代：1.20.1 = 15.3.x（Forge/NeoForge/Fabric）；1.21.1 = 16.x；1.21.5+/26.x = 19.x/26.x（Maven Central）。modid 现代线为 **`ae2`**（不是老线 `appliedenergistics2`）。
- 官方 maven：**Maven Central** `org.appliedenergistics:appliedenergistics2`（README 声明 + repo1.maven.org metadata 实测）——**15.x/16.x 不在 Central**（metadata 全量实测无 15/16），1.20.1 / 1.21.1 走 curse.maven 或 Modrinth maven
  - 1.21.5+/26.x 线：`compileOnly "org.appliedenergistics:appliedenergistics2:19.2.17:api"`（`-api` classifier 实测存在，19.2.17-api.jar 下载 200；26.x 线 latest = 26.1.10-beta）
- curse.maven 兜底：`compileOnly "curse.maven:applied-energistics-2-223794:<fileId>"`（fileId 从 https://www.curseforge.com/minecraft/mc-mods/applied-energistics-2/files 复制）
- 本时代常用版本：1.20.1 = 15.3.6（Modrinth 实测）；1.21.1 = 16.x（同上）；26.x = 26.1.10-beta（Central release）
- API 入口（包 `appeng.api`；forge/1.20.1 与 main 两分支树实测）——**rv6 老线机制在现代线已移除**：`@AEPlugin`、`AEApi.instance()`、`MENetworkEvent`/`@MENetworkEventSubscribe`、`IGridCache` 在两分支树均无对应文件，勿引用。现代入口：
  - `networking.GridServices`：`public static synchronized <T extends IGridServiceProvider> void register(Class<? super T> publicInterface, Class<T> implClass)`（两分支同签名实测；AE 按构造器自动构造实例，网格经 `IGrid.getService(Class)` 查询）；`networking.GridHelper`
  - `networking.crafting`：`ICraftingProvider` / `ICraftingService`；`storage.cells.ICellHandler`；`stacks`（AEKey/IAEStack 体系）；`features`：`P2PTunnelAttunement`、`GridLinkables`、`Locatables`、`IPlayerRegistry`
  - `networking.events`：`GridEvent` 子类（GridBootingStatusChange/GridPowerStatusChange 等）+ `appeng.api.events.Event`/`EventFactory`
  - 联动补充：`GridServices.register` 签名在 forge/1.20.1 与 main（26.x 线）两分支逐字一致（实测），跨线参考价值高；1.20.1 专属差异以分支源码为准
- 软依赖检测：`ModList.get().isLoaded("ae2")` + optional modDependencies
- 扩展点：网格服务（GridServices.register——替代老 gridCache）、自定义存储单元/外部存储（ICellHandler）、合成提供（ICraftingProvider）、P2P 隧道类型（P2PTunnelAttunement）、网格事件（GridEvent 子类）
- 说明：15.x/16.x 线除 curse.maven 外也可走 Modrinth maven（`maven { url 'https://api.modrinth.com/maven' }` + `compileOnly "maven.modrinth:ae2:<version>"`，坐标以 Modrinth ae2 项目页为准）；`stacks` 包为现代能量/物品统一键体系（AEKey/IAEStack），接口签名以目标版本分支源码为准；`-api` classifier 只含 `appeng.api`（19.2.17-api.jar 下载实测），运行时以服务器本体为准
- 联动范例（自写最小示例，register 签名实测）：
```java
// 1) 给每个 ME 网格挂自定义服务：实现类由 AE 按构造器自动构造（GridServices javadoc 实测），
//    网格内经 IGrid.getService(MyGridService.class) 取用
public class MyGridService implements IGridServiceProvider { /* 生命周期方法以 15.3.x API 为准 */ }
public static void init() {
    GridServices.register(MyGridService.class, MyGridServiceImpl.class);
}

// 2) 机器向 ME 网络提供合成配方：实现 ICraftingProvider（networking/crafting 包实测存在）
//    并把自己注册进 IGrid 的 crafting service；方法签名以 forge/1.20.1 分支源码为准
```
- 状态/注意：开源（API 文件头 LGPL，实测）；版本线坐标差异大（1.20.1/1.21.1 无 Central 坐标）；rv6 时代的 @AEPlugin 示例来自老教程、现代线无效；26.x 线 API 与 1.21.5 线同源（main 分支）
- 官方/参考链接：源码 https://github.com/AppliedEnergistics/Applied-Energistics-2 （1.20.1 分支 `forge/1.20.1`；1.21.5+/26.x 分支 `main`，API 在 src/main/java/appeng/api）
- 核实来源：cfwidget API（id 223794）；repo1.maven.org metadata（19.2.17 + api classifier 200、26.1.10-beta、无 15/16）；GitHub 两分支树（无 AEPlugin/MENetworkEvent/IGridCache；GridServices.register 签名、ICellHandler、P2PTunnelAttunement、features 清单）

## Mekanism（通用机械，aidancbrady / Mekanism 团队）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/mekanism（projectId 268560，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/268560 返回 `"id":268560`）
- 简介：高科自动化模组（能量/化学气体/管道/多方块/模块化装备）。三时代：1.20.1 = 10.4.x；1.21.1 = 10.7.x；**26.x 未见**（modmaven.dev metadata 最高 1.21.1-10.7.19.85）。modid：`mekanism`。
- 官方 maven：有 — https://modmaven.dev ；`compileOnly "mekanism:Mekanism:1.20.1-10.4.16.80"`（1.21.1 线 `1.21.1-10.7.19.85`）；现代版单 artifact 多 classifier（实测）：`-api` / `-all` / `-generators` / `-tools` / `-additions` / `-sources`（Generators 等模块并入 classifier，不再独立坐标）
- curse.maven 兜底：`compileOnly "curse.maven:mekanism-268560:<fileId>"`（fileId 从 https://www.curseforge.com/minecraft/mc-mods/mekanism/files 复制）
- 本时代常用版本：1.20.1-10.4.16.80；1.21.1-10.7.19.85
- API 入口（包 `mekanism.api`，1.20.x 与 1.21.x 分支源码实测）——**v9 老线 API 已换代**：`MekanismAPI.recipeHelper()` 与 `MekanismAPI.BoxBlacklistEvent` 两分支均不存在（1.21.x 树 0 处 BoxBlacklist），勿引用老教程：
  - 配方：**全部数据驱动**——`data/<modid>/recipes/*.json`（type `mekanism:enriching`/`crushing`/`sawing`/`metallurgic_infusing` 等）；datagen 侧 `mekanism.api.datagen.recipe`（`MekanismRecipeBuilder` + `builder` 子包：ChemicalToChemicalRecipeBuilder、CombinerRecipeBuilder、ChemicalCrystallizerRecipeBuilder 等，1.21.x 树实测）
  - 能量：`mekanism.api.energy.IEnergyContainer`（J 值，两分支实测存在；取代老 `IStrictEnergy*` 命名）、`IStrictEnergyHandler` 系
  - 化学：`mekanism.api.chemical`（Chemical/ChemicalStack/IChemicalTank/IChemicalHandler；`ChemicalBuilder` 构建新化学物，经 `MekanismAPI.CHEMICAL_REGISTRY_NAME` 的 `DeferredRegister<Chemical>` 注册，1.20.x javadoc 实测）
  - 模块：`mekanism.api.gear.ModuleData`（`MekanismAPI.MODULE_REGISTRY`）；服务：`MekanismAPI.getService(Class)` + `IMekanismAccess`（1.21.x 实测：jeiHelper/emiHelper/ingredient creators）；`robit.RobitSkin`、`security` 包
- 软依赖检测：`ModList.get().isLoaded("mekanism")` + optional modDependencies
- 扩展点：机器配方（数据包 JSON / datagen builder——无运行时注册 API）、自定义方块接能量/气体网络（实现 IEnergyContainer/IChemicalHandler 接口即接入）、模块（ModuleData 注册）、Robit 皮肤
- 联动范例（自写最小示例）：
```json
// 1) 富集仓配方（数据驱动，最稳路径）：data/<modid>/recipes/my_enriching.json
//    字段以本体 generated 配方 src/generated/resources/data/mekanism/recipes/ 为模板核对
{
  "type": "mekanism:enriching",
  "input":  { "ingredient": { "item": "minecraft:raw_iron" } },
  "output": { "item": "minecraft:iron_ingot" }
}
```
```java
// 2) datagen 侧：用 mekanism.api.datagen.recipe.builder 的 builder（类名实测）构造并写出；
//    builder 链方法（input/output/chemicalInput 等）以 1.20.x/1.21.x 分支 API 源码为准
// 3) 自定义机器接能量：TileEntity 侧持有/暴露 IEnergyContainer（energy 包，两分支实测），
//    即接入能量网络，无需注册；气体同理走 chemical/IChemicalHandler
```
- 状态/注意：开源 MIT；`MekanismAPI.API_VERSION`（1.20.x = 10.4.0 实测）与模组版本号不同步属正常；26.x 未见；`-api` classifier 是纯接口面，运行时以服务器本体为准
- 官方/参考链接：源码 https://github.com/mekanism/Mekanism （分支 `1.20.x` / `1.21.x`，API 在 src/api/java/mekanism/api）、官方 Wiki https://wiki.aidancbrady.com/
- 核实来源：cfwidget API（id 268560）；modmaven.dev metadata（1.20.1-10.4.16.80 / 1.21.1-10.7.19.85）；GitHub 两分支（MekanismAPI 无 recipeHelper/BoxBlacklist、energy/IEnergyContainer、chemical 包、datagen/recipe/builder、IMekanismAccess 服务、MODULE_REGISTRY）

## Ars Nouveau（新生魔艺，BaileyHoll）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/ars-nouveau（projectId 401955，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/401955 返回 `"id":401955`）
- 简介：法术刻印/仪式/魔药/召唤物魔法模组。三时代：1.20.1 = 4.x；1.21.1 = 5.x；**26.x 未见**（blamejared 目录与 Modrinth 过滤均无，plan 实测）。modid：`ars_nouveau`（**注意**：maven groupId 带下划线 `com.hollingsworth.ars_nouveau`，Java 包名无下划线 `com.hollingsworth.arsnouveau`）。
- 官方 maven：有 — https://maven.blamejared.com ；artifact 带 MC 后缀：`compileOnly "com.hollingsworth.ars_nouveau:ars_nouveau-1.20.1:4.12.7.264"`（1.21.1 线 `ars_nouveau-1.21.1:5.13.0.1392`）
- curse.maven 兜底：`compileOnly "curse.maven:ars-nouveau-401955:<fileId>"`（fileId 从 Files 页复制）
- 本时代常用版本：1.20.1 = 4.12.7.264；1.21.1 = 5.13.0.1392
- API 入口（包 `com.hollingsworth.arsnouveau.api`，分支 1.20 树实测）——注册分散为 `api.registry` 一族类（非老方案单一 ArsNouveauRegistry）：
  - `registry`：`GlyphRegistry`（法术刻印）、`RitualRegistry`（仪式）、`PerkRegistry`、`FamiliarRegistry`（召唤物）、`ImbuementRecipeRegistry`（注魔）、`MultiRecipeRegistry` / `GenericRecipeRegistry`（多输入配方）、`BehaviorRegistry`（mob_jar）、`CasterTomeRegistry`、`SpellSoundRegistry`、`ScryRitualRegistry`
  - `ritual`：`AbstractRitual`（仪式基类）；`mob_jar`、`particle`（ParticleColorRegistry）、`recipe`（SummonRitualRecipe/ScryRitualRecipe，仪式配方读取参考）
  - **法术刻印数据驱动**：glyph 以配方形式落数据包 `data/<modid>/recipes/glyph_<name>.json`（本体 generated 目录 src/generated/resources/data/ars_nouveau/recipes/glyph_*.json 实测为模板）；效果类在 `com.hollingsworth.arsnouveau` 的 spell 体系（api 包外，以源码为准）
  - 注意：老教程里的单一 `ArsNouveauRegistry` 类在现代 4.x/5.x 已不存在（1.20 分支 404 实测），注册入口全部落在 api/registry 各族
- 软依赖检测：`ModList.get().isLoaded("ars_nouveau")` + optional modDependencies
- 扩展点：自定义法术刻印（glyph：代码效果类 + GlyphRegistry + 数据包 glyph 配方）、仪式（AbstractRitual + RitualRegistry）、perk、召唤物（FamiliarRegistry）、注魔/魔药配方
- 说明：本体 glyph 配方为 generated 输出（src/generated/resources/data/ars_nouveau/recipes/ 下 glyph_*.json 实测 100+ 个），写附属 glyph 时照此模板走 `data/<modid>/recipes/glyph_*.json`；仪式/注魔等配方同走数据包 JSON；代码侧注册集中 `api/registry` 包（GlyphRegistry/RitualRegistry/PerkRegistry/FamiliarRegistry/ImbuementRecipeRegistry/MultiRecipeRegistry/GenericRecipeRegistry/BehaviorRegistry/CasterTomeRegistry/ScryRitualRegistry/SpellSoundRegistry 十一类，1.20 分支树实测）；本体 glyph/仪式 JSON 也可被附属数据包覆盖（标准 datapack 机制，零代码）
- 联动范例（自写最小示例）：
```json
// 1) glyph 配方（数据侧，零依赖）：data/<modid>/recipes/glyph_my_spell.json
//    type 与字段以本体 generated 的 glyph_*.json 为模板核对（1.20 分支实测存在）
{ "type": "ars_nouveau:glyph", "count": 1, "tier": "ONE",
  "input": { "item": "minecraft:amethyst_shard" },
  "output": { "item": "myaddon:glyph_my_spell" } }
```
```java
// 2) 代码侧：效果类继承/实现 spell 体系基类，经 GlyphRegistry 注册（api/registry/GlyphRegistry.java
//    实测存在；注册方法签名与 spell 基类位置以 4.12/5.13 源码为准）
```
- 状态/注意：开源（BaileyHoll/Ars-Nouveau）；26.x 未见；包名/groupId/artifact 三者写法不一致（下划线 vs 无下划线），照抄本文坐标即可；glyph 全链路为数据+代码双侧，两侧都要做
- 联动补充：附属常见诉求（替换 glyph 配方材料、覆盖仪式内容）大多可在数据包层完成零代码；必须代码注册的只有效果类、ritual 子类与召唤物实体——入口均实测在 api/registry 各族（GlyphRegistry/RitualRegistry/FamiliarRegistry）
- 官方/参考链接：源码 https://github.com/BaileyHoll/Ars-Nouveau （分支 `1.20` / `1.21.x`）、官方 Wiki https://www.arsnouveau.wiki/
- 核实来源：cfwidget API（id 401955）；maven.blamejared.com metadata（4.12.7.264 / 5.13.0.1392）；GitHub 1.20 分支树（api/registry 各族注册类、api/ritual/AbstractRitual、generated glyph 配方目录）

## Farmer's Delight（农夫乐事，vectorwing）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/farmers-delight（projectId 398521，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/398521 返回 `"id":398521`）
- 简介：烹饪与农业扩展（菜板/烹饪锅/熏制炉/作物）。三时代：1.20.1 = 1.20.1-1.3.2（Forge+NeoForge）；1.21.1 = 1.21.1-1.3.2（NeoForge）；**26.x 无发布**（Modrinth 版本 API 实测；GitHub 有 26.1 开发分支未发版）。modid：`farmersdelight`。
- 官方 maven：**无公共 maven**（build.gradle 实测：group `vectorwing.farmersdelight`，`publishing` 只发 `file://${projectDir}/repo` 本地目录）——附属只能 curse.maven
- curse.maven 兜底：`compileOnly "curse.maven:farmers-delight-398521:<fileId>"`（fileId 从 https://www.curseforge.com/minecraft/mc-mods/farmers-delight/files 复制）
- 本时代常用版本：1.20.1-1.3.2；1.21.1-1.3.2（1.21.1 线只有 NeoForge）
- API 入口：**无公开 API 包**（1.20 分支树实测 common 下无 api 目录）。稳定联动面：
  - 数据驱动配方：`vectorwing.farmersdelight.common.crafting.CuttingBoardRecipe` / `CookingPotRecipe`（1.20 分支树实测）——菜板/锅配方全部可经数据包注入，零代码
  - 物品/方块引用走注册表（`ForgeRegistries.ITEMS.getValue(new ResourceLocation("farmersdelight", "cooked_rice"))` 之类）；Forge/NeoForge 事件；软依赖
- 软依赖检测：`ModList.get().isLoaded("farmersdelight")` + mods.toml optional modDependencies（配方 JSON 内用 `mod_loaded` 条件守卫）
- 扩展点：菜板/锅配方（数据包，零代码）、作物/食物属性（无注册 API——走事件与配方）、@Mod 依赖声明式 soft dependency
- 说明：锅配方 type 为 `farmersdelight:cooking`（CookingPotRecipe 同树实测），字段（cookingtime/experience 等）以本体 generated 配方与 fromJson 源码为模板；刀类 tool tag 随 loader 线有差异（1.20.1 常用 `farmersdelight:tools/knives`，1.21.1 常用 `c:tools/knives`），落盘前对照目标版本源码 common/tags 目录核对；本体 `ModRecipeTypes`/`ModRecipeSerializers`（common/registry 实测）为内部类，勿引用
- 联动补充：需要代码级交互（右键菜板/锅、吃食物效果）走通用 Forge/NeoForge 事件（如 UseBlockEvent）+ 注册表物品引用，无专属事件 API；作物类联动同理走种植/收获事件
- 联动范例（自写最小示例）：
```json
// 菜板配方：data/<modid>/recipes/<name>_cutting.json
// 字段以 common/crafting/CuttingBoardRecipe.java 的 fromJson（实测读取 group/ingredients/tool/results/sound）
// 与本体 generated 配方为模板核对；tool 接受带 action 的 item/tag
{
  "type": "farmersdelight:cutting",
  "conditions": [ { "type": "forge:mod_loaded", "modid": "farmersdelight" } ],
  "ingredients": [ { "item": "minecraft:bread" } ],
  "tool": { "tag": "c:tools/knives", "action": "farmersdelight:add_item" },
  "result": [ { "item": "minecraft:wheat", "count": 2 } ],
  "sound": "minecraft:item.axe.scrape"
}
```
- 状态/注意：开源 MIT；无 API 包——需要代码级集成（如锅的自定义交互）走 Forge/NeoForge 事件与注册表引用，勿引内部类；`1.21.1` 线只有 NeoForge 版；26.x 无发布（GitHub 26.1 分支开发中，勿当已发版引用）
- 官方/参考链接：源码 https://github.com/vectorwing/FarmersDelight （分支 `1.20` / `1.21` / `26.1`）、Wiki https://github.com/vectorwing/FarmersDelight/wiki
- 核实来源：cfwidget API（id 398521）；Modrinth 版本 API（1.20.1-1.3.2 / 1.21.1-1.3.2、无 26.x）；GitHub build.gradle（publishing file:// 本地目录）+ 1.20 分支树（common/crafting/CuttingBoardRecipe.java、CookingPotRecipe.java、无 api 包）

## Curios（饰品 API，TheIllusiveC4）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/curios（projectId 309927，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/309927 返回 `"id":309927`、title "Curios API"）
- 简介：饰品栏 API（戒指/项链/腰带等槽位）。三时代全支持：1.20.1 = Forge；1.21.1 = NeoForge；26.x = NeoForge（三个 release 均 metadata 实测）。modid：`curios`。
- 官方 maven：有 — https://maven.theillusivec4.top ；group `top.theillusivec4.curios`，artifact 按 loader 分（目录实测）：
  - 1.20.1：`compileOnly "top.theillusivec4.curios:curios-forge:5.14.1+1.20.1"`
  - 1.21.1：`compileOnly "top.theillusivec4.curios:curios-neoforge:9.5.1+1.21.1"`
  - 26.x：`compileOnly "top.theillusivec4.curios:curios-neoforge:16.0.0+26.2"`（版本形如 `<ver>+<mc>`）
- curse.maven 兜底：`compileOnly "curse.maven:curios-309927:<fileId>"`（fileId 从 Files 页复制）
- 本时代常用版本：5.14.1+1.20.1 / 9.5.1+1.21.1 / 16.0.0+26.2
- API 入口（包 `top.theillusivec4.curios.api`，1.20.x / 1.21.x 分支树与 CuriosApi.java 源码实测）：
  - `CuriosApi`：`registerCurio(Item, ICurioItem)`（物品绑定行为，两分支同签名实测）、`registerCurioPredicate(ResourceLocation, Predicate<SlotResult>)`、`getItemStackSlots`、`getSlot`/`getSlots`、`getCuriosInventory(LivingEntity)`、`getCurio(ItemStack)`、`addSlotModifier`、`createCurioProvider`
  - `type.capability`：`ICurioItem` / `ICurio`（物品实现即入饰品栏）；`CuriosCapability`（capability 常量；1.21+ NeoForge 为 attachment）；`type.ISlotType`、`SlotTypePreset`（api 根包实测）、`SlotContext`/`SlotResult`
  - `event`：`CurioEquipEvent` / `CurioUnequipEvent` / `CurioChangeEvent` / `CurioDropsEvent` / `CurioAttributeModifierEvent` / `DropRulesEvent`；`client`：`ICurioRenderer` + `CuriosRendererRegistry`
  - 槽位类型数据驱动：`data/<modid>/curios/slots/<slot>.json`（`CuriosDataProvider` 实测存在）
- 软依赖检测：`ModList.get().isLoaded("curios")` + optional modDependencies
- 扩展点：物品实现 ICurioItem/ICurio、自定义槽位（json + registerCurioPredicate 控准入）、饰品渲染、饰品事件
- 联动范例（自写最小示例，签名实测）：
```java
public class MyRing implements ICurioItem {
    // canEquip/getEquipSound 等默认方法可选择性覆写；方法集以 1.20.1(5.14.x) API 源码为准
}

public static void init() {
    CuriosApi.registerCurio(MyItems.MY_RING, new MyRing());   // 实测签名 (Item, ICurioItem)

    // 槽位准入过滤：只允许进 ring 槽（Predicate<SlotResult>，1.20.x 实测签名）
    CuriosApi.registerCurioPredicate(new ResourceLocation("myaddon", "only_ring"),
            slotResult -> true /* 按需过滤；SlotResult 取槽方法以 API 源码为准 */);
}
// 自定义槽位 json：data/myaddon/curios/slots/my_ring.json（size/icon/validators）
```
- 状态/注意：开源；1.21+ NeoForge 无 capability——attachment 化（CuriosCapability 用法随版本差异，以 9.x API 为准）；26.x 线由 neoforge artifact 覆盖
- 官方/参考链接：源码 https://github.com/TheIllusiveC4/Curios （分支 `1.20.x` / `1.21.x` / `26.x`）、Wiki https://github.com/TheIllusiveC4/Curios/wiki
- 核实来源：cfwidget API（id 309927）；maven.theillusivec4.top 三 artifact metadata（5.14.1+1.20.1 / 9.5.1+1.21.1 / 16.0.0+26.2）；GitHub 1.20.x 树 + CuriosApi.java 方法 grep（registerCurio / registerCurioPredicate / type.capability.ICurioItem / event 清单）

## JEI（Just Enough Items，配方查看器，mezz）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/jei（projectId 238222，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/238222 返回 `"id":238222`）
- 简介：物品与配方查看器。三时代：1.20.1 = 15.x；1.21.1 = 19.x；26.x = 30.x（blamejared 三线 metadata 实测）。modid：`jei`。作为依赖（runtimeOnly）装入即可，附属侧只编译 API。
- 官方 maven：有 — https://maven.blamejared.com ；artifact 按 `jei-<mc>-<loader>` 分（目录实测）：
  - 1.20.1：`compileOnly "mezz.jei:jei-1.20.1-forge-api:15.49.0.188"` + `runtimeOnly "mezz.jei:jei-1.20.1-forge:15.49.0.188"`
  - 1.21.1：`jei-1.21.1-forge-api:19.44.0.401`；26.x：`jei-26.2-neoforge-api:30.24.0.165`（同式）
- curse.maven 兜底：`compileOnly "curse.maven:jei-238222:<fileId>"`（fileId 从 https://www.curseforge.com/minecraft/mc-mods/jei/files 复制）
- 本时代常用版本：15.49.0.188 / 19.44.0.401 / 30.24.0.165
- API 入口（包 `mezz.jei.api`，分支 1.20.1 的 CommonApi 模块源码实测）：
  - **`@JeiPlugin` 注解**（`mezz.jei.api.JeiPlugin`，javadoc 实测：所有 IModPlugin 必须带此注解且**有无参构造器**——老教程「`public static final IModPlugin INSTANCE`」写法在现代线无效）+ `IModPlugin` 接口：`getPluginUid()`（唯一 id）、`registerItemSubtypes`、`registerCategories(IRecipeCategoryRegistration)`、`registerRecipes(IRecipeRegistration)`、`registerRecipeTransferHandlers`、`registerVanillaCategoryExtensions` 等（default 方法清单实测）
  - `IRecipeCategory<T>` / `IRecipeRegistration.addRecipes` / `IRecipeManager`、runtime 交互
  - **integration API 永不进产物**：只 compileOnly 引 -api，运行时以玩家装的本体为准
- 软依赖检测：`ModList.get().isLoaded("jei")` + optional modDependencies
- 扩展点：自定义配方类别与配方展示（registerCategories/registerRecipes）、物品 subtype（registerItemSubtypes）、配方转移（registerRecipeTransferHandlers）、高级搜索/别名（registerAdvancedSearch/registerIngredientAliases）
- 联动范例（自写最小示例，签名实测）：
```java
@JeiPlugin
public class MyJeiPlugin implements IModPlugin {
    // 无参构造器；由 JEI 自动实例化（无需静态 INSTANCE 字段）
    @Override public ResourceLocation getPluginUid() {
        return new ResourceLocation("myaddon", "jei");
    }
    @Override public void registerRecipes(IRecipeRegistration reg) {
        reg.addRecipes(MyRecipeType.INSTANCE, myRecipeList()); // IRecipeRegistration.addRecipes 实测
    }
}
```
- 状态/注意：开源（MIT）；26.x 走 `-neoforge` artifact；-api 与本体版本号必须一致（metadata release 同源）；运行时玩家需装 JEI 本体
- 官方/参考链接：源码 https://github.com/mezz/JustEnoughItems （分支 `1.20.1` / `1.21.1` / `26.2`，API 在 CommonApi/src/main/java/mezz/jei/api）、Wiki https://github.com/mezz/JustEnoughItems/wiki
- 核实来源：cfwidget API（id 238222）；maven.blamejared.com 三线 metadata（15.49.0.188 / 19.44.0.401 / 30.24.0.165）；GitHub 1.20.1（JeiPlugin.java 注解 javadoc、IModPlugin 方法清单）

## REI（Roughly Enough Items，shedaniel）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/roughly-enough-items（projectId 310111，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/310111 返回 `"id":310111`、title "Roughly Enough Items Fabric/Forge/NeoForge (REI)"）
- 简介：JEI 替代配方查看器（可自定义、多 loader）。三时代：1.20.1 = 12.1.x（Forge）；1.21.1 = 16.0.x（NeoForge）；26.x = 26.2.821（architectury release 实测）。modid：`roughlyenoughitems`。
- 官方 maven：有 — https://maven.architectury.dev （老 README 的 maven.shedaniel.me 已停用，plan 实测）；group `me.shedaniel`，三件套按 loader 分（目录实测）：`RoughlyEnoughItems-api-<loader>` / `RoughlyEnoughItems-default-plugin-<loader>` / `RoughlyEnoughItems-<loader>`（forge/neoforge/fabric）
  - 1.20.1：`compileOnly "me.shedaniel:RoughlyEnoughItems-api-forge:12.1.785"` + `compileOnly "me.shedaniel:RoughlyEnoughItems-default-plugin-forge:12.1.785"` + `runtimeOnly "me.shedaniel:RoughlyEnoughItems-forge:12.1.785"`
  - 26.x：同式 `-neoforge` 系 `26.2.821`
- curse.maven 兜底：`compileOnly "curse.maven:roughly-enough-items-310111:<fileId>"`（fileId 从 Files 页复制）
- 本时代常用版本：12.1.785（1.20.1，Modrinth 实测）/ 16.0.799（1.21.1）/ 26.2.821（26.x）
- API 入口（包 `me.shedaniel.rei.api`，分支 12.x-1.20 源码实测）：
  - 插件注解按 loader 分：Forge = `me.shedaniel.rei.forge.REIPlugin`（forge/src 目录实测）、NeoForge = `me.shedaniel.rei.neoforge.REIPlugin`、Fabric = `me.shedaniel.rei.fabric.REIPlugin`
  - `api.common.plugins`：`REIPlugin` / `REIClientPlugin`（extends REIPlugin，default 方法实测：`registerCategories(CategoryRegistry)`、`registerDisplays(DisplayRegistry)`、`registerScreens(ScreenRegistry)`、`registerEntries`、`registerTransferHandlers`、`registerEntryRenderers`…）/ `REIServerPlugin` / `REIPluginProvider`
  - **注意（GitHub issue #1055）**：REI 服务端也会枚举 @REIPlugin 类——客户端插件必须标 `@REIPlugin({Dist.CLIENT})`，否则专用服务器崩溃
- 软依赖检测：`ModList.get().isLoaded("roughlyenoughitems")` + optional modDependencies
- 扩展点：自定义配方显示（DisplayRegistry）、配方类别（CategoryRegistry）、条目类型（EntryRegistry）、筛选/折叠（BasicFilteringRule/CollapsibleEntryRegistry）、transfer handler
- 说明：`-default-plugin` 是 REI 官方配方插件（本体配方/分类实现），附属通常只需 compileOnly 引 `-api`（+ 需要时 `-default-plugin`）并 runtimeOnly 引本体；另有 `api.common.plugins.REIPluginProvider`（服务端插件 provider，同树实测）可替代注解路径；三 loader 坐标同构（forge/neoforge/fabric 后缀），注解包名按 loader 分开（forge/neoforge/fabric 各一个 REIPlugin.java，实测）
- 联动范例（自写最小示例）：
```java
@REIPlugin({Dist.CLIENT})   // 必须限定客户端，见 issue #1055（服务端也会枚举插件类）
public class MyReiPlugin implements REIClientPlugin {
    @Override public void registerCategories(CategoryRegistry registry) {
        registry.add(new MyRecipeCategory());   // 类别类签名以 12.1.x API 为准
    }
    @Override public void registerDisplays(DisplayRegistry registry) {
        registry.add(myDisplay);                // Display 构造/注册方法以 me.shedaniel.rei.api.common.display 源码为准
    }
}
```
- 状态/注意：开源（MIT，文件头实测）；三 loader 坐标同构但注解包不同（forge/neoforge/fabric）；服务端插件枚举坑（Dist.CLIENT）；版本号跨度大（12.1.x → 26.2.x），坐标与 MC 线一一对应
- 官方/参考链接：源码 https://github.com/shedaniel/RoughlyEnoughItems （分支 `12.x-1.20` / `16.x-1.21` / `26.2`）、Wiki https://github.com/shedaniel/RoughlyEnoughItems/wiki
- 核实来源：cfwidget API（id 310111）；maven.architectury.dev metadata（api-neoforge 26.2.821）；Modrinth rei（12.1.785）；GitHub 12.x-1.20（forge/me/shedaniel/rei/forge/REIPlugin.java、api/common/plugins 与 api/client/plugins 方法清单）

## Patchouli（帕秋莉手册，Vazkii）
- CurseForge：https://www.curseforge.com/minecraft/mc-mods/patchouli（projectId 306770，核实 2026-08-16；来源 https://api.cfwidget.com/minecraft/mc-mods/306770 返回 `"id":306770`）
- 简介：数据驱动手册模组。三时代：1.20.1 = 1.20.1-85-FORGE；1.21.1 = 1.21.1-93-NEOFORGE（blamejared release 实测）；**26.x 无发布**（metadata 无；GitHub 26.1 分支存在但未发版）。FABRIC 同版本并存。modid：`patchouli`。
- 官方 maven：有 — https://maven.blamejared.com ；`compileOnly "vazkii.patchouli:Patchouli:1.20.1-85-FORGE"`（1.21.1 线 `1.21.1-93-NEOFORGE`）
- curse.maven 兜底：`compileOnly "curse.maven:patchouli-306770:<fileId>"`（fileId 从 Files 页复制）
- 本时代常用版本：1.20.1-85-FORGE / 1.21.1-93-NEOFORGE
- API 入口（包 `vazkii.patchouli.api`，分支 1.20.1 的 Xplat 模块源码实测）：
  - `PatchouliAPI`（接口 + `instance()`，javadoc 实测：Patchouli 缺席时返回 no-op stub 实例——可安全调用）：`openBookGUI(ServerPlayer, ResourceLocation)` / 客户端 `openBookGUI(ResourceLocation)`、`registerMultiblock(ResourceLocation, IMultiblock)`、`getMultiblock`、`makeMultiblock(String[][] pattern, Object... targets)`、`makeSparseMultiblock(Map<BlockPos, IStateMatcher>)`、`showMultiblock`
  - `IMultiblock` / `MultiblockBuilder`（代码多方块结构）；**书本体是纯资源数据驱动**：`assets/<modid>/patchouli_books/<book>/book.json` → category/entry（markdown 内容），附属手册可纯 JSON 零代码
- 软依赖检测：`ModList.get().isLoaded("patchouli")` + optional modDependencies（书数据可无代码注入，运行时未装 Patchouli 即不显示）
- 扩展点：给模组写官方手册（资源文件，零代码）、代码侧注册多方块结构（机器检测）、打开书（openBookGUI）、书联动（`PATCHOULI_DATA` 数据标签）
- 说明：书结构固定为 `assets/<modid>/patchouli_books/<book>/` 下的 book.json + categories/<cat>/*.json + entries/<cat>/*.md，book.json 关键字段（name/landing_text/model/creative_tab 等）与 entry 的 markdown 格式以官方 Wiki（见链接）与本体自带书资源为模板；patchouli_books 资源可被资源包覆盖（书本地化/内容定制），`PATCHOULI_DATA` 标签用于挂接数据包侧内容
- 联动补充：书不显示时先查 book.json 资源路径/大小写与 model 字段；Patchouli 提供 `/patchouli` 命令（dump/检查书籍资源，官方 Wiki 文档），排障与验证条目引用用得上
- 联动范例（自写最小示例，签名实测）：
```java
// 1) 代码多方块：makeMultiblock 签名实测 (String[][] pattern, Object... targets)；0=基准位，目标可为
//    ResourceLocation/Block/IStateMatcher（类型以 1.20.1-85 的 makeMultiblock javadoc 为准）
PatchouliAPI.instance().registerMultiblock(
        new ResourceLocation("myaddon", "my_machine"),
        PatchouliAPI.instance().makeMultiblock(
                new String[][] { { "M" }, { "0" } },
                new ResourceLocation("minecraft", "iron_block")));

// 2) 书本体（资源侧，零代码）：assets/<modid>/patchouli_books/guide/book.json 定义
//    book.json（name/landing_text/creative_tab/model）+ category/*.json + entry/*.md，
//    格式以官方 Wiki 与本体 Patchouli 资源（assets/patchouli/patchouli_books）为模板
```
- 状态/注意：开源（VazkiiMods/Patchouli）；26.x 无发布（GitHub 26.1 分支开发中）；书数据驱动——改书不动代码；`instance()` 有 no-op stub，软依赖下直接调用也安全
- 多版本线：1.20.1（-FORGE）/ 1.21.1（-NEOFORGE）与 FABRIC 同版本并存（metadata 实测），坐标按 loader 后缀选；写多 loader 附属时书资源完全复用，仅依赖坐标不同
- 官方/参考链接：源码 https://github.com/VazkiiMods/Patchouli （分支 `1.20.1` / `1.21.x` / `26.1`，API 在 Xplat/src/main/java/vazkii/patchouli/api）、Wiki https://github.com/VazkiiMods/Patchouli/wiki
- 核实来源：cfwidget API（id 306770）；maven.blamejared.com/vazkii/patchouli/Patchouli metadata（1.20.1-85-FORGE / 1.21.1-93-NEOFORGE、无 26.x）；GitHub 1.20.1（PatchouliAPI.java 方法清单 + no-op stub javadoc）
