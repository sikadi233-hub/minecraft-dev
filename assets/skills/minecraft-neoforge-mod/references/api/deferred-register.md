# NeoForge DeferredRegister / 注册 API 参考（21.x 主形态）

> 核对来源：docs.neoforged.net（concepts/registries）+ 官方 MDK-1.21.11-ModDevGradle zip 实测；本机访问 neoforged 域名受限，签名以 V02_PLAN.md 附录核实（2026-08-16）为准。
> 核对日期：2026-08。标注「查 docs.neoforged.net」的条目表示存疑/版本敏感，写代码前用 IDE 补全再确认。

## 1. 核心类与创建

- `net.neoforged.neoforge.registries.DeferredRegister` — 延迟注册容器：把 `Supplier<T>` 的注册推迟到 mod bus 的注册事件，返回可安全持有的句柄。

```java
public static final DeferredRegister<Item> ITEMS =
        DeferredRegister.create(Registries.ITEM, MyPlugin.MODID);
```

- 工厂方法（静态）：
  - `DeferredRegister.create(Registry<T> registry, String modid)` — 常用形态，`Registries.ITEM` 等常量即 `Registry<T>`。
  - `DeferredRegister.create(ResourceKey<? extends Registry<T>> registryKey, String modid)` — 数据包/动态注册表时用（如 `Registries.ITEM.key()`）。
- 注册表常量：`net.minecraft.core.registries.Registries` 下的 `ITEM`、`BLOCK`、`ENTITY_TYPE`、`ENCHANTMENT`、`ATTACHMENT_TYPE` 等（字段类型 `Registry<T>`）。
- 必须把注册器挂上 mod bus，否则注册不发生：

```java
public MyPlugin(IEventBus modEventBus) {
    ITEMS.register(modEventBus);          // void register(IEventBus bus)
}
```

## 2. register() 与返回值

```java
public <I extends T> DeferredHolder<Registry<T>, I> register(String name, Supplier<? extends I> supplier)
```

- 返回类型 21.x 为 `DeferredHolder<Registry<T>, I>`（`net.neoforged.neoforge.registries.DeferredHolder`）；**1.20.1（legacyforge 线）同名 API 返回 `RegistryObject<T>`**（`net.neoforged.neoforge.registries.RegistryObject`，20.6 起更名）。
- 常用方法：`T get()`（惰性解析注册项，首次访问才查注册表）、`getId()` : ResourceLocation（模组资源定位 `name` 处传短名，如 `"my_item"`）。

```java
public static final DeferredHolder<Item, Item> MY_ITEM = ITEMS.register("my_item",
        () -> new Item(new Item.Properties()));
```

- 典型用法：方块注册 + 对应物品。方块需注册到 BLOCK 与 ITEM 两处（物品带方块放置逻辑时用 `BlockItem` 或 `BlockItem` 子类）：

```java
public static final DeferredHolder<Block, Block> MY_BLOCK = BLOCKS.register("my_block",
        () -> new Block(BlockBehaviour.Properties.of()));
public static final DeferredHolder<Item, Item> MY_BLOCK_ITEM = ITEMS.register("my_block",
        () -> new BlockItem(MY_BLOCK.get(), new Item.Properties()));
```

- 注意：`Item`/`Block` 构造器与 `Item.Properties()`/`BlockBehaviour.Properties` 的具体签名随 1.21 小版本演进（1.21.4+ 有多处组件化改动），**以 IDE 补全为准（查 docs.neoforged.net 相关条目）**；上面示例为最小可用形态。

## 3. 事件驱动注册（备选）

- `RegisterEvent`（mod bus）：`net.neoforged.neoforge.registries.RegisterEvent`，在注册阶段动态补注册。签名版本敏感（`register(ResourceKey, Consumer<RegisterEvent.RegisterHelper<T>>)`），**查 docs.neoforged.net / IDE 补全**。常规注册一律用 DeferredRegister，RegisterEvent 仅在动态补注册时使用。
- 读方 API：`net.minecraft.core.Registry` 的 `registry.get(ResourceLocation)`、`Registry.getOrThrow(ResourceKey)`；`Registries.ITEM.get(...)` 直接查注册表。

## 4. 常见错误

1. **忘了 `register(modEventBus)`**：DeferredRegister 创建后不挂总线 → 物品/方块静默缺失，报「registry not present」类错误。
2. **注册名带大写/包名**：`register` 第一个参数必须是小写短名（`resource location` 路径段），运行时按 `modid:name` 合成。
3. **mod bus 事件与 game bus 事件混淆**：DeferredRegister 内部靠 mod bus 的 RegisterEvent 触发，挂到 game bus 不会注册。
4. **1.20.1 线签名差异**：legacyforge 线的注册 API 是 1.20.x 形态（`RegistryObject`），不要与 21.x 的 `DeferredHolder` 混写。
