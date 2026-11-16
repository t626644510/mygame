# sim-cli

本地内容工具，直接编译 Unity 工程现有的 Combat、Tactics、BaseEconomy、Expedition Runtime 源码。四个库分别保持 asmdef 边界，目标均为 `netstandard2.1` / C# 9。CLI 目标为 `net8.0`；没有第三方 NuGet 依赖。

## 安装与构建

安装精确的 **.NET SDK 8.0.428**，而不只是 Runtime。`global.json` 禁止自动选择其它 SDK。下列命令均从仓库根开始；SDK 安装在忽略的 `work/`，不更改系统配置。官方说明：[Windows](https://learn.microsoft.com/en-us/dotnet/core/install/windows)、[macOS](https://learn.microsoft.com/en-us/dotnet/core/install/macos)、[安装脚本](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-install-script)。

Windows PowerShell 7：

```powershell
New-Item -ItemType Directory -Force work/dotnet | Out-Null
Invoke-WebRequest https://dot.net/v1/dotnet-install.ps1 -OutFile work/dotnet-install.ps1
./work/dotnet-install.ps1 -Version 8.0.428 -InstallDir "$PWD/work/dotnet" -NoPath
$dotnet = "$PWD/work/dotnet/dotnet.exe"
Set-Location tools/sim-cli
& $dotnet --version
& $dotnet build . -c Release -warnaserror --no-incremental -m:1
Set-Location ../..
$sim = 'tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll'
& $dotnet $sim catalog
```

macOS Terminal：

```sh
mkdir -p work/dotnet
curl -fsSL https://dot.net/v1/dotnet-install.sh -o work/dotnet-install.sh
bash work/dotnet-install.sh --version 8.0.428 --install-dir "$PWD/work/dotnet" --no-path
dotnet="$PWD/work/dotnet/dotnet"
(cd tools/sim-cli && "$dotnet" --version && "$dotnet" build . -c Release -warnaserror --no-incremental -m:1)
sim=tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll
"$dotnet" "$sim" catalog
```

已有精确 SDK 时可直接使用 `dotnet`。请在 `tools/sim-cli` 目录执行，以使 SDK 解析读取这里的 `global.json`。从仓库根直接执行 `dotnet build tools/sim-cli -c Release` 时，CLI 不会根据项目参数去查找子目录中的 `global.json`；须先确认实际 SDK 版本。

## 命令

下面以已加入 PATH 的 `dotnet` 为例，工作目录为仓库根。安装在 `work/` 时用上面的 `$dotnet` 绝对路径替换。Windows PowerShell 可将 `dotnet $sim ...` 写成 `& $dotnet $sim ...`。

```sh
# 原始 Runtime 目录（条件、选择方式、状态等）
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll catalog --out work/catalog.json

# 直接由 CombatSession/GetSnapshot 校验；超容量逐指令标注，不在工具重算规则
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll validate Game/Assets/StreamingAssets/Prototype/Combat/round4_mage_library.json
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll validate --content content

# 物品 ID/旧别名引用与旧配置登记情况；旧配置只读
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll refs expedition-ore --content content --out work/ore-refs.json
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll legacy-scan --content content --out work/legacy-scan.json

# 先完整校验，再导出；编辑源与运行时输出分开
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll export --content content --out Game/Assets/StreamingAssets/Content

# CombatRunResult 与 ExportLogText 原文；预算参数可省略
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll run-combat Game/Assets/StreamingAssets/Prototype/Combat/default.json --max-steps 10000 --max-wait 100000 --log work/combat.txt --out work/combat.json
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll run-expedition Game/Assets/StreamingAssets/Prototype/Combat/round4_expedition.json --out work/expedition.json

# 两份任意战例；只报告真实运行分歧，不声称仅改了单一设置
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll compare Game/Assets/StreamingAssets/Prototype/Combat/round2_ambush.json work/variant.json --out work/comparison.json

# 稳定生成汇总；默认 content/REQUESTS.md，不打印生成时间
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll requests
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll requests --content content --out work/REQUESTS.md
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll requests new --kind note --owner planning --target global --title "需要确认的配置"
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll requests new --kind note --owner planning --target global --title "显式日期" --created-at 2026-11-15 --body "仅记录输入日期"

# 只写这次指定的新目录，不覆盖旧报告
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll selftest round4 --out work/round4-reports

# 本地 HTTP，Ctrl+C 停止
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll serve --port 5185 --content content --export-out Game/Assets/StreamingAssets/Content
```

`catalog`、`validate`、`refs`、`legacy-scan`、`run-combat`、`run-expedition`、`compare` 支持 `--out <file>`；不带时输出到 stdout。`selftest --out` 和 `export --out` 是目录；`requests --out` 是 Markdown 文件。错误信息在 stderr；退出码 `0` 为成功，`1` 为内容/校验错误，`2` 为用法/IO 错误。非法数字和显式非法日期属于用法错误。

新需求分配下一个 `REQ-NNNN`，默认 `status=open`；CLI 和 HTTP 不自动分拣。`createdAt` 始终存在，默认空串表示**未填写日期**，不会读取当前时钟。可显式提供严格的 `yyyy-MM-dd` 真实日历日期（例如 `2026-02-30` 拒绝）。三条内置需求全是 P0 格式样例，样例状态不构成实际需求授权。

## JSON 与 HTTP

普通 JSON 使用字段 DTO、UTF-8 无 BOM、中文不转义、LF 和一个末尾换行。读入后递归补空字符串/数组/可序列化对象；不推断 `availableActionIdsExplicit`，其含义保持由 Runtime 决定。

`selftest` 按施工单 6.2 的更具体规则保持原 `GenerateRound4Reports.ps1` 的读写方式：不补默认值，默认 Encoder，原 `Serialize(...) + "\n"`。JSON 不套用普通输出的 LF 归一化。因此 Windows JSON 缩进换行为 CRLF、末尾额外 LF，macOS 为 LF；Markdown 都沿用 Runtime 格式器并转 LF。跨平台报告不声称原始字节相同；每个平台必须与该平台未改原脚本逐文件 SHA-256 相同。

HTTP 使用 **ASP.NET Core Minimal API / Kestrel**，依赖随 SDK 安装的共享框架。最初 `HttpListener` 在 Windows 报 AccessDenied，故选择无需 URLACL 或系统权限改动的 Kestrel。显式只监听 `127.0.0.1`；框架日志不进入产品 stdout。CORS 只允许 `http://localhost[:port]` 和 `http://127.0.0.1[:port]`。路径穿越和内容目录内的符号链接/reparse point 被拒绝，body 上限 2 MiB。

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| GET | `/api/health` | ok、version、contentRoot、exportRoot、gitCommit；读不到 Git 时为空字符串 |
| GET | `/api/catalog` | 与 CLI catalog 完全相同的 JSON 字节 |
| GET | `/api/capabilities` | 可编辑类型、物品类型、槽位及已接入加成字段 |
| GET | `/api/ids/{id}` | exists、type、canonicalId、path、viaAlias |
| GET | `/api/refs/{id}` | 全部引用及路径、JSON Pointer、来源/用途方向、实际数量或 null |
| POST | `/api/validate-item` | `{entity,mode:"create"\|"update",requests?:[]}`；纯校验，200/422，无写入 |
| POST | `/api/validate-content` | `{}`；完整内容校验，200/422 |
| POST | `/api/export` | `{}`；写到 serve 的固定 exportRoot，拒绝 body 指定输出路径 |
| POST | `/api/validate` | body=战例；有效 200，Runtime 校验不通过 422 |
| POST | `/api/run-combat` | body=战例；默认运行预算 |
| POST | `/api/run-expedition` | body=出征配置 |
| POST | `/api/compare` | body=`{"baseline":{...},"variant":{...}}` |
| GET | `/api/content/{type}` | `[{id,path}]`；单数/复数类型均可 |
| GET/PUT/DELETE | `/api/content/{type}/{id}` | GET 附 ETag；PUT 要求创建/更新前提；字段错误 422、冲突或有引用删除 409、不存在 404 |
| GET | `/api/requests` | JSON 需求数组（CLI requests 生成 Markdown 汇总） |
| POST | `/api/requests` | kind/owner/target/title，另可带 body/field/expected/createdAt；服务端分 ID，创建 201 |

模拟类 HTTP 与对应 CLI 共用序列化器，输出逐字节相同。P1 的 `validate --content` 包含物品 schema、文件名、跨实体 ID/alias 唯一性、材料引用及物品需求目标。P2 增加技能/角色/遭遇/试炼/规则专用校验，建筑等后续模块仍按自己的工单处理。

物品新建使用 `If-None-Match: *`；更新使用 GET 返回的完整含引号 `If-Match`。409 返回当前磁盘对象和当前 ETag；客户端选择保留自己的修改后仍须带该新 ETag 重试。PUT 路径与对象 ID 不同为 422。纯校验入口的 create 重复 ID/alias 为 422；真正 PUT 已存在同 URL 且带 `If-None-Match: *` 为 409。两种操作的区别和字段错误 DTO 见 [P1_API_CONTRACT.md](../../docs/editor/P1_API_CONTRACT.md)。

物品 PUT 可用原对象，或 `{entity,requests:[...]}` 原子保存物品与需求。缺少能力的物品须为 draft 且关联非 note 需求；合法 draft 从导出集合剔除，其余有效物品仍可导出。活动物品引用 draft 时导出失败。导出剔除编辑元数据，按 ID 排序；`manifest.json` 只记录受管文件哈希及数量。失败不改目标目录；成功仅清理上次清单里的过期产物，保留其他文件及 `.meta`。

网页开发先启动 sim-cli，再启动 [editor-web](../editor-web/README.md)。需要进程身份记录时可使用可选 Node 启动器，写入实际服务 PID、镜像、参数、DLL/源码哈希及原始日志：

```sh
node tools/sim-cli/dev-server.mjs --port 5185 --content work/editor/content --export-out work/editor/runtime --identity-dir work/editor/backend --dotnet work/dotnet/dotnet.exe
```

上例是 Windows 的 SDK 文件名；macOS 把 `--dotnet` 改为 `work/dotnet/dotnet`。先将所需内容复制到隔离 content 根。前端手工审查、离线停启和独立验收各用自己的数据根与端口；启动器不自动复制正式内容。Node 只用于该开发包装器，正式 CLI/HTTP 不依赖 Node。

`--cli <path>` 可指定独立构建的 `sim-cli.dll`，便于审查服务保持旧版本、修改版在新数据根验证。启动记录中的 DLL 哈希代表实际运行版本；不能把当前源码当成已加载的版本。

## P0 回归与 P1 验收

P1 的独立检查、浏览器操作和 Unity 读回入口见 [editor-verification](../editor-verification/README.md)，实际 B1–B13 状态见 [P1_VERIFICATION.md](../../docs/editor/P1_VERIFICATION.md)。P0 已冻结证据保留在自己的验收文档；P1 收紧的领域校验及 PUT 前提须使用 P1 夹具验证。

CI 复用标准 Windows/macOS 矩阵，checkout 后核对精确 PR head。P0 回归步骤保留，P1 步骤使用 Node 24.12.0、`npm ci`、真实后端验收、前端 build/lint；命令的原始 stdout/stderr 与退出码随 artifact 保存。`verification/Invoke-P1Checks.mjs` 只启动隔离 CLI/HTTP，不运行浏览器或 Unity。Node 安装与关闭包缓存的设置依据 [官方 setup-node](https://github.com/actions/setup-node)，artifact 设置依据 [GitHub 文档](https://docs.github.com/en/actions/tutorials/store-and-share-data)。

Windows/macOS 均用 PowerShell 7，从仓库根执行（精确 SDK 已安装时）：

```powershell
pwsh -NoProfile -File tools/sim-cli/verification/Invoke-P0Checks.ps1 -OutputDirectory "$PWD/work/p0-checks" -Dotnet dotnet
```

验收程序无测试包依赖，启动真实 CLI 子进程，保存命令、stdout/stderr/exit；覆盖目录、19配置、容量与原始异常、对比、需求排序/错误、确定性、HTTP真实监听与原始路径穿越、报告哈希。包装脚本另跑未改原报告生成器到新目录，比较 10 个报告。不得用它启动 Unity 或 Player。

CLI验收采集器并发读取stdout/stderr的BaseStream，直接保存原始byte[]并按相同bytes计算SHA-256，解码只用于断言，不把产品的LF规范套在证据文件上。HTTP另存真实请求/响应body字节、status/headers、监听表及完整TCP路径错误响应。`--http-only`、`--errors-only`是验收程序的局部补证参数，不是产品命令。

`verification/expected-round4-sha256.json` 保存独立审计冻结的本机历史 Windows 10 份原始报告哈希；`expected-round4-sha256-lf.json` 是由相同冻结字节仅替换 CRLF→LF后计算的派生哈希，用于明确 macOS 换行差异，两者没有改写原档。最终 A5 仍要求 CLI 与原生成器在同平台重新生成的原始字节相等。固定源码基线为 `1706cbb353856b5b6f20c492268e3382a899a6b4`，不以移动 main 的空 diff 自证。完整状态见 [P0_VERIFICATION.md](../../docs/editor/P0_VERIFICATION.md)。

## P2 战斗内容与来源往返

后端仍由 `sim-cli serve` 提供，前端见 `tools/editor-web`。HTTP 只监听 loopback，来源文件由客户端上传 JSON 文本，不接受任意服务端文件路径。HTTP `export-scenario` 固定写当前 content 下的 `_exports`；完整 DTO、编辑意图、规则来源和错误格式见 [P2_API_CONTRACT.md](../../docs/editor/P2_API_CONTRACT.md)。

```powershell
# 使用新隔离根；保留既有物品、aliases、需求样例与规则模板。
if (Test-Path work/example) { throw '请选择新的隔离目录。' }
New-Item -ItemType Directory work/example | Out-Null
Copy-Item -LiteralPath content -Destination work/example/content -Recurse
$cli = 'tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll'
dotnet $cli import-scenario Game/Assets/StreamingAssets/Prototype/Combat/round4_mage_library.json --content work/example/content
dotnet $cli assemble trial_round4_mage_library --content work/example/content --out work/example/scenario.json
dotnet $cli run-trial trial_round4_mage_library --content work/example/content --out work/example/run.json --log work/example/original-core.log
dotnet $cli export-scenario trial_round4_mage_library --content work/example/content --out work/example/exported.json
```

17 个单场和 2 个出征应分别使用隔离根。非空库遇同 ID 非等价定义会整笔拒绝，不覆盖或自动改名；例如不同来源的 pressure_strike 18/25 不能合并。`import-expedition` 使用相同的 file、`--content`、`--prefix` 参数。CLI `assemble` 输出纯 CombatScenario 或 CombatExpeditionConfig；HTTP assemble 另带 kind/config/bindings/ruleContexts/resolvedActions。CLI `export-scenario --out` 写纯 Runtime 配置，stdout 回执的 SHA 对应该文件，不将回执写回配置。`run-trial` 使用真实 CombatSession；出征逐场日志从同一次 CombatExpeditionSession 的 1-based ExportEncounterLogText 读取，不重放或拼造日志。

新建配置按 allies→enemies 和动作 ID 排序；导入保留原 Runtime ID、头、seed、预算、presence 及 units/actions 原序，Helper `_imports` 旁车不会进入 Runtime。未编辑取原来源，明确编辑只投影对应字段。规则 UI 只读；每场绑定 `rules_<prefix>_<n>.json`，不相关 rules_combat 模板不会覆盖旧场。换绑规则采用完整目标规则；移除调用预算采用现有核心 10000/100000 缺省，场景预算不变。单场明确增场转为出征并保原首场。角色校验必须与当前 trial/场次同源；多解返回 422 要求选择，容量及 validationReason 来自真实核心，actionAvailable 不表示当前 MP 足够。

同一来源内部的逐场差异显式存为 encounter.actionOverrides 的 typed fields/remove。共享字段先投影，再应用本场固定值；继承、固定值和省略 Runtime 字段三态分开，0/false 不等于缺省。R2 的 18/12 在共享改为 20 后为 20/12；明确移除第二场固定值后为 20/20，保存重开保持。已知相同来源/hash 重导入仍核当前实际定义，仅等价时 no-op，不重置 baseline 或编辑历史。界面 shared/effective 显示值使用同一核心 NormalizeActionDefinition，不倒写来源。

`export` 保留 P1 合法 draft 物品剔除、其他有效项可出的语义；有 P2 内容时增加 skills/characters/encounters 表。实际 active 依赖 draft/未支持能力会阻止运行和导出，并保目标目录不变。trials、来源及编辑 metadata 不导出。新表不代表已实现 R2 全局库 Runtime 消费，也不引入 R1 六维派生、R3 新装备或 P3。

27 个法师动作的实际句子与原字段、来源指纹见 [P2_SKILL_SENTENCES.md](../../docs/editor/P2_SKILL_SENTENCES.md)。CI 的 `verification/Invoke-P2Checks.mjs` 消费前序正式构建，调用独立原核 oracle 核对 C1 的17单场、C2的2联场及C3的4项复用/拒绝；它只覆盖同平台纯 .NET/Node，界面、HTTP及唯一受控Unity证据分别验收。

## P3 建筑、地图与静态配方链

**建筑与配方目前只做设计和静态检查，游戏运行时尚未接入。** 已知的 storage/housing/shop/public_service/decoration 与 workshop 都是合法静态设计，不因尚未接入通用运行时而被强制设为 draft。只有未知功能使用 pending+draft，并附 owner=base、kind=new_building_function 的需求。旧 BaseSession、首餐与备战行为不变，不引入居民决策、账本推演或沙盘。

完整字段、ETag、错误层次和 HTTP DTO 见 [P3_API_CONTRACT.md](../../docs/editor/P3_API_CONTRACT.md)。源规则文件是 `content/rules/rules_base_item_flows.json`、ID 为 `rules_base_item_flows`，保持 filename=id；导出产物仍叫 `base_item_flows.json`。

从前文已构建的 `$dotnet` / `$sim` 开始，在仓库根准备新的隔离副本：

```powershell
if (Test-Path work/p3-example) { throw '请选择新的隔离目录，保留现有编辑。' }
New-Item -ItemType Directory work/p3-example | Out-Null
Copy-Item -LiteralPath content -Destination work/p3-example/content -Recurse
& $dotnet $sim import-first-meal --content work/p3-example/content
& $dotnet $sim layout-check layout_first_meal_near --content work/p3-example/content
& $dotnet $sim layout-check layout_first_meal_far --content work/p3-example/content
& $dotnet $sim analyze-chain --content work/p3-example/content --out work/p3-example/chain.json
& $dotnet $sim validate --content work/p3-example/content
& $dotnet $sim export --content work/p3-example/content --out work/p3-example/runtime
& $dotnet $sim serve --content work/p3-example/content --export-out work/p3-example/runtime --port 5185
```

macOS 使用前文同一参数的 `$dotnet` 可执行文件；命令入口均不依赖 Unity。网页在“地图”模块选择近/远首餐布局，在“生产”选择简餐/链图/物品流规则。服务只监听127.0.0.1。已有另一服务时使用独立端口和数据根，遵守实际 PID/启动身份，不按旧端口终止其它任务。

需要留在网页中浏览的完整样例时，可用准备入口代替手工复制；它只接受仓库 `work/` 下**尚不存在**的新目录，连已有空目录也拒绝，不启动服务、不删除或覆盖旧目录：

```powershell
node tools/sim-cli/scripts/prepare-p3-review.mjs --preset clean --out work/p3-review-clean-001
node tools/sim-cli/scripts/prepare-p3-review.mjs --preset layout-errors --out work/p3-review-errors-001
node tools/sim-cli/scripts/prepare-p3-review.mjs --preset chain --out work/p3-review-chain-001
```

每次准备都复制当前 canonical `content/`，打印实际 content/runtime 根、各样例 ID/网页地址和现有 serve/前端命令，并保存 `P3_REVIEW_PRESET.json`。默认命令使用当前源码的 Release DLL；本机独立构建可加 `--dotnet <可执行文件> --cli <sim-cli.dll>`，端口可加 `--port 5185 --ui-port 5175`。先按前文构建，随后分别执行打印出的后端和前端命令；Ctrl+C 停止各自服务。

`clean` 是合法近/远首餐与简餐库，可以导出；`layout-errors` 复用独验五个 active 布局与所需建筑定义，故意保留五类设计错误供问题定位，其导出应失败；`chain` 复用五种非阻断提示配方并补测试物品定义，可以导出。链样例把无来源、无去处物品与循环配方的物品分开，避免组合后提示互相抵消；这些隔离样例不写回正式定义，不是新增玩法。准备入口只读复用 `tools/editor-verification/p3/fixtures.mjs`，不运行验收或复制寻路算法。恢复相同开局时，停自己的服务，换一个新目录再次准备 `clean` 并使用其根路径重启；不要把导入或已有目录当强制重置。

`import-first-meal` 固定读取旧 `BaseEconomy/default.json`，创建/等价复用 `bld_legacy_kitchen`、`rcp_simple_meal`、`layout_first_meal_near/far`，不覆盖不同内容同ID、不改名。要重新回到未改起点，请选择新的隔离根复制正式合法 content；不要把重复导入当强制重置。legacy 厨房是1×1可通行点，入口0,0；它是旧预置设施，导入建设价0仅未知成本的静态占位，不表示免费建设。简餐引用现有 mat_grain/con_simple_meal，参考价6/10，工时3，静态单位工时增值1.3333，不是最终经济平衡。

布局结构有效时，五类非法摆放仍可 PUT 保存：越界、占地重叠/压地形、入口堵塞、不连通、实例归属不被定义允许。`POST /api/layout/check {layout}` 返回200及有定位的 errors/warnings；CLI layout-check 有硬错误时 exit1、合法时 exit0。pure validate-entity 只负责结构/引用，不能因此禁保存设计中的空间错误。显式 `validate --content` 与 export 对 active 布局检查这五类错误。默认正式库只有合法 near/far；D3 错误演示在独立副本中保持 draft=false，检查/导出失败后恢复字段或换新副本，不能靠剔除 draft 错误样例冒充通过。

距离接口 `POST /api/layout/distance {layout,from:{instanceId}|{x,y}}` 返回同行主序 distanceField 和各入口/出生点的 tiles/ticks。障碍及不可达=-1；起点越界、堵塞或实例不存在为422，不偷换到0,0。定义只取当前磁盘已保存版本，建筑表单未保存时不隐式覆盖地图。障碍数组来自不可通行地形和不可通行建筑占地；寻路/连通/距离直接调用冻结的 `Prototype.BaseEconomy.BasePathfinding`，没有第二份 BFS。路径包含首尾，步数为非空 path.Length-1；显示格距直接取 DistanceField，不把节点数当距离。

旋转采用屏幕 y 向下、实例左上角不动。对原始宽高(w,h)和局部点(x,y)：0°=(x,y)，90°=(h-1-y,x)，180°=(w-1-x,h-1-y)，270°=(y,w-1-x)；90/270交换宽高，外侧入口使用同一公式。D5 的3×2入口{1,2}旋转90°变为2×3和{-1,1}，即左侧正中；实例只持久化rotation90，不改建筑原定义。

`far_from_storage` 阈值是 `BaseLayouts.FarFromStorageThreshold=12`：工坊到最近可达仓储入口最短路 **大于12格** 才提示。没有仓储时不造该警告；不可达另报 D3 错误。阈值不写入物品流源文件。首餐近/远厨粮距离2/7、客厨3/8；公式 `max(2*d(厨,粮)*movementTicksPerTile+productionTicks,d(客,厨)*movementTicksPerTile)` 推得7/17 tick，不表示旧 BaseSession 已改用新寻路。

链图五 flags（no_source/no_sink/cycle/no_building/non_positive_margin）全部是 warning、blocking=false。缺来源、有意循环、暂时独立的合法配方仍可导出；真正缺失定义、非法字段、active依赖draft/未实现，以及D3布局错误才硬拦。no_building 看有没有建筑定义引用配方，不看布局是否摆工坊。非正参考增值琥珀，其余问题节点红描边。别名归一到现有定义；旧掉落、强化材料和建筑造价计入来源/去处，未知数量保null，实例/source标签不能注册成物品。

P3 数据存在时 export 增加 buildings.json/recipes.json/layouts.json/base_item_flows.json；P1-only根保留原一表manifest语义。输出按ID排序，剔合法draft、notes及flow note，保留设计name/description；提示在 analysisWarnings 与硬错误分开。失败不写目标任何文件，成功只清理上次manifest所管产物，保留其它文件/meta；重复导出全部文件和manifest字节相同，不读墙钟。P3 这四表仍是设计产物，游戏尚无通用建筑/配方加载执行系统。
