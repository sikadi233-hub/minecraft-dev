# Paper 事件 API 参考

> 适用：Paper/Spigot 1.20.x / 1.21.x / 26.x（这些签名自 1.13 起稳定）。
> 核对来源：docs.papermc.io + Paper API javadoc；核对日期：2026-08。
> 未收录的事件：用 web 工具查 docs.papermc.io/paper/dev 或 javadoc.io（`io.papermc.paper:paper-api`）。

## 监听器骨架

```java
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

public class MyListener implements Listener {

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        event.getPlayer().sendMessage("欢迎!");
    }
}

// 在 onEnable 里注册：
getServer().getPluginManager().registerEvents(new MyListener(), this);
```

要点：
- `@EventHandler` 方法必须是 public，参数只有一个事件类。
- `@EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)` 可调优先级与跳过已取消事件。
- 事件对象在事件处理完即失效，不要在异步任务里保留引用。
- 取消类事件实现 `Cancellable`：`event.setCancelled(true)` / `event.isCancelled()`。

## 高频事件签名速查

### 玩家类

```java
// 玩家加入（可改欢迎语）
PlayerJoinEvent:  Player getPlayer(); String getJoinMessage(); void setJoinMessage(String);
// 玩家退出
PlayerQuitEvent:  Player getPlayer(); String getQuitMessage(); void setQuitMessage(String);
// 玩家死亡
PlayerDeathEvent: Player getEntity(); List<ItemStack> getDrops(); String getDeathMessage();
// 玩家移动（高频！避免在其中做重活）
PlayerMoveEvent:  Player getPlayer(); Location getFrom(); Location getTo();
// 玩家潜行切换
PlayerToggleSneakEvent: Player getPlayer(); boolean isSneaking();
// 玩家互动（点击方块/空气/手持物品）
PlayerInteractEvent: Player getPlayer(); Action getAction();        // LEFT_CLICK_BLOCK / RIGHT_CLICK_BLOCK / ...
                     ItemStack getItem(); Block getClickedBlock();
// 聊天（async=true 才有 AsyncPlayerChatEvent；改动需 setMessage）
AsyncPlayerChatEvent: Player getPlayer(); String getMessage(); void setMessage(String);
                      Set<Player> getRecipients();
```

### 方块类

```java
// 破坏方块
BlockBreakEvent: Block getBlock(); Player getPlayer();
                 boolean isDropItems(); void setDropItems(boolean);
                 int getExpToDrop(); void setExpToDrop(int);
// 放置方块
BlockPlaceEvent: Block getBlockPlaced(); Block getBlockAgainst(); Player getPlayer();
```

### 实体/伤害类

```java
// 实体受伤（玩家/怪物通用，检查 instanceof Player 区分）
EntityDamageByEntityEvent: Entity getDamager(); Entity getEntity();
                           double getDamage(); void setDamage(double);
                           DamageCause getCause();
// 投掷物命中
ProjectileHitEvent: Projectile getEntity(); Entity getHitEntity(); Block getHitBlock();
```

### 物品栏类

```java
// 点击物品栏（检查 getClickedInventory 是否为玩家背包/箱子）
InventoryClickEvent: Inventory getInventory(); int getSlot();
                     ItemStack getCurrentItem(); ItemStack getCursor();
                     boolean isCancelled(); void setCancelled(boolean);
```

## 取消事件通用模式

```java
@EventHandler
public void onBreak(BlockBreakEvent event) {
    if (event.getBlock().getType() == Material.DIAMOND_ORE
            && !event.getPlayer().hasPermission("myplugin.break.diamond")) {
        event.setCancelled(true);                       // 阻止原行为
        event.getPlayer().sendMessage("你没有权限破坏钻石矿");
    }
}
```

## 注意

- 高频事件（PlayerMoveEvent、InventoryClickEvent）里别做磁盘 IO / 长循环。
- 需要异步读取外部数据时，先同步事件里拿数据副本，异步处理完再 `runTask` 回主线程改世界。
- Folia 上不要依赖同步调度（见 scheduler-and-config.md）。
