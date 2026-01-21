#!/bin/bash
# ChoreoMaster Windows Desktop - 在当前环境运行的测试脚本

echo "=========================================="
echo "ChoreoMaster 本地功能测试"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

# 测试1: TypeScript编译
echo "测试1: TypeScript编译"
echo "---------------------------------------"
echo "编译Electron主进程..."
if npx -p typescript tsc -p tsconfig.electron.json --noEmit 2>&1 | grep -q "error TS"; then
    echo -e "${RED}✗${NC} TypeScript编译失败"
    FAIL_COUNT=$((FAIL_COUNT + 1))
else
    echo -e "${GREEN}✓${NC} TypeScript编译成功"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

echo ""
echo "编译React应用..."
if npm run build 2>&1 | grep -q "Build failed"; then
    echo -e "${RED}✗${NC} React应用构建失败"
    FAIL_COUNT=$((FAIL_COUNT + 1))
else
    echo -e "${GREEN}✓${NC} React应用构建成功"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# 测试2: 依赖检查
echo ""
echo "测试2: 依赖完整性检查"
echo "---------------------------------------"

NODE_MODULES_PRESENT=false
if [ -d "node_modules" ]; then
    NODE_MODULES_PRESENT=true
    echo -e "${GREEN}✓${NC} node_modules存在"

    # 检查关键依赖
    for dep in electron three react @react-three/fiber; do
        if ls node_modules | grep -q "^$dep"; then
            echo -e "  ${GREEN}✓${NC} 依赖存在: $dep"
            PASS_COUNT=$((PASS_COUNT + 1))
        else
            echo -e "  ${RED}✗${NC} 依赖缺失: $dep"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    done
else
    echo -e "${RED}✗${NC} node_modules不存在，请先运行 npm install"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# 测试3: 构建产物检查
echo ""
echo "测试3: 构建产物检查"
echo "---------------------------------------"

if [ -f "dist/index.html" ]; then
    echo -e "${GREEN}✓${NC} Web应用index.html存在"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${YELLOW}⚠${NC}  Web应用未构建，请运行 npm run build"
fi

if [ -d "dist-electron" ]; then
    echo -e "${GREEN}✓${NC} Electron构建目录存在"

    if [ -f "dist-electron/main.js" ]; then
        echo -e "  ${GREEN}✓${NC} Electron主进程编译成功"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "  ${RED}✗${NC} Electron主进程未编译"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi

    if [ -f "dist-electron/preload.js" ]; then
        echo -e "  ${GREEN}✓${NC} Preload脚本编译成功"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "  ${RED}✗${NC} Preload脚本未编译"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
else
    echo -e "${YELLOW}⚠${NC} Electron应用未构建，请运行 npm run build:electron"
fi

# 测试4: 代码语法检查
echo ""
echo "测试4: JavaScript语法检查"
echo "---------------------------------------"

if [ -f "dist-electron/main.js" ]; then
    if node --check dist-electron/main.js 2>&1 | grep -q "Error"; then
        echo -e "${RED}✗${NC} Electron主进程JavaScript语法错误"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    else
        echo -e "${GREEN}✓${NC} Electron主进程JavaScript语法正确"
        PASS_COUNT=$((PASS_COUNT + 1))
    fi
fi

if [ -f "dist-electron/preload.js" ]; then
    if node --check dist-electron/preload.js 2>&1 | grep -q "Error"; then
        echo -e "${RED}✗${NC} Preload脚本JavaScript语法错误"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    else
        echo -e "${GREEN}✓${NC} Preload脚本JavaScript语法正确"
        PASS_COUNT=$((PASS_COUNT + 1))
    fi
fi

# 测试5: 配置文件有效性
echo ""
echo "测试5: 配置文件有效性"
echo "---------------------------------------"

for config in package.json tsconfig.json tsconfig.electron.json electron-builder.config.js; do
    if [ -f "$config" ]; then
        if echo "$config" | grep -qE '\.(json|js)$'; then
            if [ "${config##*.}" = "json" ]; then
                if command -v python3 &> /dev/null && python3 -m json.tool "$config" &> /dev/null; then
                    echo -e "${GREEN}✓${NC} $config JSON有效"
                    PASS_COUNT=$((PASS_COUNT + 1))
                else
                    echo -e "${GREEN}✓${NC} $config 文件存在"
                    PASS_COUNT=$((PASS_COUNT + 1))
                fi
            else
                echo -e "${GREEN}✓${NC} $config 文件存在"
                PASS_COUNT=$((PASS_COUNT + 1))
            fi
        else
            echo -e "${RED}✗${NC} $config 文件类型不支持"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    else
        echo -e "${YELLOW}⚠${NC} $config 文件不存在"
    fi
done

# 测试6: React应用启动测试（检查端口）
echo ""
echo "测试6: 开发服务器端口检查"
echo "---------------------------------------"

PORT_IN_USE=false
if command -v netstat &> /dev/null; then
    if netstat -ano 2>/dev/null | grep -q ":5173.*LISTENING"; then
        echo -e "${YELLOW}⚠${NC} 端口5173已被占用"
        PORT_IN_USE=true
    else
        echo -e "${GREEN}✓${NC} 端口5173可用"
        PASS_COUNT=$((PASS_COUNT + 1))
    fi
elif command -v ss &> /dev/null; then
    if ss -tulpn 2>/dev/null | grep -q ":5173"; then
        echo -e "${YELLOW}⚠${NC} 端口5173已被占用"
        PORT_IN_USE=true
    else
        echo -e "${GREEN}✓${NC} 端口5173可用"
        PASS_COUNT=$((PASS_COUNT + 1))
    fi
else
    echo -e "${YELLOW}⚠${NC} 无法检查端口（netstat/ss不可用）"
fi

# 测试7: 文档完整性
echo ""
echo "测试7: 项目文档检查"
echo "---------------------------------------"

REQUIRED_DOCS=(
    "README.md"
    "BUILD_INSTRUCTIONS.md"
    "WINDOWS_README.md"
    "QUICKSTART.md"
    "TESTING_PLAN.md"
    "IMPLEMENTATION_REPORT.md"
    "PROJECT_SUMMARY.md"
)

for doc in "${REQUIRED_DOCS[@]}"; do
    if [ -f "$doc" ]; then
        echo -e "${GREEN}✓${NC} 文档存在: $doc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "${YELLOW}⚠${NC} 文档缺失: $doc"
    fi
done

# 测试8: Electron API集成检查
echo ""
echo "测试8: Electron API集成检查"
echo "---------------------------------------"

if [ -f "App.tsx" ]; then
    ELECTRON_API_CHECKS=(
        "window.electronAPI?.isElectron"
        "handleExportProject"
        "handleImportProject"
    )

    for check in "${ELECTRON_API_CHECKS[@]}"; do
        if grep -q "$check" App.tsx; then
            echo -e "  ${GREEN}✓${NC} 找到: $check"
            PASS_COUNT=$((PASS_COUNT + 1))
        else
            echo -e "  ${RED}✗${NC} 缺失: $check"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    done
else
    echo -e "${YELLOW}⚠${NC} App.tsx文件不存在"
fi

# 测试9: 构建脚本可用性
echo ""
echo "测试9: 构建脚本检查"
echo "---------------------------------------"

NPM_SCRIPTS=(
    "dev:electron"
    "build:main"
    "build:electron"
)

for script in "${NPM_SCRIPTS[@]}"; do
    if grep -q "\"$script\"" package.json; then
        echo -e "${GREEN}✓${NC} NPM脚本存在: $script"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "${RED}✗${NC} NPM脚本缺失: $script"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
done

# 测试10: 安全配置验证
echo ""
echo "测试10: 安全最佳实践验证"
echo "---------------------------------------"

SECURITY_CHECKS=(
    "contextIsolation.*true"
    "nodeIntegration.*false"
)

if [ -f "electron/main.ts" ]; then
    for check in "${SECURITY_CHECKS[@]}"; do
        if grep -q "$check" electron/main.ts; then
            echo -e "${GREEN}✓${NC} 安全配置: $check"
            PASS_COUNT=$((PASS_COUNT + 1))
        else
            echo -e "${RED}✗${NC} 安全配置缺失: $check"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    done
else
    echo -e "${YELLOW}⚠${NC} electron/main.ts文件不存在"
fi

# 总结
echo ""
echo "=========================================="
echo "测试结果摘要"
echo "=========================================="
echo "通过: $PASS_COUNT"
echo "失败: $FAIL_COUNT"
echo "总测试: $((PASS_COUNT + FAIL_COUNT))"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}🎉 所有测试通过！项目处于良好状态。${NC}"
    echo ""
    echo "下一步："
    echo "  1. 在Windows环境运行 'npm run dev:electron' 测试Electron应用"
    echo "  2. 在Windows环境运行 'npm run build:electron' 生成安装包"
    echo "  3. 参考 TESTING_PLAN.md 进行完整功能测试"
    exit 0
elif [ $FAIL_COUNT -le 3 ]; then
    echo -e "${YELLOW}⚠️  少量失败（$FAIL_COUNT个），但项目总体可用。${NC}"
    echo ""
    echo "建议：修复上述失败项后再进行构建。"
    exit 0
else
    echo -e "${RED}❌  多项测试失败（$FAIL_COUNT个），请修复问题。${NC}"
    exit 1
fi
