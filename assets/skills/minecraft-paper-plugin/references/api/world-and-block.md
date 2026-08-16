# Paper 世界与方块 API 参考

> 适用：Paper/Spigot 1.20.x / 1.21.x / 26.x（1.13+ 扁平化 Material 命名）。
> 核对来源：Bukkit javadoc；核对日期：2026-08。

## 1. World 常用方法

```java
World world = player.getWorld();                 // 或 Bukkit.getWorld("world")

world.getName();                                 // 世界名
world.getSpawnLocation();
world.setTime(long ticks);                       // 0 日出 12000 日落
world.getTime();
world.setStorm(boolean);  world.setThundering(boolean);
world.getPlayers();                              // 该世界玩家列表
world.getEntities();                             // 该世界实体列表
world.getBlockAt(int x, int y, int z);           // 拿方块
world.spawnEntity(Location, EntityType);         // 生成实体
world.dropItem(Location, ItemStack);             // 掉落物品
world.playSound(Location, Sound, float volume, float pitch);
world.getHighestBlockAt(Location).getY();        // 地表高度
```

## 2. Block 常用方法

```java
Block block = world.getBlockAt(100, 64, 100);

block.getType();                                 // Material 枚举
block.setType(Material.STONE);                   // 直接改材质
block.getState();                                // BlockState（箱子/牌子等带数据方块）
block.breakNaturally();                          // 自然破坏（掉落物+粒子）
block.breakNaturally(ItemStack tool);            // 用指定工具破坏
block.getLocation();
block.getDrops(ItemStack tool);                  // 计算掉落物
block.isPassable();                              // 是否可穿过
```

## 3. Location 常用方法

```java
Location loc = player.getLocation();

loc.getWorld();
loc.getX(); loc.getY(); loc.getZ();              // 精确坐标（double）
loc.getBlockX(); loc.getBlockY(); loc.getBlockZ(); // 方块坐标（int）
loc.getBlock();                                  // 所在方块
loc.getPitch(); loc.getYaw();
loc.add(double x, double y, double z);           // 平移（返回新对象，原对象不变）
loc.add(0, 1, 0);                                // 上方一格
loc.distance(Location other);                    // 距离
loc.clone();
```

## 4. Material 枚举（1.13+ 扁平化命名）

- 用 `Material.OAK_LOG`（不是旧 `LOG`）、`Material.DIAMOND_SWORD`、`Material.RED_WOOL`。
- 常用判断：

```java
block.getType() == Material.DIAMOND_ORE
block.getType().isBlock();                       // 是否方块类
block.getType().isAir();                         // 是否空气（1.13+ 用 isAir 而非 == Material.AIR）
material.isSolid();                              // 是否实体可站
```

- `Material` 是枚举，比较用 `==`；永远不要和字符串比较。

## 5. 实用组合模式

```java
// 玩家脚下放方块
Location below = player.getLocation().add(0, -1, 0);
below.getBlock().setType(Material.GLASS);

// 指定位置掉落物品
world.dropItem(loc, new ItemStack(Material.DIAMOND, 3));

// 方块附近播放声音
loc.getWorld().playSound(loc, Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 1.0f, 1.0f);

// 检查玩家所处世界
if (player.getWorld().getName().equals("world_nether")) { ... }
```

## 注意

- 大量方块修改（>几千）考虑用 `PaperChunkAccess` 或分帧处理，避免主线程卡顿。
- `Sound` 枚举名在版本间有变动（如 `ENTITY_EXPERIENCE_ORB_PICKUP`）；拿不准时查 javadoc。
- 异步任务禁止调用本节任何方法（见 scheduler-and-config.md 主线程铁律）。
