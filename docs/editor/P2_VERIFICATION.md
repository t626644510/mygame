# P2 独立验收记录

日期：2026-11-16。唯一维护者：独立验证 Agent。固定开工基线由根提供：`2651a82322d675a077031b8bea2aec797a52cead`。

本地必须执行的C1–C14数据、交互、静态及构建证据已收口，具体执行者、版号和限制如下。根的整期最终审阅、完整公开载荷的直接确认、实际远端提交/PR/CI尚未完成；本报告不宣称整个P2或所有平台已PASS。P0/P1 PASS为继承基线，P3未启动，C仍暂停，普通Player退出故障未修复。

准备单：`outputs/helper_editor_p2/verification/preparation_20261116/P2_READ_ONLY_PREPARATION.md`。19 份原输入物理 bytes、SHA、EOL 和原始副本见同目录 `ORIGINAL_INPUTS_PHYSICAL.json` / `original-bytes/`。Git owner 的 `integration/baseline_2651/GIT_BYTE_PROVENANCE.json` 已与初始及当前物理输入逐项对齐，结果见准备目录 `PROVENANCE_ALIGNMENT_001.json`：固定基线 Game 树452个tracked blob；19输入中9份raw相同、10份仅既有CRLF/LF差异，当前19份物理SHA均未变。初始清单的待补来源状态保留为历史，不把物理SHA与Git blob或旧Windows跨平台raw混同。

| 项 | 实际状态 | 必须执行的证据 |
| --- | --- | --- |
| C1 单场往返 | B002 17/17；B004代表1/1；B011公共组装变更后17/17 Passed | 独立根 import→assemble→真实kernel；日志逐bytes同，配置/原序/初始snapshot/结果0diff。版本与触发回归的实际改动分别记录，不冒称未来HEAD |
| C2 联动往返 | B004及B011各2/2输入、4/4阶段 Passed | original与assembled各自同次真实session读取ExportEncounterLogText；逐bytes日志、配置及report相同，无重放、反射或复制carry |
| C3 技能复用 | B002首败保留；B004修后 Passed | library→area复用35技能；改值same-source报具体冲突；pressure_strike25↔18双向拒绝，全目录路径/bytes无写 |
| C4 改序对比 | 本地必备准则通过 | 独验Browser003真实键盘2→1、UI/P0 ComparePriority首分歧逐字段同、PUT200及磁盘原序落盘；008只冷读003原根，组件ready后原order与缺省pool均正确、整目录bytes未变。额外harness首败保留，不重拖 |
| C5 容量提示 | API/核心及正式UI通过 | B007/B011同源context、INT40/10及逐条GetSnapshot原文；Browser006真实INT10、分隔线在第3条前、save200/reload/恢复40，原白名单未变 |
| C6 条件编辑 | API/核心及正式UI通过 | Browser006界面构建mixed三项、operators=[and,or]、left/right，actor/target及数值真实save200/reload；不只静态JSON |
| C7 阈值单位 | API及正式UI通过 | Browser006输入35%实存0.35、后排实存2；整数2.5界面禁应用且原磁盘不写，API负例另有pure/PUT422原件 |
| C8 待实现流转 | API及正式UI通过 | Browser007无需求不落盘→combat需求compound201/pending draft/MD→真实勾选白名单/save200→run/export422且无写→UI移除依赖后export200并排除pending。合法独立draft物品及其余表成功另有API证据 |
| C9 技能读法 | 正式002静态语义/文档对齐通过 | battle初审27无阻断，根final_delta核4句建议落实、其余23不变，formatter e06与正式文档97d对齐；35池另8未充数。页面effective由来源context/前端R02定点及实际UI另证，不宣称全27逐场动态已测 |
| C10 站位 | API及正式UI通过 | Browser006真实拖入已占格拒绝、第7敌人拒绝、合法6人save200且无位置覆盖；API pure/PUT422整目录无写另证 |
| C11 日志联动 | 正式UI及核心对照通过 | Browser006实际run/report及2330 bytes原日志同核心；选中步的全部attempt/reason/candidates逐原文相同，单步只本地展开不重run，跳到正确角色/指令且实际高亮与focus，无harness注焦点 |
| C12 八图 | 前端实际采集、根有限证据/艺术静态审通过 | 8原PNG覆盖两尺寸亮暗×角色/试炼，4补图关闭顶部与来源卡缺口；根核版本/像素/trace，艺术8+4为静态结论，不冒称艺术动态交互已执行，不重复拍8图 |
| C13 响应 | 最新final61+B012一次实测通过 | 独验c13_final_001复用前端已验原测量脚本，pristine R4正常页/字体ready后唯一run：handler→commit+两RAF 94.4ms；automation上界143.1ms单列，trace仅1次run200。旧51.2ms保历史，不替代最新版本 |
| C14 构建 | 最终本地源build/lint及README通过；远端Pending | B012 SDK8.0.428 exit0/0警告0错误/sourceStable；frontend risk-fix-checks-003 final61 build/lint均exit0；两README已更新。前端build stderr有npm更新notice，不写整链0warn。提交/PR/CI因审批gate未执行，不记跨平台已过 |

规则路径统一 `content/rules/rules_combat.json`，filename=id不放宽。规则UI只读；新global默认不广播覆盖旧导入。角色预览必须与实际trial使用相同来源context，多解明确报错。

已授权独立源仅 `tools/editor-verification/**` 与本报告；后端/API/schema/content、前端及Git分别归对应owner。自有动态端口5176/5186，独立work/profile；其他owner的5175/5185和用户Edge不操作。后端可测且前端冻结后才运行对应产品检查，不对stub制造失败风暴。

所有执行保存真实命令、退出码、原始stdout/stderr/HTTP/log bytes及同bytes SHA，source/input前后与版本manifest递增。产品、harness、环境、规格待定分别分类；首败不覆盖。P1全套/旧Unity不重复。确需Unity时先交具体C项和唯一受控非图形批次方案，另等根排程；B8既有尾诊断ReviewRequired限定不变。

## 首次支持构建（不计C1/C14产品通过）

`outputs/helper_editor_p2/verification/oracle_build_001/ORACLE_BUILD.json`：SDK8.0.428真实确认；独立oracle首编译exit1，原因是本测试项目设置Nullable=disable而链接的原UnityJson含nullable注释，报CS8632两处。分类为harness编译配置失败，不是P2产品失败。原stdout/stderr和同bytes SHA已保留；仅将自有项目改为annotations上下文，不改原Reader/Runtime或掩盖警告。当时尚未运行产品C项，后续结果分别记录于下文。

`oracle_build_002/ORACLE_BUILD.json`：自有配置修后实际build exit0、0 warnings/0 errors；oracle DLL SHA `7ea72503ba49bec9a81ba02eaa49b23c6ece2ffcab172ad0d3e6984f52ae2002`。509条物理文件记录构建前后相同（Prototype459、旧StreamingAssets/Prototype47、额外编译源3）；这是宽范围物理快照，不冒称P0/P1的393条Git blob保护基线数量。`harness_syntax_001/RESULT.json`的4个自有MJS语法检查也真实exit0。两者只属harness支持证据，不计C1或产品C14通过。

根当前批准的Runtime例外仅战斗owner维护的 `CombatExpedition.cs` 与新 `CombatExpeditionLogTests.cs` / `.meta`；其他Runtime和原19输入仍严格保护。冻结SHA依次为 `71a6959abadc7aff53e4c66d6e5c8375ad170f70dfdb046d4602effb279d5314`、`11cbaa6019dc17c206290983adb4e7f71974a461500222330039d7c0a928fe32`、`7c4afd3b106fd4b4fe4cf6165371ce8ca86217ba7ee3cb6099efed5a2509b5b8`。`oracle_build_003`基于该真实源重新编译，exit0/0 warnings/0 errors，DLL SHA `d5abba3e89644c6a7be535d88367eeb302d2e93c40e82c93cc647b76c70866f8`；它是CLI独立oracle，不代替Unity实跑。

## 已执行的 CLI 切片

`cli_single_001` 的default/ambush与 `cli_single_002` 的其余15份，在B002 DLL `6911ee117349ec2318c96e1901af0f8d557bc607734fa6f10e61513fece70664` 上完成全部17单场。每份独立内容根，保留直接与组装配置、原始日志、snapshot、run result及每命令原始流；Game与19输入前后不变。`cli_single_002`整体报告为false，是其后C3首败，不抹掉已完成15项C1，也不把整体报告改成成功。

C3首败的命令 `cli_single_002/commands/063-c3-altered-reimport` 在技能已改值后返回泛化import_exists，未核验当前实际定义。分类为产品合同缺口；首次stdout/stderr、拒绝无写证据保留。B004 DLL `9790b3cdfa7246007a876810796660ad39ad2f1a088e187faa722fb3aa0be38d` 修复后，`cli_c3_003` 的7条真实命令通过等价复用、mage_firebolt具体冲突及pressure25↔18双向拒绝，全部拒绝前后目录路径/bytes相同。该报告两个pressure记录的id被harness展开字段覆盖，原报告未改；`CHECK_ID_ANNOTATION.json`以真实命令路径标注方向，仅修后续报告标签，不改任何断言或重复C3。

`cli_linked_004` 在同B004及上述新oracle上执行12条命令：C2两输入四阶段通过；R2两段日志为7629/4980 bytes，R4为6207/4933 bytes，original与assembled逐bytes同，完整配置及report均0diff。每一侧均为同次session的公开getter读取，未重放。另仅复验受共用空local投影影响的mage_library单场代表，17525 bytes日志、配置、snapshot、result均同；不据此声称其他16份在B004重新执行。该轮506条物理Game/旧输入记录及独立harness前后相同。所有具体SHA见各 `P2_CLI_ACCEPTANCE.json` / `COMPARISON.json`，C2typedvariant编辑三态与其他HTTP/UI项另行记录。

## 唯一受控 Unity 批次

根重新取得两侧pause ACK后明确GO，`unity_c2_observer_001` 仅启动一次6000.3.28f1 Editor PID67976，2026-11-16T12:29:35.865Z至12:30:12.009Z，真实exit0，无guard停止/超时/重试。EditMode精确过滤的实际NUnit为25 selected/25 passed/0 failed/0 skipped/0 inconclusive：15新observer、9既有Expedition、1ActualJSON。未运行全量EditMode、PlayMode或普通Player，也不拿该批代替C1/C2来源与组装日志对照。

`tests.xml` SHA `8d2dee939331795341b9a81be076bfcbec30e81cdb47e042ef6b43315347e6e6`。563条Assets/Packages/ProjectSettings及指定产物前后记录完全相同；源快照raw SHA均为 `afca17476288569ea048e8859cd007abda6091e17b64aa7c98ac11b5c8986232`。真实scoped进程快照before/after均[]。原始Editor stdout63 bytes、stderr0 bytes及Editor.log/XML同bytes SHA已复核，见 `RAW_AND_SCOPE_RECEIPT.json` / `BATCH_REVIEW.md`。

功能测试通过与原生诊断分层：尾部4条abort_threads失败及debugger-agent无法监听3720，另有shader依赖提示和structured MemoryLeaks输出，全部保留。状态为 **TestsPassed_Exit0_ReviewRequired**，launcher有意返回3，外层采集器返回1；不是NUnit失败，也不写整个批次0 warnings或旧Player问题已修。P1 B8的ReviewRequired限定继续保留；根已释放本批窗口，绝不自动启动第二Unity。

## 旧 CI fixture 的必要适配

仅根明确授权的 `tools/editor-verification/backend-checks.mjs` 一处skill_pool_owner测试造数补为合法damage技能：追加effectKind、magnitude、mpCost、baseWait、draft，原id/alias和冲突/self-update/409断言未改。旧物理SHA `16c07464716493816d44bd3baa7272e9250bd05415084d93b42e3bf8e8bc6b1b`，新SHA `26785a56ae3ab18b48894ae9e297a9b95e12d2bc4eb916fa702cf0f458de79b0`，CRLF及该处外bytes未变。`p1_fixture_adaptation_001`保留原文件/最小diff；这是新schema启用后的静态CI fixture适配，尚无旧套实跑，不记作已观测产品失败或旧套新通过。

## 已执行的 HTTP / 直接核心切片

`http_variants_001` 在B006 DLL `90cae70c68fb7dac834d57b82edb537b73f363c11d32457671f7bcb854013bdd` 上9阶段通过：57 HTTP（55个200、2个422）、6命令。18/12→本场18/14且首场原日志不变→共享20/12→删除本场固定值20/20并重读持久→再设20/14；每次保原baselineJson/sourceJson/bindings。明确0/false、set/remove/set最后意图、Runtime省略与继承、互斥422以及known-hash no-op/改后冲突无写均有原件；四个运行状态另与直接同次核心日志/report对照。不包含当时已知待修的/id纯校验入口。

`http_semantics_001` 的B007意图检查通过：非法/id intent纯校验422与fresh PUT422、完整无写；合法无intent校验200/create201/delete200。其后首败是harness把GetAvailableActions原CopyAction字段当作NormalizeActionDefinition输出：空串与single/legacy比较入口错误，非产品错误。原整体false保留，`TRIAGE.json`说明；oracle005只新增公开Normalize直出，exit0/0 warnings/0 errors，DLL SHA `fddd2d9c6c960923dbb47acba45e0847661488f2c2482757ef57c0ddb3d23cc2`，不改Game/原Reader。

`http_semantics_002` 在B007 `d25ce73672c814f141964c7f390f4cd6a5f99ef82ad7b481867a46de37998693` 上只补未完12阶段，75 HTTP（61个200、14个422）、14命令全部通过。resolvedActions与直接Normalize完整字段相同且S0 raw不变；无关global规则不广播，来源场景预算0走同核心fallback、调用预算0拒绝；共享角色无context多解422，指定两场preview与trial同resolver且逐行GetSnapshot/GetAvailableActions原文相同。slots/encounters重排按稳定ID保来源/局部动作并正确修改指定角色HP；INT40/10容量、mixed左右括号、0.35/row2、2.5无写拒绝、未学技能不因指令获得、同格/第7敌人pure+PUT拒绝均已实跑。它们仍是API层，不替代实际UI操作。

`http_export_001` 的B007首败为真实产品缺口：CLI export-scenario --out先写纯Runtime4435 bytes（SHA `b133be96980acd68994aabe122609af548b448bd4d620677298a4c7c19402e81`），之后被261 bytes的receipt覆盖。原CLI/HTTP/产物全保；此前合法独立draft物品剔除、原5items SHA `12ebb6d534e5eca719d93e734f9f7598e9bc17e7fa0a1f604a8cf89b5b9d9903`、新四表重复导出及HTTP/CLI global导出同bytes已实际过，不重写整体false。

B009 DLL `8b19abfc9e06f40433e6ed8ff55d65a0fe3b1e5e20a8a71f273123f8e3d70d2c` 的 `http_export_002` 修后纯Runtime CLI产物、receipt SHA及直接内核日志已过。四类typed引用/DELETE409、错类型422、pending无需求422→原子compound201/open combat需求/Markdown、合法未引用draft剔除后其他表成功、实际相关run/global及单战例export422、CLIexport exit1和失败前后整个目标路径/bytes不变均已执行。恢复合法角色后export200；harness额外要求成功重存也复现保存前数字词法，因threshold0.0经JSON成为0而首败。完整JSON0diff，`TRIAGE.json`分类为额外格式断言过严；原整体false不改，所有失败时raw保护断言不放宽，也不为这个额外断言重跑37请求。

`http_equipment_001` 新测试trial遗漏显式队伍，core拒绝，归harness fixture不完整，原件保留。合法fixture修正后 `http_equipment_002` 在B009通过基础装备7、-1推导、显式0不推导、实例source标签保留而不能当物品定义、enhancement4不自动加及相关draft run/export422目标不变。后续新无来源inline角色preview的resolvedActions仍未Normalize，2动作×shared/effective×7缺省共28 missing-key，HTTP024真实200/2450 bytes SHA `dcede79b3ec28e02ab06f0723e7343af3be3be34bd9345dd3f5d58a79dcae317`；这是独立于原harness入口错误的真实产品元数据显示缺口。B011的 `http_inline_003` 只补该原反例，6HTTP/3命令通过，全部实际Normalize字段0diff；不重复已过装备阶段。

上述服务均为独立5186/隔离root/保留ChildProcess句柄，实际PID/镜像/owner/session/command在各报告中，最后均SIGTERM受控停止且portFree=true；exitCode=null不冒称正常exit0。Game/原19输入与本次harness前后快照相同。未启动用户浏览器、普通Player或另一Unity。

B011 DLL `ac453006dd904a0eac2acc2db2e4a843c7dfa43405dfde32af716d6ca3585da2`，正式合同SHA `63c6bad7716ef7f377421bc4e19f7e0f5118773a8b56f60ecc69d253cd23b9d9`。实际公共CombatAssembly/CombatRuns变更后，`cli_assembly_005` 以76真实命令重新执行17单场及两联场四阶段，全部raw日志/配置/报告0diff；这是源码实际影响触发的回归，不是归档重复。`http_projection_001` 的41HTTP/8命令通过R04根预算remove字段确实省略→同核心DTO10000/100000且场景预算与日志报告不变、R05整目标规则换绑/同源preview、R09当前场次重排及删除后的来源/pressure12保持、R08原single增场后保scenario provenance及原首场id/全部raw字段/原序/原日志，场景字段不泄到expedition根。各服务均已受控停且portFree；source/harness前后相同。

根局部独审来源另见 `outputs/helper_editor_p2/root_review/first_ui_evidence/REVIEW.md`（SHA `b54f597c82a1640f244acfe3cdb400b19ea92ed874050858a7453c35feb0c888`）与 `root_review/unity_batch/REVIEW.md`（SHA `3a45784ff539d92992132d2a28487eab40f69eb47ba19f97c9eefceb5d875188`）。前者核8图/61源/4trace与真实运行对比，font为CDP Buffer摘要加Face.loaded，未单独持久OTF HTTPbody；后者接受25/25测试层，仍明确Editor0/launcher3/outer1与原生ReviewRequired，不作整链全0或旧Player修复声明。

新增schema边界单列：`http_budget_null_001` 真实复现B011对runBudget:null纯校验200且fresh PUT200落盘，与optional object schema不符；不把null等同field absence。B012仅CombatContent的ContainsKey一行修后，`http_budget_null_002` 仅补同一pair，pure422/PUT422、完整内容目录路径bytes均未写，6HTTP含必要setup。原200/落盘和目录diff完整保留；未重复17场、四投影或其他HTTP切片。B012 DLL SHA `9905fa2a6aa785640be066cec39f5081aa71d5ee34bf613b7e6fa7c4324ed155`，其公共assembly/runs与B011相同。

C9的 `outputs/helper_editor_p2/combat_review/skill_sentences/SKILL_SENTENCE_REVIEW_20261116.md` 已对初稿27句逐句静态审，无阻断。integration唯一writer的正式 `docs/editor/P2_SKILL_SENTENCES.md` SHA `97d291d7ab1f897749939870e838cba049c2d493e0f6be86dc9623c8b6c33929`，采用前端skill-sentences-002；27原始动作不变，formatter完整SHA `e06c817b43f6e075e300346e857e9a33c594809b9b17e92b2063c5d7e2683790` 修订4句、其余23句同，35池排除其余8队友/敌人动作。`combat_review/skill_sentences/final_delta/REVIEW.md` SHA `62d73fc80cfd643d758645a59fec1b8aa4bd67ab1b80867d26e379bb49e99399` 已通过002语义/文档对齐；未重审全27或执行动态页面。中央报告不抢写句子正文，也不把该静态审当全27逐场effective动态验证。

根R01–R09：R04/05/08/09由B011四定点独验及 `root_review/backend_delta/REVIEW.md`（SHA `547071df510c83efe464f298474bf547586239970bc15d935bdfecfab3b70246`）局部闭环。前端R01/06/02/03/07的原版反例与定向修后原件由前端owner提供，根 `frontend_delta/REVIEW.md` SHA `804f9fff24f32400ddccbd84424b663616fc64ecb11521669f725aa5a46821ed` 限定通过五风险和两个可选字段入口；R01单案pre/post清单不完整，由全局快照/真实请求补证，不宣称每项均有完整独立清单。五项修后绑定418a源，最后61源 `1e1ea44812793b44606176c4bcf7f65820df00aaad8e4b4edb67f279d9f39713` 仅optional guards/pending差异，不能改称五项都在最终源再跑。可选publicDrops与ambush缺省availableActionIds崩溃另列接入问题；原反例与最终缺省池定向实证均保留，未auto hydrate或回写原缺省。唯一前端交接 `frontend/RISK_FIX_HANDOFF_001.md` SHA `95ded320572d81e88a0ca3545335204da5adbef2e0e8b275866eb9211f5797b1`。这些定向证据与下述正式C4–C11主路径分别归属。

正式独验 `browser_001` 已逐个匹配最终61源，启动阶段因录像所需本地ffmpeg缺失而停在preflight，没有进入App或执行C4–C11。Playwright实际短启自有Edge PID38056后正常close exit0；自有Vite51876/backend69604均保留句柄SIGTERM停止且端口释放。原始异常及launcher streams保存，不记产品失败或任何UI通过；继续复用既有runtime或仅保工单要求的trace/操作证据，不升级产品依赖。

## 正式界面验收与原件边界

界面验收固定final61指纹1e1e上述版本、B012 DLL及合同63c6上述版本；自有5176/5186、独立profile/内容根，未接管用户Edge。`browser_003` 的C4实际键盘拾起/目标over后2→1、未保存不写盘、UI firstDivergence与直接公开P0 ComparePriority逐字段同，卡上ordinal/actionId/targetId/WAIT对应，实际PUT200且磁盘顺序正确。它的原整体报告为false，因为harness在reload后只等toolbar就立即读取尚未挂载的指令列表；`C4_CRITERIA_REVIEW.json`保留观察范围，不改原报告。之后 `browser_c4_read_008` 直接冷开003原内容根，未seed/import/拖拽/compare/save；真实组件ready后原顺序fallback_attack→emergency_heal、核心默认pool[first_aid,basic_attack]及Helper pool仍missing均已读到，003 after=008 before=008 after整目录bytes同。008额外网络判断把允许的GET /api/requests误认写，原false保留；`C4_READ_CRITERIA_REVIEW.json`对同一批已存请求按真实method复核0个修改请求，不为改报告重开浏览器。

`browser_006` 的C11/C5/C6/C7/C10五项实际通过。C11运行报告及2330 bytes原日志SHA `8235a0510dce751c23897749cab037efdb74d80661bf4a71ff49760a8aae6b8f` 同直接核心；所选步骤1/3的全部attempts、reason和候选原文均核对，单步不追加run，跳转正确角色/指令、高亮与实际activeElement定位均由产品完成。C5真实INT10→2槽/第3条前分隔线/逐行核心原文、save200/reload再恢复40；C6左右mixed各三项条件真实save200/reload；C7输入35%→0.35、后排2，整数2.5禁应用且磁盘不动；C10真实拖到已占格和第7人均拒绝，合法6人save200且格子唯一。006原整体false仅因随后C8在点击前的同名按钮selector strict歧义，五项不被抹除，也未重跑。

`browser_007` 仅补未完C8并整体true：UI不附需求不能保存/无文件，附combat非note需求后compound201/pending草稿及Markdown；真实勾角色白名单并save200后run422，页面明确技能与角色ID，global export422目标整目录bytes未动；UI取消白名单/save200后export200并排除pending。原同名selector改为相同工具栏入口，未改产品。

所有原始false报告、trace/HTML/实际PNG不重写。browser002快键落self需等待实际Dnd状态；004是测试把已展开details再次折叠；005是立即读高亮，原FAILURE.html已显示正确highlight；006是两个同名NewSkill按钮；008是GET误分类。这些分别保TRIAGE或scope review，最终源码修正ready/披露状态/selector/method判断，不注入CSS、focus、store，不mock响应或改必要顺序断言。独立功能录像未硬求，不为其下载依赖；trace、截图、网络原bytes与磁盘原件是实际证据。

008原BROWSER_ACCEPTANCE.passed=false和launcher exit1始终保留。`READONLY_METHOD_CALIBRATION_001.json`直接对原008的140实际请求离线重判，#55 GET /api/requests不再误报；并用007实际PUT创建/角色保存、POST导入/导出以及既有真实DELETE作8个write-capable反例，均不漏判，纯POST预览/校验/试跑不误算持久写入。另4个明确标为静态method控制的HEAD/POST示例不冒称新网络。当前helper结合method与实际route；GET/HEAD/OPTIONS读，PUT/DELETE及受支持POST写路由仍识别。判定write-capable不代表422拒绝调用实际写过，所有失败修改的整目录bytes断言保持。校准及最后语法是纯离线，无新open/drag/run。

**网络数量必须区分记录与body。** `UI_RAW_BYTE_AUDIT_001.json`（SHA `389b6b139c867c0992b43fd9301c4593c490f4c22de31e49d37ec635168dea5d`）逐份重新Read Buffer核同bytes/SHA，并列全部缺失URL/原原因：003为237响应记录/218实际body，19个旧GET在reload后Playwright报NoResource；006为659/639，20个旧GET同类明确unavailable；007为336/336；008为140/140。全部39个缺失项实际method均为GET，不造空body或伪算哈希。验收关键POST/PUT/DELETE及run/compare/save/preview实际body均在并逐SHA核同，不宣称全659份body或所有传输均完整。scope结果保留这些限制，不重非关键旧GET。

## 最新版本 C13 与 C14

根因R07结果状态及公共组装有实改而要求最新性能对齐。独验 `c13_final_001` 在final61+B012的全新pristine R4根直接调用原 `tools/editor-web/verification/measure-combat-run.mjs`，未改测量算法。正常import、纯assemble、页面/字体ready后只点一次run，trace离线核仅1个POST /api/trial/run200；没有预热完整试炼，不宣称全冷后端/JIT。产品handler→结果commit+两RAF为 **94.4ms**，automation上界143.1ms独立列示，Victory/19行动/WAIT230。真实request1181 bytes SHA `a7d87073dedc2cbed89cea8dd9330879bdba94850871f3050448d1e7427cfd88`；response129921 bytes SHA `87b6cb34af7b25e721b1637874a324a92f424ef0eb8626fb5836a91a6fccb6c7`。原配置SHA99f207上述来源对应、无overrides/intents、Noto Face.loaded；fixture/前端61/Game/harness前后同bytes。旧5dc/B005的51.2ms仅作历史。只读复用现有ffmpeg，未安装/升级；单次测量保trace/video/真实帧和raw。离线初次PS检查器用了自动Matches变量而报错，未产成功收据、不计产品失败或第二次run；`inspection-002`原stdout/stderr及 `TRACE_AND_BROWSER_AFTER_002.json` 核唯一run与专用profile after[]。

C14本地最后后端 `integration/build_012/{BUILD_RESULT.json,build.stdout,build.stderr,build.binlog,sources-before.json,sources-after.json}`：实际SDK8.0.428、exit0、0警告0错误/sourceStable，CLI SHA9905上述值。前端 `frontend/risk-fix-checks-003/{build,lint}/receipt.json` 与两路原bin流：最终61源build/lint各exit0；build.stderr211 bytes为npm11.6.2→11.21.2更新notice，未执行更新，不称整链0warn。`tools/sim-cli/README.md` SHA `112626b853503fdf95535d4e514395e7a082203a2c22fa48e867d91d64e6a200`、`tools/editor-web/README.md` SHA `d53c28f3df8bc80e018051c9858eafbc603896702f668cc2fafc2966baf8c833` 已含P2说明。独立oracle及必要最后两个harness语法检查见 `oracle_build_005` / `harness_syntax_final_007`，不冒称产品又重跑。

C12的8图由前端采集，根first_ui_evidence limited核及艺术首审通过；`art_review/supplement/REVIEW.md` SHA `498bd05622c70bcd8404f18e5b3f5656740c5b333447f0b10da6fc9d175ec3e1` 逐张4补图关闭顶部与来源卡两个静态缺口。没有把静态艺术审、未入图组合或未执行的艺术动态交互标通过；后续业务修无CSS/结构视觉变更按root delta映射继承，不重拍8图。

## 缺陷、交付与最终 gate

工单外的实际缺口另列，不只统计根R01–R09：工程numeric validator首败/修复；新UI错误/id intent与pure validate/PUT意图不一致；独验C3 known-source早退；CLI --out收据覆盖（B009纯Runtime修后真核）；基础装备field/id键（B008修，独验B009非零7/显式0）；inline元数据（B011修后直接Normalize0diff）；null预算schema（B012同pair422无写）；两个合法optional字段UI接入崩溃。各原反例、修后版号与归属在上文及owner integration/frontend handoff中，不把owner的首败冒称本Agent亲跑。相反CS8632、GetAvailable/Normalize错入口、成功恢复数字词法过严、测试fixture缺队伍、缺可选ffmpeg、selector/ready/披露状态/GET判断、离线PS变量错误属于harness或环境，原件保留。所有失败导出/拒绝修改的完整目录bytes断言始终保留；只纠正成功保存后的额外数字词法要求。

稳定源码完整清单和实际物理bytes/SHA/LF来源映射交 sole Git owner，见ignored `FINAL_VERIFICATION_HANDOFF.json`。原CI7清单 `CI_SOURCE_HANDOFF_001.json` SHA `023b3edf4ecf03b17791e0515556ed94f264f34c86478520d43b0bc12d2bd47a` 中6功能源+README未改；另交10工具源，含后加C13薄包装。只有纯.NET/Node CLI子集声明跨平台CI可用；HTTP exact-owned helper及受控Unity launcher为本机工具，不冒称mac已跑。最后源码的method/fixture纠正有必要语法检查，实际业务逻辑按原raw逐run映射；未假称全最终harness入口在一遍重跑中全绿。outputs/work/cache/trace及私密原始诊断不入公开payload。

首候选72文件与中央0e99 Pending快照、自动审批拒绝原包保留不覆盖。根据soleowner固定通知，首正常发布在CreateProcess前被拒，尚无stage/commit/push/PR/CI实际执行；原拒绝见 `integration/first_candidate_001/P2_FIRST_PUBLICATION_AUTOREVIEW_BLOCK.json`。本地证据与新的完整载荷准备可继续，明确新载荷确认后才由soleowner执行Git/公开发布；本报告不实施该动作，也不把本地Windows结果写成标准Win/mac远端成功。后续实际HEAD、PR、run和根终审由外部固定收据对齐，不用反复回填run制造文档提交循环。

所有本轮自有backend/Vite和自动浏览器已按原handle/context关闭，见各service stopped/portFree、browser exact-PID afterClose以及C13专用profile after[]；它们是各次实测结束时的收据，不冒称对当前全机进程做过扫描。不会按陈旧PID/端口盲杀。唯一Unity仍是上述25项单批；Editor0、launcher3、outer1/nativeReviewRequired及普通Player旧故障均未被解释为修复。根整期终审Pending，P2未合并、P3未启动、C暂停，PROJECT_CONTEXT与记忆未写。
