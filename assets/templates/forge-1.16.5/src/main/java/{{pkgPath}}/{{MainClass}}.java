package {{pkg}};

import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;

@Mod("{{name}}")
public class {{MainClass}} {
    public static final String MODID = "{{name}}";

    public {{MainClass}}() {
        IEventBus bus = FMLJavaModLoadingContext.get().getModEventBus();
        // TODO: DeferredRegister 注册（mod bus）+ 游戏事件监听（MinecraftForge.EVENT_BUS）。
    }
}
