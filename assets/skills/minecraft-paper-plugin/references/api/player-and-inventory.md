# Paper 玩家与物品 API 参考

> 适用：Paper/Spigot 1.20.x / 1.21.x / 26.x（1.13+ 命名）。
> 核对来源：Bukkit/Paper javadoc；核对日期：2026-08。

## 1. Player 常用方法

```java
// 消息（旧版字符串方式，简单场景够用）
player.sendMessage(String);

// 属性
player.getName();                       // 名字（可含颜色码）
player.getUniqueId();                   // 不变的 UUID
player.getDisplayName();                // 显示名
player.setDisplayName(String);

// 位置/世界
player.getLocation();                   // Location
player.getWorld();                      // World
player.teleport(Location);              // 传送（玩家需已加载区块）

// 背包/状态
player.getInventory();                  // PlayerInventory
player.getGameMode();                   // GameMode 枚举
player.setGameMode(GameMode);
player.getHealth();  player.setHealth(double);
player.getMaxHealth(); player.setMaxHealth(double);
player.getFoodLevel(); player.setFoodLevel(int);

// 权限/管理
player.isOp(); player.setOp(boolean);
player.hasPermission(String);
player.kickPlayer(String);              // 踢出，参数为原因
player.playSound(Location, Sound, float volume, float pitch);   // 1.9+
player.getPing();                       // 延迟毫秒
```

## 2. ItemStack 常用方法

```java
ItemStack item = new ItemStack(Material.DIAMOND_SWORD, 1);   // 材质 + 数量

item.getType();                         // Material 枚举（1.13+ 扁平化命名）
item.setType(Material);
item.getAmount(); item.setAmount(int);
item.getItemMeta();                     // ItemMeta（可能为 null）
item.setItemMeta(ItemMeta);
item.isSimilar(ItemStack);              // 同材质同 meta 判断（不要用 equals）
item.clone();
item.setLore(List<String>);             // 便捷方法（1.13.2+）
```

## 3. ItemMeta 常用方法

```java
ItemMeta meta = item.getItemMeta();
meta.setDisplayName(String);            // 显示名（颜色码用 ChatColor 或 adventure）
meta.getDisplayName();
meta.setLore(List<String>);             // 多行说明
meta.getLore();
meta.addEnchant(Enchantment, int level, boolean ignoreLevelRestriction);
meta.setUnbreakable(boolean);
meta.setCustomModelData(int);           // 自定义模型
item.setItemMeta(meta);                 // 必须写回！
```

## 4. Inventory / PlayerInventory

```java
Inventory inv = player.getInventory();

inv.getItem(int slot);                  // 拿槽位物品
inv.setItem(int slot, ItemStack);
inv.addItem(ItemStack...);              // 堆叠进第一个空位，放不下的留在返回值
inv.removeItem(ItemStack...);
inv.contains(Material);                 // 是否含有该材质
inv.clear();
inv.getSize();                          // 格子总数（玩家背包 36）
inv.getHolder();                        // 持有者（玩家/方块/实体）
inv.firstEmpty();                       // 第一个空槽，无则 -1

// PlayerInventory 专属（1.9+ 主副手）
player.getInventory().getItemInMainHand();
player.getInventory().setItemInMainHand(ItemStack);
player.getInventory().getItemInOffHand();
player.getInventory().getHelmet();      // 同盔甲槽：getChestplate/getLeggings/getBoots
player.getInventory().setHelmet(ItemStack);
```

## 5. OfflinePlayer（离线玩家）

```java
OfflinePlayer offline = Bukkit.getOfflinePlayer(UUID);
offline.getName();
offline.getUniqueId();
offline.hasPlayedBefore();
offline.isOnline();                      // 在线时强转 Player
```

## 注意

- `Material` 是枚举：用 `Material.DIAMOND_SWORD`，不要用字符串比较（`Material.valueOf` 仅反序列化用）。
- 改完 ItemMeta 必须 `setItemMeta` 写回，否则改动丢失。
- 离线玩家没有 Location/Inventory，先判 `isOnline()`。
