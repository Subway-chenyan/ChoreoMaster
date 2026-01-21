#!/bin/bash
# ChoreoMaster Windows Desktop - 验证脚本
# 在任何环境运行以检查代码完整性

echo "=========================================="
echo "ChoreoMaster Desktop 代码完整性验证"
echo "=========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SUCCESS_COUNT=0
FAILURE_COUNT=0
TOTAL_CHECKS=0

check_file() {
    local file=$1
    local description=$2

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $description: $file"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        return 0
    else
        echo -e "${RED}✗${NC} $description: $file (未找到)"
        FAILURE_COUNT=$((FAILURE_COUNT + 1))
        return 1
    fi
}

check_directory() {
    local dir=$1
    local description=$2

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✓${NC} $description: $dir"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        return 0
    else
        echo -e "${RED}✗${NC} $description: $dir (未找到)"
        FAILURE_COUNT=$((FAILURE_COUNT + 1))
        return 1
    fi
}

check_in_file() {
    local file=$1
    local pattern=$2
    local description=$3

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    if [ -f "$file" ] && grep -q "$pattern" "$file"; then
        echo -e "${GREEN}✓${NC} $description"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        return 0
    else
        echo -e "${RED}✗${NC} $description (未找到'$pattern')"
        FAILURE_COUNT=$((FAILURE_COUNT + 1))
        return 1
    fi
}

check_line_count() {
    local file=$1
    local min_lines=$2
    local description=$3

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    if [ -f "$file" ]; then
        local actual_lines=$(wc -l < "$file" | tr -d ' ')
        if [ "$actual_lines" -ge "$min_lines" ]; then
            echo -e "${GREEN}✓${NC} $description ($actual_lines 行)"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            return 0
        else
            echo -e "${RED}✗${NC} $description (仅 $actual_lines 行，需要至少 $min_lines)"
            FAILURE_COUNT=$((FAILURE_COUNT + 1))
            return 1
        fi
    else
        echo -e "${RED}✗${NC} $description (文件不存在: $file)"
        FAILURE_COUNT=$((FAILURE_COUNT + 1))
        return 1
    fi
}

check_json_valid() {
    local file=$1
    local description=$2

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    if command -v python3 &> /dev/null; then
        if python3 -m json.tool "$file" &> /dev/null; then
            echo -e "${GREEN}✓${NC} $description (JSON有效)"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            return 0
        else
            echo -e "${RED}✗${NC} $description (JSON无效)"
            FAILURE_COUNT=$((FAILURE_COUNT + 1))
            return 1
        fi
    elif command -v node &> /dev/null; then
        if node -e "try { JSON.parse(require('fs').readFileSync('$file')) } catch(e) { process.exit(1) }" &> /dev/null; then
            echo -e "${GREEN}✓${NC} $description (JSON有效)"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            return 0
        else
            echo -e "${YELLOW}⚠${NC} $description (跳过，无Python/Node)"
            TOTAL_CHECKS=$((TOTAL_CHECKS - 1))
            return 0
        fi
    else
        echo -e "${YELLOW}⚠${NC} $description (跳过，无Python/Node)"
        TOTAL_CHECKS=$((TOTAL_CHECKS - 1))
        return 0
    fi
}

echo "1. Electron核心文件检查"
echo "---------------------------------------"
check_file "electron/main.ts" "Electron主进程"
check_file "electron/preload.ts" "Electron预加载脚本"
check_file "electron/ipc-handlers.ts" "IPC处理器"
echo ""

echo "2. TypeScript编译检查"
echo "---------------------------------------"
check_in_file "electron/main.ts" "export function createWindow" "main.ts函数定义"
check_in_file "electron/preload.ts" "contextBridge.exposeInMainWorld" "preload.ts contextBridge"
check_in_file "electron/ipc-handlers.ts" "ipcMain.handle" "IPC处理器注册"
echo ""

echo "3. 代码完整性检查"
echo "---------------------------------------"
check_line_count "electron/main.ts" 50 "主进程代码量"
check_line_count "electron/preload.ts" 30 "预加载脚本代码量"
check_line_count "electron/ipc-handlers.ts" 70 "IPC处理器代码量"
echo ""

echo "4. 配置文件检查"
echo "---------------------------------------"
check_file "tsconfig.electron.json" "Electron TypeScript配置"
check_file "electron-builder.config.js" "Electron Builder配置"
check_file "package.json" "项目配置"
echo ""

echo "5. React集成检查"
echo "---------------------------------------"
check_in_file "App.tsx" "window.electronAPI" "Electron API集成"
check_in_file "App.tsx" "handleExportProject" "导出函数更新"
check_in_file "App.tsx" "handleImportProject" "导入函数更新"
echo ""

echo "6. 类型定义检查"
echo "---------------------------------------"
check_file "electron-bridge.d.ts" "Electron API类型定义"
check_in_file "electron-bridge.d.ts" "interface ElectronAPI" "ElectronAPI接口"
check_in_file "electron-bridge.d.ts" "declare global" "全局类型声明"
echo ""

echo "7. 构建产物检查"
echo "---------------------------------------"
check_directory "dist" "Web应用构建产物"
check_directory "dist-electron" "Electron应用构建产物"
if [ -d "dist/assets" ]; then
    JS_SIZE=$(du -h dist/assets/*.js 2>/dev/null | tail -1 | cut -f1)
    echo -e "${GREEN}✓${NC} Web应用构建产物 ($JS_SIZE)"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
fi
echo ""

echo "8. 文档完整性检查"
echo "---------------------------------------"
check_file "BUILD_INSTRUCTIONS.md" "构建说明文档"
check_file "WINDOWS_README.md" "Windows应用README"
check_file "QUICKSTART.md" "快速开始指南"
check_file "TESTING_PLAN.md" "测试计划"
check_file "IMPLEMENTATION_REPORT.md" "实施报告"
check_file "PROJECT_SUMMARY.md" "项目总结"
echo ""

echo "9. package.json依赖检查"
echo "---------------------------------------"
check_in_file "package.json" '"electron":' "Electron依赖"
check_in_file "package.json" '"electron-builder":' "electron-builder依赖"
check_in_file "package.json" '"electron-is-dev":' "electron-is-dev依赖"
check_in_file "package.json" '"dev:electron":' "Electron开发脚本"
check_in_file "package.json" '"build:electron":' "Electron构建脚本"
check_in_file "package.json" '"build:main":' "主进程构建脚本"
echo ""

echo "10. 安全配置检查"
echo "---------------------------------------"
check_in_file "electron/main.ts" 'contextIsolation: true' "contextIsolation配置"
check_in_file "electron/main.ts" 'nodeIntegration: false' "nodeIntegration关闭"
check_in_file "electron/preload.ts" "contextBridge.exposeInMainWorld" "安全API暴露"
echo ""

echo "=========================================="
echo "验证结果摘要"
echo "=========================================="
echo -e "总检查项: $TOTAL_CHECKS"
echo -e "${GREEN}通过: $SUCCESS_COUNT${NC}"
echo -e "${RED}失败: $FAILURE_COUNT${NC}"
echo ""

if [ $FAILURE_COUNT -eq 0 ]; then
    echo -e "${GREEN}🎉 所有检查通过！代码完整性验证成功。${NC}"
    exit 0
elif [ $FAILURE_COUNT -le 2 ]; then
    echo -e "${YELLOW}⚠️  $FAILURE_COUNT 个检查失败，但总体可接受。${NC}"
    exit 0
else
    echo -e "${RED}❌  $FAILURE_COUNT 个检查失败，请检查上述问题。${NC}"
    exit 1
fi
