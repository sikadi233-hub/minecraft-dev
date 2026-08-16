package {{pkg}};

import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.Mod.EventHandler;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;
import net.minecraftforge.fml.common.event.FMLPostInitializationEvent;
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;

@Mod(modid = {{MainClass}}.MODID, name = "{{name}}", version = "0.1.0")
public class {{MainClass}} {
    public static final String MODID = "{{name}}";

    @EventHandler
    public void preInit(FMLPreInitializationEvent event) {
        // TODO: 注册方块/物品（RegistryEvent.Register 时代）。
    }

    @EventHandler
    public void init(FMLInitializationEvent event) {
        // TODO: 初始化逻辑。
    }

    @EventHandler
    public void postInit(FMLPostInitializationEvent event) {
        // TODO: 跨模组协作。
    }
}
