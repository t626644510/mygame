# P3 本地 API 与数据合同

基线 `37825dc90b2e8dacbd6f4fdf0d54534372ee9bce`，本阶段仅本地施工。P3-B 工程负责本合同、sim-cli、建筑/配方/布局/物品流源数据与 schema；前端独占 `tools/editor-web/**`；独立验证独占 `tools/editor-verification/p3/**`、`P3_VERIFICATION.md`。P3-A 只新增基地寻路和指定测试。不得修改旧 `BaseSession` 或复制寻路算法。

常驻说明：**建筑与配方目前只做设计和静态检查，游戏运行时尚未接入。** 已知功能的建筑均可作为静态设计数据，不强制草稿；仅 `function=pending` 必须 `draft=true` 并有 `kind=new_building_function, owner=base, target=building:<id>` 的需求。

## 1. 源实体与校验

源文件名严格等于实体 ID。新增：

| type | 目录 / schema | 必需字段（均含 schemaVersion=1、id、name，规则文件除 name 外） |
|---|---|---|
| building | buildings / building.schema.json | description、footprint{w,h}、walkableFootprint、entrance{x,y}、function、recipeIds、workSlots、storageSlots、ownership、buildCost{cash,workTicks,materials:[{itemId,quantity}]}、draft |
| recipe | recipes / recipe.schema.json | inputs:[{itemId,quantity}]、outputs:[{itemId,quantity}]、workTicks、workerTags:string[]、draft |
| layout | layouts / layout.schema.json | width、height、movementTicksPerTile、tiles:[{x,y,kind}]、buildings:[{instanceId,buildingId,x,y,rotation,ownership}]、spawns:[{id,x,y,role}]、zones:[]、draft |
| rule（基地流） | rules/rules_base_item_flows.json / base-item-flows.schema.json | id=rules_base_item_flows、sources:[{itemId,kind,note?}]、sinks:[{itemId,kind,note?}] |

可选编辑字段：`notes:string`；建筑/配方/布局可有 `aliases:string[]`，沿用全局 ID/alias 不冲突检查。规则流的 `note` 是编辑说明，导出剔除。未知字段逐层拒绝，不以空值绕过可选对象类型。

`rule` 共用目录/CRUD 路由，但战斗规则与基地物品流是不同的规则分域。trial 的顶层或逐场 rulesId 只能引用战斗规则，纯校验/PUT及实际解析取值都按 lookup 后的 canonical 实体拒绝基地流，返回422/`rule_family`；不得只比较请求字符串。当前战斗和基地流两类规则 schema 都没有合法 aliases 字段，本期不为造测试扩 schema；规则alias正例为NotApplicable，未知aliases字段422不能冒称分域检查证据。防御判断仍使用已解析canonical ID，若以后规则metadata允许alias也不会被字面比较绕过。正常战斗规则ID和合法基地流CRUD保留。

尺寸/数量/工时/现金/坐标使用32位整数，不接受数字字符串或布尔值。footprint w/h 1–16，地图 width/height 1–256，movementTicksPerTile≥1，数量≥1，recipe workTicks≥1；现金、建筑 workTicks/workSlots/storageSlots≥0。实例/出生点坐标允许负数或超地图，交给几何问题检查，不在保存结构层禁止摆放。tiles 的 kind 仅 blocked/water，实例 rotation 仅0/90/180/270，zones 本期只能空数组。

建筑 function：workshop/storage/housing/shop/public_service/decoration/pending。只有 workshop 的 recipeIds 可以非空。建筑 ownership：public/private/both；实例 ownership：public/private。引用必须存在；物品引用按 canonical ID 或已登记 alias 解析。配方/布局的建筑及配方引用按同一注册表解析，未知实例字符串和 source 标签不能冒充定义。

结构/字段/引用错误禁止保存并返回422。**五类空间/实例归属问题允许保存布局**；问题面板通过独立 check 接口展示，export 才硬拦。pure validate-entity 与最终 PUT 共用结构验证，不将空间错误偷偷塞进 PUT 的硬门槛。

## 2. 复用 CRUD、需求和目录

沿用现有 `/api/content/{building|recipe|layout|rule}[/<id>]`，GET list 为 `[{id,path}]`，GET entity 返回原始对象与 quoted SHA256 ETag。PUT 新建 `If-None-Match:*`，更新 `If-Match:<etag>`；409 返回 current/etag，422 返回 `{ok:false,errors:[{path,field,code,message}],warnings:[]}`。compound body：`{entity,requests:[{kind,owner,target?,title,field?,body?,expected?,createdAt?}]}`，实体与新需求/Markdown 原子落盘。需求编号由服务端分配；禁止 Agent 自动分拣。

`POST /api/validate-entity {type,mode:'create'|'update',entity,requests?}` 为纯结构校验，无写；新 P3 实体不使用 P2 的 source editIntent。删除沿用 refs 保护。`GET /api/refs/<id>` 仍为原 ItemReference[]，新增 buildingId/recipeIds 和配方投入/产出、建筑造价、流规则位置；不改变旧 item/Combat 引用含义。

`POST /api/validate-content {}` 与 CLI `validate --content <root>` 扩展检查有效布局的几何问题。合法的独立 draft 仍可从导出集合剔除，不能把整个库锁住。schema 本身无效的草稿依旧是字段错误；active 定义依赖被剔除的草稿则禁止导出。

## 3. 旋转与布局检查

屏幕坐标 x 向右、y 向下。原 footprint `(w,h)` 的局部点（包括外侧入口）转换为：

| rotation | 新尺寸 | 新点 |
|---|---|---|
| 0 | w,h | x,y |
| 90 | h,w | h-1-y,x |
| 180 | w,h | w-1-x,h-1-y |
| 270 | h,w | y,w-1-x |

转换后加实例左上角坐标。3×2 的入口 `{1,2}` 顺时针90°变为2×3、局部入口 `{-1,1}`，即左侧正中；保存仍是原建筑定义和实例 `rotation:90`，不倒写 footprint。该项是 **D5**。

`POST /api/layout/check {layout:<完整未保存对象>}`；CLI `layout-check <layoutId> --content <root> [--out <file>]`。

结构有效时 HTTP200，响应：

```json
{"ok":false,"errors":[{"code":"overlap","message":"…","severity":"error","blocking":true,"entityType":"layout","entityId":"layout_first_meal_near","field":"/buildings/0","instanceId":"kitchen_01","spawnId":"","x":3,"y":2}],"warnings":[],"geometry":[{"instanceId":"kitchen_01","buildingId":"bld_legacy_kitchen","x":3,"y":2,"width":1,"height":1,"rotation":0,"entrance":{"x":3,"y":2}}]}
```

Issue 字段固定：code/message/severity(`error|warning`)/blocking/entityType/entityId/field/instanceId/spawnId/x/y，非格子问题 x/y 为 null。path 可由实体类型/ID和 field 定位；代码为 out_of_bounds/overlap/entrance_blocked/unreachable/ownership_not_allowed，均 error/blocking。far_from_storage 为 warning/非阻断；阈值是最近仓储入口的最短路 **>12格**，不是直线距离，不存进 flows 源实体。没有仓储时不凭空新增该警告。默认地形可通行，blocked/water 不通行；walkableFootprint=true 的占地不当作路障，但仍参与建筑重叠检查。

本接口依赖的建筑定义只取**当前磁盘已保存**版本；未保存的建筑表单不会隐式改变地图解析。前端应显示这一点。结构无效为422；空间问题为200的问题结果，不冒充结构错误。

## 4. 距离

`POST /api/layout/distance {layout,from:{instanceId}}` 或 `{layout,from:{x,y}}`，两种 from 互斥。响应：

```json
{"width":10,"height":5,"from":{"x":3,"y":2},"distanceField":[0],"targets":[{"kind":"spawn","id":"supplier","instanceId":"","spawnId":"supplier","x":1,"y":2,"tiles":2,"ticks":2}]}
```

distanceField 实际长度始终 width×height，索引 y×width+x；示例数组仅表示类型。目标包括全部建筑入口和出生点，稳定按 kind/id 排序。不可达 tiles=-1、ticks=-1；可达 ticks=tiles×movementTicksPerTile。起点不存在、越界或为路障返回422及字段定位，不调用核心后用默认坐标偷换。其它空间错误仍可显示距离场，只要起点有效。

唯一寻路入口是直接编译 `Prototype.BaseEconomy.BasePathfinding.FindPath/DistanceField`；不反射、不复制 BFS。P3-A 已冻结四源码/测试文件，Runtime SHA9e21a7cd1fb242504afef7774a57c09e8b7d648698db18636d7cc0a78e7a1f65；语义为 FIFO、邻居 +x/-x/+y/-y，合法同点 FindPath=[p]，不可达=[]；DistanceField 源点0、路障/不可达-1；非法参数 ArgumentException、输入不变。具体 InnerException 不作为公开验收门槛。D1 的实际 .NET/Unity 原件和原生退出限定由独立 P3_VERIFICATION 汇总，本 API 合同不替代验收报告。

## 5. 生产链

CLI `analyze-chain --content <root> [--out <file>]`，HTTP `GET /api/chain`，无写。只分析 active 集合，draft 显式列为 excludedDraftIds。返回工单原 items/recipes/cycles/graph，增加统一 issues：

```json
{"items":[{"itemId":"mat_grain","sources":[],"sinks":[],"flags":[]}],"recipes":[{"recipeId":"rcp_simple_meal","buildings":["bld_legacy_kitchen"],"inputValue":6,"outputValue":10,"workTicks":3,"valueAddedPerTick":1.3333,"flags":[]}],"cycles":[],"graph":{"nodes":[{"id":"item:mat_grain","type":"item","entityId":"mat_grain","label":"粮食","flags":[]}],"edges":[{"id":"rcp_simple_meal:input:0","source":"item:mat_grain","target":"recipe:rcp_simple_meal","itemId":"mat_grain","recipeId":"rcp_simple_meal","quantity":1}]},"issues":[],"excludedDraftIds":[]}
```

source/sink 记录含 kind/sourceType/sourceId/path/jsonPointer/quantity；数量确实未知时 null，不伪造0。来源包含显式 flows、配方产出、遭遇 publicDrops、旧出征掉落；去处包含配方投入、物品 enhancement 材料、建筑造价和显式 sinks。旧实例/装备 source 标签不因此注册定义。环按配方产出→其它配方投入的图求强连通分量（包括单配方自环），稳定排序。计算使用 decimal，保留4位小数、invariant culture；数值的 JSON 表达不受系统区域设置影响。

五flag触发条件严格沿专单 §7。根已正式裁定：**no_source/cycle/no_building/no_sink/non_positive_margin 全部 severity=warning、blocking=false，不单独阻止 export。** 这些是设计分析提示，不是缺失引用或运行时未实现错误；有意循环、暂缺链外来源、尚无建筑定义引用的合法配方均可导出。no_building 指没有建筑定义引用配方，不是布局没摆工坊。图中 no_source/no_sink/no_building/cycle 问题节点红描边；仅 non_positive_margin 用琥珀色，并显示参考值，不能误称正式利润规则。正式字段是 non_positive_margin。服务器 issues 与硬错误集合分开，客户端不得用所有flags计数禁export。

## 6. 首餐导入

CLI `import-first-meal --content <root> [--out <receipt.json>]`；HTTP `POST /api/import-first-meal {}`。只读固定 `Game/Assets/StreamingAssets/Prototype/BaseEconomy/default.json`，调用现有 BaseScenario.Validate，不接受 HTTP 任意源路径。需要已登记 mat_grain/con_simple_meal。新增缺失的 bld_legacy_kitchen、rcp_simple_meal、layout_first_meal_near/far；等价现有实体复用，不覆写；不同内容同ID原子拒绝并列具体字段差异，不静默改名。

legacy 厨房为1×1/可通行/入口0,0/workshop/配方rcp_simple_meal；布局厨房实例 kitchen_01、private，出生点 supplier/customer 读取旧坐标。near/far 读取旧 nearKitchenPosition/farKitchenPosition、地图与每格 tick；配方 grainPerMeal→1份简餐、productionTicks、cook标签。旧厨房为预置设施，没有建设价：导入的建造值0仅是明确标注的静态占位，不宣称免费建设或正式经济规则。

返回 `{ok,created:[{type,id,path}],reused:[{type,id,path}],source:{path,sha256},layoutIds:["layout_first_meal_near","layout_first_meal_far"],staticOnly:true}`。source SHA 对应实际物理旧输入，不混成 Gitblob/EOL 证明。独立 flows 例子由本期 content/rules/rules_base_item_flows.json 交付，不擅造新物品或改 P1 五定义。D2 分别检查厨粮2/7、客厨3/8；公式 `max(2*d厨粮*每格tick+productionTicks,d客厨*每格tick)` 得7/17，未新增居民运行时。

## 7. 导出与安全边界

沿用 CLI `export --content <root> --out <directory>`、HTTP `POST /api/export {}`；HTTP导出根只由 serve --export-out 固定，不收客户端路径。P1-only 根保持旧一表 manifest；出现P3数据时增加 buildings.json/recipes.json/layouts.json/base_item_flows.json，前3为 `{schemaVersion:1,<plural>:[...]}`，flow为单个规则对象。所有实体按ID稳定排序，剔draft；递归剔notes、flow note，保留真实name/description。不得把Helper需求或诊断塞进导出。

导出前完整检查字段/引用、active→draft依赖及active布局空间错误，失败时目标整个目录路径/bytes均不变。上述五链flags只随分析提示返回，不进入硬错误集合。成功仅清理上次manifest所管旧产物，保留非受管文件及meta。两次相同输入导出文件和manifest逐字节相同，不读墙钟，不靠归一化旧原件来凑hash。

前端5175/后端5185为工程可审现场；独验5176/5186使用自有独立content/export根。实际 DLL/源 manifest、PID/启动参数/owned停启回执由工程 ready 后另交；当前无新服务。Unity仅验证owner在根统一排程后受控单批，旧44+新寻路，绝不普通Player。

## 8. 默认库与问题演示

正式 content 默认只含合法 near/far 首餐布局与静态定义/flows，必须能成功导出四个新文件，不掺 active 错误验收夹具。UI 地图列表直接选 layout_first_meal_near/far；原库没导入时提供 import-first-meal 入口。五类错误在独立工作副本中从合法布局复制/编辑得到，保持 draft=false 真实触发 check 与 export422；通过重新读取原未改源或恢复字段回到同一起点。验收不能靠把错误布局设 draft 剔除来冒充 D3 通过。

链flags例子同样由独立工作副本加载/创建：例如登记 mat_moon_silk 后作为配方输入得到 no_source；有意成环、无建筑引用的合法配方可见提示且仍可导出。default库/独立演示根/恢复命令与UI打开步骤在 ready 后工程README和handoff固定，不修改P1五物品或原BaseEconomy配置凑样例。
