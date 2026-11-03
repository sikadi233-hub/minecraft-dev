package {{pkg}};

import org.bukkit.plugin.java.JavaPlugin;

public final class {{MainClass}} extends JavaPlugin {
    // [mc:fields]

    @Override
    public void onEnable() {
        getLogger().info("{{name}} enabled");
        // [mc:init]
    }

    @Override
    public void onDisable() {
        getLogger().info("{{name}} disabled");
        // [mc:shutdown]
    }
}
