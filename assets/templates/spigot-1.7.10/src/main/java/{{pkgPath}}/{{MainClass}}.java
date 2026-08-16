package {{pkg}};

import org.bukkit.plugin.java.JavaPlugin;

public final class {{MainClass}} extends JavaPlugin {

    @Override
    public void onEnable() {
        getLogger().info("{{name}} enabled");
        // TODO: 注册事件监听器与命令。
    }

    @Override
    public void onDisable() {
        getLogger().info("{{name}} disabled");
        // TODO: 清理资源（任务、连接）。
    }
}
