package {{pkg}};

import cpw.mods.fml.common.Mod;
import cpw.mods.fml.common.Mod.EventHandler;
import cpw.mods.fml.common.event.FMLInitializationEvent;

@Mod(modid = {{MainClass}}.MODID, name = "{{name}}", version = "0.1.0")
public class {{MainClass}} {
    public static final String MODID = "{{name}}";

    @EventHandler
    public void init(FMLInitializationEvent event) {
        // TODO: 注册方块/物品、事件监听等入口（1.7.10 时代 API）。
    }
}
