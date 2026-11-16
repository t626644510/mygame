# Helper：本地内容、战斗与基地设计编辑器

开放物品定义、P2 的技能/角色/遭遇/试炼场，以及 P3 的建筑/布局/配方/物品流与生产链。战斗规则参数按 P2 工单只读展示。**建筑与配方目前只做设计和静态检查，游戏运行时尚未接入。** 校验、距离和战斗结果来自现有 C# Runtime 与 sim-cli；服务需支持 [P2 API 合同](../../docs/editor/P2_API_CONTRACT.md) 与 [P3 API 合同](../../docs/editor/P3_API_CONTRACT.md)，未接通时显示真实错误，不用模拟结果替代。

## 启动顺序

先按 [sim-cli README](../sim-cli/README.md) 安装精确的 .NET SDK **8.0.428**。前端已验证 Node **24.12.0**、npm **11.6.2**；依赖版本由 `package-lock.json` 固定。

在仓库根的第一个 PowerShell 终端启动模拟器：

```powershell
# 如果 SDK 装在 work/，把此处替换成该 dotnet.exe 的绝对路径。
$dotnet = 'dotnet'
Set-Location tools/sim-cli
& $dotnet build . -c Release -warnaserror --no-incremental -m:1
Set-Location ../..
& $dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll serve --content content --port 5185
```

再在第二个终端启动前端：

```powershell
Set-Location tools/editor-web
npm.cmd ci --cache ../../work/p1-frontend-npm-cache
npm.cmd run dev
```

打开 [http://127.0.0.1:5175/#/items](http://127.0.0.1:5175/#/items)。Vite 仅监听 `127.0.0.1`，把 `/api` 代理到 `127.0.0.1:5185`，保留 ETag 与并发条件头。端口被占时直接失败，不自动换端口。Windows 使用 `npm.cmd`，无需更改 PowerShell 执行策略。

隔离测试时，模拟器必须显式指向测试内容与导出目录：

```powershell
& $dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll serve --content work/my-test/content --export-out work/my-test/runtime --port 5186

# 在前端终端设置后启动，避免连接到正式内容。
$env:SIM_API_URL = 'http://127.0.0.1:5186'
npm.cmd run dev -- --port 5176
```

`dev-service.mjs` 是需要服务身份记录时使用的同一 Vite 入口。它在指定的本地工作目录写入 PID、实际 Node 路径、参数、启动时间和 API 地址；Ctrl+C 关闭自己的服务。

```powershell
node verification/dev-service.mjs --port 5175 --identity-dir ../../work/my-editor-service
```

## 操作

- Ctrl / Cmd+K 打开 ID、别名、名称搜索，方向键选择，Enter 打开；Esc 关闭对话框或详情。所有控件可用 Tab 到达，并有可见焦点。
- Ctrl / Cmd+S 保存。首次保存后 ID 锁定；修改显示名不会改 ID。离开未保存内容时，用页面内对话框选择保存、放弃或继续编辑。
- 校验来自 sim-cli：字段下显示后端原文，问题面板可跳到实体与字段。300ms 防抖纯校验不落盘；最终 PUT 仍重新校验并核对 ETag。
- 冲突时并排显示磁盘与本地字段。“用磁盘的”加载当前文件；“保留我的”只以收到的精确当前 ETag 重试，再次冲突仍会拦截。
- 断线后 5 秒内显示连接横幅，保留内存修改并禁用保存。模拟器恢复后自动重新连接；内容列表刷新不会覆盖当前草稿。
- 从表格粘贴支持 TSV / CSV（含引号、换行与转义引号），可手动匹配表头。逐行检查类型、数值和全局 ID；仅导入合格新行，错误行可连同表头复制后修改。
- 未实现的加成或消耗品效果必须附非备注需求，与物品原子保存为草稿。需求不会由编辑器自动分拣或派发。P0 样例状态不代表真实工作获授权。
- “导出可用内容”导出已保存的有效定义，清楚显示被排除的草稿数量。草稿本身不会进入产物；活动定义引用草稿、缺能力或其他校验错误由后端拒绝，失败不改产物。

参考价不是游戏内售价。矿料参考价 4、巡卫短剑参考价 40 尚待确认；短剑强化消耗 3 矿料、2 淬火砂与攻击增量 4 仅对应现有 preparation 测试参数。旧别名不改写旧配置，实例 ID 不登记为物品定义。

## 检查与可重放证据

```powershell
npm.cmd run build
npm.cmd run lint

# 原始 stdout/stderr 字节分开保存，receipt 内 SHA-256 对同一批字节计算。
# 必须使用尚不存在的证据目录，避免抹去失败记录。
node verification/capture-check.mjs build ../../outputs/my-editor-check/build
node verification/capture-check.mjs lint ../../outputs/my-editor-check/lint
```

浏览器脚本使用项目锁定的 Playwright。Windows 默认复用已安装的 Edge，不下载重复浏览器、不共享用户 profile；每次创建隔离 context。其他位置可设 `EDITOR_BROWSER_PATH`。截图需要一个真实模拟器服务，内容为 60 项且包含五个正式定义；脚本本身不造假数据或 mock HTTP。

```powershell
node verification/capture-ui.mjs http://127.0.0.1:5175 ../../outputs/my-editor-check/screenshots 60

# 会修改指定隔离夹具；拒绝指向正式 content/。
npm.cmd run test:browser -- http://127.0.0.1:5176 ../../work/my-test/content ../../outputs/my-editor-check/browser
```

截图脚本生成 1280×800 / 1920×1080 各亮暗四张，记录真实浏览器版本、文件哈希、页面溢出、详情宽度、表格容器滚动及虚拟行数量。交互脚本检查粘贴、需求草稿、导出排除与重复哈希、磁盘冲突双分支，以及真实浏览器键盘事件。真实进程停启的 B10 与 Unity 读取的 B8 由各自进程负责人及独立验收执行；脚本不操作 Unity，不以网络 mock 冒充停服。

构建目录、依赖、缓存和本地证据不入 Git；只提交源码、配置和依赖锁文件。完整验收以 [P1_VERIFICATION.md](../../docs/editor/P1_VERIFICATION.md) 为准。

## 实现入口

`src/api.ts` 对应 [固定 API 合同](../../docs/editor/P1_API_CONTRACT.md)，`src/store.ts` 保存当前编辑会话，`src/components/` 包含可复用表格、字段、对话框、需求、粘贴与冲突视图。React 18 / TypeScript strict / Vite、Tailwind 3、Zustand、TanStack Table + Virtual；本地 shadcn 风格按钮与 Radix Dialog、Lucide 图标。参考：[shadcn Dialog](https://ui.shadcn.com/docs/components/radix/dialog)、[TanStack Virtual](https://tanstack.com/virtual/latest/docs/framework/react/react-virtual)。

## P2 战斗编辑

从左侧“战斗”进入技能、角色、遭遇、试炼场；规则页只读。各页未保存修改保留在内存，Ctrl / Cmd+S 保存当前实体，关闭页面前仍会提示未保存修改。字段错误保持服务端原文；已有实体 ID 锁定，409 使用磁盘 / 保留我的仍遵守精确 ETag。

- “导入旧战例”读取本地 JSON 文本并原子导入。来源原文件不修改；上传文本 SHA 明确不等于未上传的文件字节证明。同 ID 不等价导入拒绝，不能用前缀把原动作 ID 自动改名。
- 角色指令从上往下尝试；拖动柄支持鼠标，也可按空格拾起、方向键移动、空格确认、Esc取消。操作菜单另有上移 / 下移。目录来自核心，条件比例显示百分比而存0–1，三项混合条件明确保存连接符与括号。核心显示与逐条 validationReason 原文可展开查看；超槽行保留，不截断。
- 角色预览必须选择唯一的试炼 / 场次规则来源。容量、已接通状态来自真实核心；actionAvailable不表示当前MP或目标条件满足。只有智力接入战斗，其他五维和 combatOverride 不由前端补公式。
- 遭遇的角色可拖到网格，或先选择模板再点击空格。槽位0、false、空状态表与缺省分别保留；新建才采用-1满值 / 装备推导哨兵。装备只用已有基础伤害加值，不投影强化等级。
- 普通技能页编辑共享定义。遭遇的“本场技能覆盖”分别显示共享、本场操作、核心实际值：继承当前共享、固定本场值、或省略Runtime字段三态互斥。删除本场固定值后继承当前共享，不能让原来源值复活。原动作ID保持不变。
- 试炼运行取当前相关候选，对比的基线严格从磁盘读取；多场比较明确仅限首场。单步和步骤选择只切换已返回记录，不重复请求战斗。时间轴 / 步骤 / attempts / candidates 的原因与效果均显示核心返回值；“跳到这条指令”使用明确绑定，不按ID前缀猜角色。
- 来源卡区分原运行ID和Helper实体ID，显示实际绑定规则、来源与预算。打开表单不补写默认，全局规则模板不覆盖已导入场景。联场逐场头字段只读；场景预算与调用预算分开。
- 角色 JSON 下载为 Helper 模板；“导出为战例”使用已保存的试炼并写到后端固定 `_exports/<trialId>.json`。草稿和缺能力依赖由服务端硬阻，合法草稿仍可从全库导出集合中剔除。

战斗实现位于 `src/features/combat/`；通用指令拖排位于 `src/components/rules/RuleList.tsx`。拖排使用精确锁定的 dnd-kit core6.3.1 / sortable10.0.0 / utilities3.2.2，沿用 [官方 sortable](https://dndkit.com/legacy/presets/sortable/overview/) 与 [keyboard sensor](https://dndkit.com/legacy/api-documentation/sensors/keyboard/) 接口；未升级React、Vite、PostCSS或ESLint链。当前依赖审计仍需保留原有TS-eslint / minimatch条件风险及ESLint9支持边界，不能把构建成功称为零漏洞。

P2的真实截图、性能与交互验收以独立 `P2_VERIFICATION.md` 及对应原件为准；开发中的页面与本README不构成验收通过声明。

## P3 地图与生产设计

地图与生产页常驻静态能力说明。工坊、仓储、住宅、商店、公共服务和装饰均可保存为普通设计数据；不因运行时尚未接入而把它们全部标成草稿。只有“其他（未实现）”建筑功能必须为草稿，并附 `base / new_building_function` 需求后原子保存。

| 地址 | 内容 |
| --- | --- |
| `#/map/building/<id>` | 建筑表单、拖动右下角调整占地、点击格子设置入口、建设成本与可做配方 |
| `#/map/layout/<id>` | 原生双层 Canvas 布局、地形笔刷、建筑实例/出生点、真实距离和问题定位 |
| `#/production/recipe/<id>` | 配方投入/产出/工时/工人标签，以及已保存版本的参考价值分析 |
| `#/production/chain` | 物品→配方→物品链，问题与相关物品筛选、点击节点打开对应编辑页 |
| `#/production/flows/rules_base_item_flows` | 链外来源与去处规则表 |

“导入首餐布局”只从后端固定的旧 `BaseEconomy/default.json` 原子生成近/远样例及预置厨房/简餐配方；等价已存在实体复用，不覆盖不等价同ID。源规则文件是 `content/rules/rules_base_item_flows.json`；导出名为 `base_item_flows.json`。旧预置厨房建设值0只是静态占位，不代表免费建设规则。

布局的检查、距离及画布始终使用**已保存的建筑定义**。未保存建筑表单不会隐式改变地图。鼠标滚轮围绕指针缩放（25%–400%），空格+拖动或中键平移；适配窗口遵守相同缩放下限。选建筑后单击放置，Shift连续放置、R顺时针旋转，Esc/右键取消。拖动实例移动，Delete删除；Ctrl/Cmd+Z撤销、Ctrl/Cmd+Shift+Z重做，每个布局会话保留100步。一次连续笔刷或一次拖动在放开指针时形成一步。

屏幕坐标x向右、y向下；90°把 `(w,h)` 变为 `(h,w)`，局部点包括外侧入口一起映射为 `(h−1−y,x)`。3×2建筑入口 `{1,2}` 转90°后是2×3、入口 `{-1,1}`，即左侧正中。建筑原占地不改写，保存实例 `rotation:90`。前端只做几何投影，不复制寻路；距离场来自后端同一 `BasePathfinding`，源点0、障碍/不可达为−1，格数与移动tick分别显示。图例按≤4/5–8/≥9格分段，另有不可达斜纹，亮暗主题各有固定颜色。

越界、重叠、入口堵塞、不可达、归属不允许仍可放下并保存，300ms防抖检查会列出实际问题；点击问题居中定位并闪烁该格。导出前先保存修改，后端对已保存的上述空间错误硬拦，失败不会改变产物。链的no_source、cycle、no_building、no_sink、non_positive_margin均为分析提示，单独出现时仍可导出；no_building检查建筑定义是否引用配方，和布局是否摆了工坊无关。非正增值标琥珀，其他问题节点红框；参考增值基于测试baseValue，不是正式价格或运行时利润。

生产图和配方数值分析对应磁盘已保存数据；未保存修改会明确提示。布局保存、409两选择、断线恢复、字段问题定位与物品/战斗页沿用同一并发保护：GET期间新输入不会被晚响应覆盖，冲突重试始终绑定原实体与精确ETag。

P3存在有效设计时，全局导出新增 `buildings.json`、`recipes.json`、`layouts.json`、`base_item_flows.json`。草稿与备注不进入产物；合法独立草稿可被剔除，不把整个库锁住。字段/真实引用错误、active依赖被剔除草稿，以及五类布局错误仍阻断。未实现居民决策、通用经济推演或P4沙盘。

实现位于 `src/features/base/`。布局没有引入画布库；链图仅使用精确锁定的 `@xyflow/react 12.12.1` 与 `dagre 0.8.5`，依赖与许可由lock/npm包固定，已有React/Vite/PostCSS/ESLint链未升级。P3的实际通过范围以独立 `P3_VERIFICATION.md` 与生产源码绑定的原始截图/性能/网络/磁盘记录为准。

正文复用仓库已跟踪的 Noto Sans CJK 字体，代码与数值使用本地 `@fontsource/jetbrains-mono`，不依赖远端字体服务。Noto 的原始许可与来源见 `Game/Assets/Prototype/Art/Fonts/OFL.txt`、`SOURCE.txt` 和仓库 `THIRD_PARTY_NOTICES.md`；依赖的许可随各 npm 包保留。开发服务器仅精确允许编辑器根与该 OTF 文件，生产构建将字体打包为普通 `/assets/` URL，并随资产保留同源 `NotoSansCJKsc-OFL.txt` / `NotoSansCJKsc-SOURCE.txt`。
