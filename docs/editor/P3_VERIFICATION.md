# P3 独立验收

施工基线：`37825dc90b2e8dacbd6f4fdf0d54534372ee9bce`，分支 `codex/helper-editor-p3`。本报告由独立验证 owner 唯一维护。本地既定验收层已闭合：最终前端79源aggregate `86dbebfdaf57518c2bf88bed1c1a433f41199ea994114689774419b0d57a6791`、后端B003；D7获根限定性能PASS，D9获有限静态PASS。D1原生诊断仍ReviewRequired，旧普通Player退出问题未修。本报告不签整P3放行；最终候选审查、发布授权、实际远端Windows/macOS CI与根整期终审仍待完成，未执行Git/发布动作。

## D1–D10 当前分层状态

| 项 | 当前产品状态 | 必要证据与归属 |
|---|---|---|
| D1 寻路 | 内核与Windows Unity测试层通过；native ReviewRequired | A的57份原件、2500有序对/14750位置/50距离场/5障碍已独核；唯一6000.3.28f1批次84/84（新40+旧16+28）。Editor0/launcher3/outer1，不作整链clean结论。 |
| D2 首餐 | CLI/HTTP与旧核心桥接通过 | B002新根CLI首次created4、HTTP再导入no-op整库不变；近远厨粮2/7、客厨3/8，原物理输入SHA与直接旧BaseSession7/17对齐。 |
| D3 五类布局问题 | API及真实GUI功能通过 | 五种active非法编辑实际保存200、问题点击按真实camera居中、export422且非空目标整目录前后相同；真实CtrlZ+Save恢复。GUI在browser_002完整通过。 |
| D4 生产链 | API、节点/导出操作及既定链图视觉通过 | 简餐1.3333及五提示/API导出通过；GUI warning页面真实导出200、节点跳物品通过。筛选与修后最小交互由前端采集；根静态复审关闭V01/V02，动态与静态归属分开。 |
| D5 旋转 | API及真实GUI通过 | 3×2、入口{1,2}，真实R键CW90→2×3、局部入口{-1,1}；anchor(3,1)+局部(-1,1)=世界入口(2,2)。真实保存90，原定义3×2/{1,2}不变。 |
| D6 撤销重做 | 真实GUI通过 | 放置/移动/删除10步，每一步完整状态与10次真实Undo/Redo对齐；另真实50连续放置/50Undo/50Redo验证容量，未调用store写方法。 |
| D7 性能 | 根限定PASS：本机受测场景平均FPS | 最终唯一nativezoom固定5秒内371trusted=74.2Hz、293生产draw=58.6fps；旧pan59.1697按未变Canvas/renderer/非chain样式继承。最大绘制间隔38.5ms，原两轮及exit1不改，不称每帧<20ms或所有硬件保证。 |
| D8 导出 | CLI/HTTP标准通过；未变Base路径继承B003 | 四表剔draft/notes/note、HTTP与CLI重复全目标bytes相同；合法pending草稿剔除；active依赖draft、缺ID及D3失败全目标无写。GUI同时实测warning导出200/五D3导出422。 |
| D9 八图 | 根有限静态PASS | 最终套为4张0ba7布局原图+4张86db新链图，各图原source保留；V01/V02修复并关闭，低级别非阻断小地图建议保留。不是八图同版重拍或动态全验结论。 |
| D10 构建文档 | B003工程构建0W0E；86db前端checks006 build/lint0；远端CI待运行 | README公式/12格阈值与prepare-only三preset已交，根样例增量审通过。原workflow仅加portable P3两step并静态核对，实际Win/mac未运行。不称前端chunk提示或Unity/native全0warning。 |

## 已有旧核心对照

本地原件：`outputs/helper_editor_p3/verification/first_meal_001/FIRST_MEAL_BASELINE.json`。新独立小程序集直接编译现有BaseScenario/BaseSession/BaseSnapshot与现有UnityJson读取器；SDK8.0.428、build和实际执行exit0，10份输入/源码前后相同。没有产品项目引用、没有新寻路调用、没有Unity或浏览器。

原`Game/Assets/StreamingAssets/Prototype/BaseEconomy/default.json`物理892B，SHA256 `72584d098a0cf59a395295199da6f15d106e706bda77acc9bc4035bce9c70f7e`。近/远实际FirstMealTick为7/17；逐tick快照及原账本位于同目录`direct/`。物理输入字节来源与Git blob/EOL来源分开，不能拿既有Windows raw跨平台强等。此独立旧核心对照本身不含新接口；后续接口桥接结果见下节。

## B002真实后端证据

候选DLL为`work/p3_backend_build_002/sim-cli.dll`，SHA256 `15c2fddcfdf1a414fd728df21ca36032f44b2861c910aed739bbdca37db72379`；API合同SHA256 `c192cd5f6a6b0b7cf3965d9922da63adfa2a5e04a93174ec27bdab9981f37fa8`。工程`integration/build_002/BUILD_RECEIPT.json`记录实际SDK8.0.428/0警告0错误与稳定源码。下列均是独立5186、自有全新content/runtime的真实CLI/HTTP调用，不含浏览器。

`outputs/helper_editor_p3/verification/backend_001/HTTP_ACCEPTANCE.json`保留原passed=false/41条HTTP。D2完整通过；D3前三类越界/重叠/入口被堵已实际保存/check/全局拒绝/export拒绝并执行目录不变断言。第四类正确返回`spawnId=supplier/customer`和`/spawns/0、1`，而旧harness误要求每条定位必须有instanceId，故首败属于脚手架定位标准错误，不是产品失败。原结果/栈/041 request/response均保留；没有改为true。

纠正后只补未完成D3两类和此前未跑D5/D4/D8，未重跑D2或前三类。`backend_002/HTTP_ACCEPTANCE.json`真实passed=true，92条HTTP/3条命令，32对保存的全目录before/after路径/bytes/SHA守卫相同，510份Game/原输入保护源前后相同。D3同时接受真实instance/spawn，核对应JSON pointer与整数坐标；失败noWrite断言没有放松。脚本实际版本原bytes副本位于`backend_002/harness-source/`。自有后端均核精确PID/image/父PID/命令行/start/user后以保留handle SIGTERM停止，实际exitCode=null/signal=SIGTERM如实记录，停后5186无监听，不写成正常exit0。

D8的missing-ID反例是明确在隔离content文件注入无效引用后真实export422，并在finally恢复原文件bytes；不是宣称编辑器成功保存了无效引用。D4的五flag逐个在独立可恢复状态触发并真实导出成功；`no_building`还以未放入布局的建筑定义引用作正对照，不以摆放代替定义能力。

工程完成的最小旧回归在`outputs/helper_editor_p3/integration/compatibility_001/COMPATIBILITY_RECEIPT.json`，独验仅离线复核，未重复执行：5条命令、10份原stdout/stderr均按记录bytes/SHA复核；P1-only输出恰items.json+manifest.json，与接受main的原Git blob逐bytes相同（items SHA12ebb6…9903）；P2/P3混库代表round4_mage_library的原/组装report原bytes相同，日志17525B、SHAc69e101c…5f55c相同。只是一例代表，旧P2全部覆盖按未改Runtime/相关helpers继承，不冒称本期重跑17/2。

`baseline_37825_001/BASELINE_PROVENANCE.json`明确631个tracked条目、454个旧Game文件、479个选定保护blob、13项仅既有EOL差异、capture时material差异0，A新增四文件另列不冒充旧blob；19旧战斗输入单列。独验直接读已归档cat-file原bytes，以各offset重算479个SHA256及Git blob SHA1，并核上述P1两文件与对应blob完全相同。物理SHA、Gitblob SHA与LF派生SHA用途分开，不归一化运行日志来凑相等。独验收据`COMPATIBILITY_READ_REVIEW_001.json`（SHA256 `9a4bb1d1f9f5e3f1b1f8a02cdfdd048800e5f88551dc5f2389a7f0b52523bcc1`）记工程执行/独验只读复核归属与时间边界。

## B003与正式GUI证据

B003 DLL SHA256为`574a784676e8abe9c912dd83ffbe9329ec4e7731e2b8995a1c5f5902774499c1`，合同SHA256为`721b454f4a6fada831badbdd121de3008a74346157e04305d370fb2d2bdeb2e6`。相对B002的48个编译输入仅`CombatContent.cs`改变，按解析后的规则实体阻止战斗引用基地流；六个Base模块、五份schema及其余47个编译输入逐bytes相同。B01先静态发现，再实际保留修前pure/PUT200坏引用落盘，修后pure/PUT422及正常combat/flow对照；规则schema不开放aliases，未造alias正例。工程执行、独验离线核；不把B002原Base用例冒称B003重跑。根后端独审`outputs/helper_editor_p3/root_review/backend_acceptance/REVIEW.md`（SHA256 `c3ed47eba3caf027c1ed0c137d37fc7573ee2c1497faeea62f6cf6382e4baf6d`）限定通过D2/D3/D4/D5/D8后端及B01闭环。

独验`boundary_001/HTTP_ACCEPTANCE.json`在B003真实完成6组专单/共享CRUD边界：68条HTTP、34组完整目录守卫，包括canonical/alias、ETag、引用删除、严格schema、距离/12格阈值、pending需求compound。没有继续扩展API矩阵，也没有重复D2–D8宏观用例。

正式GUI使用前端79唯一文件aggregate `0ba7b98a7a5e1c9aab784512cff29c6ed7e726eadaf5b3ec2f3fc0dfb30cc39b`及B003，三个运行各自source pre/post相同。统一入口`outputs/helper_editor_p3/verification/GUI_CRITERIA_INDEX_001.json`（SHA256 `926404d5831a4fdb6049532d48f827e5d3b442875b45596d3e315cac846a633d`）记录35项原件和1634份已核request/response字节文件：814条API响应及3条实际模块响应均有原body。

- `browser_001`保留总体false：D6十步逐状态撤销重做和50步容量、D5旋转已完整通过。F03别名布局真实绘制/命中/选中并保存，建筑页配方checkbox正确、建筑修改保存后仍保原recipe alias；配方页核使用列表，未执行配方GUI编辑保存。最后使用列表的exact文本selector漏算子`code`而失败。原DOM和PNG显示`UI alias workshop saved`按钮内另有`bld_ui_alias`，离线`F03_ADJUDICATION_001.json`按原件裁定，不改原false。247/247响应body。
- `browser_002`保留总体false：D3五种active非法编辑、问题居中、保存200、导出422、非空目标全目录无写及CtrlZ恢复全部完成。末尾D4使用错误导出按钮名称而停，实际文案为“导出可用内容”。500/500响应body。
- `browser_003`只续未完D4：真实warning页面点击“导出可用内容”返回200，节点跳转物品并读到目标字段；总体true，67/67响应body。未重D3/D5/D6/F03。

三次均无page error，owned Edge关闭后精确PID确认不存在；owned前后端按所持handle停止，SIGTERM/exitCode=null如实保留。以上是各次收尾时点收据，不替代未来进程核验。根前端增量独审`root_review/frontend_delta/REVIEW.md`（SHA256 `ea021c7c4c5c6c72033fa11ada837690dded16cc6f3066a2655646d3d6d26f6d`）限定关闭F01/F02/F04/F05，其当时待验F03由上述正式GUI与离线裁定补齐；不回改该历史报告。

根正式GUI独审`outputs/helper_editor_p3/root_review/formal_gui/REVIEW.md`（SHA256 `4fefb479dc902184ce1d32e570ce7eecdcc85c4b715680ad68c2240a6ce6c9de`）已关闭D3/D5/D6/F03，无未闭合实质问题。该根审另核关键35条HTTP/70份请求响应，不冒称它亲核了全部1634份流；全量流完整性核验归独验原索引。根同时确认当前86db仅chain增量，既有布局/撤销/建筑/配方操作证据可继承，不说在新aggregate重跑整套。

## D7性能与D9最终图

D7前两轮只读复核入口`outputs/helper_editor_p3/verification/D7_TWO_RUN_RAW_INDEX_001.json`（SHA256 `c345a3a48e183ab9da78da5f94db38e81ae83175ed132c87b7db6ff2eff195cd`）；前端历史统一入口`frontend/FINAL_ADDITIONAL_EVIDENCE_INDEX_001.json`（SHA256 `b289b871971c3701589a3ff36e71f4dec164a34bd401123b37fcfe3a09feba46`）。两轮均为真实128×128/300实例/距离叠加，保完整zoom/pan活动窗、原rAF/输入/生产renderedAt序列及CDP trace，未挑有利片段。首轮含人为8ms sleep，display RAF60.129而生产draw26.480/s；第二轮去掉sleep，display RAF60.308，生产draw整体44.194、原zoom29.606、pan59.170/s，原exit1保留。两轮distinct draw计数对活动前baseline的处理差异已单列，不混算。离线补充`D7_ZOOM_TIME_ATTRIBUTION_001.json`（SHA256 `2a058f1abaf680d1e8d069973360e02f32a52009c8071eef41e081ec96544090`）按实际生产绘制time将4632.4ms末帧归入zoom固定窗：其在4649.8ms才被采样读到，实际早于zoomEnd4639.6ms，所以派生为96次/29.918draw/s；不覆盖原95次/29.606或原false，且仍低于50。原生wheel约30Hz是该次实测观察，未证明库硬限30Hz；display RAF不能替代生产draw，测量截图不是DevTools界面。根当时保持未通过、不降门槛，随后只为相同实现的独立zoom给一次明确GO，没有循环调参重试。

最终唯一nativezoom索引`frontend/NATIVE_ZOOM_EVIDENCE_INDEX_001.json`（SHA256 `67c1245dd6da7d5dcf515edb7bd18b854634375d348ba83039207da3c4c0169f`）；已审脚本SHA `aa0df43c6ab0edc86c05964732768ea3efcce3d54faad0c8decf906e1c04328a`。86db+B003、1920×1080暗色、128×128/300实例/距离叠加；75Hz独立deadline的375条CDP原生wheel全部ACK、0skip、最大在途4（cap8），不是逐条等待ACK或DOM合成事件。固定页时窗`[1426.5,6426.5)`ms：实际372个trusted wheel中371个在窗内，即74.2Hz；369个约−3和3个约−6与三次合并量级一致，只有一个6426.600000009ms事件晚于窗尾。375−371不是四个窗外浏览器事件。

独验离线`D7_NATIVE_RAW_REVIEW_001.json`（SHA256 `a6d031b8fb355e73e54fc13890f7f6993d6d5c791a4b1b6910f3c34bd15ae9aa`）核21项原bytes/SHA并独算窗内293个不同生产renderedAt=58.6fps；10个500ms桶均有持续zoom变化、范围0.251127535→1.345419135未夹限，全窗采样visible/focus。已完成ACK及3rAF drain后，按绘制time归属，晚读到的窗内绘制保留、窗外绘制剔除；display RAF60仅旁证。79源before/after同、48文件全库与实际旧after-import快照相同，明确这不是虚构fresh-start dump；runtime也有before/after守卫。runner exit0、pageErrors为空、owned Edge/profile及runner收尾不存在，服务仍由前端owner保持idle。

根最终D7独审`outputs/helper_editor_p3/root_review/performance/REVIEW.md`（SHA256 `4e8c31f163c9664a41fc5bfdc17ea765f2892c32a7530ac887ab4a1549efbab0`；重算原件`ORIGINAL_HASHES_AND_RECOMPUTE.json` SHA256 `216529d2ff5585ceafca104f97e89bc842bc74cb5aada8fb3c0e5cbb9ecb53c0`）正式限定PASS：独立CDP trace也有293次生产drawFrame，旧pan59.1697依未改实现继承，二者均达到50平均FPS。本窗最大绘制间隔38.5ms，8个间隔>20ms、4个>33.34ms；不是每帧<20ms，也不承诺所有硬件/所有缩放范围。D7工作已结束，无后续补跑授权。

D9原8图`frontend/capture-base-final-001/capture.json`（SHA256 `aba605467fcf3d9eaf5dcb65cc72849b92089013323cad6320489f39fa163d44`）的PNG SHA与IHDR两尺寸已独核。根美术`outputs/helper_editor_p3/art_review/REVIEW.md`（SHA256 `1a642dbdd6ded2d541d9076c00f4e5c5f0c7a061336acb6dcb81dedbd196690f`）首轮逐图静态审核：布局4图可见范围通过；链图R1（总控V01）为1280文字过小，R2（V02）为四图右侧简餐连线穿ID正文，故首轮D9整体未通过。原八图和报告不改。前端按根授权仅修ChainView及chain局部CSS、重采4链图并最小核节点/问题操作；未重跑布局/已通过GUI/Unity。美术结论没有动态、字体网络、性能或算法验收含义。

修后79源aggregate为`86dbebfdaf57518c2bf88bed1c1a433f41199ea994114689774419b0d57a6791`；独验逐文件核SHA并重算聚合，只变ChainView.tsx/base.css。另用PostCSS AST比较所有非chain规则、声明及at-rule上下文完全相同；LayoutCanvas、LayoutEditor、renderer、geometry原bytes相同。新`frontend/capture-chain-002/capture.json`（SHA256 `bf3b58368e5703393d770da241f8de7b0e46da7b6965749048b09035aceb708f`）四图SHA/IHDR符合；原四布局图明确继承、不重拍。离线收据`CHAIN_SOURCE_INHERITANCE_REVIEW_001.json`（SHA256 `d8e235dfcf4faee22514bfa20851b0f6f83a6f8272ca299bb99984d2df40782f`）支持源码/元数据与既有GUI、pan证据继承。根美术`art_review/DELTA_REVIEW_002.md`（SHA256 `11fe74a834582ccb69e4ca48f5eeb777c420a497e97b58b00bc20d70e42a1b9c`）实看新四图后关闭V01/V02、D9有限静态PASS。最终`art_review/FINAL_EIGHT_IMAGES.json`（SHA256 `1379e7472e8d9653c4de3a78107ab7aec8ea77b5cd598148e0842b281a627d5a`）明确4旧layout+4新chain；小图minimap仅压右节点底部空白/底边为非阻断建议，未扩修或新增截图。

前端最终组合点检在相同0ba7+B003上实际读到5个既有物品行及粮食详情（另有样例物品）、原default战斗真实Victory（13 actions、WAIT200）及map→production→items/reload。它是import后的实载/运行与只读切换点检，没有另做保存。布局/建筑真实保存以formal_gui及frontend_delta的PUT/GET/磁盘原件为证；配方保存只有已完成的API验收和通用store静态审，GUI只核列表/checkbox/usage，未补做配方编辑保存。其原runner总体exit1保留：setup的正式import会重生成`REQUESTS.md`来源说明，末尾过严整库不变守卫因此失败；import完成后的实际UI/run目录守卫相同。该归类见前端统一索引与CLASSIFICATION，不能改写成整次exit0或追加无关重测。

## 交付、操作与尚未执行的远端层

前端最终唯一交接`frontend/FRONTEND_HANDOFF_FINAL_003.md`（SHA256 `3546d093b967d85f34f6b469e8cd231d924b37e923b7881572c02cd6a71f9cd7`），最终79路径及物理SHA在`source-freeze-002.json`。工程B003构建SDK8.0.428、0W0E；前端checks006 build/lint均exit0，Vite大chunk提示不冒称零警告。`tools/sim-cli/README.md`明确CW90公式`(h-1-y,x)`、最近可达仓储最短路大于12格阈值及首餐公式；依赖未额外升级，静态设计/游戏未接入边界保留。

根样例增量审`outputs/helper_editor_p3/root_review/sample_cli/REVIEW.md`（SHA256 `53bd00be2f27808c215c3a982d2af729369a3190d572ca6363bfd35b2db1c0a4`）限定通过backend-owned prepare-only脚本及README：28路径、14条实际命令/28份原始流，clean合法可导、layout-errors五active错误硬拦且全目标不写、chain五提示同时可见但可导；已有空/非空目录均拒绝。首prepare001仅排序断言误判，原件/CORRECTION保留。该入口只读复用独验fixtures，不是再次运行验收或新寻路算法，未改变48个编译输入/DLL。

实际现场及启停见`frontend/CURRENT_PLAYGUIDE_004.md`（SHA256 `8dcd3c077e7f95aebbc4bb6e563f54ef969d2ae79fc0b9cdb8144f0adb43c9b8`）：当前由前端owner持有的`http://127.0.0.1:5175`连接B003的5187，根为`work/p3_frontend_20261117/smoke_001/content`及同级runtime；近远路由为`#/map/layout/layout_first_meal_near`、`...far`，链图为`#/production/chain`，另有此克隆已实际导入的`#/combat/trial/trial_p3_final_smoke`。18:20:35Z收尾时Edge/profile和runner已退出，Vite53412/backend74656/parent54652保持idle；这是owner的时间点收据，不是独验持续在线探测。owner retained launcher输入stop只控停自己的子进程，不能按端口或旧PID杀其它任务。

另建可复现样例使用`node tools/sim-cli/scripts/prepare-p3-review.mjs --preset clean|layout-errors|chain --out <全新work子目录> --port 5191 --ui-port 5179`，随后逐条执行stdout打印的、绑定该新根的后端/前端命令。该新5191/5179示例命令本轮未启动，不能与已运行5175/5187混称；目录存在即拒绝，换新名字恢复开局，不覆盖编辑。基础preset不自动导入战斗、不启动Unity/Player。成功输出包括`buildings.json`、`recipes.json`、`layouts.json`、`base_item_flows.json`及manifest/既有物品产物；错误preset故意阻断。

CI仅由唯一Git/工程owner在原`.github/workflows/sim-cli-p0.yml`增加两step：first-meal-check再backend-checks（D2/D3/D4/D5/D8）及always原件artifact，保原P0/P1/P2、Win/mac矩阵、SDK/Node、权限和actions。静态收据`integration/ci_integration_001/CI_STATIC_RECEIPT.json`（SHA256 `54c172d5dbcd7f52640e12eea9cf2952604bc493468236cef66f39db6f78f19e`）为YAML/PS AST及constructor参数dry，未执行oracle/build/server入口；workflow SHA256 `ffe80458244d3930ec5b1135a35103517a65e69488c7196e1e0dbd3608f1da77`。本报告不将静态适配当实际Win/mac通过；远端HEAD、run、版本和退出原件以后固定在外部receipt，不为回填未来CI号循环改报告。

独验11工具源（含first-meal oracle两源、HTTP/Browser/Boundary/Unity复现脚本和README）已正式停笔，逐路径/bytes/SHA与readonly依赖在`outputs/helper_editor_p3/verification/TOOL_SOURCE_HANDOFF_001.json`（SHA256 `8f0791a8cb8ba9c81bbf0b89c8ed83c32aa932bece229abff3c1c8a7a2621351`，11源aggregate `5cfb0a241e05fd43cdfac85c1fef67120d452abce265c29bf751d477e82fec69`）。portable子集仅真实first-meal与后端HTTP，不含Browser/Unity/FPS；Windows需实际PowerShell7，POSIX exact-PID ps分支仅静态核到，macOS实际待CI。最终中央doc作为第12路径另交唯一Gitowner；outputs/work/cache/private Unity raw不入公开源码。冻结时应按这12路径、前端79源、B003构建清单、A四新增源及授权workflow逐SHA核对，不把Git基线SHA当未提交产品源码SHA。

本独验owner已停止全部自有测试/服务/浏览器，历史收尾原件见GUI索引、各HTTP_ACCEPTANCE及Unity processes-after；没有再启动。所有源保护及raw只证明各次实测区间；P1/P2继承、两个P3后端候选和前端版本继承均按上述实际改动划界。本地结论与根报告完整不等于发布授权；此时尚未stage/commit/push/创建PR/远端CI，不开启后续阶段，不更新PROJECT_CONTEXT或memory。

## 导出与运行边界

源规则为`content/rules/rules_base_item_flows.json`、id=`rules_base_item_flows`，产物仍为`base_item_flows.json`。已知功能的静态建筑不强制draft；仅pending功能必须draft并关联base需求。五链flag（no_source/cycle/no_building/no_sink/non_positive_margin）不单独阻断导出；非法字段/缺ID、D3空间错误、active引用未实现draft保持硬拦。no_building检查建筑定义是否引用配方，不以布局是否摆工坊替代。

建筑、配方、布局只作设计与静态检查；旧BaseSession仍是原先x后y移动，不宣称已支持障碍运行时。P1/P2旧证据按真实源码影响面继承，必要回归另记，不重复旧全套或普通Player。

## 进程与原始证据

独验专用5176/5186、自有隔离content/export/profile；前端5175/后端5185不混用。stdout/stderr/HTTP body/账本均保存原bytes并对同一bytes算SHA，失败首件不覆盖。准备期Node REPL没有process全局导致的宿主错误已留在`preparation_001/HOST_PREPARATION_FAILURE.json`；未启动产品。改用普通Node进程后的两份JS语法检查均exit0，实际旧核心对照随后通过。这是验收宿主准备问题，不是产品失败。

## 唯一受控Unity批次

A四源冻结后，独验只读核57份证据原bytes SHA、四源与35旧文件，2500对/50同点/14750路径位置/50距离场及五障碍6、8、不可达、不可达、10步均对齐；未重跑其纯.NET套件。原件的UTF-8 BOM仅在解码JSON供解析时移除，不改原文件或原SHA。读证据时的首次BOM解析错误属于宿主准备问题，没有启动产品。

根组件审通过、新鲜owner暂停ACK及唯一GO后，`tools/editor-verification/p3/Run-P3UnityTests.ps1`（SHA256 `e6d55dd90ddaaed38587f712fe8e9d9e299d6e3e00ce463bbcb57cc75b2a0d50`）启动一次6000.3.28f1 batch/nographics EditMode，无-quit、无PlayMode/Player/重试。实际84/84 Passed：BasePathfindingTests40、BaseSessionTests16、PreparationSessionTests28；零非Passed。XML SHA256 `ae3b275a81340db09119ad0b1561f15f65c582517c6a76be8f4f700d8007b5db`。

根同次原件独审为`outputs/helper_editor_p3/root_review/unity_batch/REVIEW.md`（SHA256 `c9f67902fda9411bad3bfa2fde9ccedde99a81f5c5d8107a13094ee1ff6d81b7`），结论限定D1功能PASS/native ReviewRequired；不扩展为旧Player故障已修复。

实际Editor exit0、launcher exit3、outer recorder/tool exit1。状态为TestsPassed_Exit0_ReviewRequired；尾部4条abort_threads、1条debugger-agent端口失败、1条结构化MemoryLeaks分别保留。MemoryLeaks实际在原log第829行、字节[70077,71764)，本次native时间2026-11-16T16:38:46.008Z、phase=Immediate、allocatedMemory=33432408B；完整原文及原字节切片在`native_detail_001/NATIVE_DIAGNOSTICS.json`和`MemoryLeaks.raw`，不归并为旧warning。全log有37条模式匹配信息/诊断行，不是37个失败测试。566条源/输入/守卫pre/post完全相同；未触发控停/超时，批后processes-after实际为空。该absence是批后时间点收据，不作未来进程状态保证。root已统一release两owner；没有第二次Unity授权。

唯一离线索引：`outputs/helper_editor_p3/verification/UNITY_BATCH_REVIEW_001.md`（SHA256 `72b6f77d6e25851a0bbfb9a10a09e4f781a55d6ca59b2aa8893e8a36e4c04286`）与`UNITY_RAW_INDEX_001.json`（SHA256 `1594404bd3c2cc533c84567810e962e2785540af0035c307a70bb3e5cfd3f7cd`）。补精确native原文前的报告/索引副本保留。原summary/XML/log/stdout/stderr/resources/source前后与身份在`unity_base_pathfinding_001/`，外层命令/真实退出码/原流在`unity_launch_001/`；派生解码tail另标，不替代原log。

此前P2受控批次25/25的Editor exit0、launcher exit3、outer recorder exit1及native ReviewRequired尾诊断边界保留；该历史不证明P3新测试或旧普通Player退出故障已修复。不得为本报告复现普通Player、重试异常Editor或关闭用户其他进程。根P3整期终审、实际远端候选CI与后续阶段均未被本报告代替。
