# 大型模组附属开发参考（minecraft-major-mods）

> 前置：构建/Java 版本问题同时加载 minecraft-java-build（老线 JDK 8 与 Gradle 8.14.3 配对见该技能）；老线模组本体开发加载 minecraft-forge-mod / minecraft-spigot-legacy。
> **铁律：每个模组的坐标/API 入口一律 `read_file` 查 `references/api/mods-1.7.10.md`、`mods-1.12.2.md` 与 `mods-modern.md`，禁止凭记忆写坐标与类名。** 参考里带「未实测」标注的签名，用 web 工具查源码或反编译 jar 核对后再用，不要编。
> 核对日期：2026-08-16。fileId 等易变值以 CurseForge 文件页「Curse Maven 代码」为准（V03_PLAN R16）。

## 1. 定位与适用

- 本技能覆盖 **1.7.10 / 1.12.2 老线模组附属开发**（addon）：给 Thaumcraft、Tinkers Construct、Botania、Twilight Forest、Applied Energistics 2、Mekanism、IndustrialCraft 2、Thermal Expansion、Draconic Evolution、SlashBlade 等做联动内容。
- **现代线（1.20.1 Forge、1.21.1 / 26.x NeoForge）附属开发**见 `references/api/mods-modern.md`（Create / Botania / AE2 / Mekanism / Ars Nouveau / Farmer's Delight / Curios / JEI / REI / Patchouli 10 模组，按三时代分别给版本号；Fabric 线不在本技能覆盖，走 minecraft-fabric-mod 技能）。现代线软依赖写法与老线不同（`ModList.get().isLoaded` + optional modDependencies，见 §2.4；`@Optional` 仅老线）。
- 本技能教**通用范式**（软依赖检测、可选依赖、仓库坐标、联动挂钩），不逐模组背数据：每个模组的坐标/API 入口/联动范例一律查 references 三份 mods 文件（本技能正文不再重复具体签名）。
- 适用形态：Forge mod（主）、混合服（Cauldron/KCauldron/Thermos/Mohist/CatServer）上的 Bukkit 插件（也常见）。两形态的软依赖写法不同（§2）。
- 老线模组生态 2026 年已冻结：坐标以本文档实测为准，不适用现代线（1.16+ / 1.20+）的 maven 坐标与 API（如 Mekanism `:api` classifier、AE2 新坐标 `org.appliedenergistics`）。

## 2. 软依赖检测写法（核心范式）

附属必须做到「目标模组缺席时照常加载、不崩不报错」。老线三套写法对应三种运行形态（§2.4 为现代线 Forge/NeoForge 变体）：

### 2.1 Forge mod（1.7.10 / 1.12.2 同写法，双保险）

```java
// ① 方法级注解门卫：模组加载时才执行（防类加载即崩）
@Optional.Method(modid = "thaumcraft")
public static void registerTC() { /* 引用 thaumcraft.api 的注册代码 */ }

// ② 调用侧运行时判定：初始化阶段再调一次
if (Loader.isModLoaded("thaumcraft")) registerTC();
```

- `@Optional.Method` 的**包位置随版本变化**：1.7.10 是 `cpw.mods.fml.common.Optional`，1.12.2 是 `net.minecraftforge.fml.common.Optional`——import 别写错（§6）。
- 依赖注入侧用 `@Optional.Interface(iface = "…", modid = "…")` 标注接口字段，模组缺席时注入 null。
- modid 一律查 mods 文件逐模组取值，**大小写敏感**：Thaumcraft 1.7.10 线是 `Thaumcraft`、1.12.2 线是 `thaumcraft`；Twilight 1.7.10 是 `TwilightForest`（大写）、1.12.2 是 `twilightforest`；个别模组（Mekanism 1.7.10）历史上有大小写混用，写 `Loader.isModLoaded("Mekanism") || Loader.isModLoaded("mekanism")` 双写兜底。

### 2.2 混合服上的 Bukkit 插件（Cauldron/Thermos/Mohist/CatServer）

```java
Plugin target = Bukkit.getPluginManager().getPlugin("WorldGuard");
if (target != null && target.isEnabled()) { /* 联动 */ }
```

- 模组方（Forge 侧）的 `isModLoaded` 与插件方（Bukkit 侧）的 `getPlugin()` 是**两套独立检测**：混合服上同一样东西可能在 mods/ 里是模组、在 plugins/ 里是插件，检测结果要一致（插件侧尽量只依赖同为插件的目标，或同时检测两侧）。
- 检测失败时**降级而非禁用**：插件功能局部可用比整体拒载好；plugin.yml 的 `softdepend` 只影响加载顺序，不做存在性保证。

### 2.3 运行时反射兜底（compileOnly 依赖缺类）

```java
// compileOnly 引入的 API jar 在运行期可能不存在：
// 方法级 try/catch 接 NoClassDefFoundError（类加载发生在方法首次执行时）
try {
    Class<?> api = Class.forName("mekanism.api.MekanismAPI");
    api.getMethod("addBoxBlacklist", Block.class, int.class)
       .invoke(null, myBlock, 0);
} catch (ClassNotFoundException | NoClassDefFoundError e) {
    // 模组未加载：静默跳过
} catch (ReflectiveOperationException e) {
    log.warn("Mekanism API 调用失败", e);
}
```

- 反射只兜「编译期有、运行期可能无」的类；已有 `@Optional.Method` 门卫的方法体内不要再用反射（双重冗余）。
- `NoClassDefFoundError` 是 Error 不是 Exception，普通 catch 抓不到——**必须显式列在 catch 里**。

### 2.4 现代线软依赖检测（1.20.1 Forge / 1.21.1+ / 26.x NeoForge）

现代线**不再用 `@Optional`**（`net.minecraftforge.fml.common.Optional` 已废弃，仅老线）。两段式写法：

```java
// ① 运行时判定（类加载安全：仅在判定为 true 后引用目标模组 API 类）
if (ModList.get().isLoaded("create")) { /* 引用 com.simibubi.create.api 的注册代码 */ }

// ② 声明侧：mods.toml（1.20.1 Forge）/ neoforge.mods.toml（1.21.1+ / 26.x）
[[dependencies.<loaderid>]]
  modId = "create"
  optional = true
```

- modid 大小写敏感，现代线取值（一律查 mods-modern.md）：`create`、`botania`、`ae2`、`mekanism`、`ars_nouveau`、`farmersdelight`、`curios`、`jei`、`roughlyenoughitems`、`patchouli`。
- 配方数据包内的条件守卫走 `mod_loaded`（Forge/NeoForge 通用），见 mods-modern.md Farmer's Delight 条目。

## 3. compileOnly 可选依赖

- **`compileOnly "坐标"` 不打包**：产物 jar 里不得出现模组类；运行期由服务端 `mods/`（模组）或 `plugins/`（插件）里的本体提供。
- **API-only jar 与完整 mod jar 的区别**：
  - 官方发 `:api` classifier 的（IC2 1.12.2 的 `:api` jar、Mekanism v10+ 的 `:api`）：编译用 API jar 最干净，体积小、无混淆。
  - 只发完整 jar 的（Mekanism 1.7.10/1.12.2 v9、Tinkers 1.7.10）：拿完整 mod jar 当 compileOnly，**禁止打进产物**（运行时以 mods/ 内本体为准）。
  - 1.12.2 发布 jar 多带 SRG 混淆：官方 maven 有 `:dev`/`:deobf` classifier 优先用；没有就 curse.maven + `fg.deobf(...)`（ForgeGradle 3 的 deobf 包装，见 §4）。
- **缺少时禁止直接引用类**：写了 `implements IGasHandler` 而 mod 缺席 → 类加载直接崩。门卫顺序：`@Optional` 注解 > `isModLoaded` 判断 > 反射（§2.3）。

## 4. 依赖仓库与坐标获取

### 4.1 curse.maven（老线主路径）

```groovy
repositories {
    maven { url 'https://cursemaven.com' }
}
dependencies {
    // 1.12.2 ForgeGradle 3 下常配 fg.deobf：
    compileOnly fg.deobf('curse.maven:applied-energistics-2-223794:2747063')
    // 1.7.10 ForgeGradle 1.2（或纯 java 插件）直接 compileOnly：
    compileOnly 'curse.maven:thaumcraft-223628:<fileId>'
}
```

- 坐标格式：`curse.maven:<slug>-<projectId>:<fileId>`。
- **fileId 获取（R16）**：CurseForge 项目 Files 页 → Game Version 过滤 1.7.10/1.12.2 → 点目标版本 → 右侧「Curse Maven 代码」复制数字。**fileId 随 CF 迁移会变，禁止凭记忆填、禁止把本文数字当常量写死**；references 中已实测的 fileId（AE2 rv6=2747063、Twilight 4.3.2508=5468648、Tinkers 1.7.10=2264246、Mekanism 9.1.0.281=2426270）仅供参考。
- 注意文件跨线：AE2 的 2747063 是 1.12.2 线，勿用于 1.7.10 线（mods-1.7.10.md 有专门警告）。

### 4.2 Modrinth maven（次选）

```groovy
repositories {
    maven { url 'https://api.modrinth.com/maven' }
}
dependencies {
    compileOnly 'maven.modrinth:<project-slug>:<version>'
}
```

- 与 curse.maven 不混用同一模组（同模组选一条路径）；老线模组在 Modrinth 上覆盖不全，逐模组以 references 为准。

### 4.3 官方 maven（优先，但老线覆盖少）

| 线 | 有官方 maven 的模组 |
|---|---|
| 1.12.2 | Tinkers（dvs1.progwml6.com / modmaven.dev）、IC2（maven.ic2.player.to，`2.8.222-ex112:api`）、CoFH/Thermal（maven.covers1624.net / modmaven.dev）、Botania（maven.blamejared.com） |
| 1.7.10 | **几乎全无**（各模组 maven 均自 1.10/1.12+ 起，2026-08 metadata 逐个实测）——1.7.10 附属一律走 curse.maven |

- 原则：官方 maven > Modrinth maven > curse.maven；能用官方 dev/deobf/api classifier 就别用完整 jar。

## 5. 联动配方/事件挂钩模式

### 5.1 配方注册（模组自有 API 静态表 vs 数据驱动）

- **模组自有静态配方表**（老线主流）：`ThaumcraftApi`（坩埚/注魔/要素）、`TinkerRegistry`（1.12.2）/`TConstructRegistry`（1.7.10，无 TinkerRegistry！）、`BotaniaAPI.petalRecipes` 等、`ThermalExpansionHelper`（1.7.10）、`Recipes.macerator`（IC2）、`MekanismAPI.recipeHelper()`——全部静态注册，**注册时机**：模组 init 后（Forge `FMLInitializationEvent` / `RegistryEvent` 或 `@Optional.Method` 门卫方法内）。
- **数据驱动**（1.12.2 起才有）：TC6 研究本体是 `assets/thaumcraft/research/*.json`；1.12.2 原版 JSON recipes 用 `data/<modid>/recipes/`。1.7.10 没有数据驱动（无 registry 事件），只能代码注册。
- CraftTweaker 脚本是给玩家用的；附属开发者写代码，不写脚本。

### 5.2 事件挂钩（Forge 总线 vs 模组自有总线）

- **Forge 事件总线**：`@SubscribeEvent` + `MinecraftForge.EVENT_BUS`（1.12.2）/ `MinecraftForge.EVENT_BUS`（1.7.10 同）。1.7.10 事件基类在 `cpw.mods.fml.common.eventhandler.Event` 包，1.12.2 在 `net.minecraftforge.fml.common.eventhandler`——**1.7.10 与 1.12.2 的 Forge 事件类不全同**（如 1.7.10 无 1.12.2 的部分 registry 事件），逐事件查 references。
- **模组自有总线**：SlashBlade 的 `SlashBladeHooks.EventBus`（**不是** Forge 总线，注册方式见 mods-1.7.10.md/1.12.2.md）；AE2 的 `@AEPlugin` + `@AEInjectable` 构造器注入（1.12.2 特有，AE2 启动时自动实例化附属类）。
- **接口实现即接入**（无注册调用）：IC2 的 `IEnergySink`/`IEnergySource`、CoFH 的 `IEnergyHandler`、Mekanism 的 `IGasHandler`——TileEntity 实现接口即被能量/气体网络自动接管。

### 5.3 registry 事件时代差异（大坑）

- **1.7.10 没有 RegistryEvent**：注册/初始化只能挂 `FMLInitializationEvent` 等 FML 生命周期事件；**1.12.2 有** `RegistryEvent.Register<Item/Block>` 与 `GameRegistry` 数据驱动。写双线兼容代码时，1.7.10 侧用 FML 事件、1.12.2 侧用 registry 事件，不能共享同一段注册代码。

## 6. 老线差异坑

1. **FG 1.2 vs FG3 的 deobf classifier**：1.7.10（ForgeGradle 1.2）对 curse.maven 的依赖**没有** `fg.deobf()` 可用（老 FG 语法不同），直接 compileOnly；1.12.2（FG3）必须 `fg.deobf(...)` 否则 SRG 混淆类名对不上。模板/构建细节见 minecraft-forge-mod 技能。
2. **MCP 映射下的类名**：老线附属编译时引用的模组 API 类名以**各自的开发环境映射**为准（1.7.10 = MCP 2014 映射、1.12.2 = MCP snapshot 20171003）；同一模组跨线 API 包名常不同（TC4 `thaumcraft.api` 与 TC6 `thaumcraft.api` 差异巨大；AE2 rv2 与 rv6 完全不同），**严禁把 1.12.2 的 API 代码抄进 1.7.10 项目**。
3. **`@Optional` 包位置**：1.7.10 `cpw.mods.fml.common.Optional` vs 1.12.2 `net.minecraftforge.fml.common.Optional`。
4. **modid 大小写**：见 §2.1 表；写错 `isModLoaded` 永远 false，附属功能静默缺失。
5. **1.7.10 混合服 mod 联动**：KCauldron/Thermos 对 mod 方法做过改写（tile 事件桥接等），mod 源码里能跑的逻辑在混合服可能行为不同；插件侧事件侧漏（Forge 事件不触发 Bukkit 监听器）见 minecraft-spigot-legacy §7。
6. **老线 maven 普遍缺失**：1.7.10 十个模组全部无官方 maven；先查 references 再决定仓库配置，别浪费时间试 404 仓库。

## 7. 逐模组索引

坐标/API 入口/软依赖/联动范例/状态注意事项一律查对应文件（**10 个模组在 1.7.10、8 个在 1.12.2**——Thermal Expansion 与 Draconic Evolution 只有 1.7.10 线条目）：

| 模组 | modid（1.7.10 / 1.12.2） | API 入口 | 主要扩展点 |
|---|---|---|---|
| Thaumcraft | `Thaumcraft` / `thaumcraft` | `thaumcraft.api` | 要素/坩埚/注魔/研究（TC4 与 TC6 差异极大） |
| Tinkers Construct | `TConstruct` / `tconstruct` | `tconstruct.library` | TConstructRegistry（1.7.10）/ TinkerRegistry（1.12.2）、冶炼炉、强化 |
| Botania | `Botania` / `botania` | `vazkii.botania.api` | 自定义功能花/产能花（SubTileEntity 体系）、花药合成 |
| Twilight Forest | `TwilightForest` / `twilightforest` | 无公开 API | 维度检测 + Forge 事件（无注册表） |
| Applied Energistics 2 | `appliedenergistics2`（两线同） | `appeng.api` | rv2（1.7.10）/ rv6（1.12.2）体系完全不同；1.12.2 有 @AEPlugin 注入 |
| Mekanism | `Mekanism`（大小写双写）/ `mekanism` | `mekanism.api` | 机器配方、气体/能量网络接口实现 |
| IndustrialCraft 2 | `IC2` / `ic2` | `ic2.api` | 能量接口、Recipes 静态配方表、CropRegisterEvent（1.12.2） |
| Thermal Expansion | `ThermalExpansion`（仅 1.7.10） | `cofh.api` | RF 接口、ThermalExpansionHelper 配方 |
| Draconic Evolution | `DraconicEvolution`（仅 1.7.10） | `com.brandon3055.draconicevolution.api` | IExtendedRFStorage 长容量存储 |
| SlashBlade | `flammpfeil.slashblade`（两线同） | `mods.flammpfeil.slashblade` | 模组自有事件总线（SlashBladeHooks）、命名剑注册 |

现代线索引（10 个模组，一律查 `references/api/mods-modern.md`；modid 为现代线取值，与老线可能不同——如 AE2 为 `ae2` 而非 `appliedenergistics2`）：

| 模组 | modid | API 入口 | 主要扩展点 |
|---|---|---|---|
| Create | `create` | `com.simibubi.create.api` | MovementBehaviour/MovingInteractionBehaviour（Block 为 key 的 REGISTRY）、动力配方 datagen、自建 CreateRegistrate |
| Botania | `botania` | `vazkii.botania.api` | 自定义功能/产能花（FunctionalFlowerBlockEntity 体系，无 registerSubTile）、可染色方块、corporea 节点 |
| Applied Energistics 2 | `ae2` | `appeng.api` | GridServices.register 网格服务、ICellHandler 存储单元、ICraftingProvider、P2PTunnelAttunement（无 @AEPlugin，rv6 机制已移除） |
| Mekanism | `mekanism` | `mekanism.api` | 机器配方数据包 JSON / datagen builder、IEnergyContainer/IChemicalHandler 接口实现即接入、ModuleData |
| Ars Nouveau | `ars_nouveau` | `com.hollingsworth.arsnouveau.api` | glyph 配方数据包 + GlyphRegistry、RitualRegistry、PerkRegistry、FamiliarRegistry |
| Farmer's Delight | `farmersdelight` | 无公开 API 包 | 菜板/锅配方数据包 JSON（type `farmersdelight:cutting`/`cooking`）、Forge/NeoForge 事件 |
| Curios | `curios` | `top.theillusivec4.curios.api` | 物品实现 ICurioItem、槽位 json + registerCurioPredicate、饰品渲染/事件 |
| JEI | `jei` | `mezz.jei.api` | @JeiPlugin + IModPlugin（registerCategories/registerRecipes；-api 仅 compileOnly，永不进产物） |
| REI | `roughlyenoughitems` | `me.shedaniel.rei.api` | @REIPlugin（须标 Dist.CLIENT）+ REIClientPlugin/REIServerPlugin |
| Patchouli | `patchouli` | `vazkii.patchouli.api` | 书本体纯资源数据驱动（patchouli_books）、registerMultiblock 代码多方块、IComponentProcessor |

开发流程速查：确定目标模组与线 → 读 mods 文件（modid/坐标/API 入口）→ build.gradle 配仓库 + compileOnly → 写软依赖门卫（老线 `@Optional` + `isModLoaded`，现代线 `ModList.get().isLoaded` + optional modDependencies）→ 写注册/事件代码（签名对照 references）→ `gradlew build`（老线构建用 JDK 8 + Gradle 8.14.3，见 minecraft-java-build；现代线构建见 minecraft-forge-mod / minecraft-neoforge-mod）→ 拷入服务端实测。
