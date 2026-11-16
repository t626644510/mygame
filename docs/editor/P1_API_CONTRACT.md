# P1 API contract

固定开工基线：`84ed464d12fec3291f0cdd237dd9c4b70f37062d`（P0 PR #3 普通merge）。本文件归后端集成唯一维护；`P1_VERIFICATION.md` 归独立验收Agent。P1工单优先于旧线框，不延伸P2/P3玩法。

## 文件与进程所有权

- 后端集成：`tools/sim-cli/**`、`content/items/**`、必要需求单及生成汇总、`docs/editor/schemas/**`、本文；`Game/Assets/StreamingAssets/Content/**` 只由export写。
- 前端：仅 `tools/editor-web/**`。
- 独立验收：`tools/editor-verification/**`、`docs/editor/P1_VERIFICATION.md`、`outputs/p1_20261116/verification/**`及自有work夹具。其他人不并写验收文档。
- 工程开发端口：frontend5175/backend5185；独立验收：frontend5176/backend5186，各用独立content/output根。所有服务仅127.0.0.1，service PID/镜像/参数/日志在启动时另交付。Unity须根排程，浏览器审阅安排在Unity退出后。

## JSON与错误

沿用P0 UTF-8无BOM、LF、普通中文不转义。对象字段名采用camelCase；普通GET实体返回原始实体对象，不包装。列表仍为`[{id,path}]`；`item/items`等单复数均接受。

校验失败HTTP422：

```json
{"ok":false,"errors":[{"path":"items/mat_probe.json#/baseValue","field":"/baseValue","code":"minimum","message":"参考价必须为大于等于0的整数。"}],"warnings":[]}
```

`field`是RFC6901 JSON Pointer，界面按该值定位并原样显示message；`path`包含内容相对路径和pointer。无具体字段时field为空串。路径穿越/非法JSON/错误协议为400，IO失败500，未找到404。

## 实体保存与ETag

GET `/api/content/item/{id}`：body=Item，header `ETag: "<lowercase sha256 of physical file bytes>"`；跨域暴露ETag。前端原样保存/回传完整含引号的ETag。

PUT `/api/content/item/{id}`支持两种body：

```json
{"schemaVersion":1,"id":"mat_probe","aliases":[],"name":"样本","category":"material","description":"","icon":"","stackLimit":99,"baseValue":0,"tags":[],"equipment":{"slot":"","combatBonus":[],"enhancement":[]},"consumable":{"effects":[]},"draft":false}
```

```json
{"entity":{"schemaVersion":1,"id":"con_probe","aliases":[],"name":"样本","category":"consumable","description":"","icon":"","stackLimit":99,"baseValue":0,"tags":[],"equipment":{"slot":"","combatBonus":[],"enhancement":[]},"consumable":{"effects":[{"kind":"restore_hunger","note":"待实现"}]},"draft":true},"requests":[{"kind":"new_item_property","owner":"engineering","title":"恢复饥饿","body":"P1只登记，不实现效果。","expected":"","field":"consumable.effects"}]}
```

第二种是compound save：RequestDraft字段为kind/owner/title及可选body/expected/field/createdAt。target可省略，由服务端填`item:<canonicalId>`；如传入必须一致。status只能open；id由服务端分配。新item和关联需求使用同一prospective内容集校验，再一次提交；失败不写任何一方，不制造“请求目标不存在/草稿必须有需求”的循环。需求汇总也随成功创建重新生成。

| 操作 | 请求条件 | 成功 | 失败 |
| --- | --- | --- | --- |
| 新建PUT | `If-None-Match: *` | 201，ETag | URL已存在为409；缺前提为409 |
| 更新PUT | `If-Match: <GET得到的精确ETag>` | 200，ETag | stale/缺前提为409，不静默覆盖；不接受盲写wildcard |
| raw body | 上述条件 | body=保存后的Item | 422为字段错误 |
| compound body | 上述条件 | body=`{entity:Item,createdRequests:RequestRecord[]}` | 整包422/409，不部分提交 |

409冲突body：`{ok:false,code:"etag_conflict|precondition_required|already_exists",error:string,current:Item|null,etag:string}`；存在当前文件时header也回当前ETag。`保留我的`必须以当前ETag重试，若又有修改仍409；`用磁盘的`应用current，不额外覆盖磁盘。

错误优先级：JSON/路径安全→id格式与URL/body身份422→PUT资源前提409→其余schema/全局ID/引用字段422。不会用stale请求测试字段422。新建ID的提前可用性检查不替代最终写入前提。

根已确认B3/6.3交界口径：纯验证create重复ID是422；真正PUT已有同URL且If-None-Match:*是409，二者不伪装成同一操作。

## 校验、ID与能力

- GET `/api/ids/{id}` → `{exists,type,canonicalId,path,viaAlias}`。未知时exists=false，其余字符串为空，viaAlias=false。id/aliases跨所有实体目录共用唯一池；请求单REQ ID不混入实体池。
- POST `/api/validate-item` → body `{entity:Item,mode:"create"|"update",requests?:RequestDraft[]}`。纯验证，不写文件；200或422。create重复canonical/alias为422；update排除自身文件身份，但仍检查与其他实体/alias冲突。请求草稿参与prospective校验，不分配持久ID。
- POST `/api/validate-content` → body `{}`，与CLI `validate --content`相同完整校验；200或422。
- GET `/api/capabilities` → `{schemaVersion,contentTypes,itemCategories,equipmentSlots,combatBonusFields,consumableEffectKinds,exportRoot}`。contentTypes含`{id,plural,label,editable}`；P1仅item可编辑；consumableEffectKinds当前为空，不把需求单状态当作能力已实现。
- GET `/api/catalog`保持原Combat目录，combatBonusFields仍只有equipmentDamageBonus。
- 新建直接请求仍用POST `/api/requests`，保留P0字段和自动REQ分配。`item:<id-or-alias>`目标必须存在；输出target统一可由canonicalId关联。target格式允许安全的旧连字符alias。

## 引用与旧配置

CLI `refs <id> [--content dir]` / GET `/api/refs/{id}` → `[{sourceType,sourceId,path,jsonPointer,quantity,legacy,direction}]`。

- content path相对于content根；legacy path为仓库相对旧配置路径。jsonPointer为原位置，不改写旧JSON。
- direction取source/usage/mapping/reference：drops/loot/rewards/presetExpeditionDrop为source；强化materials、oreItemId/auxiliaryItemId为usage；combatItemId/preparationItemId为mapping；无法判定只标reference。UI来源/用途只分别计source/usage，不把mapping当生产来源。
- quantity只取引用对象明确的quantity，无该字段为null。oreItemId或映射端不从oreRequired反推quantity，不填0，不发明kg/unit。
- sourceType为内容实体单数类型/request，或legacy_combat/legacy_base/legacy_expedition。`legacy-scan`固定返回`{schemaVersion:1,entries:[{id,status,canonicalId,type,occurrences:[Ref]}],summary:{registered,alias,unregistered}}`；summary按distinct原字符串计。refs/legacy-scan均支持`--content`和`--out`。
- 只扫描旧字段itemId/oreItemId/auxiliaryItemId/combatItemId/preparationItemId/equipmentSourceId；weaponInstanceId不计入。legacy-scan按原字符串分组registered/alias/unregistered，附全部位置，不登记training_weapon标签。
- 矿料应观察到8个legacy位置，再加短剑强化1个内容引用，共9处；实际数量逐文件读取，round2两场2+3、round4两场1+1、preparation preset3，不能泛化。
- DELETE `/api/content/item/{id}`：有任何引用409，`{ok:false,code:"referenced",error,current,etag,refs:[...]}`，不删除；无引用可删。若提供If-Match则也核对，不允许stale删除。

## export与试跑边界

CLI：`export --content <dir> --out <dir>`；HTTP：POST `/api/export` body `{}`。HTTP不接受任意out路径；serve新增`--export-out <dir>`固定根。真实content默认到`Game/Assets/StreamingAssets/Content`；隔离content默认到其相邻runtime目录，验收应显式传隔离export-out。

先全内容校验，有错退出1/HTTP422且目标文件不变。合法draft不进入items.json；活动定义引用被排除draft时拒绝导出。items按id排序，aliases保留，去掉notes/draft等编辑元数据；equipment/consumable空默认始终存在。尚未接通bonus/effect必须draft+关联非note需求，不能靠状态标签导出/试跑。

输出items.json `{schemaVersion,items:[...]}`；manifest.json `{schemaVersion,contentHash,files:[{path,sha256,count}]}`。contentHash按有序`path + LF + sha256 + LF`串联的UTF-8字节SHA-256计算（不包含manifest自身，避免递归）。只更新自身清单文件；上次清单的过期产物才可删除，其他文件和全部.meta保持。连续导出原字节一致，无时间。

stackLimit/baseValue、combatBonus.value、enhancement.level/cash/attackBonusDelta、materials.quantity均为32-bit整数；非负字段范围0..2147483647，stack/quantity从1起。Unity读取DTO按int，不使用非法小数作为合法探针。

成功HTTP body `{ok:true,contentHash,files,exportRoot}`。新建/修改草稿定义不会改旧Runtime；试跑只拒绝实际解析到已登记draft/缺能力物品的输入引用，不因原有未登记training_weapon标签改变旧战例语义。

## 五个正式定义

expedition_ore(alias expedition-ore)、quenching_sand(alias quenching-sand)、mat_grain、con_simple_meal、eq_patrol_sword。粮食/简餐旧配置没有字符串定义ID，短剑旧实例不作alias；不伪造额外物品引用。矿参考4、短剑参考40的description注明待定；3矿/2砂/+4仅映射preparation参数，不改规则或声称正式经济平衡。
