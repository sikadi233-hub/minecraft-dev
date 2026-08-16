package {{pkg}};

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 主类同时实现 ModInitializer（双端通用入口）与 ClientModInitializer（仅客户端入口）。
 * 最小模板两者都只打日志；具体逻辑按 SKILL.md 指引写入。
 */
public class {{MainClass}} implements ModInitializer, ClientModInitializer {
    public static final String MOD_ID = "{{name}}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        // 主入口（客户端 + 服务端都会执行）：在这里注册物品/方块、事件监听、命令等。
        LOGGER.info("{{name}} enabled");
    }

    @Override
    public void onInitializeClient() {
        // 仅客户端入口：键位绑定、渲染相关注册等。
        // 一旦这里引用了客户端专用类（Screen、GuiGraphics 等），必须拆到独立 client 类/源集
        // （见 SKILL.md「client source set」一节），否则服务端加载会 ClassNotFound。
        LOGGER.info("{{name}} client initialized");
    }
}
