# P0 工程验收记录

状态：**实现已联通，验收进行中；P0 尚未完成。** 固定源码基线 `1706cbb353856b5b6f20c492268e3382a899a6b4`。本文由工程集成负责人维护，不修改权威上下文或其摘要，不延伸到 P1、R1/R2/R3/R5/P4。

本轮用户明确要求 A1 两个平台正式工程实证、A6 Windows Unity 实证。施工单中旧的 `git diff main` 以本轮授权的固定 `1706cbb` 替代；A6 可延后的旧句不作为本轮跳过验收的依据。源码提交、纯 .NET 通过、Unity 通过与用户玩法验收分别记录。

## 实施与来源

- 四个 Runtime 项目分别对应原 asmdef，直接链接 `Game/Assets/Prototype/<模块>/Runtime/**/*.cs`，`netstandard2.1` / C# 9 / nullable、implicit usings 关闭 / warnings as errors；CLI 为 `net8.0`。
- 精确 SDK **8.0.428**，`tools/sim-cli/global.json` 禁止 roll-forward。Windows 隔离安装在忽略目录 `work/p0_20261116/dotnet`；官方安装脚本 URL `https://dot.net/v1/dotnet-install.ps1`，本次脚本 SHA-256 `e8b873e18a81e5c4cd8ab69d84dac8fead291d50b3c44633cd7fddad709a13d6`。首次 channel 8.0 解析得到该版本，此后实际调用和 CI 均固定精确版本，不改全局 Git/系统路径/URLACL。
- P0-A 仅工具、内容、需求 schema 和本文；P0-B 仅 CombatSampleRuns 新增公开方法及新增 EditMode 测试/meta；P0-C 仅独立 Editor 检查目录及对应 meta。CI 使用标准 Windows/macOS runner，`contents: read`，不使用秘密、部署或付费 runner。
- HTTP 最初 HttpListener 在 Windows 遇 AccessDenied；最终选择施工单允许的 ASP.NET Core Minimal API/Kestrel，共享框架无第三方 NuGet。显式 `IPAddress.Loopback`，框架日志关闭，不改系统权限。错误仍按协议和 stderr 返回。
- `createdAt` 必填表示字段必须存在；原单未规定非空或 date-time。经 root 按本轮授权确认：默认空串表示未填写，显式 `--created-at` / HTTP `createdAt` 必须是真实 `yyyy-MM-dd` 日期；不读墙钟。非法显式日期 CLI=2、HTTP=400。三条状态样例不构成真实需求授权。
- `selftest` 特例严格遵循 6.2 原脚本的裸读取、默认 Encoder、`Serialize + "\n"`；不套普通 JSON 的 LF 归一化。Windows 报告 JSON 为原脚本的 CRLF 缩进+末尾 LF，Markdown 为 LF。macOS 原始输出平台差异须另外展示，不声称跨平台报告字节一致。

## 当前证据

本机证据都保存在忽略目录，不覆盖历史报告。当前正式 Windows 纯 .NET 完整运行：`outputs/p0_20261116/formal-windows-run4/`；主验收 JSON：`pure/verification.json`，**106 项检查通过，40 次真实 CLI 调用**。包装脚本另执行未改 `GenerateRound4Reports.ps1`，10/10 报告 CLI、新生成脚本、冻结旧原件 SHA-256 相同。

HTTP/A8 原件补证：`outputs/p0_20261116/http-supplement-run7/`，仅相关24项实跑，未重跑19配置。`execution-receipt.json` 记录拥有的PID **23196**、真实镜像/启动参数、正常退出 **0**；服务嵌入同一验收进程。`http/` 保存18组请求/响应body原始字节及status/headers/hash、3份网络流直接保存的完整TCP400响应和真实监听表 `127.0.0.1:5187`。`direct/compare-priority.json` 为直接Runtime期望报告，CLI实际输出另存 `commands/001-compare.stdout`。run4只保存HTTP内存断言，不能从run4摘要独立重算HTTP；本次补证填补该缺口，不追记旧run已有原件。

stderr字节采集补证：独立复核发现run4的80个已保存流中，有5个stderr被旧采集器改为LF，但回执hash按未归一化捕获字符串计算，属于证据瑕疵：`024-validate`、`025-run-combat`、`026-run-combat`、`033-requests`、`034-validate`。旧run4未改写或重标；新采集器直接并发复制两条BaseStream到byte[]，原字节保存且同bytes算SHA，UTF-8解码仅用于断言。`outputs/p0_20261116/error-byte-supplement-run8/`仅重新采集这5错误路径，映射到新`001/002/003/004/005`，exit依次`1/2/2/2/1`；10个stdout/stderr物理文件与回执hash **10/10相同**。`STREAM_HASH_AUDIT.json`保存旧80流完整检查及5条旧新映射，SHA-256 `9c5508c24ef925c823db4a571ab1c5ae8c3f2520a9320f7823db42797dd991ef`。没有重跑19配置或旧报告，也未改产品/Runtime/UnityJson。

独立审计已重算关闭该采集器项：旧80流精确5条不符，新10/10物理hash=metadata、CRLF真实保留、退出码向量一致，源码确为同一原始byte[]写盘和算hash。根预审原件另见 `outputs/helper_editor_p0/root_review/preaudit_20261116T044603Z/{PREAUDIT.md,end-source-manifest.json,evidence-crosschecks-v2.json}`；它此前确认的这5条阻塞由run8补证回应，不追改旧回执。

复核命令（PowerShell 7，在仓库根；新建输出目录）：

```powershell
pwsh -NoProfile -File tools/sim-cli/verification/Invoke-P0Checks.ps1 -OutputDirectory "$PWD/work/p0-checks-review" -Dotnet "$PWD/work/p0_20261116/dotnet/dotnet.exe"
git -c safe.directory=C:/Users/lau/Documents/ChatGPT/mygame diff 1706cbb353856b5b6f20c492268e3382a899a6b4 -- Game/
```

四工程 MSBuild `-getProperty/-getItem` 的实际属性/源码链接/引用图也由包装脚本验证并保存。不是只读取 csproj 文本自证。SDK 的选择以 `sdk-version.stdout` 和 `sdk-info.stdout` 为准。

| 项 | 当前状态 | 命令与真实结果/证据 |
| --- | --- | --- |
| A1 | Windows 通过；macOS 未验 | 正式五工程 `build . -c Release -warnaserror --no-incremental -m:1`：exit0、0 Warning、0 Error；`formal-build.stdout/.stderr/.command.json/.binlog`。双平台 CI尚未触发，main提交/推送被自动审批阻止 |
| A2 | 固定基线源码检查通过；最终提交映射待做 | Runtime 全为直接 Compile Link，无 Runtime `.cs` 副本。24个Runtime/asmdef文件中23个相同，唯一现有文件变化是P0-B纯新增22行；Game新增为B测试/meta2个和C9个，StreamingAssets零变更。根独立审查已复核允许范围；不能用移动main空diff证明 |
| A3 | 通过 | 真实 `catalog` 对10个原Runtime Get* 序列化逐项比较；数量37/24/7/9/3/4。`pure/verification.json` 和 `commands/001-catalog.stdout` |
| A4 | 通过 | 17战例结果/WAIT/行动数全部与工单表相同；2出征 CompletedAllEncounters、各2场；`pure/run-results.json`。出征观察到的最终 WAIT 单独列为实测，不补写成工单旧基准 |
| A5 | Windows 通过；macOS待同平台对照 | 10/10 CLI selftest = 未改脚本新目录输出 = 冻结Windows本机旧10报告；`report-hash-comparison.json`。raw旧哈希来自独立审计，不是1706 Git blob；mac换行派生哈希明确另存，不归一化原档 |
| A6 | 通过（限所要求的一致性；保留未解释诊断） | 真实Windows Unity6000.3.28f1 batchmode/nographics：19配置、21日志对全部相同，完整报告一致；Combat EditMode258/258，新增16/16 XML Passed。独立审查重算42日志文件和19完整JSON通过；两批实际exit0，但有mono abort/debugger-agent/allocator尾诊断，不能称干净退出 |
| A7 | 通过 | INT10每条capacityAllowed/validationReason与直接GetSnapshot相同；重复角色ID exit1且error/stderr保持原ArgumentException消息 |
| A8 | 通过（正式直接方法调用） | `CompareScenarios` 与 `ComparePriority(round2_ambush)` 的firstDivergence序列化相同；onlyDeclaredSettingChanged=false。已删除临时reflection/501 fallback |
| A9 | 通过 | 三样例schema有效，owner/status排序及done/rejected折叠；kind非法、ID重复、target错误同次报出exit1；创建ID、空日期/非法日期另验 |
| A10 | 通过 | 真实系统TCP表仅127.0.0.1；三种raw路径穿越400；PUT/GET字节一致，非法PUT422保留原件；catalog/run/validate/expedition/compare与CLI字节一致；CORS、创建需求、DELETE实测 |
| A11 | 通过 | run-combat/compare两次真实CLI输出逐字节相同；requests两次生成Markdown逐字节相同。普通产品输出不读墙钟；明确输入日期只作内容元数据 |
| A12 | 通过 | [sim-cli README](../../tools/sim-cli/README.md) 有Windows/mac安装、构建、所有命令、错误码/HTTP与特例说明；[content README](../../content/README.md) 有目录、ID、样例边界 |

## 首次失败及修正

1. 首/二次默认并行构建 exit1，仅显示“0警告0错误”的失败还原；不是通过。分别保留 `work/p0_20261116/windows-build-first.txt`、`outputs/p0_20261116/windows-build-second.binlog`。随后单进程诊断构建 `-m:1 -v:diag` exit0、0/0，88.78秒，原日志 `windows-build-diagnostic.txt`。前两次具体根因未实证归因。
2. 第一次完整验收在 HttpListener.Start 报 AccessDenied(5)；`outputs/p0_20261116/verification.json` 保留失败，HTTP前项目已过。改Kestrel后本地HTTP启动成功；第二次运行在读取系统TCP表时被沙箱拒绝访问，`dotnet-run2/verification.json` 保留。正常用户上下文实测系统监听地址；产品不要求提权运行。
3. `dotnet-run3-normal/verification.json` 发现 selftest `--out` 目录被通用文件输出收尾误用，exit2；修为目录命令独立结束，普通命令 `--out` 文件行为不变。
4. 同次首次报告比较发现5 JSON因普通LF归一化与原脚本CRLF不同，5 Markdown相同；未改Runtime/配置/旧档。报告写出改为原脚本特例，正式run4新目录10/10 SHA相同。首次新输出保留在 `dotnet-run3-normal/reports-cli/`。
5. HTTP补证辅助记录：run5的完整TCP响应曾经过文本LF helper，不能当完整原始TCP字节；run6已改直接保存byte[]，但PS5 Start-Process的ExitCode返回null，未当作可用退出码原件。run7用PS7 ProcessStartInfo准确捕获0退出，正文/TCP字节直接保存。旧补证目录全部保留；这些辅助脚手架问题不改产品逻辑。
6. 独立复核发现run4旧采集器5个stderr文件/hash不一致，原因和替代证据已在上文明确；不是产品错误返回被修改。采集器修为原始byte流；只build验证器0警告0错误并运行5错误路径，新10流hash全部匹配。普通产品JSON/LF规范保持不变。

## 真实Unity执行与诊断边界

唯一执行目录 `outputs/p0_20261116/unity_batch_01/`。EditMode拥有PID18780，UTC04:53:39.649–04:54:27.433；A6拥有PID46388，04:54:28.206–04:54:38.905，串行无重叠，均实际exit0。XML258/258及新增16/16通过；A6 19/19配置、21对真实导出日志和19组完整报告一致。19原文件、19往返文件、P0-C九文件前后物理hash未变；不是用静态编译代替Editor。

两批尾部存在 `abort_threads: Failed aborting ... mono_thread_manage will ignore it`（EditMode日志874/876/878/880行；A6日志564/566/568/570行）。A6另有 `debugger-agent: Unable to listen on 3808`（572行）及 `~StackAllocator(ALLOC_TEMP_MAIN) m_LastAlloc not NULL`（577行）。第一批已有诊断，但wrapper原fatal模式未覆盖，第二批已按原计划运行；人工收尾发现后停止全部后续Unity/重试。summary的Passed只反映当时断言/退出码，不代表诊断无害。独立审查 `outputs/p0_independent_audit_20261116/UNITY_BATCH_01_REVIEW.json`（SHA-256 `c9d97ec544905f71468590d0d2e4c36c073dccd5ee5b86e5c631666202f6fc12`）已确认A6所要求的19/21一致性、真实XML/exit/资源与来源，但未解释上述诊断；不能标“干净退出”或用Editor结果宣称Player关闭崩溃修复。

104原件清单 `unity_batch_01/ARTIFACT_MANIFEST.json` SHA-256 `f214c70fa9820781b870aabbf03c191ccd3a5e442d39bcb26f9a174d18fcfeb5`；关键原件：

| 原件 | SHA-256 |
| --- | --- |
| `UNITY_BATCH_SUMMARY.json` | `c78b29f95dfed73ec83c3e33bab8aed800d5ea96ae73fc1b6d04ffd4016bc927` |
| `POST_BATCH_VERIFICATION.json` | `bccdf3bdb9e18fc2fcb46f67434c589379aacd77f7ac58dd8e88b1a676884b97` |
| `editmode/results.xml` | `d382dbb63b5abf4de928c6d151d94ea40b78e1108a28dfe89070c28443416606` |
| `a6/result/A6_RESULTS.json` | `36ead7bfbed0b45af4e1f82976b06a7ac8365f046c0dc5656fc42934cc51de2f` |

资源与实际命令/拥有者保留在各阶段的resources/processes/editor原日志。事件查询只在拥有PID/限定时窗/Application IDs1000/1001/1002中未匹配显式PID事件，不能排除不带PID的WER或其它风险。未再启动Unity或普通Player。

## 原始来源与尚未核验

独立审计冻结：`outputs/p0_independent_audit_20261116/baseline-manifest.json`，SHA-256 `5bbb45d20355eb67ed2240a328872c0d1a85747064dfd186c926564b879fd7d7`。19配置/4 asmdef/生成器身份来自固定1706 Git blob；10报告来自本机ignored历史原件，Git树中没有这些报告，不能混写来源。

当前物理19配置中9份与Git原始字节相同，另10份原有checkout为CRLF而blob为LF、无BOM；Git无配置变更。A6 provenance保存实际物理输入hash，Git基线身份单列。最终19往返输入为 `outputs/p0_20261116/roundtrip/`；旁 `roundtrip-provenance.json` SHA-256 `21ba074bfd52e3236f0552e3c6c56089ee358d7a15102544e8f2e95949e8931c`，内容由 `UnityJson.Read<T>` 后 `Serialize` 生成（17 CombatScenario、2 CombatExpeditionConfig）。

P0-B原专项自报16纯C#探针/37报告/509保护清单的部分原始临时日志已不可访问，只能恢复摘要，不作为本会话正式可复核验收。其历史边界说明见 `outputs/helper_editor_p0/p0b_evidence_20261116_063363f9/MINIMAL_RECEIPT.md`。当前直接公开入口、19配置、10报告均已在持久目录重新实跑；新增16参数化测试已由本轮真实Unity XML核对，未抄纯C#探针冒充Editor结果。

macOS正式工程CI、最终冻结Git SHA与阶段独立审查尚未完成；Unity尾诊断保留为未解释限制。首次main commit/push工具调用在执行前被自动审批拒绝，理由为“可信用户内容未明确授权此次精确的main提交/推送目标”；没有执行提交或推送，不拆分/换通道绕过。原main提案/patch保留在 `outputs/p0_20261116/P0_COMMIT_PUSH_PROPOSAL.md` 与 `staged-p0.patch`，不作为当前新方案身份。HEAD仍为1706基线。

新方案是向全新 `codex/helper-editor-p0` 功能分支正常提交/推送，并建立无外部reviewer的Draft PR取双平台CI，不更新main或合并PR。具体可审目标与新patch见 `outputs/p0_20261116/P0_BRANCH_CI_PROPOSAL.md`。本段为执行前准备快照：同名分支已只读确认不存在，根已明确“本地可送跨平台CI”；执行前再查分支存在性并接受正常自动审批，存在或被拒即停，不覆盖、换工具/身份绕过。送CI许可不等于P0通过。

候选workflow的feature分支push不会匹配push-main条件，Draft PR的opened/synchronize/reopened事件才运行一套Windows/macOS矩阵，没有draft跳过条件。显式checkout `github.event.pull_request.head.sha`，保存实际Git HEAD、expected head、事件SHA、SDK和平台，并拒绝checkout不符；PR事件的synthetic merge SHA不能冒充已验证的功能分支提交。普通Player退出崩溃未修复；不启动普通Player、不接触Unity窗口UIAutomation，C/Opus保持暂停。
