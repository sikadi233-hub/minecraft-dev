# Fabric 注册与物品 API 参考

> 核对日期：2026-08。签名核对来源：
> - 官方文档「Creating Your First Item / First Block」：https://docs.fabricmc.net/develop/items/first-item （1.21.11 版：https://docs.fabricmc.net/1.21.11/develop/items/first-item ，26.x 版：https://docs.fabricmc.net/26.1.2/develop/items/first-item ）
> - Fabric Wiki「Intro to Registries」：https://wiki.fabricmc.net/tutorial:registry
> - ResourceLocation/Identifier 改名与工厂方法：NeoForge 官方迁移文档 https://docs.neoforged.net/primer/docs/1.21/ 与 FabricMC/fabric-api GitHub 讨论 #5216；mojmap 1.21.11 起 `ResourceLocation` → `Identifier`
>
> 以下全部为 mojmap 名（本项目用 `loom.officialMojangMappings()`）。

## 1. 涉及类（mojmap 名）

| 类 | 作用 | Yarn 对应名 |
|---|---|---|
| `net.minecraft.core.Registry<T>` | 注册表接口 | `net.minecraft.registry.Registry` |
| `net.minecraft.core.registries.BuiltInRegistries` | 各注册表实例（`ITEM`、`BLOCK`、`ENTITY_TYPE`、`SOUND_EVENT` 等） | `net.minecraft.registry.Registries` |
| `net.minecraft.core.registries.Registries` | 各注册表的 `ResourceKey` 常量（`Registries.ITEM` 是 `ResourceKey<Registry<Item>>`） | `net.minecraft.registry.RegistryKeys` |
| `net.minecraft.resources.ResourceKey<T>` | 注册条目 key | `net.minecraft.registry.RegistryKey` |
| `net.minecraft.resources.ResourceLocation` / `Identifier` | 资源标识符 `namespace:path`（1.21.11 起 mojmap 改名为 `Identifier`） | `net.minecraft.util.Identifier` |
| `net.minecraft.world.item.Item` / `net.minecraft.world.level.block.Block` | 物品/方块类 | 同名 |
| `net.minecraft.world.item.Items` / `net.minecraft.world.level.block.Blocks` | 原版常量 | 同名 |

## 2. 物品注册（全时代可用形式）

### 2.1 1.20.1 线（ResourceLocation 构造器可用）

```java
Registry.register(BuiltInRegistries.ITEM,
        new ResourceLocation("{{name}}", "example_item"),
        new Item(new Item.Properties()));
```

- 注册**必须发生在 `onInitialize()` 内**（或从其中调用的方法）。
- `new Item.Properties()` 是 mojmap 名；Yarn 名为 `Item.Settings`——社区教程里的 `Item.Settings` 在 mojmap 工程里要写成 `Item.Properties`。
- 静态字段初始化的坑：把物品存成 `public static final Item X = Registry.register(...)` 时，类要在 `onInitialize()` 里显式触发一次（如 `ModItems.initialize();` 空方法），否则静态块不会执行、物品不会注册（官方文档明确此坑）。

### 2.2 1.21.2+ 线（1.21.11 / 26.2 均如此，官方文档示例）

1.21.2 起 `ResourceLocation`/`Identifier` 构造器私有化，且 1.21.2 起物品的 key **必须**写进 `Item.Properties`（漏写报 `NullPointerException: Item id not set`），注册改用 `ResourceKey` 重载：

```java
// 1.21.11：Identifier；26.x：同（1.21.11 起 mojmap 由 ResourceLocation 改名）
ResourceKey<Item> itemKey = ResourceKey.create(Registries.ITEM, Identifier.fromNamespaceAndPath("{{name}}", "example_item"));
Item item = new Item(new Item.Properties().setId(itemKey));
Registry.register(BuiltInRegistries.ITEM, itemKey, item);
```

官方文档推荐的通用注册辅助方法（1.21.11 原文，含静态初始化兜底）：

```java
public class ModItems {
    public static <T extends Item> T register(String name, Function<Item.Properties, T> itemFactory, Item.Properties settings) {
        ResourceKey<Item> itemKey = ResourceKey.create(Registries.ITEM, Identifier.fromNamespaceAndPath("{{name}}", name));
        T item = itemFactory.apply(settings.setId(itemKey));
        Registry.register(BuiltInRegistries.ITEM, itemKey, item);
        return item;
    }
    public static void initialize() { } // 在 onInitialize() 里调用，触发上面静态字段的类加载

    public static final Item EXAMPLE_ITEM = register("example_item", Item::new, new Item.Properties());
}
```

### 2.3 工厂方法（1.21.2+，mojmap）

`new ResourceLocation(...)` 自 1.21.2 起不可用（构造器私有、类 final），改用：
- `ResourceLocation.fromNamespaceAndPath(String namespace, String path)`（等效旧的 `new RL(ns, path)`；带 `tryBuild` 变体不抛异常返回 null）
- `ResourceLocation.parse(String full)`（`"modid:path"` 整体；带 `tryParse` 变体）
- `ResourceLocation.withDefaultNamespace(String path)`（`minecraft` 命名空间）
- 1.21.11 起类名改 `Identifier`，方法不变；26.x 同。

## 3. Registry.register 的返回类型与重载

- 重载：`register(Registry<T>, ResourceLocation/Identifier, T)` 与 `register(Registry<T>, ResourceKey<T>, T)`（还有 `registerForHolder` 等变体，见 javadoc）。
- **返回类型随版本变化**（部分版本返回 `T`，部分返回 `Holder.Reference<T>`，1.21.5+ 后 `Holder` 在 mojmap 中更名为 `RegistryEntry`）：需要返回值时用 `var` 接收，不要硬编码返回类型。
- 注册时机错误（游戏启动后/数据包重载后注册）报 `IllegalStateException: This registry can't create intrusive holders` 或 `Registry frozen`——检查注册是否在 `onInitialize()` 里。

## 4. 方块注册（要点）

```java
// 1.20.1 形式；1.21.2+ 把 key 通过 setId/Properties 传给 BlockBehaviour.Properties 并改用 RegistryKey 重载
Registry.register(BuiltInRegistries.BLOCK,
        new ResourceLocation("{{name}}", "example_block"),
        new Block(BlockBehaviour.Properties.of()));   // 1.20.1：new ResourceLocation(...)；1.21.2+：Identifier.fromNamespaceAndPath(...)
```

- 方块必须配 `BlockItem` 才能在物品栏里拿：同样注册进 `BuiltInRegistries.ITEM`，`new BlockItem(block, new Item.Properties())`（1.21.2+ 需 `setId`）。
- 方块还需资源文件才能正常显示：`assets/{{name}}/blockstates/<name>.json`、`assets/{{name}}/models/block/<name>.json`、`assets/{{name}}/models/item/<name>.json`、纹理与语言文件。缺模型/纹理的物品显示为紫黑方块/问号纹理，但注册本身有效。

## 5. 创造模式物品栏

`fabric-item-group-api-v1` 模块（fabric-api 自带）：

```java
ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.INGREDIENTS).register(group -> group.accept(ModItems.EXAMPLE_ITEM));
```

- `CreativeModeTabs`（mojmap `net.minecraft.world.item.CreativeModeTabs`）常用：`INGREDIENTS`、`BUILDING_BLOCKS`、`COMBAT`、`SEARCH`。
- 1.20.1 与 1.21.11/26.2 签名一致；`group.accept(...)` 参数在较新版本是 `ItemLike`/`ItemStack`（传物品即可）。

## 6. 备注

- 原版常量类 `Items` / `Blocks` 的字段名即注册名（如 `Items.DIAMOND`），`Blocks.IRON_BLOCK`。
- 1.20.1 物品的 `Item.Properties` 没有 `setId`；`setId` 与 `RegistryKey` 注册重载是 1.21.2+ 的事，老版本写了会编译不过。
- 26.x 若再遇注册 API 变化（官方文档 26.1.2 示例即第 2.2 节形式），以 https://docs.fabricmc.net/26.1.2/ 对应页面为准。
