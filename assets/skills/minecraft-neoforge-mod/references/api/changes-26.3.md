# MC 26.3 移植参考（Architectury API 21.1 → 22）

> 核对日期：2026-09。**唯一来源**：Architectury 官方移植指南「Porting from 26.2 to 26.3」https://docs.architectury.dev/api/porting/port-26.2-26.3/ （2026-09 全文读取，下列签名逐条摘自该页）。
> **重要限定**：该页记录的是 **Architectury API 21.1 → 22** 的变更（Architectury 自己的 `dev.architectury.*` 命名空间），**不是 NeoForge / Fabric 核心 API 的 26.3 变更日志**。页面只给简名不给包名，因此本文件不写 import 路径。
> `UNVERIFIED` = 官方页未给出的信息（包名、部分泛型/参数细节）。写代码前用 IDE 补全，或 `javap` 反编译 26.3 环境下的 Architectury 22 jar 确认。
> 适用前提：26.3 的 NeoForge 侧目前只有 `-beta` 构建（26.3.0.12-beta，maven.neoforged.net 2026-09 实测），Architectury 22 自己声明的目标是 NeoForge 26.3.0.0-beta；这些 API 仍可能继续变动。

## 0. 依赖版本（该页「Dependency versions」）

| 组件 | 版本 |
|---|---|
| Minecraft | 26.3 |
| Fabric Loader | 0.19.5 |
| Fabric API | 0.160.5（**最低目标**；maven 上 26.3 已出到 `0.161.0+26.3`） |
| NeoForge | 26.3.0.0-beta |

表中 Fabric Loader / Fabric API / NeoForge 三个值与 meta.fabricmc.net、maven.fabricmc.net、maven.neoforged.net 的 2026-09 实测一致（页面写的是 26.3.0.0-beta，maven 上 26.3 已发到 26.3.0.12-beta）。

## 1. LootEvent（破坏性变更）

`HolderLookup.Provider` → `HolderGetter.Provider`：

```text
ModifyLootTable#modifyLootTable(HolderLookup.Provider, ResourceKey, LootTableModificationContext, boolean)
  -> modifyLootTable(HolderGetter.Provider, ResourceKey, LootTableModificationContext, boolean)

ReplaceLootTable#replaceLootTable(HolderLookup.Provider, ResourceKey, LootTable)
  -> replaceLootTable(HolderGetter.Provider, ResourceKey, LootTable)
```

- 无 provider 参数的旧重载被移除：`ModifyLootTable#modifyLootTable(ResourceKey, LootTableModificationContext, boolean)` → 改用上面带 `HolderGetter.Provider` 的重载。
- 迁移动作：监听器/回调里所有 `HolderLookup.Provider` 参数与局部变量整体换成 `HolderGetter.Provider`，编译报错处按 IDE 提示逐个改。

## 2. 扩展菜单：ExtendedMenuProvider → codec 化的 ExtendedMenuDataProvider

新增（Additions）：

```text
ExtendedMenuDataProvider<D>                     // 接口：ExtendedMenuProvider 的 codec 化替代
ExtendedMenuDataFactory<T, D>                   // 菜单工厂：接收解码后的数据，而不是 buffer
MenuRegistry.ofExtended(ExtendedMenuDataFactory<T, D>, StreamCodec<? super RegistryFriendlyByteBuf, D>)
openExtendedMenu(ServerPlayer, ExtendedMenuDataProvider<D>)
```

废弃（Deprecations，官方注明 **Architectury 23 移除**）：

```text
ExtendedMenuProvider                                  -> ExtendedMenuDataProvider<D>
ExtendedMenuTypeFactory<T>                            -> ExtendedMenuDataFactory<T, D>
MenuRegistry.ofExtended(ExtendedMenuTypeFactory<T>)   -> ofExtended(ExtendedMenuDataFactory<T, D>, StreamCodec)
openExtendedMenu(ServerPlayer, MenuProvider, Consumer<FriendlyByteBuf>)
openExtendedMenu(ServerPlayer, ExtendedMenuProvider)  -> openExtendedMenu(ServerPlayer, ExtendedMenuDataProvider)
```

- 迁移动作：给菜单数据加 `StreamCodec`；实现类从 `ExtendedMenuProvider` 换到 `ExtendedMenuDataProvider<D>`；`ExtendedMenuTypeFactory` 的用法换成 `ExtendedMenuDataFactory<T, D>`。

## 3. 工具交互钩子 → BlockTransformerHooks

新增统一入口（Additions），替换原来三个「按工具划分」的 hook 类：

```text
BlockTransformerHooks.addStrippable(Block, Block)
BlockTransformerHooks.addFlattenable(Block, BlockState)
BlockTransformerHooks.addTillable(Block, BlockState)
```

被移除的旧入口（Removal，逐条对应）：

```text
AxeItemHooks.addStrippable(Block, Block)
  -> BlockTransformerHooks.addStrippable(Block, Block)

ShovelItemHooks.addFlattenable(Block, BlockState)
  -> BlockTransformerHooks.addFlattenable(Block, BlockState)

HoeItemHooks.addTillable(Block, Predicate<UseOnContext>, Consumer<UseOnContext>, Function<UseOnContext, BlockState>)
  -> BlockTransformerHooks.addTillable(Block, BlockState)
```

- **注意 `addTillable` 参数从 4 个减到 2 个**：旧代码多传的 `Predicate` / `Consumer` / `Function` 参数不再需要（新形态只收 `Block` + `BlockState`）——具体语义变化按新签名与实现核对，官方页只给了签名。
- 同批移除（Removal）：
  - `DyeColorHooks.getColorValue(DyeColor)` → 改用原版 `DyeColor#getTextureDiffuseColor()`（官方注：两个 loader 早已解析到该调用）。
  - `EventFactory.createInteractionResult(Class<T>)` → `createInteractionResult(T...)`。

## 4. FuelRegistry

新增（Additions）：

```text
FuelRegistry.register(int time, float speedMultiplier, ItemLike... items)   // speedMultiplier 控熔炼速度，1.0 = 正常
```

- 旧 2 参形式 `register(int, ItemLike...)` 保留，内部按 **1.0** 委托给新方法——不改熔炼速度的代码无需改动。

破坏性变更（Breaking Changes）：

```text
FuelRegistry.get(ItemStack, RecipeType<?>, FuelValues)  ->  FuelRegistry.get(ItemStack, ServerLevel)
```

## 5. BiomeHooks / GenerationProperties

新增（Additions）：

```text
BiomeHooks.extractMobSpawnSettings(Biome)
BiomeHooks.extractCreatureProbability(Biome)
SpawnSettingsWrapped(MobSpawnSettings, float)
```

- `UNVERIFIED`：`extractCreatureProbability` 的返回类型、`SpawnSettingsWrapped` 的取值方法未在页面上给出（只给了构造器形态）——以 IDE / `javap` 为准。

破坏性变更（Breaking Changes，跟原版改名走）：

```text
GenerationProperties：Carvers 的类型由 ConfiguredWorldCarver<?> 改为 WorldCarver
  -> getCarvers() / addCarver(Holder) / addCarver(ResourceKey) / removeCarver(ResourceKey) 签名全部随之变化
BiomeHooks.GenerationSettingsWrapped#getCarvers() 返回 Iterable<Holder<WorldCarver>>
```

## 6. 注册表与平台工具（Removal）

```text
Mod.getFilePath()                                    -> getFilePaths()
RegistrarManager.get(Registry<T>)                    -> get(ResourceKey<Registry<T>>)
RegistrarManager.getId(T, Registry<T>)               -> getId(T, ResourceKey<Registry<T>>)
RegistrarManager.RegistryProvider.get(Registry<T>)   -> get(ResourceKey<Registry<T>>)
```

## 7. 使用纪律

1. 本文件只覆盖 **Architectury API 21.1 → 22（MC 26.2 → 26.3）** 的变更，**不是** NeoForge / Fabric 核心 API 的 26.3 变更清单；核心 API 变更以 docs.neoforged.net primer 与 Fabric 官方文档/博客为准（**本文件未核对**）。
2. 不用 Architectury 的纯 loader 项目不适用本文件。
3. 标 `UNVERIFIED` 的条目写代码前必须二次确认——本技能的 API 铁律同样适用。
