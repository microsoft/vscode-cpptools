# Hornet C/C++ 设计文档

> 文档状态：Draft
> 文档版本：0.1.0
> 产品名称：Hornet C/C++
> 扩展建议 ID：`hornet-cpp`
> 配置前缀：`hornet-cpp.*`
> 基础仓库：`codehubcloud/vscode-cpptools`
> 目标：基于 vscode-cpptools 前端能力，构建完全独立的 C/C++ VS Code 语言插件。

---

# 1. 项目背景

Hornet C/C++ 是面向大型 C/C++ 工程开发的 VS Code 语言支持插件。

插件提供：

* 代码补全
* 编译错误实时检查
* 查找所有引用
* 跳转定义
* 调用关系图
* 重命名
* 类继承关系图
* 语义高亮
* 大纲
* 符号搜索
* 重构
* 内联提示
* 代码格式化
* 宏定义导航
* 工程索引
* `compile_commands.json` 管理
* 大型代码仓浏览

Hornet C/C++ 支持四种解析模式：

1. Flyweight
2. Tag
3. Compiler
4. Hybrid

四种模式采用统一 VS Code 前端，不让不同语言后端直接耦合 VS Code UI。

---

# 2. 项目目标

## 2.1 核心目标

Hornet C/C++ 应满足以下目标：

### 独立产品

插件名称、扩展 ID、命令、配置项、日志、状态栏、语言服务、索引数据库全部使用 Hornet 自己的命名空间。

不得继续依赖：

```text
ms-vscode.cpptools
C_Cpp.*
cpptools/*
cpptools-srv
Microsoft C/C++ proprietary runtime
```

最终形成：

```text
Hornet C/C++
        │
        ├── Hornet VS Code Frontend
        │
        ├── hornet-flyweight-lsp
        │
        ├── hornet-db
        │
        ├── clangd
        │
        ├── universal-ctags
        │
        └── cscope
```

---

## 2.2 开箱即用

用户安装插件后：

```text
安装 Hornet C/C++
        ↓
打开 C/C++ 工程
        ↓
自动检测工程
        ↓
自动选择解析模式
        ↓
开始索引
        ↓
提供代码导航
```

没有 `compile_commands.json` 时仍然必须具备基础代码浏览能力。

---

## 2.3 精准模式

存在有效：

```text
compile_commands.json
```

时可以通过 Compiler 模式获得：

* 精准语义分析
* 编译诊断
* 精准跳转
* 精准引用
* Rename
* Refactor
* Inlay Hint
* Semantic Token
* Call Hierarchy
* Type Hierarchy

---

## 2.4 大工程能力

插件需要考虑：

```text
10 万文件
50 万文件
100 万文件
100 万+ C/C++ 文件
```

不能将所有功能设计成：

```text
一次扫描
+
全部加载内存
```

必须支持：

* 增量解析
* 增量索引
* 持久化索引
* Lazy Loading
* Lazy Expand
* 后台线程池
* CPU 限流
* 内存限制
* 文件排除
* 分目录索引
* 索引重建
* 单文件更新

---

# 3. 非目标

第一阶段 Hornet C/C++ 不实现：

* 自研 C/C++ 编译器
* 自研 Debug Adapter
* 替代 GCC/Clang
* 完整 C++ ABI
* 自研 Linker
* 自研 Build System

第一阶段重点是：

```text
Editor
+
Language Service
+
Code Index
+
Navigation
+
Code Intelligence
```

Debug 功能不从原 vscode-cpptools 直接继承。

后续如需要调试功能，可单独设计：

```text
Hornet Debug Adapter
```

---

# 4. 原 vscode-cpptools 使用边界

Hornet 基于 vscode-cpptools 前端源码重构。

可以重点复用或改造的部分：

```text
Extension/src/
    LanguageServer/
    Providers/
    Utility/
    common/
    settings/
    UI/
```

重点参考：

* Provider 生命周期
* Workspace 管理
* VS Code API 注册
* Configuration 管理
* Status Bar
* Semantic Token
* Call Hierarchy
* Inlay Hint
* Outline
* Workspace Symbol
* Rename Provider
* Folding Provider

不将 Microsoft 官方 VSIX 中随包提供的私有语言服务器二进制作为 Hornet 后端。

Hornet 后端全部替换。

---

# 5. 总体架构

Hornet C/C++ 推荐采用五层架构。

```text
┌─────────────────────────────────────────────────────────┐
│                        VS Code                          │
│                                                         │
│ Completion / Definition / References / Rename           │
│ CallHierarchy / TypeHierarchy / Hover / Symbol          │
│ SemanticTokens / InlayHint / Diagnostic / Folding       │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                Hornet VS Code Frontend                  │
│                                                         │
│ Commands                                                │
│ StatusBar                                               │
│ Configuration                                           │
│ TreeView                                                │
│ Webview                                                 │
│ Language Providers                                      │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  Capability Router                      │
│                                                         │
│ definition()                                            │
│ references()                                            │
│ completion()                                            │
│ hover()                                                 │
│ rename()                                                │
│ callHierarchy()                                         │
│ typeHierarchy()                                         │
│ documentSymbols()                                       │
│ workspaceSymbols()                                      │
└───────────────────────────┬─────────────────────────────┘
                            │
              ┌─────────────┼───────────────┐
              │             │               │
              ▼             ▼               ▼
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│   Flyweight    │ │      Tag       │ │    Compiler    │
│    Engine      │ │     Engine     │ │     Engine     │
│                │ │                │ │                │
│ Tree-sitter    │ │ hornet-db      │ │ clangd         │
│ LSP            │ │ ctags          │ │ LSP            │
│                │ │ cscope         │ │                │
└────────────────┘ └────────────────┘ └────────────────┘
              │             │               │
              └─────────────┼───────────────┘
                            │
                            ▼
                  ┌─────────────────┐
                  │  Hybrid Engine  │
                  │                 │
                  │ Compiler + Tag  │
                  └─────────────────┘
```

---

# 6. 统一语言引擎接口

插件最重要的设计之一，是不能让 Provider 直接依赖：

```text
clangd
ctags
cscope
Tree-sitter
```

必须增加统一接口。

建议：

```typescript
export interface LanguageEngine {
    readonly mode: ParseMode;

    initialize(): Promise<void>;

    shutdown(): Promise<void>;

    restart(): Promise<void>;

    getCapabilities(): EngineCapabilities;

    completion(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<CompletionResult>;

    definition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<LocationResult>;

    references(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<LocationResult>;

    hover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<HoverResult>;

    rename(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string
    ): Promise<WorkspaceEditResult>;

    callHierarchy(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<CallHierarchyResult>;

    typeHierarchy(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<TypeHierarchyResult>;
}
```

各后端实现：

```text
FlyweightEngine
TagEngine
CompilerEngine
HybridEngine
```

---

# 7. Capability Router

所有请求先进入：

```text
CapabilityRouter
```

而不是 Provider 自己判断当前模式。

例如：

```typescript
class CapabilityRouter {
    async definition(request: DefinitionRequest) {
        const engine = this.modeManager.getActiveEngine();

        return engine.definition(
            request.document,
            request.position
        );
    }
}
```

优点：

```text
VS Code Provider
       │
       ▼
CapabilityRouter
       │
       ├── Flyweight
       ├── Tag
       ├── Compiler
       └── Hybrid
```

后续增加第五种解析器时不需要修改 VS Code Provider。

---

# 8. Mode Manager

新增：

```text
ModeManager
```

管理：

```typescript
enum ParseMode {
    Flyweight = "flyweight",
    Tag = "tag",
    Compiler = "compiler",
    Hybrid = "hybrid"
}
```

职责：

* 当前模式
* 模式切换
* 模式持久化
* Backend 生命周期
* 状态栏更新
* Capability 更新
* Mode fallback

配置：

```json
{
    "hornet-cpp.mode": "hybrid"
}
```

---

# 9. 状态栏模式切换

VS Code 底部增加：

```text
$(symbol-namespace) Hornet: Hybrid
```

点击：

```text
Hornet C/C++ Parsing Mode

○ Flyweight
○ Tag
○ Compiler
● Hybrid
```

选择后：

```text
停止旧 Engine
    ↓
保存 mode
    ↓
启动新 Engine
    ↓
更新 Provider Capability
    ↓
更新状态栏
```

命令：

```text
Hornet C/C++: 切换解析模式
```

Command ID：

```text
hornet-cpp.switchMode
```

---

# 10. Flyweight 模式

## 10.1 定位

Flyweight 是 Hornet 的轻量级自研代码索引引擎。

特点：

```text
无需 compile_commands.json
无需编译器
无需 ctags
无需 cscope
开箱即用
```

底层：

```text
Tree-sitter
```

使用 Tree-sitter 对 C/C++ 生成增量语法树。

---

# 11. Flyweight 架构

推荐采用：

```text
VS Code
   │
   │ LSP / stdio
   ▼
hornet-flyweight-lsp
   │
   ├── Tree-sitter C
   ├── Tree-sitter C++
   │
   ├── Parser
   ├── Symbol Resolver
   ├── Reference Resolver
   ├── Macro Engine
   ├── Index Manager
   └── SQLite Index
```

进程：

```text
hornet-flyweight-lsp
```

单可执行文件。

---

# 12. Flyweight 技术选型

建议：

```text
Rust
+
tree-sitter
+
tree-sitter-c
+
tree-sitter-cpp
+
LSP
+
SQLite
```

Rust 的主要用途：

* Language Server
* AST 管理
* 文件索引
* 并发
* SQLite 管理
* JSON-RPC/LSP

VS Code 前端继续使用 TypeScript。

---

# 13. Flyweight AST

Tree-sitter 负责：

```text
source code
     ↓
Concrete Syntax Tree
     ↓
Hornet Semantic Model
```

Hornet 在 CST 上构造自己的语义索引：

```text
Symbol
Definition
Reference
Scope
Namespace
Class
Struct
Function
Variable
Macro
Template
Using
Inheritance
Call
Include
```

统一结构建议：

```rust
struct Symbol {
    id: SymbolId,
    name: String,
    kind: SymbolKind,
    file_id: FileId,
    range: Range,
    scope_id: Option<SymbolId>,
    type_name: Option<String>,
    signature: Option<String>,
}
```

---

# 14. Flyweight Unified Index

与 Tag 模式不同：

Flyweight 不应该分别建立：

```text
tags
refs
```

而使用统一数据库。

例如：

```text
symbols
references
calls
inheritance
includes
macros
files
scopes
```

关系：

```text
Symbol
 ├── Definition
 ├── References
 ├── Calls
 ├── Inheritance
 ├── Scope
 └── Type
```

因此 Definition 和 Reference 可以基于相同 Symbol ID。

---

# 15. Flyweight 数据库

推荐 SQLite：

```text
hornet-flyweight.db
```

表结构：

```sql
files
symbols
references
calls
inheritance
includes
macros
```

例如：

```text
symbols

id
name
qualified_name
kind
file_id
line
column
end_line
end_column
container_id
type_name
signature
hash
```

引用：

```text
references

id
symbol_id
file_id
line
column
container_id
reference_kind
```

调用：

```text
calls

caller_symbol_id
callee_symbol_id
file_id
line
column
```

继承：

```text
inheritance

base_symbol_id
derived_symbol_id
access
```

---

# 16. Flyweight 增量更新

文件改变时：

```text
File Changed
     ↓
Tree-sitter Incremental Parse
     ↓
Old AST
     ↓
New AST
     ↓
AST Diff
     ↓
更新受影响的 Symbols
     ↓
更新 References
     ↓
更新 Calls
```

禁止：

```text
修改一个 .c
→ 重建整个项目
```

---

# 17. Tag 模式

Tag 是经典快速索引模式。

架构：

```text
VS Code
   │
   │ gRPC
   ▼
hornet-db
   │
   ├── Universal Ctags
   │
   └── Cscope
```

三个可执行程序：

```text
hornet-db
ctags
cscope
```

---

# 18. hornet-db

hornet-db 是 Hornet 自己的索引服务。

负责：

* 启动 ctags
* 启动 cscope
* 建立索引
* 管理索引状态
* 查询 Definition
* 查询 References
* 查询 Callers
* 查询 Callees
* Symbol Search
* Workspace Outline
* gRPC 服务
* Index Cache
* 文件增量更新

通信：

```text
VS Code Extension
        │
        │ gRPC
        ▼
    hornet-db
```

---

# 19. Tag 数据来源

ctags 主要负责：

```text
Definition
Symbol
Class
Struct
Namespace
Function
Variable
Enum
Macro
```

cscope 主要负责：

```text
Reference
Caller
Callee
Include
Text Reference
```

结构：

```text
            ┌──── ctags ──── Definitions
hornet-db ──┤
            └──── cscope ─── References
```

---

# 20. Tag 模式限制

由于：

```text
ctags symbol
```

和：

```text
cscope reference
```

来自两套独立模型，因此 References 不一定拥有完整：

```text
container
type
scope
symbol id
```

所以 Tag 模式允许存在：

```text
同名函数
同名成员
同名变量
```

产生额外结果。

这属于 Tag 模式天然能力边界。

---

# 21. Compiler 模式

Compiler 模式核心后端：

```text
clangd
```

架构：

```text
VS Code
   │
   │ LSP
   ▼
Hornet CompilerEngine
   │
   ▼
clangd
   │
   ▼
compile_commands.json
```

Compiler 模式提供最高语义准确度。

---

# 22. Compiler 模式能力

Compiler 模式承担：

* Completion
* Diagnostics
* Definition
* Declaration
* References
* Hover
* Signature Help
* Rename
* Semantic Tokens
* Inlay Hint
* Formatting
* Code Action
* Call Hierarchy
* Type Hierarchy
* Document Symbol
* Workspace Symbol
* Include Navigation
* Refactor

---

# 23. compile_commands.json

Compiler 模式依赖：

```text
compile_commands.json
```

没有编译数据库时：

```text
Compiler
```

允许启动，但 UI 必须明确提示：

```text
当前文件没有有效编译参数，
可能导致错误诊断或不准确的代码分析。
```

不能静默表现成精准模式。

---

# 24. Hybrid 模式

Hybrid 是默认推荐模式。

架构：

```text
              HybridEngine
                   │
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
    CompilerEngine       TagEngine
          │                 │
        clangd           hornet-db
```

Hybrid 并不是简单：

```text
Compiler结果 + Tag结果
```

而是：

```text
根据文件和请求选择最佳 Engine
```

---

# 25. Hybrid 路由策略

如果当前文件：

```text
存在有效 Compile Command
```

则：

```text
Compiler First
```

否则：

```text
Tag First
```

例如：

| 功能               | 有 Compile Command | 无 Compile Command |
| ---------------- | ----------------- | ----------------- |
| Completion       | Compiler          | Tag               |
| Definition       | Compiler          | Tag               |
| Reference        | Compiler          | Tag               |
| Diagnostics      | Compiler          | Disabled          |
| Rename           | Compiler          | Disabled          |
| Refactor         | Compiler          | Disabled          |
| Call Hierarchy   | Compiler          | Tag               |
| Type Hierarchy   | Compiler          | Tag               |
| Workspace Symbol | Merge             | Tag               |
| Outline          | Compiler          | Tag               |

---

# 26. Hybrid Fallback

定义：

```typescript
interface RoutingPolicy {
    preferred: EngineType;
    fallback?: EngineType;
    merge?: boolean;
}
```

例如 Definition：

```text
Compiler
    │
    ├─ 有结果 → 返回
    │
    └─ 无结果
          ↓
         Tag
```

Workspace Symbol：

```text
Compiler
   +
Tag
   ↓
Deduplicate
   ↓
Sort
```

---

# 27. 结果去重

Hybrid 必须建立统一：

```text
LocationKey
```

例如：

```text
normalized_file_path
+
start_line
+
start_column
+
symbol_name
```

避免：

```text
clangd Result
+
Tag Result
```

重复显示。

---

# 28. 调用关系图

Hornet 需要同时提供：

## VS Code 原生 Call Hierarchy

支持：

```text
Show Call Hierarchy
```

以及 Hornet 自定义侧边视图。

---

# 29. Hornet Call Graph

左侧增加：

```text
HORNET CALL GRAPH
```

例如：

```text
▼ FtlWrite
   ▼ Callers
      ▶ NvmeWrite
      ▶ BackgroundWrite
      ▶ GcMove
   ▼ Callees
      ▼ AllocPpa
         ▶ GetFreeBlock
         ▶ UpdateWritePointer
      ▶ UpdateMap
      ▶ NandWrite
```

所有节点支持：

```text
▶ 折叠
▼ 展开
```

采用 Lazy Query。

初始不会一次查询整个项目调用树。

---

# 30. Call Graph Lazy Loading

用户展开：

```text
AllocPpa
```

才执行：

```text
getOutgoingCalls(AllocPpa)
```

因此：

```text
100 万文件工程
```

也不会因为打开调用图把整个调用关系加载到 Extension Host。

---

# 31. Call Graph 节点

```typescript
interface CallGraphNode {
    symbolId: string;
    name: string;
    qualifiedName?: string;
    file: string;
    line: number;
    direction: "caller" | "callee";
    hasChildren: boolean;
}
```

支持：

* 点击跳转
* 双击展开
* Refresh
* Copy Symbol
* Copy Qualified Name
* Find References
* Pin Root
* Set As Root

---

# 32. 类继承关系图

新增：

```text
HORNET TYPE HIERARCHY
```

例如：

```text
NvmeCommand
├── AdminCommand
│   ├── IdentifyCommand
│   └── FirmwareCommand
└── IoCommand
    ├── ReadCommand
    └── WriteCommand
```

支持：

```text
Bases
Derived
```

以及 Lazy Expand。

---

# 33. Completion

Completion Provider 统一调用：

```text
CapabilityRouter.completion()
```

Compiler：

```text
clangd completion
```

Flyweight：

```text
AST
+
Scope
+
Symbol Index
```

Tag：

```text
symbol prefix search
```

Hybrid：

```text
Compiler preferred
Tag fallback
```

---

# 34. 实时诊断

实时编译错误仅：

```text
Compiler
Hybrid
```

启用。

原因：

```text
真实编译错误
```

必须拥有：

```text
include path
defines
compiler flags
language standard
target
system header
```

Tag/Flyweight 不宣称提供完整编译器诊断。

---

# 35. Diagnostic 配置

```json
{
    "hornet-cpp.clangd.ignoreDiagnostics": "not_indexed"
}
```

允许：

```text
none
all
not_indexed
```

解释：

### none

显示所有 clangd 诊断。

### all

隐藏所有 clangd 诊断。

### not_indexed

只有文件存在有效编译参数或已进入 Compiler Index 时显示诊断。

建议默认：

```text
not_indexed
```

---

# 36. Rename

Rename：

```text
Compiler：支持
Flyweight：第二阶段支持
Tag：不支持
Hybrid：Compiler
```

Rename 操作前：

```text
prepareRename
```

然后：

```text
WorkspaceEdit
```

需要支持：

```text
跨文件 rename
```

---

# 37. Refactor

第一阶段 Refactor 主要使用 clangd CodeAction。

例如：

* Fix Include
* Add Missing Include
* Extract
* Quick Fix
* Remove Unused
* Apply Suggested Fix

Flyweight 自研 Refactor 放在第二阶段。

---

# 38. Semantic Highlight

配置：

```json
{
    "hornet-cpp.syntaxColor.enable": true
}
```

来源：

```text
Compiler → clangd semantic tokens
Flyweight → Tree-sitter semantic model
Tag → basic only
Hybrid → Compiler
```

---

# 39. 不活跃代码

配置：

```json
{
    "hornet-cpp.syntaxColor.enableInactiveCode": true
}
```

例如：

```c
#if 0
...
#endif
```

或条件编译：

```c
#ifdef FEATURE_A
...
#endif
```

Flyweight 需要实现基础 Preprocessor Condition Engine。

Compiler 直接优先采用编译语义信息。

---

# 40. Inlay Hints

配置：

```json
{
    "hornet-cpp.clangd.enableInlayHints": true
}
```

Compiler：

```text
clangd
```

Flyweight：

逐步实现：

* Parameter Name
* Auto Type
* Template Argument

Tag：

```text
不支持
```

---

# 41. Outline

VS Code Outline 通过：

```text
DocumentSymbolProvider
```

提供。

层级：

```text
namespace
  class
    method
      local
```

Flyweight 可以利用 AST 提供完整结构。

Tag 模式只提供基础层级。

---

# 42. Symbol Search

命令：

```text
Hornet C/C++: 搜索符号
```

ID：

```text
hornet-cpp.symbolSearch
```

支持：

```text
exact
prefix
fuzzy
```

Flyweight：

```text
SQLite FTS
```

Tag：

```text
hornet-db
```

Compiler：

```text
workspace/symbol
```

Hybrid：

```text
Merge + Deduplicate
```

---

# 43. Compile Commands Manager

新增核心组件：

```text
CompileCommandsManager
```

职责：

* Import
* Generate
* Merge
* Deduplicate
* Validate
* Normalize
* Watch
* Query per file
* Export

---

# 44. Import Compile Database

命令：

```text
Hornet C/C++: 导入编译数据库文件
```

ID：

```text
hornet-cpp.importCompilationDatabase
```

用户选择：

```text
compile_commands.json
```

Hornet 导入到：

```text
.vscode/
└── hornet/
    └── compile-db/
        ├── compile_commands.json
        └── sources.json
```

---

# 45. 多数据库合并

支持：

```text
moduleA/build/compile_commands.json
moduleB/build/compile_commands.json
moduleC/build/compile_commands.json
```

合并：

```text
             A
             │
             ├── B
             │
             └── C
             ↓
.vscode/hornet/compile-db/compile_commands.json
```

---

# 46. Compile Command 去重

以规范化绝对路径作为主键：

```text
canonical(file)
```

例如：

```python
/home/test/a/../a/test.c
```

和：

```python
/home/test/a/test.c
```

视为同一个文件。

冲突策略：

```text
后导入优先
```

同时记录来源。

---

# 47. 编译数据库生成

命令：

```text
Hornet C/C++: 生成编译数据库文件
```

ID：

```text
hornet-cpp.generateCompilationDatabase
```

生成方案按照优先级：

```text
CMake
 ↓
Bear
 ↓
Header Guess
```

对于 CMake：

```bash
cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
```

对于已有构建环境可以接入 Bear。

对于无法构建的工程，可以生成 fallback database，但 UI 必须标记：

```text
Generated / Heuristic
```

不能与真实编译数据库混淆。

---

# 48. LinuxBuild API

Hornet 提供 Extension API：

```typescript
export interface HornetCppApi {
    importCompilationDatabase(
        path: string
    ): Promise<void>;

    importCompilationDatabases(
        paths: string[]
    ): Promise<void>;

    refreshIndex(): Promise<void>;

    getCompileCommand(
        file: string
    ): Promise<CompileCommand | undefined>;
}
```

LinuxBuild 插件可以直接：

```text
build
 ↓
Bear
 ↓
compile_commands.json
 ↓
Hornet API
 ↓
自动导入
```

---

# 49. 编译参数查看

资源管理器或者 Editor 右键：

```text
Hornet C/C++: 显示编译参数
```

例如：

```text
File:
src/ftl/write.c

Directory:
/home/project/build

Compiler:
/usr/bin/aarch64-linux-gnu-gcc

Arguments:
-Iinclude
-Iplatform
-DPRODUCT=8550
-DDEBUG=1
-std=gnu11
-O2
```

---

# 50. System Header Provider

配置：

```text
hornet-cpp.codebase.systemHeaderProvider
```

支持：

```text
RTOS+Compiler
RTOS
Compiler
None
```

---

# 51. RTOS+Compiler

顺序：

```text
compile_commands.json
        │
        ▼
提取 Compiler
        │
        ▼
查询 Compiler System Include
        │
        ├── 成功 → 使用
        │
        └── 失败
               ↓
          Hornet RTOS Headers
```

适合：

* ARM GCC
* Cross GCC
* Embedded GCC
* RTOS
* Firmware

---

# 52. Compiler 安全策略

从 compile command 中取得：

```text
compiler path
```

不代表可以任意执行。

默认只允许：

```text
workspace approved
+
trusted workspace
+
query-driver allowlist
```

避免恶意工程通过：

```text
compile_commands.json
```

诱导插件执行任意程序。

---

# 53. 索引命令

支持：

```text
Hornet C/C++: 同步工程索引
Hornet C/C++: 同步文件夹索引
Hornet C/C++: 同步当前文件索引
Hornet C/C++: 重建全项目索引
```

Command ID：

```text
hornet-cpp.syncProjectIndex
hornet-cpp.syncFolderIndex
hornet-cpp.syncFileIndex
hornet-cpp.rebuildProjectIndex
```

---

# 54. 文件夹右键菜单

Explorer：

```text
src/
    Right Click
        ↓
Hornet C/C++: 同步文件夹索引
```

文件：

```text
test.c
    Right Click
        ↓
Hornet C/C++: 同步当前文件索引
```

---

# 55. Index Manager

统一组件：

```text
IndexManager
```

但每个 Engine 可以拥有自己的 Storage。

```text
IndexManager
 ├── FlyweightIndex
 ├── TagIndex
 └── CompilerIndexState
```

IndexManager 负责：

* indexing state
* progress
* rebuild
* cancel
* invalidate
* file change
* workspace change
* exclude rules

---

# 56. 索引存储位置

不建议把大型索引文件直接写进源码目录。

优先：

```text
VS Code globalStorageUri
```

例如逻辑结构：

```text
hornet-cpp/
└── workspaces/
    └── <workspace-hash>/
        ├── flyweight/
        ├── tag/
        ├── compiler/
        └── metadata.json
```

`.vscode/hornet` 只保存轻量工程配置和编译数据库。

---

# 57. 文件排除

配置：

```json
{
    "hornet-cpp.excludePaths": [
        "**/.mm/**",
        "**/.git/**",
        "**/build/**",
        "**/output/**"
    ]
}
```

默认排除：

```text
**/.mm/**
**/.git/**
**/build/**
**/output/**
```

---

# 58. Include Folder

配置：

```json
{
    "hornet-cpp.hornetDb.includeFolders": [
        "/opt/project/common",
        "/opt/project/platform"
    ]
}
```

这些路径作为额外索引目录。

---

# 59. CPU 使用控制

配置：

```text
hornet-cpp.cpuUsage
```

支持：

```text
Maximum
High
Medium
Low
```

线程计算：

```text
Maximum = CPU * 100%
High    = CPU * 75%
Medium  = CPU * 50%
Low     = CPU * 25%
```

至少：

```text
1 thread
```

---

# 60. CPU Scheduler

统一：

```text
HornetCpuScheduler
```

计算：

```typescript
threadCount =
    Math.max(
        1,
        Math.floor(
            cpuCount * ratio
        )
    );
```

将结果传给：

```text
Flyweight
Tag
Compiler
```

而不是每个后端自行占满 CPU。

---

# 61. 内存模式

建议增加：

```text
hornet-cpp.memoryMode
```

支持：

```text
Performance
Balanced
LowMemory
```

其中：

### Performance

优先内存缓存。

### Balanced

默认。

### LowMemory

* 减少 AST Cache
* 减少 Symbol Cache
* 更积极释放文件 AST
* 磁盘索引优先
* 降低后台并发

---

# 62. 超大工程保护

当检测：

```text
> 1,000,000 C/C++ files
```

显示：

```text
Hornet C/C++ detected a very large workspace.
Consider Flyweight mode, exclusions, or reduced indexing scope.
```

Hybrid 不应在超大工程中默认无条件同时全量建立：

```text
clangd index
+
tag index
```

应支持：

```text
hornet-cpp.hybrid.fullTagIndex
```

默认：

```text
false
```

大工程下 Tag 只索引 Compiler 未覆盖区域。

---

# 63. 模式功能矩阵

| 功能                   |    Flyweight |     Tag | Compiler | Hybrid |
| -------------------- | -----------: | ------: | -------: | -----: |
| Completion           |            ✓ |       ✓ |        ✓ |      ✓ |
| Hover                |            ✓ |       ✗ |        ✓ |      ✓ |
| Definition           |            ✓ |       ✓ |        ✓ |      ✓ |
| References           |            ✓ |       ✓ |        ✓ |      ✓ |
| Folding              |            ✓ | Limited |        ✓ |      ✓ |
| Formatting           |            ✓ |       ✗ |        ✓ |      ✓ |
| Diagnostics          | Basic Syntax |       ✗ |        ✓ |      ✓ |
| Rename               |      Phase 2 |       ✗ |        ✓ |      ✓ |
| Refactor             |      Phase 2 |       ✗ |        ✓ |      ✓ |
| Semantic Highlight   |            ✓ | Limited |        ✓ |      ✓ |
| Inlay Hint           |            ✓ |       ✗ |        ✓ |      ✓ |
| Macro Navigation     |            ✓ | Limited |        ✓ |      ✓ |
| Call Hierarchy       |            ✓ |       ✓ |        ✓ |      ✓ |
| Type Hierarchy       |            ✓ |       ✓ |        ✓ |      ✓ |
| Outline              |            ✓ |       ✓ |        ✓ |      ✓ |
| Workspace Symbol     |            ✓ |       ✓ |        ✓ |      ✓ |
| compile_commands     |          不需要 |     不需要 |  必需/强烈建议 |     可选 |
| Compiler Environment |          不需要 |     不需要 |       推荐 |     可选 |

---

# 64. Flyweight 与 Tag

| 功能                  | Flyweight | Tag  |
| ------------------- | --------- | ---- |
| Hover               | 支持        | 不支持  |
| Folding             | 支持        | 有限   |
| Formatting          | 支持        | 不支持  |
| Inactive Code       | 支持        | 不支持  |
| Deprecated Symbol   | 支持        | 不支持  |
| Macro               | 支持        | 有限   |
| Complex Macro       | 支持        | 不支持  |
| Template Parameter  | 支持        | 不支持  |
| using namespace     | 支持        | 不支持  |
| this Completion     | 支持        | 不支持  |
| STL                 | 有限        | 非常有限 |
| Reserved Keyword    | 支持        | 有限   |
| Definition Accuracy | 高于 Tag    | 中    |
| Reference Accuracy  | 高于 Tag    | 中    |
| Executables         | 1         | 3    |
| LSP                 | stdio     | gRPC |
| Memory View         | 支持        | 不支持  |
| Refactor            | Phase 2   | 不支持  |

---

# 65. 性能指标

以下指标作为 Hornet Benchmark 的目标基线，而不是设计阶段声明已经达到的实际数据。

测试项目：

```text
OpenHarmony
Router
大型 Firmware Project
```

目标：

| 指标                   | Flyweight Target | Tag Target |
| -------------------- | ---------------: | ---------: |
| 索引时间                 |          ≤ 8m22s |   ≤ 13m21s |
| Completion Avg       |           ≤ 35ms |    ≤ 850ms |
| Syntax Highlight Avg |           ≤ 20ms |   ≤ 4300ms |
| Initialization       |           ≤ 100s |     ≤ 460s |

测试必须固定：

```text
CPU
RAM
Disk
Git Commit
File Count
Thread Count
Cache State
```

否则数字不可比较。

---

# 66. Benchmark 工具

仓库新增：

```text
benchmark/
├── completion/
├── indexing/
├── highlight/
├── navigation/
└── startup/
```

输出：

```json
{
    "mode": "flyweight",
    "workspaceFiles": 812345,
    "threads": 16,
    "indexTimeMs": 502000,
    "completionAvgMs": 32.3
}
```

CI 可以长期观察性能回归。

---

# 67. glibc 要求

发布验收目标：

| 模式        | 架构     | 最低 glibc |
| --------- | ------ | -------: |
| Compiler  | x86_64 |     2.17 |
| Compiler  | arm64  |     2.27 |
| Hybrid    | x86_64 |     2.17 |
| Hybrid    | arm64  |     2.27 |
| Tag       | x86_64 |     2.16 |
| Tag       | arm64  |     2.18 |
| Flyweight | x86_64 |     2.18 |
| Flyweight | arm64  |     2.18 |

启动 Backend 前先：

```text
detect glibc
```

不符合要求时给出明确错误。

禁止直接：

```text
spawn
→ ENOEXEC
→ 插件崩溃
```

---

# 68. Binary Manager

新增：

```text
BinaryManager
```

管理：

```text
clangd
hornet-db
hornet-flyweight-lsp
ctags
cscope
```

根据：

```text
OS
Architecture
glibc
```

选择正确 binary。

---

# 69. Backend Manifest

建议：

```json
{
    "flyweight": {
        "linux-x64": {
            "path": "bin/linux-x64/hornet-flyweight-lsp",
            "glibc": "2.18"
        },
        "linux-arm64": {
            "path": "bin/linux-arm64/hornet-flyweight-lsp",
            "glibc": "2.18"
        }
    }
}
```

启动前完成：

```text
Platform Check
Architecture Check
ABI Check
Checksum Check
Executable Check
```

---

# 70. 第三方许可证

Hornet 发布包需要单独维护：

```text
ThirdPartyNotices.txt
licenses/
```

至少包含：

```text
LLVM / clangd
Tree-sitter
tree-sitter-c
tree-sitter-cpp
Universal Ctags
Cscope
SQLite
Rust dependencies
Node dependencies
```

其中 Universal Ctags 的分发需要特别检查 GPLv2 相应义务。

不能把“能下载源码”等同于“可以忽略许可证”。

---

# 71. Hornet 配置命名

禁止继续新增：

```text
C_Cpp.*
```

全部统一：

```text
hornet-cpp.*
```

例如：

```text
hornet-cpp.mode
hornet-cpp.excludePaths
hornet-cpp.cpuUsage
hornet-cpp.memoryMode
hornet-cpp.clangd.path
hornet-cpp.clangd.arguments
hornet-cpp.clangd.enableInlayHints
hornet-cpp.clangd.ignoreDiagnostics
hornet-cpp.syntaxColor.enable
hornet-cpp.syntaxColor.enableInactiveCode
hornet-cpp.hornetDb.includeFolders
hornet-cpp.codebase.systemHeaderProvider
```

---

# 72. 命令命名

统一：

```text
hornet-cpp.*
```

建议命令：

```text
hornet-cpp.switchMode
hornet-cpp.importCompilationDatabase
hornet-cpp.generateCompilationDatabase
hornet-cpp.mergeCompilationDatabases
hornet-cpp.syncProjectIndex
hornet-cpp.syncFolderIndex
hornet-cpp.syncFileIndex
hornet-cpp.rebuildProjectIndex
hornet-cpp.showCompileCommand
hornet-cpp.showCallGraph
hornet-cpp.showTypeHierarchy
hornet-cpp.restartLanguageServices
hornet-cpp.openLogs
hornet-cpp.symbolSearch
```

---

# 73. Extension Metadata

最终：

```json
{
    "name": "hornet-cpp",
    "displayName": "Hornet C/C++",
    "description": "C/C++ language support, code intelligence and code browsing.",
    "publisher": "<hornet-publisher>"
}
```

不再使用：

```text
ms-vscode
cpptools
Microsoft C/C++
```

---

# 74. Output Channels

统一：

```text
Hornet C/C++
Hornet Compiler
Hornet Flyweight
Hornet Tag
Hornet Index
```

日志必须带：

```text
timestamp
workspace
mode
backend
level
```

例如：

```text
[09:22:31.312] [INFO] [Compiler] clangd started
[09:22:31.420] [INFO] [Compiler] compile database loaded: 18233 files
[09:22:32.001] [INFO] [Index] background index started
```

---

# 75. 项目目录设计

建议逐步从现有 Extension 重构成：

```text
Extension/
├── src/
│   ├── hornet/
│   │   ├── core/
│   │   │   ├── modeManager.ts
│   │   │   ├── capabilityRouter.ts
│   │   │   ├── binaryManager.ts
│   │   │   ├── processManager.ts
│   │   │   └── cpuScheduler.ts
│   │   │
│   │   ├── engines/
│   │   │   ├── languageEngine.ts
│   │   │   ├── flyweightEngine.ts
│   │   │   ├── tagEngine.ts
│   │   │   ├── compilerEngine.ts
│   │   │   └── hybridEngine.ts
│   │   │
│   │   ├── providers/
│   │   │   ├── completionProvider.ts
│   │   │   ├── definitionProvider.ts
│   │   │   ├── referenceProvider.ts
│   │   │   ├── callHierarchyProvider.ts
│   │   │   ├── typeHierarchyProvider.ts
│   │   │   ├── renameProvider.ts
│   │   │   ├── semanticTokensProvider.ts
│   │   │   ├── inlayHintProvider.ts
│   │   │   └── symbolProvider.ts
│   │   │
│   │   ├── compdb/
│   │   │   ├── compileCommandsManager.ts
│   │   │   ├── compileCommandsParser.ts
│   │   │   ├── compileCommandsMerge.ts
│   │   │   └── compilerProbe.ts
│   │   │
│   │   ├── index/
│   │   │   ├── indexManager.ts
│   │   │   └── indexState.ts
│   │   │
│   │   ├── views/
│   │   │   ├── callGraphView.ts
│   │   │   ├── typeHierarchyView.ts
│   │   │   └── indexStatusView.ts
│   │   │
│   │   ├── config/
│   │   │   ├── settings.ts
│   │   │   └── defaults.ts
│   │   │
│   │   └── api/
│   │       └── hornetCppApi.ts
│   │
│   └── main.ts
│
└── package.json
```

Native：

```text
Native/
├── flyweight-lsp/
│   ├── src/
│   └── Cargo.toml
│
├── hornet-db/
│   ├── src/
│   ├── proto/
│   └── Cargo.toml
│
└── third_party/
```

---

# 76. Process Manager

所有 native process 必须统一由：

```text
ProcessManager
```

启动。

管理：

* spawn
* stdout
* stderr
* restart
* crash
* timeout
* process tree
* graceful shutdown

禁止每个模块自行：

```typescript
child_process.spawn()
```

导致无法统一回收进程。

---

# 77. Backend Crash Recovery

如果：

```text
clangd crash
```

策略：

```text
第1次 → 自动 restart
第2次 → 自动 restart
第3次 → 停止自动 restart
```

显示：

```text
Hornet Compiler language server stopped unexpectedly.
```

Hybrid 可以自动：

```text
Compiler unavailable
        ↓
Tag fallback
```

---

# 78. Remote 场景

需要识别：

```text
Remote SSH
WSL
Container
Codespace-like remote
```

Engine 应运行：

```text
workspace side
```

而不是本机 UI side。

BinaryManager 根据 Extension Host 所在平台选择 backend。

Flyweight 不应因为 remote 场景强制切换 Hybrid。

只要对应平台 binary 可用即可继续 Flyweight。

---

# 79. Multi-root Workspace

每个 Workspace Folder 建立：

```text
WorkspaceContext
```

例如：

```text
WorkspaceManager
 ├── workspace A
 │    ├── mode
 │    ├── engine
 │    └── index
 │
 └── workspace B
      ├── mode
      ├── engine
      └── index
```

不同 Workspace Folder 可以使用不同模式。

例如：

```text
firmware/       Hybrid
bootloader/     Flyweight
thirdparty/     Tag
```

---

# 80. Workspace Trust

未信任 workspace：

禁止：

```text
运行编译器
运行 Bear
query-driver
执行 build command
```

仍可允许：

```text
Flyweight parse
```

前提是不执行工程内程序。

---

# 81. 初始模式

建议默认：

```text
Hybrid
```

启动：

```text
打开 Workspace
     ↓
寻找 compile_commands.json
     │
     ├── 找到
     │     ↓
     │   Compiler + Tag
     │
     └── 未找到
           ↓
          Tag
```

但中长期建议：

```text
Hybrid = Compiler + Flyweight fallback
```

并逐步淘汰 Tag。

---

# 82. Tag 淘汰路线

阶段：

```text
V1
Hybrid = Compiler + Tag
```

之后：

```text
V2
Hybrid = Compiler + Flyweight
```

最终：

```text
Tag
```

只作为兼容模式保留。

原因是 Flyweight 可以统一：

```text
Definition
Reference
Container
Type
Call
Inheritance
```

数据模型。

---

# 83. 插件冲突处理

Hornet 与：

```text
ms-vscode.cpptools
clangd extension
其他 C/C++ Language Server
```

可能同时注册：

```text
Completion
Definition
Diagnostics
```

安装后检测已激活扩展。

如果发现冲突：

```text
Multiple C/C++ language providers are active.
This may produce duplicate completion or diagnostics.
```

但不要未经用户同意自动 Disable 别的插件。

---

# 84. 用户界面

Activity/Views 建议：

```text
HORNET C/C++

Parsing
    Mode: Hybrid
    Compiler: Ready
    Tag Index: Ready

Call Graph

Type Hierarchy

Index
    Files: 132,991
    Indexed: 132,881
    Pending: 110
```

---

# 85. Status Bar

建议显示：

```text
Hornet: Hybrid
```

索引期间：

```text
Hornet: Hybrid $(sync~spin)
```

异常：

```text
Hornet: Compiler !
```

不要长期占用多个 Status Bar Item。

---

# 86. 重构原 vscode-cpptools 的原则

不是全仓库：

```text
cpptools → hornet
```

机械替换。

必须分类：

### 可以重命名

```text
package metadata
command ids
setting ids
output channel
status text
schemas
UI
class names
frontend service
```

### 需要删除

```text
Microsoft telemetry
Microsoft experiment service
Microsoft marketplace-specific behavior
Microsoft Copilot-specific integration
private binary downloader
private runtime
vsdbg dependency
```

### 可以保留并重构

```text
VS Code Provider patterns
Workspace lifecycle
Utility code
Configuration helpers
Localization framework
Test harness
```

---

# 87. 包名迁移

推荐：

```text
cpptools
→
hornet-cpp
```

API：

```text
vscode-cpptools
→
hornet-cpp-api
```

内部 namespace：

```text
cpptools/
→
hornet/
```

---

# 88. 配置迁移

第一版可以提供：

```text
Hornet C/C++: 从 Microsoft C/C++ 导入配置
```

读取：

```text
C_Cpp.*
c_cpp_properties.json
```

转换成：

```text
hornet-cpp.*
hornet_cpp_properties.json
```

只读取。

不修改原插件配置。

---

# 89. hornet_cpp_properties.json

建议新增：

```text
.vscode/hornet_cpp_properties.json
```

用于：

```text
includePath
defines
compilerPath
compilerArgs
standards
fallback configuration
```

而：

```text
compile_commands.json
```

仍然作为 Compiler 模式优先数据源。

---

# 90. API Version

Extension API：

```typescript
enum HornetApiVersion {
    v1 = 1
}
```

消费者：

```typescript
const api =
    extension.exports.getApi(
        HornetApiVersion.v1
    );
```

LinuxBuild 等插件通过正式 API 对接，禁止依赖 Hornet 内部文件。

---

# 91. 安全边界

外部输入包括：

```text
compile_commands.json
ctags config
workspace files
compiler path
clangd args
include path
build command
```

所有进程调用：

禁止：

```typescript
exec("string " + userInput)
```

必须：

```typescript
spawn(binary, args)
```

避免 Shell Injection。

---

# 92. 文件系统安全

索引路径必须经过：

```text
canonicalize
```

防止：

```text
../
symlink escape
malformed URI
```

索引数据库不得覆盖源码文件。

---

# 93. 测试体系

测试分：

```text
Unit Test
Integration Test
VS Code E2E
Backend Test
Performance Test
Compatibility Test
```

---

# 94. Unit Test

重点：

```text
ModeManager
CapabilityRouter
CompileCommandsMerge
CompileCommandsParser
PathNormalizer
ResultDeduplicator
CPU Scheduler
Binary Selector
```

---

# 95. Integration Test

准备：

```text
test/fixtures/
├── simple_c/
├── simple_cpp/
├── cmake/
├── macro/
├── template/
├── inheritance/
├── duplicate_symbol/
├── multi_root/
└── compile_commands/
```

验证：

```text
definition
references
rename
calls
types
completion
diagnostic
```

---

# 96. Call Hierarchy Test

例如：

```c
void C(void)
{
}

void B(void)
{
    C();
}

void A(void)
{
    B();
}
```

验证：

```text
A
└── B
    └── C
```

反向：

```text
C
└── B
    └── A
```

并测试 Lazy Expand。

---

# 97. Type Hierarchy Test

```cpp
class A {};

class B : public A {};

class C : public B {};
```

结果：

```text
A
└── B
    └── C
```

---

# 98. 发布产物

VSIX：

```text
hornet-cpp-x.y.z-linux-x64.vsix
hornet-cpp-x.y.z-linux-arm64.vsix
```

未来：

```text
win32-x64
win32-arm64
darwin-x64
darwin-arm64
```

---

# 99. CI

建议流水线：

```text
Lint
 ↓
TypeScript Unit Test
 ↓
Flyweight Test
 ↓
hornet-db Test
 ↓
VS Code Integration Test
 ↓
Native Build
 ↓
glibc Compatibility Test
 ↓
License Scan
 ↓
VSIX Package
 ↓
Smoke Test
```

---

# 100. Commit 拆分方案

正式开始修改仓库时，不建议一个超大 Commit。

建议：

## Commit 1

```text
refactor: establish Hornet C/C++ product identity
```

内容：

* package metadata
* displayName
* extension id
* output channel
* command namespace
* settings namespace
* README 基础品牌

---

## Commit 2

```text
refactor: remove Microsoft runtime dependencies
```

内容：

* private cpptools runtime
* downloader
* Microsoft services
* telemetry/experiments
* debug runtime dependency

---

## Commit 3

```text
feat: introduce language engine abstraction
```

内容：

```text
LanguageEngine
ModeManager
CapabilityRouter
```

---

## Commit 4

```text
feat: add compiler engine based on clangd
```

---

## Commit 5

```text
feat: add compilation database manager
```

---

## Commit 6

```text
feat: add Hornet parsing mode switcher
```

---

## Commit 7

```text
feat: add tag engine architecture
```

---

## Commit 8

```text
feat: add flyweight Tree-sitter language server
```

---

## Commit 9

```text
feat: add expandable call graph
```

---

## Commit 10

```text
feat: add type hierarchy view
```

---

## Commit 11

```text
feat: add project index management
```

---

## Commit 12

```text
docs: add Hornet C/C++ documentation
```

---

# 101. 开发阶段

推荐分四阶段。

---

## Phase 1：Hornet 化 + Compiler

目标：

```text
Hornet Extension
+
clangd
+
compile_commands
```

实现：

* Hornet 品牌
* ModeManager
* CapabilityRouter
* Compiler Engine
* Completion
* Diagnostics
* Definition
* References
* Rename
* Semantic Highlight
* Inlay Hints
* Call Hierarchy
* Type Hierarchy
* Outline
* Symbol Search

完成后已经可以作为可用 C/C++ 插件。

---

## Phase 2：Tag

实现：

```text
hornet-db
ctags
cscope
```

重点：

* 无编译环境导航
* Workspace Index
* Definition
* References
* Callers/Callees
* Symbol Search
* Hybrid

---

## Phase 3：Flyweight

实现：

```text
hornet-flyweight-lsp
Tree-sitter
Unified Index
```

优先：

* Parser
* Symbol
* Definition
* Reference
* Outline
* Folding
* Hover
* Call
* Inheritance

之后：

* Completion
* Macro
* Formatting
* Inlay Hint
* Semantic Token

---

## Phase 4：大型工程优化

实现：

* Incremental Index
* CPU Limit
* Memory Limit
* Lazy Call Graph
* Lazy Type Hierarchy
* Index Sharding
* Workspace Partition
* Benchmark
* 100w+ file stress test

---

# 102. V1 推荐范围

为了避免 Hornet 第一版同时实现三个复杂后端而迟迟不可用，推荐 V1：

```text
Compiler
+
Hybrid Framework
+
Call Graph
+
Type Hierarchy
+
Compile Commands Manager
```

然后：

```text
V1.1 → Tag
V1.2 → Flyweight Basic
V1.3 → Flyweight Advanced
```

但是整个架构从第一个 Commit 就按四模式设计，避免未来大规模重构。

---

# 103. 最终架构

最终期望：

```text
                       Hornet C/C++
                            │
              ┌─────────────┴─────────────┐
              │                           │
          VS Code UI                 Public API
              │                           │
              └─────────────┬─────────────┘
                            │
                    Capability Router
                            │
                     Mode Manager
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
       ▼                    ▼                    ▼
 FlyweightEngine        TagEngine          CompilerEngine
       │                    │                    │
       ▼                    ▼                    ▼
flyweight-lsp           hornet-db              clangd
       │                /        \                │
       ▼             ctags      cscope            ▼
  Tree-sitter                              compile_commands
       │
       ▼
Unified AST Index

                 HybridEngine
                      │
             Intelligent Routing
                      │
       ┌──────────────┴──────────────┐
       │                             │
 Compiler Semantic             Fallback Index
```

这套架构的核心原则是：

```text
VS Code UI 与语言后端解耦
```

以及：

```text
不同解析模式共享统一 Capability Interface
```

这样 Hornet C/C++ 后续即使：

```text
淘汰 Tag
替换 clangd
升级 Tree-sitter
增加 Remote Index
增加 Distributed Index
```

都不需要重新设计整个 VS Code 插件。

---

# 104. 结论

Hornet C/C++ 不应只是：

```text
vscode-cpptools
+
改图标
+
改名字
```

而应该以 vscode-cpptools 成熟的 VS Code 前端代码作为基础，重新建立自己的语言服务体系。

最终产品应形成三个核心层：

```text
Hornet Frontend
        ↓
Hornet Capability Router
        ↓
Hornet Language Engines
```

其中：

```text
Compiler
```

解决精准语义分析；

```text
Tag
```

解决传统、无编译环境、快速浏览；

```text
Flyweight
```

解决下一代轻量 AST 索引；

```text
Hybrid
```

负责把不同后端组合成最佳用户体验。

Hornet C/C++ 的长期方向建议为：

```text
Compiler + Flyweight
```

Tag 最终逐步转为兼容模式。

这样既能支持普通 C/C++ 工程，也能够面向 Firmware、Linux Kernel、OpenHarmony、嵌入式、大规模企业代码仓等场景。
