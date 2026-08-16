# NeoForge 数据生成（Data Generation）API 参考（21.x 主形态）

> 核对来源：docs.neoforged.net（datagen 教程）+ 官方 MDK-1.21.11-ModDevGradle zip 实测；本机访问 neoforged 域名受限，签名以 V02_PLAN.md 附录核实（2026-08-16）为准。
> 核对日期：2026-08。标注「查 docs.neoforged.net」的条目表示存疑/版本敏感，写代码前用 IDE 补全再确认。

## 1. 运行方式与输出约定

- 任务名 **`runData`**（moddev 插件提供，与 runClient/runServer 同级）：`gradlew.bat runData` / `./gradlew runData`。
- 输出目录约定：**`src/generated/resources`**（moddev 默认）。模板 build.gradle 已有：

```gradle
sourceSets.main.resources { srcDir 'src/generated/resources' }
```

  这样生成的 JSON/语言文件/模型会随 `gradlew build` 打进 jar。**不要手动改 `src/generated/resources` 下的文件**——再次运行 runData 会被覆盖。
- 首次运行 runData 前需完成一次构建/反编译（NeoForm），耗时可达一小时。

## 2. GatherDataEvent 入口

- 事件：`net.neoforged.neoforge.data.event.GatherDataEvent`（mod bus 事件）。
- 标准写法（mod bus 静态监听）：

```java
package com.example.myplugin.datagen;

import net.minecraft.core.HolderLookup;
import net.minecraft.data.DataGenerator;
import net.minecraft.data.PackOutput;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.common.data.ExistingFileHelper;
import net.neoforged.neoforge.data.event.GatherDataEvent;

import java.util.concurrent.CompletableFuture;

@EventBusSubscriber(modid = MyPlugin.MODID, bus = EventBusSubscriber.Bus.MOD)
public class DataGenerators {
    @SubscribeEvent
    public static void gatherData(GatherDataEvent event) {
        DataGenerator generator = event.getGenerator();
        PackOutput packOutput = generator.getPackOutput();
        ExistingFileHelper helper = event.getExistingFileHelper();
        CompletableFuture<HolderLookup.Provider> lookupProvider = event.getLookupProvider();

        generator.addProvider(event.includeServer(), new MyRecipeProvider(packOutput, lookupProvider));
        generator.addProvider(event.includeClient(), new MyItemModelProvider(packOutput, helper));
    }
}
```

- GatherDataEvent 常用方法（21.x）：
  - `getGenerator()` : `net.minecraft.data.DataGenerator`
  - `getPackOutput()` : `net.minecraft.data.PackOutput`
  - `getExistingFileHelper()` : `net.neoforged.neoforge.common.data.ExistingFileHelper`
  - `getLookupProvider()` : `CompletableFuture<net.minecraft.core.HolderLookup.Provider>`
  - `includeServer()` : boolean（`--all` 或 `--server` 时 true）、`includeClient()` : boolean
- 注册 Provider：`DataGenerator.addProvider(boolean run, DataProvider provider)`（1.21.x 形态；早于 1.20.2 的版本只有 `addProvider(DataProvider)`，**查 docs.neoforged.net**）。`includeServer()/includeClient()` 控制该 provider 是否参与本次运行（client 侧数据放 `includeClient()` 分支，服务端数据放 `includeServer()`）。

## 3. DataProvider 体系

- 接口：`net.minecraft.data.DataProvider`
  - `CompletableFuture<?> run(CachedOutput cachedOutput)` — 执行生成（`net.minecraft.data.CachedOutput`，写文件用 `cachedOutput.writeIfNeeded(path, bytes)`）。
  - `String getName()` — 日志中显示的 provider 名。
- 常用现成 provider（构造参数版本敏感，**以 IDE 补全为准，查 docs.neoforged.net**）：
  - `net.neoforged.neoforge.client.model.generators.ItemModelProvider` — 物品模型 JSON（client 侧）
  - `net.neoforged.neoforge.client.model.generators.BlockStateProvider` — 方块状态 + 方块模型 JSON（client 侧）
  - `net.minecraft.data.recipes.RecipeProvider` — 合成表（server 侧；1.21.x 构造器带 `CompletableFuture<HolderLookup.Provider>`）
  - `net.minecraft.data.loot.LootTableProvider` — 战利品表（server 侧）
  - `net.minecraft.data.models.ModelProvider`（原 `net.minecraft.data.models.BlockModelGenerators`/`ItemModelGenerators` 的 vanilla 入口）— vanilla 侧模型生成（server 侧）
  - `net.neoforged.neoforge.common.data.LanguageProvider` — 语言文件 `lang/<locale>.json`（`add(key, name)` 逐条添加）
- 自定义 provider：实现 `DataProvider` 接口即可；`PackOutput` 提供 `getPath(DataProvider)`/`getOutputFolder()` 定位输出目录（**查 docs.neoforged.net**）。

## 4. 典型流程

1. 在 `@Mod` 类或专用类里加 `DataGenerators`（如上），确认 `@EventBusSubscriber(bus = Bus.MOD)`（GAME 总线不会收到 GatherDataEvent）。
2. `gradlew.bat runData`（或 IDE 运行配置 `runData`）。
3. 检查 `src/generated/resources/` 输出；若 provider 没跑，先查 `--mod <modid>` 参数是否命中（moddev 的 data run 默认带当前 mods 块，见 SKILL.md 构建节）。
4. `gradlew.bat build` 打包时 generated 资源自动并入 jar（`sourceSets.main.resources` 已挂）。

## 5. 常见错误

1. **GatherDataEvent 挂在 game bus**：事件只在 mod bus 上触发，`bus = Bus.MOD` 漏写则 datagen 静默不执行。
2. **忘了 `srcDir 'src/generated/resources'`**：生成的 JSON 不随 jar 打包，游戏内资源缺失。
3. **手动编辑 generated 文件**：再跑 runData 被覆盖，改 provider 而不是改输出。
4. **provider 构造器版本漂移**：1.21 小版本间 provider 构造器经常调整（加 `CompletableFuture<HolderLookup.Provider>` 参数等），换版本后先过一遍编译错误。
