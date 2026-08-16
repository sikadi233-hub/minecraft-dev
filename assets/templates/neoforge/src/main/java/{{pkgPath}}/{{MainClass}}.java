package {{pkg}};

import com.mojang.logging.LogUtils;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import org.slf4j.Logger;

@Mod({{MainClass}}.MODID)
public class {{MainClass}} {
    public static final String MODID = "{{name}}";
    private static final Logger LOGGER = LogUtils.getLogger();

    public {{MainClass}}(IEventBus modEventBus) {
        // mod bus（IEventBus）：模组生命周期事件与 DeferredRegister 的注册挂载点。
        // game bus（NeoForge.EVENT_BUS）：游戏运行期事件；@SubscribeEvent 方法所在对象需先注册。
        // 签名详见 skills/minecraft-neoforge-mod 的 references/api/。
        NeoForge.EVENT_BUS.register(this);
    }

    @SubscribeEvent
    public void onServerStarting(ServerStartingEvent event) {
        LOGGER.info("{} server starting", MODID);
    }
}
