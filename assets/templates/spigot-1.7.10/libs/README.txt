Spigot 1.7.10 API — vendored jar 说明
======================================

把文件 spigot-1.7.10-R0.1-SNAPSHOT.jar 放进本目录（libs/），然后才能构建。

为什么是 vendored：
- 1.7.10 的 spigot-api 不在任何公共 maven 上（hub.spigotmc.org 最早的
  spigot-api 是 1.8-R0.1-SNAPSHOT；各镜像 2026-08 实测全部 404；jitpack
  因 Bukkit GitHub 历史在 DMCA 后被重置而无 1.7.10 tag）。
- 下载来源：getbukkit.org 归档的完整服务端 jar（内含 org/bukkit/** 与
  org/spigotmc/** 的 API 类——1.7.10 时代服务端 jar 未做 API 混淆）。
  下载 URL 形如 download.getbukkit.org/spigot/spigot-1.7.10-R0.1-SNAPSHOT.jar。
  下载受限时，替代源见 minecraft-spigot-legacy 技能 §2。

缺文件时行为：Gradle 对 files() 缺失文件直接报错（fail-loud），错误信息
指向本文件。放好 jar 后重跑 gradlew build 即可。
