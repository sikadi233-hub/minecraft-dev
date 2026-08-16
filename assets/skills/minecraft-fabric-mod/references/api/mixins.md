# Fabric Mixin API 参考

> 核对日期：2026-08。签名核对来源：
> - Mixin 配置格式与 fabric.mod.json `mixins` 字段：Fabric Wiki「fabric.mod.json Specification」https://wiki.fabricmc.net/documentation:fabric_mod_json_spec 与「Mixin Configurations」https://wiki.fabricmc.net/tutorial:mixin_configs
> - refmap 取消：fabric-loom 发布说明 https://github.com/FabricMC/fabric-loom/releases （Loom 1.16 起默认禁用旧版 Mixin 注解处理器，mixin 改为 Tiny Remapper 就地重映射，不再生成 refmap）与 Fabric Wiki「Mixins and Obfuscation」https://wiki.fabricmc.net/drafts:mixin_obfuscation
> - 注解签名：SpongePowered Mixin javadoc（org.spongepowered.asm.mixin 包）

## 1. 启用 Mixin

### 1.1 fabric.mod.json

```json
{
  "schemaVersion": 1,
  "id": "{{name}}",
  "mixins": ["{{name}}.mixins.json"]
}
```

### 1.2 Mixin 配置文件 `src/main/resources/{{name}}.mixins.json`

```json
{
  "required": true,
  "package": "{{pkg}}.mixin",
  "compatibilityLevel": "JAVA_17",
  "mixins": [],
  "client": [],
  "server": [],
  "injectors": {
    "defaultRequire": 1
  }
}
```

字段说明：
- `package`：mixin 类所在包（惯例建 `.mixin` 子包）；下面数组里的名字是该包下类名的**简写**。
- `mixins` / `client` / `server`：数组。`client` 里放仅客户端类（类引用 `Screen`、`GuiGraphics` 等），loader 在服务端不会加载它们。
- `compatibilityLevel`：建议填工程 Java 级别（1.20.1 线 `JAVA_17`；1.21.11 线 `JAVA_21`；26.2 线 `JAVA_25`）。
- `injectors.defaultRequire`：默认 1——即每个注入点必须命中一次，命中不了直接崩溃（防映射错位导致注入静默失效）。
- **`refmap` 字段：新工程不要写。** Loom 1.16 起默认禁用旧版 Mixin 注解处理器，mixin 由 Tiny Remapper 就地重映射，不再生成 refmap.json；老教程里的 `"refmap": "{{name}}-refmap.refmap.json"` 已过时。旧工程从旧 loom 升级时把该字段删掉。

## 2. 注解要点（org.spongepowered.asm.mixin 包）

### 2.1 @Mixin —— 类级

```java
@Mixin(TargetClass.class)
public abstract class TargetClassMixin {   // 惯例：原类名 + Mixin
    ...
}
```

- 被 mixin 的类写在 `@Mixin(...)` 里（1.20.1 原版类，mojmap 名）。
- 与目标类同名成员用 `@Shadow` 声明（`@Shadow private int field;`、`@Shadow private void method();`），`@Shadow @Final` 对应 final 字段；`@Unique` 标记 mixin 自己新增的成员（编译期重名冲突检查）。
- 目标在第三方 mod 里、依赖可选时，加 `@Pseudo` 防止目标类缺失直接崩溃。

### 2.2 @Inject —— 方法注入（最常用）

```java
@Inject(method = "methodName", at = @At("HEAD"), cancellable = true)
private void onMethod(CallbackInfo ci) {
    if (条件) ci.cancel();          // 取消后原方法体不执行（需要 cancellable = true）
}
```

- 目标方法是**返回 void** 时用 `CallbackInfo`；**有返回值**时用 `CallbackInfoReturnable<T>`（T 为目标返回类型），用 `cir.setReturnValue(...)` 改返回值并 `return;`。
- `method` 写原版方法名（mojmap 名）；重载/混淆名拿不准时可用 `method = "methodName(Lnet/minecraft/...;...)V"` 描述符形式（`@At` 的 `target` 用 `L类;方法名(签名)返回` 描述符）。
- 常用注入点：`@At("HEAD")`（方法开头）、`@At("RETURN")`（返回前）、`@At(value = "INVOKE", target = "...")`（某个方法调用处）、`@At(value = "INVOKE", target = "...", shift = At.Shift.AFTER)`（调用之后）。`ordinal` 指定第几个匹配处（从 0 起）。
- 处理函数惯例为 `private` 且返回 `void`；**不要**把处理函数写成 public 静态（老版本会报错，新版本仍建议 private）。

### 2.3 @Redirect —— 替换调用/字段访问

```java
@Redirect(method = "methodName",
          at = @At(value = "INVOKE", target = "Lnet/minecraft/world/item/ItemStack;getCount()I"))
private int onGetCount(ItemStack stack) {
    return Math.min(stack.getCount(), 64);
}
```

- 处理函数参数：前几个对应被替换调用/字段访问的参数，最后追加目标所属实例（static 调用则没有），返回类型与被替换目标一致。
- `@Redirect` 会改变原逻辑上下文，比 `@Inject` 脆弱；优先 `@Inject`。

## 3. 常见注入失败排查

1. **注入点没命中（启动即崩 `InjectionError`）**：方法名/签名不对（mojmap 名 vs Yarn 名混用是头号原因），或 `@At` 的 `target` 描述符写错。临时把 `defaultRequire` 设 0 不崩，但那是掩盖问题。
2. **看日志**：`run/` 目录下 `logs/latest.log` 里搜 `mixin`；启动参数加 `-Dmixin.debug.verbose=true -Dmixin.debug.countInjections=true`（loom 的 runClient/runServer 配置里加 `programArgument` 或 IDE 运行参数）能看到每个注入点匹配情况。
3. **remap 相关**：老 loom 工程报 refmap 缺失 → 按 1.2 节删 `refmap` 字段并升级 loom；新工程若报「mixin 应用失败且方法找不到」，多半是映射混用。
4. **目标类不在该端存在**：客户端专用类放进 `client` 数组；混淆时代服务端不存在的类进 `server`/`client` 相应数组，别全塞 `mixins`。
5. **26.x 迁移提醒**：26.1 起不再混淆、官方名直用，从 Yarn 工程迁移到 26.x 时 mixin 的 `method`/`target` 字符串要整体换名，官方文档明示 mixin 是手工修复重点（https://docs.fabricmc.net/develop/porting/mappings/ ）。

## 4. client source set 与 mixin 的搭配（进阶）

- 开 `loom { splitEnvironmentSourceSets() }` 后，客户端代码放 `src/client/java`、客户端资源放 `src/client/resources`；`fabric.mod.json` 里客户端入口点类与 `client` mixin 类都放那边。
- 本技能模板默认**不开** splitEnvironmentSourceSets（最小模板）；需要时按 SKILL.md「项目骨架」一节改 build.gradle 的 `loom {}` 块。
