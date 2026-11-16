# P1 独立验收记录

日期：2026-11-16。施工依据：[P1_WORK_ORDER.md](P1_WORK_ORDER.md)。本文件由独立验收 Agent 唯一维护；后端、前端负责人提供各自证据，由本文件汇总。

**当前状态：R01–R05 已按本地实证闭环，字体有限独审与新四图美术静态复核通过；原候选 `6a613d4824580550164f86676eae552c7fd5dbf9` 本地技术终审及首轮 Windows/macOS CI 通过，必要依赖最小修复的本地增量已取得真实证据。** 旧 fonts.ready/回退字体图不冒称 Noto 通过；修后实证包含 HTTP200、实际字体 Buffer SHA 与 Face.status=loaded。依赖剩余条件性告警、ESLint EOL 和 Actions 提示另列。B8 字段数据通过但原生尾诊断保持 `ReviewRequired`。依赖与报告后续候选的必要 CI、根整期终审仍待完成；本文不宣布 P1 完成或准许合并。

## 基线与范围

- 已实际合并的 P0 基线：`84ed464d12fec3291f0cdd237dd9c4b70f37062d`。P0 的既有验收不在本次重复执行。
- 本期只验收编辑器外壳、物品和通用编辑能力。P2/P3 未放行；既有需求单样例的状态不构成授权。
- 不改旧 Runtime、旧 `StreamingAssets/Prototype` 配置、已验收玩法、装备公式或世界观。不启动普通 Player、C 候选或 Opus 审核。
- 先静态预审，再在负责人明确可审/冻结后运行相应构建、服务和浏览器检查。真实 Unity 字段核对另等根明确排程，不能由静态或 .NET 检查代替。
- 独立验收自有正式测试源路径为 `tools/editor-verification/**`；不并写 `tools/sim-cli/**` 或 `tools/editor-web/**`。本机持久证据放 `outputs/p1_20261116/verification/`，隔离夹具放 `work/p1_verification_20261116/`，各次执行使用新的子目录并保留首次失败。
- 独立验收预留前端 `5176`、后端 `5186`，内容根为隔离副本，使用自有浏览器 context/profile。前端自测的 `5175/5185` 不由独立验收操作。

## 真实物品与旧字段基线

| canonical ID | aliases | 名称 / 类型 | 依据与边界 |
| --- | --- | --- | --- |
| `expedition_ore` | `expedition-ore` | 出征矿料 / material | 战斗旧配置已有 canonical；参考价 4 为占位值，描述须注明待定 |
| `quenching_sand` | `quenching-sand` | 淬火砂 / material | `preparation.json` 的辅料；参考价 6 对应试玩采购单价 |
| `mat_grain` | 无 | 粮食 / material | 旧 `BaseEconomy/default.json` 只有 `grainUnitPrice=6`、`grainPerMeal=1`，没有物品定义 ID |
| `con_simple_meal` | 无 | 简餐 / consumable | 旧首餐按每餐 1 份计数、`mealUnitPrice=10`，没有物品定义 ID；不新造 kg 等单位字段 |
| `eq_patrol_sword` | 无 | 巡卫短剑 / equipment | `weaponName`，`stackLimit=1`；参考价 40 为占位值，描述须注明待定 |

`guard-linen-sword-001` 是 `weaponInstanceId`，不能作为物品定义或 alias。`training_weapon`、`round3_training_weapon`、`round4_training_weapon` 是旧测试来源标签，扫描应列为未登记。

强化基线是 `preparation.json` 的 `oreRequired=3`、`auxiliaryRequired=2`、`enhancementAttackBonus=4`。`PreparationSession.EnhanceEquippedWeapon` 消耗这些数量并修改 `WeaponAttackBonus`，既有 `ExpeditionSliceSession` 再投影至战斗的 `equipmentDamageBonus`。3 是耗量，不是掉落量；`round2_expedition` 两场掉落 2+3=5，强化后可剩 2；`round4_expedition` 两场各掉 1。全部为可替换试玩参数，不据此冻结正式经济规则。

独立只读解析得到矿料的 8 个旧引用位置；加入剑强化表后预计 9 个。扫描必须保留逐个 JSON Pointer，不能只依据线框示意数量：

| 旧配置 | JSON Pointer | 原值 |
| --- | --- | --- |
| `Combat/round2_expedition.json` | `/encounters/0/publicDrops/0/itemId` | `expedition_ore` |
| `Combat/round2_expedition.json` | `/encounters/1/publicDrops/0/itemId` | `expedition_ore` |
| `Combat/round4_expedition.json` | `/encounters/0/publicDrops/0/itemId` | `expedition_ore` |
| `Combat/round4_expedition.json` | `/encounters/1/publicDrops/0/itemId` | `expedition_ore` |
| `BaseEconomy/preparation.json` | `/oreItemId` | `expedition-ore` |
| `BaseEconomy/preparation.json` | `/presetExpeditionDrop/items/0/itemId` | `expedition-ore` |
| `Expedition/default.json` | `/itemMappings/0/combatItemId` | `expedition_ore` |
| `Expedition/default.json` | `/itemMappings/0/preparationItemId` | `expedition-ore` |

淬火砂的旧引用为 `BaseEconomy/preparation.json#/auxiliaryItemId`。Helper 对别名的处理不能改变现有 Runtime 的显式 `itemMappings` 桥接。

## B1–B13 验收矩阵

| 项 | 当前结果 | 独立验证方法与必须保存的证据 |
| --- | --- | --- |
| B1 数据录入 | PASS | `backend_005`：真实五文件与 CLI 全量 validate 通过，强化 3/2/+4 与原字段一致。|
| B2 旧配置扫描 | PASS | `backend_005`：真实 legacy-scan 为 registered 1 / alias 2 / unregistered 3，原字符串和位置完整，实例排除。 |
| B3 ID 规则 / 原文错误跳转 | PASS（修后） | `backend_005` 的语义 422 / 并发 409、跨实体 ID 池、nested 与通用实体回归通过。`browser_003` 实际验证重复 ID、alias、格式拒绝、已保存 ID 锁定和原文错误，首次发现错误跳转先命中备注按钮。仅修 focus 选择顺序后，`browser_focus_007` 在新源上实际点击问题：精确聚焦 `INPUT#field-baseValue`，值 -1→-1、不打开备注、整个内容目录不写。原失败保留，未降低断言。 |
| B4 引用与删除 | PASS | `backend_005`：canonical/alias 同 9 引用，DELETE 409 附表且目录不变。`browser_004`：真实详情 9 引用、旧配置只读、删除禁用并提示“被 9 处引用”。 |
| B5 粘贴 | PASS | `browser_004`：真实 CSV 10 行，8 文件正确新建、重复 ID/非法类型两行跳过；含逗号/引号的名称正确落盘。首个真实 PUT 暂缓后继续到服务，busy 时 textarea 和 6 个映射禁用，两次实际编辑尝试被阻。实际复制的错误行含表头与正确失败 ID，不含成功行；重复矿料文件没被覆盖。 |
| B6 需求单 | PASS | `backend_005` 验证缺需求/非法需求整包无写、alias target、直接/间接 draft 试跑拒绝。`browser_004`：取消能力表单和对话框内 Ctrl+S 无写；填写后随简餐原子保存 open engineering 需求与 draft，工程 Markdown 分组有该条，UI 全局导出成功并正确剔除合法 draft。 |
| B7 export | PASS（CLI/HTTP） | `backend_005`：合法 draft 剔除后其余定义导出成功；真实 notes 被剔除、递归无 notes/draft、排序、UTF-8 无 BOM/LF、manifest 每个 SHA 和 contentHash 均匹配。重复导出全目录路径/bytes 相同；非法 draft/active→draft 引用均 exit1/HTTP422 且目标全目录不变；只清理旧受管文件，.meta/二进制哨兵保持。界面全局导出按钮另随 B6 检查。 |
| B8 Unity 读取 | 字段数据 PASS；诊断 ReviewRequired | 根正式排程的唯一 Unity 6000.3.28f1 batchmode/nographics/quit 进程同批读取实际 `Game/Assets/StreamingAssets/Content/items.json` 五项及独立九项探针；分别与各自源投影/全键数组比较通过，并按 ID 和源原字节 SHA 证明正式五项与探针子集对应。实际 Editor exit0，无强停/超时/重试；Mono/debugger/allocator 等尾诊断仍未解释，整体不标干净 Passed。三份正式 Content `.meta` 由该批 Unity 自动生成。 |
| B9 冲突 | PASS | `browser_004`：两份独立物品各自实际外改磁盘→真实 409，并排显示正确差异；“我的”用冲突返回 ETag 重试、全候选正确落盘；“磁盘”不额外 PUT。两支随后再次编辑保存，If-Match 均等于解决后的新物理文件 SHA，最终落盘匹配。 |
| B10 离线 | PASS | `browser_005`：只停自有 5186，1427ms 出横幅；未保存描述保留、保存禁用；同根重启后自动恢复，真实 Ctrl+S 200 且 marker 写盘。原生 timeOrigin 前后精确相同，document 请求 1→1；保存的同文档 history 事件单列，不冒称刷新。 |
| B11 截图 | 本地 PASS（字体及依赖增量） | 原滚动/小屏实证保留，原回退字体图不满足 Noto。前端 `screenshots-font-002` 四图的字体实证、根 R05 与美术 STATIC_PASS 已闭合。依赖增量另以 dev 四态和 prod 一个 context 验证真实字体加载、CSS 原字节相同与对应 DOM 几何相同，复用已审四图，不称新依赖版本重新拍摄了四图。各层按实际执行者归属，美术动态仍未执行。 |
| B12 键盘 | PASS | `browser_006` 从独立文档和真实 ready 状态开始，仅 Tab/Enter/Ctrl+A/type/Ctrl+S 新建并实际保存物品，ID 锁定；Ctrl+K 旧 alias 搜索/Enter 跳转、Esc 关对话框/详情、可见焦点通过。无脚本 focus/fill 代替新建/保存；005 的初始化失败保留。 |
| B13 构建 | 本地增量 PASS；新依赖候选 CI 待验 | `b13_final_001` 为本文执行者的 focus 源独立 build/lint exit0；字体增量由前端 `build-font-delta-002` / `lint-font-delta-002`，依赖增量由 `dependency-delta-001` 的实际 build/lint exit0 接续。首轮 CI 两平台 npm ci/build/lint exit0 只绑定原候选 6a613d4；新依赖源 canonical6eb 的最终 head CI 另由 sole Git owner 执行，不借旧 CI 宣称已验收新依赖。README 启动顺序已核对。 |

## 证据采集约定

- 采集器自身回归已通过：`outputs/p1_20261116/verification/capture_selfcheck_001/SELF_CHECK.json`。stdout 探针含 CRLF、0xff、NUL，stderr 探针含中文与 CRLF；保存文件逐字节等于预期，保存与计算 SHA 的输入完全相同。这只验证证据管道。
- CLI、build、lint 的 stdout/stderr 同时按原始字节读取，直接保存 bytes，再对完全相同的 bytes 计算 SHA-256；解码只用于断言。禁止给证据日志套用产品 JSON 的 LF 归一化。
- HTTP 保存真实请求/响应 body 字节、方法/URL、status 和 ETag 等相关 headers。新建、更新、删除、冲突和校验错误都验证目录前后差异。
- 每次执行记录基线、实际源文件哈希、参数、cwd、工具版本、PID/启动时间和持久路径。服务只停止本次保留进程句柄所对应的 owned PID，且核对 image/user/start time；不按端口盲杀其它进程。
- 浏览器与 Unity 不并跑；不使用系统全局 UIAutomation 扫描，不操作 Unity 窗口。受控 Unity 的非零退出、超时或错误保留首次证据，先报告，不自动无界重试。
- 失败、修复、复验分别记录。所有 B 项实际通过且根独立终审之前，P1 不标完成、不合 main、不继续 P2/P3。

## 已执行记录与首次失败

当前独立后端证据：`outputs/p1_20261116/verification/backend_005/BACKEND_ACCEPTANCE.json`。实际 DLL 为 `work/p1_backend_build_003/sim-cli.dll`，SHA-256 `b5bd143a75a36ad4fdf7d4b88bed13a90286df39c8bc6281a7a07a29d09f9bbc`；合同 SHA `b06d20a4195f8805b67486c38915f9f8724890ed0106ef109ed978a7d5b92c72`。7 个阶段真实通过，所有服务停止；正式 content 与旧 Prototype 前后原字节哈希不变。源码、执行脚本、物理 DLL、请求/响应及 owned PID/image/user/start/实际参数均有清单。

| 原件目录 | 分类 | 实际结果与后续 |
| --- | --- | --- |
| `backend_001` | 采集环境限制 | B1/B2 实际通过；AppContainer 拒绝 CIM 元数据查询，因此未进入 HTTP 阶段。owned 71840 已停。改用单个 owned PID 的原生查询，`backend_002` 通过；不计为产品失败。 |
| `backend_nested_original_001` | 产品首次失败 | 原 `bed358f7…f558` DLL 对 `/equipment/unexpectedProbe` 的纯校验应 422，实际 200；533 字节请求和 51 字节响应保留在 `http/014-*`。立即停后续。后端修正后六层 unknown 的纯校验和实际 PUT 均 422 且无写。 |
| `backend_003` | 扩展覆盖后的阶段通过 | `3314b862…e0695` 通过 nested 等用例，但随后根发现 scenario Runtime 校验失联，因此不作为最终候选。 |
| `backend_004` | 验收夹具首次失败 | 合法 Runtime default clone 缺 content 实体必需的 schemaVersion，产品正确 422。只给隔离 clone 补 schemaVersion=1；旧 default 文件没改，Runtime 非法 units=[] 反例不变。 |
| `backend_005` | 当前后端复验通过 | 最终本轮 b5bd DLL 对全部新增回归通过。P0 106 项及旧 Unity 批次未重复运行。 |
| `browser_001` | 启动环境错误 | 自有 programmatic Vite 的 cwd 误设仓库根，Tailwind 未找到前端配置，未进入 App。只改验收服务 cwd 为 `tools/editor-web`，没改产品 Tailwind。raw 错误、截图、trace 保留。 |
| `browser_002` | 布局通过 / 脚手架 selector 错误 | B11 四图与布局实测通过；B3 的 bottom-status selector 匹配两个按钮而停。只收窄 selector；不是产品缺陷。 |
| `browser_003` | 产品首次失败 | 原文错误已经显示，点击问题面板后 10 秒未聚焦 `field-baseValue`。App 的混合 querySelector 按 DOM 顺序先命中字段旁备注按钮；FAILURE 原图/HTML/trace 保留，待修，不降低焦点要求。 |
| `browser_004` | 四项通过 / 无刷新判据错误 | B4/B5/B6/B9 通过。B10 恢复后已真实保存，但旧 frameNavigated 判据把 `history.replaceState` 当刷新；旧原件/落盘文件保留，改用 timeOrigin 与 document 请求数。 |
| `browser_005` | B10 通过 / 键盘初始化失败 | B10 双指标和再次保存通过；B12 hash 导航沿用上一页 saving 瞬态，首次未完成，后续 006 已以独立文档初始化补验通过。 |
| `browser_006` | B12 修正初始化后通过 | fresh document、等待数据与控件可编辑后纯键盘流程通过；未改产品以适应测试，也未注入焦点。 |
| `browser_focus_007` | B3 产品修后通过 | 仅复验原文错误跳转；新 App 精确聚焦目标 INPUT，点击前后值相同、无备注弹窗、磁盘不变。其它已过项目不重复。 |
| `unity_b8_dual_001` | B8 数据通过 / 原生诊断待审 | 唯一 Editor exit0，正式五项和九项全字段/源投影/子集桥均通过，73 源前后 SHA 同，生成三 `.meta`。整体状态 ReviewRequired；原始诊断只存本地 ignored 目录，不宣称旧 Player 退出问题已修复。 |
| `b13_final_001` | 字体修前本地构建通过 | 独立 build/lint exit0，实际执行源 canonical 为 3ab116…16522，源前后未变；不替代其后的字体增量或远端 CI。 |
| 根最终 font 审查 | 新产品问题，首推 hold | `final_review/B8_AND_B3_REVIEW.md` 在 focus007 实际 trace 发现 OTF 403。原图/trace 与 source 清单不改写，原最终 handoff001 撤回其当前验收状态；前端只修资源入口并重新提供字体/四图/构建增量。 |

浏览器冻结源绑定：官方原清单 `outputs/p1_20261116/frontend/screenshots-final-002/source.json` 的 `7f7bb51e28fa7530e95bf4e692243424f9f539275e839907002f80d954d53e13` 是原序 `path + LF + SHA + LF` 聚合，**43 entries / 27 unique files**（16 个重复 src entry 原样保留，未重写快照），每个 entry 已与物理文件 SHA 核对。package-lock 另有原始 SHA。独立脚本的 `a7986752…4098a` 使用记录顺序的 JSON 清单（src entry 另含 bytes）聚合，算法不同，不能混称另一个产品版本。

焦点修后新绑定：`outputs/p1_20261116/frontend/focus-delta-001/source.json` 的 canonical 为 `3ab116902f25ae8d493b81662e59f1f0de2ebaec900c0f319c08556d62916522`，29 个去重产品路径（含 lock）；交付 stage 清单另含验证脚本共 36 个唯一路径。相对旧清单唯一变更为 `src/App.tsx`，实际 SHA `41ae6b68d445e31dc2f27f39c3ca6d03b93de3e7512f400e799124bd13c89c93`。007 及最终 B13 均逐文件对齐；兼容旧重复清单的聚合值另列，旧 7f 快照没有被重写。

字体修后已验收源：`frontend/font-delta-001/source.json` canonical29 为 `8307b67c59b27eb0781589b101cd231eda8f87987f59ba2074c8ea5efc5b1437`，stage36 聚合 `7fb3f9c616f26bd9133c623d6f08043adf1ec42c9f46e3d755d78a2eaccdae25`。运行代码只变精确 font allowlist/build-only 原许可输出的 Vite 配置及 README，App/styles 业务不变。`outputs/p1_20261116/verification/FONT_LIMITED_REVIEW.md` 与根 `outputs/helper_editor_p1/root_review/final_review/FONT_DELTA_REVIEW.md` 已确认有限闭环；后者 SHA 为 `cecd0b8111f1e1fa32c2e5b852d814d51eda5a3b636006dc90f0c9736738137f`，212 项物理文件 bytes/SHA 核对通过。四状态实际 CDP 响应 Buffer 的执行时摘要均对应原 OTF：16,437,364B，SHA `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`；完整网络 body 未另存四份 bin，本轮有限审阅也未重新发起网络请求。`production-font-002.json` 的普通 `/assets/` 字体和原 OFL/SOURCE 构建及 HTTP200 摘要一致，构建 HTML/CSS/JS 无 `/@fs/` 或本机用户路径。旧 403、首次 inspector 缓存失败及字体修前 handoff/withdrawal 均保留。

根后端局部独立审查（不是本文执行者亲跑）：`outputs/helper_editor_p1/root_review/backend_closure/BACKEND_CLOSURE_REVIEW.md` 与 `independent_002/RESULT.json` 关闭 R01/R02。其原 40 个输入在该轮构建前后/测试后 SHA 稳定，36 HTTP、22 全目录保护和 CLI/draft/alias 反删通过；其另建 DLL 不与工程 b5bd 冒称字节相同。152 个工程证据项原 bytes/SHA 重读匹配。当前 `outputs/p1_20261116/backend/BACKEND_40_WITH_B8_ALIGNMENT.json` 将其中 39 个原源保持不变与唯一后续获准变更分开：`Game/Assets/Prototype/Editor/SimCliRoundTrip/P1ItemExportCheck.cs` 从 `135aaa4dd0767cc9993d4a36f321d14312142ea083a1f01233810bdd3c071bd3` 变为双读 reader `70272508c195e3f84b78e18e964ae8cb4a16f05f55f48abe33c763ca99726293`。物品字段定义未改，真实 API 编译和同批 formal5/probe9 实际 B8 已覆盖此测试源差异；没有把原 40 源闭环倒写为已测试新 reader，也未重跑原闭环。

根美术来源：原布局为 `outputs/helper_editor_p1/art_review/phase2-20261116T082140Z/REVIEW.md`、`MANIFEST.json`；字体修后为 `outputs/helper_editor_p1/art_review/font_delta/run-20261116T093637Z/REVIEW.md`、`MANIFEST.json`，新四图真实像素尺寸/bytes/SHA 对应并获 STATIC_PASS。只对其成功查看的归档原图给静态结论；其 CUA provider/approval timeout 与动态未执行记录单列，既不是动态通过，也不计产品失败。字体在线加载由工程网络/FontFace 原件证明，PNG 本身不替代在线测量。

静态支持检查（不算 B8）：`static_001/STATIC_CHECKS.json` 的 9 项语言/语法/故意损坏比较器检查通过；`unity_api_static_001/UNITY_REAL_API_STATIC.json` 以安装的 Unity 6000.3.28f1 真实 Engine/Editor 引用运行纯 Roslyn 编译通过，未启动 Unity.exe。

B8 实际输入与结果：主输入是实际 `Game/Assets/StreamingAssets/Content/items.json`，5 项，SHA `12ebb6d534e5eca719d93e734f9f7598e9bc17e7fa0a1f604a8cf89b5b9d9903`；探针输入是 `work/p1_verification_20261116/backend_005/b8-runtime/items.json`，9 项，SHA `2b70da733cf3bd274a82118cafdb1781dd92480878da0c53d3d17e383a7fe14a`。`unity_b8_dual_001/unity-result/` 的 formal/probe 子目录分别保存同一实际 PID 的 JsonUtility 读回原件；`semantic-comparison/B8_FORMAL_AND_PROBE_COMPARISON.json` 记录两次独立全键/源投影比较和正式五源/探针子集原 byte SHA 桥，全部通过。探针支持的是当前合法可导出字段，不声称未实现消耗效果已接入。

该批使用受控无图形参数、480s 时限和资源/停滞守卫，未请求强停；进程原 stdout/stderr 按原 bytes 保存并计算同 bytes SHA。完整日志中的未解释尾诊断只留在本地证据，保持整体 ReviewRequired，不作原因推断或自动再跑。`EDITOR_ABSENCE_CONFIRMATION.json` 在正常用户执行边界确认 0 个 Editor；`SOURCE_AND_META_POSTFLIGHT.json` 确认 73 源前后 SHA 不变并列出自动新增的 `Content.meta`、`Content/items.json.meta`、`Content/manifest.json.meta`。三份 `.meta` 均由实际 Unity 首次导入生成，未手写，原 bytes 副本已保留。

## 接口交界与后续执行入口

1. B3 语义校验和资源前提按正式合同分别真实验证：纯 create 重复 canonical/alias 为 422/无写，真正 PUT 已有 URL 配 `If-None-Match: *` 为 409/current/etag；update 自身 ID 排除与其余全局池冲突也通过。
2. 需求 target 的安全旧连字符 alias 已经 schema/服务校验接通，`item:expedition-ore` 的真实 POST 及完整内容校验通过；旧 Runtime 的显式映射和原配置未改。
3. B11 字体、修后 B13 及必要依赖的本地增量已取得实证，原候选首轮真实 CI 已通过；新依赖候选的必要 CI、根整期终审与原生尾诊断审阅仍分开记录。B3/B8/B12 已有实际证据不重跑。字段数据通过不等于进程无异常，既有普通 Player 退出崩溃仍未修复；不自动授权合 main 或 P2/P3。

## 候选发布与首轮远端 CI

候选 `6a613d4824580550164f86676eae552c7fd5dbf9` 的本地技术终审见 `outputs/helper_editor_p1/root_review/final_review/LOCAL_CANDIDATE_6a613d4_REVIEW.md`（SHA `26387c53962285a49d1218f79d12e1043fb209a946e6212b81411bc22c5376cd`）。R01–R05 已按对应局部原件关闭；本地终审不等于 P1 整期 PASS。

首推历史见 `outputs/p1_20261116/P1_PUBLICATION_APPROVAL_HISTORY.json`：第一次自动审批在 CreateProcess 前拒绝，理由为公开推送 83 文件并创建 Draft PR 属外部披露，而该审核视野尚未看到此公开目的地/载荷的明确人类授权；该次 push/PR/CI 实际均为 0。owner 随后直接核对原人类 P0–P3 授权和完整 83 文件范围，以同工具、正常用户身份及同一命令做一次补证重审，正常审批通过后实际普通 push 1 次、Draft PR 1 次、自动 CI 1 次。原拒绝、补证和成功原件分别为 `P1_PUBLICATION_AUTOREVIEW_BLOCK.json`、`P1_PUBLICATION_RESUBMISSION_EVIDENCE.json`、`P1_FIRST_PUBLICATION.json`；没有拆分执行或切换身份绕过审批。历史 P0 拒绝另存，不混计；main 写入为 0。

[Draft PR #4](https://github.com/t626644510/mygame/pull/4) 的[首轮 CI run 43844825961](https://github.com/t626644510/mygame/actions/runs/43844825961) 为 attempt1、pull_request，两个 job 均 completed/success。下载原件保存在 `outputs/p1_20261116/ci/43844825961/`：`run.json`、`jobs.json`、`artifacts.json`、`logs.zip`/解压日志、四份 artifact 原 zip/解压及 `DOWNLOAD_RECEIPTS.json`。实际重算 logs.zip SHA 为 `a68c8223df127a69a991963c7208d8999667931e6bc212935f857a253a440d15`；四份 zip 与已保存 API digest、下载回执逐一一致，P1 两平台各 7 条命令（共 14 条）的 28 份 stdout/stderr 原 bytes/SHA 也一致。

| 平台 / job | 实际 checkout 与版本 | 实际结果 |
| --- | --- | --- |
| windows-latest / `133222271170` | Windows x64；HEAD/expected 均为 `6a613d4824580550164f86676eae552c7fd5dbf9`；SDK `8.0.428`，.NET runtime `8.0.34`，Node `v24.12.0`，npm `11.6.2` | 正式 CLI/verification 构建、四 Runtime 项目 msbuild 元数据核对、原生成器及纯回归命令均 exit0；正式 .NET 构建 0 warnings/0 errors，P0 106 checks/0 fail。P1 npm ci/build/lint/真实 CLI-HTTP 命令均 exit0、无超时，七阶段 passed。job 于 `2026-11-16T10:02:46Z` 完成。 |
| macos-latest / `133222271398` | macOS arm64；HEAD/expected 均为 `6a613d4824580550164f86676eae552c7fd5dbf9`；SDK `8.0.428`，.NET runtime `8.0.34`，Node `v24.12.0`，npm `11.6.2` | 同一组构建/元数据核对/回归命令均 exit0；正式 .NET 构建 0 warnings/0 errors，P0 106 checks/0 fail。P1 npm ci/build/lint/真实 CLI-HTTP 命令均 exit0、无超时，七阶段 passed。job 于 `2026-11-16T10:02:38Z` 完成。 |

首轮原警告见 `outputs/p1_20261116/CI_43844825961_WARNINGS.json`（SHA `f32db3a5e1e4f9b056a68b84e6319b22b22b414873cd6e0427ab6aef3d02f5c2`）：两平台 `04-npm-ci.stdout` 第 7 行均报告 9 vulnerabilities（7 moderate、2 high），stderr 第 1 行为 `eslint@9.39.1` unsupported/deprecated；Actions 日志另有 Node.js 20 目标被强制运行于 Node.js 24 及 DEP0040/DEP0169 提示。整个 CI 不是 0 warnings。这是原 6a 锁文件的历史输出；后续正式判读与最小修复见下节，不改写原计数或据计数直接声称已被利用。核心汇总为 `outputs/p1_20261116/CI_43844825961_SUMMARY.json`（SHA `d5f7837701cffcf972c2a0969ef00eab464d067048cb2912f8c5629a66f27c76`），首轮无远端失败。

| artifact（同名 zip 与解压目录） | ID | zip SHA-256 |
| --- | --- | --- |
| `sim-cli-p0-windows-latest-1` | `14214154502` | `01f9d7329a749801b43c74cf9503001a5d1ee5780400c233c28e0786678334ce` |
| `sim-cli-p0-macos-latest-1` | `14215151670` | `41120f43eb353844b08747edfccb44cdc8890c3a73466e6a859e256baba5639b` |
| `helper-editor-p1-windows-latest-1` | `14215390497` | `907c6f2dff83d1932567d4fe9314339988a806a2f48bd858abc0b73829f4cf66` |
| `helper-editor-p1-macos-latest-1` | `14213888944` | `3103d92c0400ec67f88b2e694f6a256c3b41fa7cc804643bce4fa0df9f3b1095` |

各 P1 artifact 的 `CI_IDENTITY.json`、`P1_CI_RESULT.json`、`01`–`07` 命令及 `backend/BACKEND_ACCEPTANCE.json` 保存身份、版本、退出码和原始流摘要；各 P0 artifact 的 `environment.json`、命令原件和 `pure/verification.json` 对应同一实际 checkout。CI 七阶段中的 B8 仅准备输入，不执行 Unity；浏览器、键盘和唯一真实 Unity 批次仍采用各自已归档的本地实证。此处是阅读已下载原件，没有重跑本机测试、浏览器或 Unity。

根的首轮独立复核见 `outputs/helper_editor_p1/root_review/remote_ci/run-43844825961/CI_REVIEW_6a613d4.md` 与 `INDEPENDENT_ARTIFACT_AUDIT.json`：两平台、四 ZIP 及 452 份原始流回执核对通过。Mac 与旧冻结历史不同的五份 JSON 经逐键比较只有整文件 CRLF/LF 差异，解析对象、字段、值和嵌入字符串相同，不把 LF 派生比较说成原字节相同。远端字体仅有实际 build 产出日志，未另存 dist 字体的独立字节摘要；字体精确 bytes/许可/Face.loaded 沿用本地原件，不冒称 CI 已重新散列远端字体文件。

## 必要依赖增量与后续候选

正式根判读为 `outputs/helper_editor_p1/root_review/dependency_triage/DEPENDENCY_TRIAGE.md`，SHA `e599ac2a77e2e91f006beb9712f5c5f0e8905806c2a2b8d26edbd3808bf950b3`。原审计是 9 个受影响包节点、关联 15 条公告，不是 9 个独立漏洞。两个 high 根源为 Vite/PostCSS；不能以 devDependency 或绑定 127.0.0.1 豁免。Vite 的 Windows `/__open-in-editor`、恶意站点/UNC/NTLM 条件不能被 loopback 本身排除；判读未执行利用、UNC 或凭据请求，也不声称本机已被攻击。

前端唯一冻结交接为 `outputs/p1_20261116/frontend/dependency-delta-001/FINAL_DEPENDENCY_HANDOFF.md`（SHA `7263cfdebf936824b138e976349d96fd364e058438a6eb3e500006c94a60ea00`）。仅 `tools/editor-web/package.json` 与 `package-lock.json` 两个产品文件改变：精确锁定 Vite `7.3.8`、PostCSS `8.5.33`，正常解析 esbuild `0.28.2` 与对应 `@esbuild/*` 平台包。30 个 lock 节点变化只涉及 root 两个 pin 与这条必要依赖图；React、Radix、TS-ESLint 等未改，未使用 audit fix、降级、override 或大版本迁移。新 canonical29 为 `6ebda5fb26430cbe4632a554532818f4361aa0fbf3b9102a9dfc71fa5018596a`，stage36 聚合为 `dd06f6827ea69b37e43fb5df340d44e7103300bec8b48a13016017530f568aa6`，另 34 个 stage 路径原 bytes 不变。`package.json` SHA 为 `9acbfc4e7c10b2a1cf58d0e03122ae5e1cef8882af65720173c92c50725d68b3`，lock SHA 为 `6816bb96f01e587aa78497b5d5d23309b69beee7db168d9ab28b1725d964fb13`；`source.json`、`source-delta.json` 和 `git-stage-manifest.json` 保留前后对应。

该目录 `checks-index.json` 与分任务 raw 回执记录正常 install、锁定 npm ci、版本查询、build、lint、真实浏览器探针均 exit0；独立 audit JSON 命令实际 exit1，结果为 0 high、0 critical、7 moderate/total7，Vite/PostCSS 已不在受影响包节点中，不是全零告警。两个指定 registry 版本的 dist.integrity 与 lock 一致；`dependency-verification.json` 对 Vite/PostCSS 14 条公告逐项核对安装版本覆盖修复版本。剩余七节点来自 TS-ESLint/minimatch 链；公告要求攻击者控制 glob 且 optimizationLevel>=2，所见 estree 调用仅传 dot:true、minimatch 默认级别1，当前未启用 type-aware projectService，未达到所见公告条件。这是当前调用边界判断，不是一般安全保证；未做动态漏洞复现。ESLint 9.39.1 EOL 与 Actions 弃用提示仍作为维护事项保留。

`browser/results.json` 与 `browser-raw/receipt.json` 是前端的真实增量执行原件，本文仅复核原件：dev5179 的 1280×800/1920×1080 亮暗四态，加 prod4179 的 1280 亮态，共五个独立 context，均为字体 HTTP200、16,437,364B、源 SHA `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`、Noto Face loaded 与 body Noto。冻结 b5bd 后端5189仅服务隔离60项夹具；正常保存200并核落盘，baseValue=-1 返回422，实际点错误后精确聚焦 `INPUT#field-baseValue`、保留-1、无备注弹窗且原文件 bytes 不变，恢复保存200。未改正式内容或借此重跑旧 B1–B13、.NET 或 Unity。

`production-assets.json` 记录 built OTF、OFL、SOURCE 与原源物理 bytes/SHA 相同，生产网络均 HTTP200 并对应同源摘要；字体 URL 为普通 `/assets/`，构建 HTML/CSS/JS 扫描无 `/@fs/` 或本机路径。新旧 CSS 均为49,820B、SHA `f55a9ef96b94777f3e83d315cc1678e3a5c59142f09c16129164ce39279c2cd2`；四个 dev 状态及额外 prod 状态的对应 DOM 几何与 font002 记录相同，因此复用原四图，不冒称新拍四图或 JS 输出相同。自有5179/4179/5189及 Edge 在 `services-after-stop.json` 中均为空；仅对自有会话作受控停止，wrapper exit1 已明确记录，不写成干净应用退出。

根的依赖增量有限独审见 `outputs/helper_editor_p1/root_review/final_review/DEPENDENCY_DELTA_REVIEW.md`，结论 PASS，允许沿用旧四图及其余已验收行为；本报告不将该审查冒称本文执行者的新增实跑。

后续候选合并这两个必要依赖文件与准确报告，已不再是纯 docs-only。首轮 CI 只覆盖原 `6a613d4`，不冒称覆盖新依赖源码。最终 commit/run、必要 Windows/macOS CI 与根整期终审以 sole Git owner 的外部持久收据及 PR 实际状态对齐，不为回填 run 循环新增文档提交。所有首次失败、字体四份完整网络 body 未另存 bin、美术动态未执行和 B8 原生尾诊断 `ReviewRequired` 的限定保留；普通 Player 退出故障仍未修复，不合并、不推进 P2/P3。
