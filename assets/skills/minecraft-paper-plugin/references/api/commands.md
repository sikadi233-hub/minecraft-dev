# Paper 命令 API 参考

> 适用：Paper/Spigot 1.20.x / 1.21.x / 26.x。
> 核对来源：docs.papermc.io/paper/dev + Bukkit javadoc；核对日期：2026-08。

## 1. plugin.yml 声明

```yaml
commands:
  hello:
    description: 打招呼
    usage: /hello <名字>
    aliases: [hi, greet]
    permission: myplugin.hello
    permission-message: 你没有权限
```

## 2. CommandExecutor（经典方式）

```java
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public class HelloCommand implements CommandExecutor {

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        // sender 可能是 Player 或 ConsoleCommandSender
        if (!(sender instanceof Player player)) {
            sender.sendMessage("该命令只能由玩家执行");
            return true;
        }
        player.sendMessage("你好, " + player.getName());
        return true;   // true = 命令已处理；false = 向玩家打印 usage
    }
}

// onEnable 里注册：
getCommand("hello").setExecutor(new HelloCommand());
```

## 3. TabCompleter（自动补全）

```java
import org.bukkit.command.TabCompleter;

public class HelloTab implements TabCompleter {
    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) {
            return List.of("world", "player", "server").stream()
                    .filter(s -> s.startsWith(args[0]))
                    .toList();
        }
        return List.of();
    }
}

getCommand("hello").setTabCompleter(new HelloTab());
```

## 4. CommandSender 常用方法

```java
sender.sendMessage(String);            // 向玩家/控制台发消息
sender.hasPermission("myplugin.x");    // 权限检查（未配权限时 OP 默认通过）
sender.getName();
sender instanceof Player;              // 判断是否玩家
sender instanceof ConsoleCommandSender; // 判断是否控制台
```

## 5. 权限（plugin.yml）

```yaml
permissions:
  myplugin.admin:
    description: 管理权限
    default: op          # op = 仅 OP；true = 所有人；false = 无人
    children:
      myplugin.hello: true
```

## 6. Brigadier 命令（Paper 现代推荐，进阶）

Paper 1.19+ 支持用 Brigadier 注册带参数类型的命令（ArgumentType 等），注册入口：

```java
getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> {
    Commands commands = event.registrar().getDispatcher();
    commands.register(...);
});
```

细节较复杂，需要时用 web 工具查 docs.papermc.io 的 Brigadier 章节；普通插件用 CommandExecutor 已足够。
