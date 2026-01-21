# ChoreoMaster Windows 应用 - 快速开始指南

## 环境准备

### Windows环境
- Windows 10或更高版本（x64）
- Node.js 18+ (推荐20 LTS)
- npm或pnpm
- Git（可选）

### Linux/Mac开发环境（当前）
- WSL2 Ubuntu
- Node.js 18+
- npm

## 开发模式启动

### 1. Web开发模式（快速迭代）
```bash
npm install
npm run dev
```
- 访问: http://localhost:5173
- 热重载: 已启用
- 用于：UI/功能开发

### 2. Electron开发模式（原生功能测试）
```bash
npm run dev:electron
```
- 启动完整Electron应用
- 包含原生文件对话框
- 用于：文件系统测试、性能测试

**注意**: 在Linux/Mac开发`npm run dev:electron`将启动Linux版本。

## 构建步骤

### 1. Web构建
```bash
npm run build
```
输出: `dist/`目录

### 2. Electron主进程编译
```bash
npm run build:main
```
输出: `dist-electron/`目录

### 3. 完整应用构建
```bash
npm run build:electron
```
输出:
- Windows: 需要在Windows环境执行
- Linux: `dist-electron/` (AppImage, Snap, deb)

## Windows环境构建

### 本地构建（Windows）
在Windows PowerShell或CMD中执行：
```powershell
# 克隆或下载项目
cd ChoreoMaster

# 安装依赖
npm install

# 开发模式
npm run dev:electron

# 构建安装包
npm run build:electron
```

### 跨平台构建（GitHub Actions）
创建`.github/workflows/build.yml`：

```yaml
name: Build Windows Installer

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build:
    runs-on: windows-2022
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Build application
        run: npm run build:electron

      - name: Upload artifact
        uses: actions/upload-artifact@v3
        with:
          name: Windows-Installer
          path: dist-electron/*.exe
```

### Docker构建（Windows）
使用Docker + Wine：
```bash
docker run --rm -v $(pwd):/app -w /app electronuserland/builder:wine \
  npm run build:electron
```

## 调试

### DevTools
开发模式自动打开DevTools。

生产模式手动打开：
1. 启动应用
2. 按 `Ctrl+Shift+I` (Windows)

### 日志位置
- **主进程日志**: 控制台输出
- **渲染进程日志**: DevTools Console
- **错误日志**: `~/.npm/_logs/` (npm)

## 常见问题

### Q: 端口已被占用
```
Error: listen EADDRINUSE: address already in use :::5173
```
**解决方案**:
```bash
# Windows
netstat -ano | findstr :5173
taskkill /PID <进程ID> /F

# 或修改端口
编辑 vite.config.ts: port: 5174
```

### Q: 编译错误
```
error TS2304: Cannot find name 'AudioBuffer'
```
**解决方案**:
确保`tsconfig.json`包含正确的类型：
```json
{
  "compilerOptions": {
    "lib": ["ES2022", "DOM"]
  }
}
```

### Q: electron-builder失败
```
error: Cannot find module 'electron-builder'
```
**解决方案**:
```bash
npm install --save-dev electron-builder
```

### Q: 应用窗口空白
**原因**: 路径配置错误或未编译

**解决方案**:
```bash
# 1. 确保先构建Web版本
npm run build

# 2. 确保编译Electron主进程
npm run build:main

# 3. 检查dist-electron/目录结构
ls dist-electron/
# 应该包含: main.js, preload.js, dist/
```

## 发布清单

### 功能完整性
- [x] 2D舞台视图
- [x] 3D舞台视图
- [x] 队形时间轴
- [x] 演员/道具管理
- [x] 项目导入/导出
- [x] 音频同步
- [x] 视频导出
- [x] AI队形生成
- [x] LED屏幕支持
- [x] 主题切换
- [x] 快捷键
- [x] 帮助系统

### 平台支持
- [x] Windows (主要目标)
- [x] Web (原有功能)
- [ ] macOS (已配置，需测试)
- [ ] Linux (已配置，需测试)

### 质量指标
- [x] TypeScript编译无错误
- [x] Web构建成功
- [x] Electron主进程编译成功
- [ ] Windows安装包测试
- [ ] 功能测试完成
- [ ] 性能测试完成

## 下一步

### 立即行动
1. [ ] 在Windows环境运行`npm run build:electron`
2. [ ] 测试.exe安装程序
3. [ ] 执行`TESTING_PLAN.md`中的测试
4. [ ] 记录所有问题和性能数据

### 可选增强
1. [ ] 添加应用图标 (`build/icon.ico`)
2. [ ] 配置自动更新
3. [ ] 添加代码签名（防止安全警告）
4. [ ] 优化bundle大小（代码分割）
5. [ ] 添加系统托盘支持
6. [ ] 添加安装程序背景图
7. [ ] 配置自动崩溃报告

## 联系与支持

- **项目仓库**: [GitHub链接]
- **问题反馈**: [Issues链接]
- **文档**: 参考`IMPLEMENTATION_REPORT.md`

## 许可证

Copyright © 2025 ChoreoMaster. All rights reserved.
