package {{pkg}};

import org.bukkit.plugin.java.JavaPlugin;

public final class {{MainClass}} extends JavaPlugin {

    @Override
    public void onEnable() {
        getLogger().info("{{name}} enabled");
    }

    @Override
    public void onDisable() {
        getLogger().info("{{name}} disabled");
    }
}
