# 横屏交互优化 — 2026-10-13

本轮验证：类型检查、移动核心 7 项、桌面回归 149 项、浏览器交互 8 项通过；生产构建及 Android 资源同步通过。没有修改原生 API，也未进行 APK 或真机验证，先前的工具链限制仍在。

新增浏览器覆盖：640×360 / 812×375 / 915×412 横屏布局，收起队形栏后播放与撤销重做，9 个队形的自动滚动，横竖屏切换，按米微调与撤销，右侧抽屉与关闭后焦点恢复，以及网格开启时轻点 / 3px 手指抖动不改变站位。

浏览器缩小视口验证了键盘尺寸下不会误切横屏布局；没有模拟真实 Android 输入法、系统安全区域或硬件返回键，仍需真机验收。

---

# 验证记录 — 2026-10-12

环境：Linux ARM64，Node 22.22.1，系统 Chromium 触屏仿真。Python 后端依赖安装在 `/tmp/cosstage-mobile-verify-venv`，没有修改系统 Python。

| 验证 | 结果 |
| --- | --- |
| `PYTHON=/tmp/cosstage-mobile-verify-venv/bin/python npm test` | 通过：类型检查、发布 102 通过 / 2 跳过、后端 22、项目服务 27、桌面 149、移动核心 6、生产构建 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/chenyan/.local/bin/google-chrome npm run test:mobile:ui` | 4 个浏览器场景通过 |
| `npm run android:sync` | 生产资源打包并同步到 Android，发现 App / Filesystem / Share 三个插件 |
| `android/gradlew assembleDebug` | 未通过：环境没有 JDK，`JAVA_HOME is not set`；Android SDK 也未安装 |
| `adb devices` | 无连接设备；未进行真机安装与原生行为验证 |
| GitHub Actions Android preview | 工作流已添加；未推送、未触发，不代表远程 APK 构建成功 |

浏览器覆盖：触屏拖动、多选整体位移、演员锁定、缩放视角及取消未提交拖动、撤销重做、队形复制、时长编辑、播放和 WAV 导入、横竖屏及 360px 窄屏、离线编辑、重新加载、ZIP 下载与重新导入、坏包保留原项目、配额写入失败后恢复素材、桌面仍进入原编辑器。

核心测试通过真实桌面项目服务执行 desktop → mobile → desktop 往返，核对演员位置及高度、旋转、分组、贝塞尔转场、备注、音频标记、模型快照和原始素材字节。单独注入素材写入异常，验证同事务的文档写入被回滚。

生产构建仍有仓库的较大共享/桌面 chunk 提示与过期 Browserslist 数据提示；未以升级无关依赖的方式处理。

## 待真机验收

配置 JDK 21 / SDK 36 后运行 `npm run android:build`，或执行 Android preview 工作流，再安装调试 APK。应检查：

- 飞行模式下冷启动、编辑、退出及再次打开。
- 系统文件选择器导入，系统分享文件在接收端完整可读。
- 返回键逐层退出、安全区域、软键盘、旋转、切后台再恢复。
- 较多演员及接近 64 MiB 项目包的内存和触控表现。
- 升级安装保留本机项目；卸载前导出备份。

这些原生场景尚未验证，不能由浏览器测试结果推断为通过。
