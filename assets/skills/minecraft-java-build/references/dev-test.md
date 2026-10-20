# 开发环境测试（dev 把游戏跑起来验证）

> 适用：Paper / Spigot 插件、Fabric、Forge、NeoForge，任何时代。
> **编译通过 ≠ 能跑。** `@Shadow` 字段类型写错、缺少运行时前置依赖、mixin 目标方法不存在、
> 插件依赖声明漏了……javac 一个都不报，只在启动那一刻炸。所以 dev 测试不是可选项。

## 0. 先判断有没有探针工具

宿主若装了 `mcdev_*` 一套（`mcdev_prepare` / `mcdev_command` / `mcdev_screenshot` / `mcdev_ui` …），
且项目里装了 dev probe（`mcdev_probe-*-dev.jar` 在 `<runDir>/mods`），优先用它——能直接读 Screen、
点 GUI、发命令、截图。

**但探针是平台绑定的**：它是针对某个加载器 + 某个 MC 版本 dev-mapped 构建的。换大版本
（1.20.1 Forge → 1.21.1 NeoForge）或换平台（Forge → Fabric / Paper）就装不上，`mcdev_prepare` 会起	
进程但永远等不到 probe ready。**这时不要反复重试**，走下面的手工流程。

## 1. 各平台的启动方式

| 平台 | 客户端 | 服务端 | 备注 |
|---|---|---|---|
| NeoForge（moddev） | `gradlew runClient` | `gradlew runServer` | run 配置写 `gameDirectory` |
| Forge 1.20.1（ForgeGradle 6） | `gradlew runClient` | `gradlew runServer` | 同上；`minecraft { runs { … } }` |
| Fabric（loom） | `gradlew runClient` | `gradlew runServer` | `loom { runs { … } }` |
| **Paper / Spigot 插件** | 无 | 起真实服务端（paper.jar / `runServer`） | 插件没有客户端，用正常 MC 客户端连 |

插件类项目没有 `runClient`：把打好的 jar 丢进服务端 `plugins/`，用普通客户端连上去测。

## 2. 客户端与服务端必须分开 run 目录

moddev / loom / ForgeGradle 默认让所有 run 共用 `run/`。合一目录会因文件锁导致客户端登录超时
（症状：客户端日志停在 `Starting new vanilla impl connection` 之后没了，服务端 30s 后
`lost connection: Disconnected`）。

```groovy
// NeoForge moddev 写法；Forge ForgeGradle 用 workingDirectory，Fabric loom 用 runDir
runs {
    client {
        client()
        gameDirectory = file('run-client')
        programArguments.addAll '--quickPlayMultiplayer', '127.0.0.1:25566'
    }
    server {
        server()
        gameDirectory = file('run-server')
        programArgument '--nogui'
        programArguments.addAll '--port', '25566'
    }
}
```

服务端首启前先写 `run-server/eula.txt`：`eula=true`。

## 3. 起进程

两个进程必须**同时**活着，所以不能用同步的构建调用，要放后台任务：

```
gradlew runServer --console=plain --no-configuration-cache
gradlew runClient --console=plain --no-configuration-cache
```

`--no-configuration-cache` 避开两个 Gradle 调用同时写配置缓存时的锁争抢。

## 4. 驱动客户端：必须用线程输入挂接（核心）

`keybd_event` / `SendInput` 对 Minecraft 客户端**默认无效**。GLFW 只认真正持有焦点的窗口；
即使 `GetForegroundWindow()` 已返回 MC 窗口、`SetForegroundWindow()` 也返回成功，按键照样被丢弃
（症状：按 F3 没反应、按 E 不开背包，但截图正常、进程也活着）。

**必须先做线程输入挂接**：

```powershell
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;
public class W {
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc f, IntPtr l);
 public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool at);
 [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint fl, IntPtr ex);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
}
"@

# 1) 按标题找窗口（标题形如 "Minecraft NeoForge* 1.21.1" / "Minecraft* 1.20.1"）
$script:hwnd = [IntPtr]::Zero
$cb = [W+EnumWindowsProc]{ param($h,$l)
  $sb = New-Object System.Text.StringBuilder 512
  [void][W]::GetWindowText($h,$sb,512)
  if ($sb.ToString() -match '^Minecraft') { $script:hwnd = $h; return $false }
  return $true }
[void][W]::EnumWindows($cb,[IntPtr]::Zero)

# 2) 线程输入挂接 -> 设焦点 -> 断开挂接
$mcTid = 0; [void][W]::GetWindowThreadProcessId($script:hwnd,[ref]$mcTid)
$myTid = [W]::GetCurrentThreadId()
[void][W]::AttachThreadInput($myTid, $mcTid, $true)
[void][W]::SetForegroundWindow($script:hwnd)
[void][W]::SetFocus($script:hwnd)
Start-Sleep -Milliseconds 600
[void][W]::AttachThreadInput($myTid, $mcTid, $false)

# 3) 之后按键/鼠标才真正送达游戏
function Key([int]$vk) {
  [W]::keybd_event([byte]$vk,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 90
  [W]::keybd_event([byte]$vk,0,2,[IntPtr]::Zero); Start-Sleep -Milliseconds 700
}
Key 0x72   # F3 调试屏 —— 自检用
Key 0x45   # E 打开背包
Key 0x54   # T 打开聊天（可发命令）
Key 0x1B   # Esc 关闭
```

**自检判据**：挂接前发 F3 无反应，挂接后立刻出调试屏。F3 还是没反应 = 挂接没生效，别往下测。

鼠标同理：`SetCursorPos` + `mouse_event(LEFTDOWN/LEFTUP)` 挂接后才生效；
坐标换算 `屏幕坐标 = rect.Left + 窗口内x`。

## 5. 截图判读

```powershell
$r = New-Object W+RECT
[void][W]::GetWindowRect($script:hwnd,[ref]$r)
$w = $r.Right-$r.Left; $h = $r.Bottom-$r.Top
$bmp = New-Object System.Drawing.Bitmap $w,$h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left,$r.Top,0,0,(New-Object System.Drawing.Size $w,$h))
$bmp.Save('<path>.png',[System.Drawing.Imaging.ImageFormat]::Png)
```

然后 `read_image` 看。**连续两张截图看着一样时别急着判定卡死**——可能按键根本没送进去（回第 4 节），
也可能画面本来就静止。判活用 CPU 增量：

```powershell
$a = (Get-Process -Id <clientPid>).TotalProcessorTime.TotalSeconds; Start-Sleep 5
$b = (Get-Process -Id <clientPid>).TotalProcessorTime.TotalSeconds
"cpu delta = $($b-$a)s"   # 渲染中应 > 0
```

## 6. 常见坑

1. **首启无障碍页挡路**：新建 `run-client` 第一次启动会停在 `Welcome to Minecraft!`（问旁白 / 无障碍
   设置），**quickPlay 会被这一页吃掉**。症状：客户端起来了但日志没有 `Connecting to`。点掉 `Continue`
   后才会连；`options.txt` 生成后不再出现。
2. **`runGameTestServer` 不能当冒烟测试**：没注册 gametest 时抛
   `IllegalArgumentException: No test functions were given!`。这个失败发生在 mod **全部加载完之后**，
   属假阴性——看到它别以为模组有问题，用 `runServer`。
3. **`Reference map 'xxx.refmap.json' could not be read`** 是 dev 环境正常告警（所有模组都会有）；
   只有 `MixinApplyError` / `Shadow field ... was not located` 才是真问题。
4. **依赖下载不通**：NeoForge 的 `runServer` 需要 `net.neoforged:DevLaunch`。若 `maven.neoforged.net`
   直连不通（DNS 污染 / 真实 CDN IP 也拒连 / CN 镜像无此件），给 Gradle 显式加代理：
   `-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=<port> -Dhttp.proxyHost=… -Dhttp.proxyPort=…`。
   **系统代理开着也不一定对 JVM 透明**（非 TUN 模式直连仍被拦），必须显式传。
5. **Paper/Spigot 插件测试**：服务端首启会生成 `plugins/` 与 `eula.txt`；插件类加载失败看
   `logs/latest.log` 的 `Could not load plugin`，不是崩溃报告。

## 7. 验收信号（缺一不可）

1. 服务端日志：`Done (x.xxxs)! For help, type "help"`
2. 服务端日志：`<player>[/127.0.0.1:…] logged in` + `<player> joined the game`
3. 客户端 `logs/debug.log`：`Mixing <MixinName> from <modid>.mixins.json into <目标类>`，
   且**没有任何** `MixinApplyError` / `Shadow field … was not located`
4. 客户端日志出现服务端下发的数据（配置同步 / 网络包），证明链路通
5. 客户端 F3 的 `XYZ` 与服务端登录坐标一致，证明真在同一世界

> 教训：`@Shadow` 字段**类型**写错（如 1.21 的 `Map<Holder<MobEffect>, …>` 写成 `Map<MobEffect, …>`）
> 编译期完全不报错，只在运行时 mixin 应用阶段炸。所以第 3 条必须真看 `debug.log`，
> 不能靠"编译通过"推断。

## 8. 收尾

dev 测试完必须收干净，否则下一轮有残留进程占端口 / 占文件锁：

- 停掉后台任务（顺带杀掉 gradlew 及其子进程树）
- 确认没有 `clientRunVmArgs` / `serverRunVmArgs`（或 java `-jar server.jar`）的残留进程
- 需要时 `gradlew --stop` 收掉 daemon
