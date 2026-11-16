# sim-cli（P0）

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
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll serve --port 5178 --content content
```

`catalog`、`validate`、`run-combat`、`run-expedition`、`compare` 支持 `--out <file>`；不带时输出到 stdout。`selftest --out` 是目录；`requests --out` 是 Markdown 文件。错误信息在 stderr；退出码 `0` 为成功，`1` 为内容/校验错误，`2` 为用法/IO 错误。非法数字和显式非法日期属于用法错误。

新需求分配下一个 `REQ-NNNN`，默认 `status=open`；CLI 和 HTTP 不自动分拣。`createdAt` 始终存在，默认空串表示**未填写日期**，不会读取当前时钟。可显式提供严格的 `yyyy-MM-dd` 真实日历日期（例如 `2026-02-30` 拒绝）。三条内置需求全是 P0 格式样例，样例状态不构成实际需求授权。

## JSON 与 HTTP

普通 JSON 使用字段 DTO、UTF-8 无 BOM、中文不转义、LF 和一个末尾换行。读入后递归补空字符串/数组/可序列化对象；不推断 `availableActionIdsExplicit`，其含义保持由 Runtime 决定。

`selftest` 按施工单 6.2 的更具体规则保持原 `GenerateRound4Reports.ps1` 的读写方式：不补默认值，默认 Encoder，原 `Serialize(...) + "\n"`。JSON 不套用普通输出的 LF 归一化。因此 Windows JSON 缩进换行为 CRLF、末尾额外 LF，macOS 为 LF；Markdown 都沿用 Runtime 格式器并转 LF。跨平台报告不声称原始字节相同；每个平台必须与该平台未改原脚本逐文件 SHA-256 相同。

HTTP 使用 **ASP.NET Core Minimal API / Kestrel**，依赖随 SDK 安装的共享框架。最初 `HttpListener` 在 Windows 报 AccessDenied，故选择无需 URLACL 或系统权限改动的 Kestrel。显式只监听 `127.0.0.1`；框架日志不进入产品 stdout。CORS 只允许 `http://localhost[:port]` 和 `http://127.0.0.1[:port]`。路径穿越和内容目录内的符号链接/reparse point 被拒绝，body 上限 2 MiB。

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| GET | `/api/health` | ok、version、contentRoot、gitCommit；读不到 Git 时为空字符串 |
| GET | `/api/catalog` | 与 CLI catalog 完全相同的 JSON 字节 |
| POST | `/api/validate` | body=战例；有效 200，Runtime 校验不通过 422 |
| POST | `/api/run-combat` | body=战例；默认运行预算 |
| POST | `/api/run-expedition` | body=出征配置 |
| POST | `/api/compare` | body=`{"baseline":{...},"variant":{...}}` |
| GET | `/api/content/{type}` | `[{id,path}]`；单数/复数类型均可 |
| GET/PUT/DELETE | `/api/content/{type}/{id}` | 单实体；PUT 校验失败 422；不存在 404 |
| GET | `/api/requests` | JSON 需求数组（CLI requests 生成 Markdown 汇总） |
| POST | `/api/requests` | kind/owner/target/title，另可带 body/field/expected/createdAt；服务端分 ID，创建 201 |

模拟类 HTTP 与对应 CLI 共用序列化器，输出逐字节相同。P0 尚无物品/技能/建筑领域 schema，实体 PUT 只检查 JSON 对象、`schemaVersion=1` 与 URL/实体 ID 一致；`scenarios` 另外调用真实 CombatSession 校验。完整实体规则属于后续工单，不能把 P0 的基础检查称为完整内容校验。`validate --content` 仅验证 `_requests/`。

## 复核

Windows/macOS 均用 PowerShell 7，从仓库根执行（精确 SDK 已安装时）：

```powershell
pwsh -NoProfile -File tools/sim-cli/verification/Invoke-P0Checks.ps1 -OutputDirectory "$PWD/work/p0-checks" -Dotnet dotnet
```

验收程序无测试包依赖，启动真实 CLI 子进程，保存命令、stdout/stderr/exit；覆盖目录、19配置、容量与原始异常、对比、需求排序/错误、确定性、HTTP真实监听与原始路径穿越、报告哈希。包装脚本另跑未改原报告生成器到新目录，比较 10 个报告。不得用它启动 Unity 或 Player。

CLI验收采集器并发读取stdout/stderr的BaseStream，直接保存原始byte[]并按相同bytes计算SHA-256，解码只用于断言，不把产品的LF规范套在证据文件上。HTTP另存真实请求/响应body字节、status/headers、监听表及完整TCP路径错误响应。`--http-only`、`--errors-only`是验收程序的局部补证参数，不是产品命令。

`verification/expected-round4-sha256.json` 保存独立审计冻结的本机历史 Windows 10 份原始报告哈希；`expected-round4-sha256-lf.json` 是由相同冻结字节仅替换 CRLF→LF后计算的派生哈希，用于明确 macOS 换行差异，两者没有改写原档。最终 A5 仍要求 CLI 与原生成器在同平台重新生成的原始字节相等。固定源码基线为 `1706cbb353856b5b6f20c492268e3382a899a6b4`，不以移动 main 的空 diff 自证。完整状态见 [P0_VERIFICATION.md](../../docs/editor/P0_VERIFICATION.md)。
