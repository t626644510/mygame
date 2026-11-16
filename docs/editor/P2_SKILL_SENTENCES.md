# P2 法师技能读法（实际导出）

本文件集成前端生成器的实际第二版输出，不由集成者续写技能说明。原配置共35个动作，筛选27个 mage_ 动作；其余8个为 `round4_ally_attack`、`round4_ally_cleanse`、`round4_ally_guard`、`round4_enemy_attack`、`round4_enemy_heavy`、`round4_enemy_lethal`、`round4_enemy_magic`、`round4_enemy_silence`，不纳入本句子表。

战斗专项初审 `outputs/helper_editor_p2/combat_review/skill_sentences/SKILL_SENTENCE_REVIEW_20261116.md` 已逐条审核第一版全部27句，未发现阻断语义错误。第二版仅采纳其中两项非阻断表述精度建议：`mage_mana_drain` 明确向施放者返还、封顶其最大MP；`mage_empower/mage_weaken/mage_mass_weaken` 明确伤害输出方向。27项原动作字段不变、其余23句逐字不变。该初审及本次集成不代表最终页面、交互、试跑或P2整期验收通过；来源场的 effective 读法由页面/接口验证另证。

实际导出来源与指纹：

| 对象 | 路径 | SHA-256 |
| --- | --- | --- |
| 实际读取的原配置 bytes | `Game/Assets/StreamingAssets/Prototype/Combat/round4_mage_library.json` | `99f2074712b85530180e16f2476579248b4ff49d09206a4310cb106288cf8942` |
| 当前生成函数 | `tools/editor-web/src/features/combat/skillSentence.ts` | `e06c817b43f6e075e300346e857e9a33c594809b9b17e92b2063c5d7e2683790` |
| 导出字段与句子表 | `outputs/helper_editor_p2/frontend/skill-sentences-002/sentences.json` | `4acf138ea63c6482695df32f5832847b667f80afe45c2eb485f4db3885e98f1f` |
| 实际导出 Markdown | `outputs/helper_editor_p2/frontend/skill-sentences-002/sentences.md` | `922f43fd458e76768b9681fe6dfbe73ad0ad2754674f079e2a1346efda11e09e` |
| 四句增量记录 | `outputs/helper_editor_p2/frontend/skill-sentences-002/delta.json` | `3f43345637477cf7c348ea3e810465431dde3d5f8284cd00c30e8f176aab7e2d` |
| 第一版27句专项初审 | `outputs/helper_editor_p2/combat_review/skill_sentences/SKILL_SENTENCE_REVIEW_20261116.md` | `b1c7aa39e1a198336562ee55302feab5b6c69be6b44d25dea7e1de45ded395a9` |

上表原配置SHA是本机导出实际读取的物理字节，不冒称其他checkout换行后的字节SHA；固定Git基线与EOL来源分开记录于验收。下面字段表来自实际sourceFields解析值，不改变字段presence，也不声称保留数值词法。句子逐字采用第二版导出的27节。

可在新目录重建导出（Node24.12.0，仓库根目录）：

```powershell
node tools/editor-web/verification/export-skill-sentences.mjs Game/Assets/StreamingAssets/Prototype/Combat/round4_mage_library.json work/p2-skill-sentences-new
```

| ID | effectKind | magnitude | mpCost | baseWait | 其余实际字段 |
| --- | --- | --- | --- | --- | --- |
| `mage_meditate` | `"restore_mp"` | `12` | `0` | `60` | `{"displayName":"冥想","targetMode":"single","isMagic":false,"damageType":"legacy"}` |
| `mage_quick_breath` | `"restore_mp"` | `4` | `0` | `25` | `{"displayName":"紧急吐纳","targetMode":"single","isMagic":false,"damageType":"legacy"}` |
| `mage_mana_transfer` | `"restore_mp"` | `8` | `8` | `35` | `{"displayName":"魔力转移","targetMode":"single","isMagic":true,"damageType":"magic"}` |
| `mage_mana_drain` | `"drain_mp"` | `8` | `0` | `45` | `{"displayName":"汲取魔力","targetMode":"single","isMagic":true,"damageType":"magic"}` |
| `mage_staff` | `"damage"` | `8` | `0` | `40` | `{"displayName":"法杖敲击","targetMode":"single","isMagic":false,"damageType":"physical"}` |
| `mage_firebolt` | `"damage"` | `28` | `8` | `40` | `{"displayName":"火弹","targetMode":"single","isMagic":true,"damageType":"magic"}` |
| `mage_arcane_lance` | `"damage"` | `45` | `16` | `70` | `{"displayName":"奥术长矛","targetMode":"single","isMagic":true,"damageType":"magic"}` |
| `mage_chain_lightning` | `"damage"` | `16` | `12` | `55` | `{"displayName":"整排雷击","targetMode":"row","isMagic":true,"damageType":"magic"}` |
| `mage_fire_rain` | `"damage"` | `14` | `14` | `65` | `{"displayName":"全体火雨","targetMode":"all","isMagic":true,"damageType":"magic"}` |
| `mage_piercing_ray` | `"damage"` | `20` | `10` | `55` | `{"displayName":"纵列射线","targetMode":"column","isMagic":true,"damageType":"magic"}` |
| `mage_first_aid` | `"heal"` | `30` | `6` | `30` | `{"displayName":"急救","targetMode":"single","isMagic":true,"damageType":"magic"}` |
| `mage_greater_heal` | `"heal"` | `60` | `12` | `60` | `{"displayName":"大治疗","targetMode":"single","isMagic":true,"damageType":"magic"}` |
| `mage_group_heal` | `"heal"` | `20` | `12` | `55` | `{"displayName":"群体恢复","targetMode":"all","isMagic":true,"damageType":"magic"}` |
| `mage_stone_skin` | `"apply_status"` | `1` | `4` | `25` | `{"displayName":"石肤护盾","targetMode":"single","isMagic":true,"damageType":"magic","statusId":"mage_stone_skin_state","statusKind":"guard","statusMagnitude":6,"statusDuration":80}` |
| `mage_mass_guard` | `"apply_status"` | `1` | `12` | `55` | `{"displayName":"群体护盾","targetMode":"all","isMagic":true,"damageType":"magic","statusId":"mage_mass_guard_state","statusKind":"guard","statusMagnitude":4,"statusDuration":100}` |
| `mage_magic_barrier` | `"apply_status"` | `1` | `5` | `30` | `{"displayName":"魔法屏障","targetMode":"single","isMagic":true,"damageType":"magic","statusId":"mage_magic_barrier_state","statusKind":"magic_guard","statusMagnitude":10,"statusDuration":100}` |
| `mage_empower` | `"apply_status"` | `1` | `6` | `35` | `{"displayName":"魔力增幅","targetMode":"single","isMagic":true,"damageType":"magic","statusId":"mage_empower_state","statusKind":"empowered","statusMagnitude":10,"statusDuration":100}` |
| `mage_focus_mark` | `"apply_status"` | `1` | `3` | `25` | `{"displayName":"易伤标记","targetMode":"single","isMagic":true,"damageType":"magic","statusId":"mage_focus_mark_state","statusKind":"vulnerable","statusMagnitude":0,"statusDuration":150}` |
| `mage_cleanse` | `"cleanse"` | `1` | `4` | `25` | `{"displayName":"净化","targetMode":"single","isMagic":true,"damageType":"magic"}` |
| `mage_group_cleanse` | `"cleanse"` | `1` | `12` | `60` | `{"displayName":"广域净化","targetMode":"all","isMagic":true,"damageType":"magic"}` |
| `mage_dispel` | `"dispel"` | `1` | `5` | `35` | `{"displayName":"驱散","targetMode":"single","isMagic":true,"damageType":"magic"}` |
| `mage_freeze` | `"apply_status"` | `1` | `8` | `25` | `{"displayName":"冰缚","targetMode":"single","isMagic":true,"damageType":"magic","statusId":"mage_freeze_state","statusKind":"stunned","statusMagnitude":0,"statusDuration":70}` |
| `mage_silence` | `"apply_status"` | `1` | `6` | `35` | `{"displayName":"沉默","targetMode":"single","isMagic":true,"damageType":"magic","statusId":"mage_silence_state","statusKind":"silenced","statusMagnitude":0,"statusDuration":80}` |
| `mage_weaken` | `"apply_status"` | `1` | `6` | `35` | `{"displayName":"虚弱","targetMode":"single","isMagic":true,"damageType":"magic","statusId":"mage_weaken_state","statusKind":"weakened","statusMagnitude":8,"statusDuration":100}` |
| `mage_haste` | `"apply_status"` | `1` | `6` | `35` | `{"displayName":"加速","targetMode":"single","isMagic":true,"damageType":"magic","statusId":"mage_haste_state","statusKind":"haste","statusMagnitude":25,"statusDuration":100}` |
| `mage_slow` | `"apply_status"` | `1` | `6` | `35` | `{"displayName":"减速","targetMode":"single","isMagic":true,"damageType":"magic","statusId":"mage_slow_state","statusKind":"slow","statusMagnitude":25,"statusDuration":100}` |
| `mage_mass_weaken` | `"apply_status"` | `1` | `14` | `55` | `{"displayName":"群体虚弱","targetMode":"all","isMagic":true,"damageType":"magic","statusId":"mage_mass_weaken_state","statusKind":"weakened","statusMagnitude":5,"statusDuration":80}` |

## mage_meditate

消耗 0 MP；基础 WAIT 60（效果即时结算后的行动间隔，实际间隔见试跑）。为指令选中的一名合法目标恢复至多 12 MP，不超过最大 MP；施放消耗先扣除，目标由指令选择。属于非魔法动作，不因沉默被禁止。

## mage_quick_breath

消耗 0 MP；基础 WAIT 25（效果即时结算后的行动间隔，实际间隔见试跑）。为指令选中的一名合法目标恢复至多 4 MP，不超过最大 MP；施放消耗先扣除，目标由指令选择。属于非魔法动作，不因沉默被禁止。

## mage_mana_transfer

消耗 8 MP；基础 WAIT 35（效果即时结算后的行动间隔，实际间隔见试跑）。为指令选中的一名合法目标恢复至多 8 MP，不超过最大 MP；施放消耗先扣除，目标由指令选择。属于魔法动作，被沉默时不能使用。

## mage_mana_drain

消耗 0 MP；基础 WAIT 45（效果即时结算后的行动间隔，实际间隔见试跑）。从指令选中的一名合法目标汲取至多 8 MP，并向施放者返还实际扣除量，封顶其最大 MP；不能自吸，返还溢出销毁。属于魔法动作，被沉默时不能使用。

## mage_staff

消耗 0 MP；基础 WAIT 40（效果即时结算后的行动间隔，实际间隔见试跑）。对指令选中的一名合法目标造成基础 8 点物理伤害；实际值由核心计入装备、增减伤和防护。属于非魔法动作，不因沉默被禁止。

## mage_firebolt

消耗 8 MP；基础 WAIT 40（效果即时结算后的行动间隔，实际间隔见试跑）。对指令选中的一名合法目标造成基础 28 点魔法伤害；实际值由核心计入装备、增减伤和防护。属于魔法动作，被沉默时不能使用。

## mage_arcane_lance

消耗 16 MP；基础 WAIT 70（效果即时结算后的行动间隔，实际间隔见试跑）。对指令选中的一名合法目标造成基础 45 点魔法伤害；实际值由核心计入装备、增减伤和防护。属于魔法动作，被沉默时不能使用。

## mage_chain_lightning

消耗 12 MP；基础 WAIT 55（效果即时结算后的行动间隔，实际间隔见试跑）。对锚点同队、同排且仍在指令范围内的合法目标造成基础 16 点魔法伤害；实际值由核心计入装备、增减伤和防护。属于魔法动作，被沉默时不能使用。群体只扣一次 MP、预约一次 WAIT；覆盖成员不重复判断锚点条件。

## mage_fire_rain

消耗 14 MP；基础 WAIT 65（效果即时结算后的行动间隔，实际间隔见试跑）。对锚点同队且仍在指令范围内的全部合法目标造成基础 14 点魔法伤害；实际值由核心计入装备、增减伤和防护。属于魔法动作，被沉默时不能使用。群体只扣一次 MP、预约一次 WAIT；覆盖成员不重复判断锚点条件。

## mage_piercing_ray

消耗 10 MP；基础 WAIT 55（效果即时结算后的行动间隔，实际间隔见试跑）。对锚点同队、同列且仍在指令范围内的合法目标造成基础 20 点魔法伤害；实际值由核心计入装备、增减伤和防护。属于魔法动作，被沉默时不能使用。群体只扣一次 MP、预约一次 WAIT；覆盖成员不重复判断锚点条件。

## mage_first_aid

消耗 6 MP；基础 WAIT 30（效果即时结算后的行动间隔，实际间隔见试跑）。为指令选中的一名合法目标恢复至多 30 HP，不超过最大 HP。属于魔法动作，被沉默时不能使用。

## mage_greater_heal

消耗 12 MP；基础 WAIT 60（效果即时结算后的行动间隔，实际间隔见试跑）。为指令选中的一名合法目标恢复至多 60 HP，不超过最大 HP。属于魔法动作，被沉默时不能使用。

## mage_group_heal

消耗 12 MP；基础 WAIT 55（效果即时结算后的行动间隔，实际间隔见试跑）。为锚点同队且仍在指令范围内的全部合法目标恢复至多 20 HP，不超过最大 HP。属于魔法动作，被沉默时不能使用。群体只扣一次 MP、预约一次 WAIT；覆盖成员不重复判断锚点条件。

## mage_stone_skin

消耗 4 MP；基础 WAIT 25（效果即时结算后的行动间隔，实际间隔见试跑）。向指令选中的一名合法目标施加每次直接减伤 6 的防护，持续 80 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。

## mage_mass_guard

消耗 12 MP；基础 WAIT 55（效果即时结算后的行动间隔，实际间隔见试跑）。向锚点同队且仍在指令范围内的全部合法目标施加每次直接减伤 4 的防护，持续 100 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。群体只扣一次 MP、预约一次 WAIT；覆盖成员不重复判断锚点条件。

## mage_magic_barrier

消耗 5 MP；基础 WAIT 30（效果即时结算后的行动间隔，实际间隔见试跑）。向指令选中的一名合法目标施加额外减少魔法伤害 10 的魔法屏障，持续 100 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。

## mage_empower

消耗 6 MP；基础 WAIT 35（效果即时结算后的行动间隔，实际间隔见试跑）。向指令选中的一名合法目标施加伤害输出加值 10 的增伤，持续 100 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。

## mage_focus_mark

消耗 3 MP；基础 WAIT 25（效果即时结算后的行动间隔，实际间隔见试跑）。向指令选中的一名合法目标施加易伤标记，供条件和选择器识别，不附加伤害倍率，持续 150 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。

## mage_cleanse

消耗 4 MP；基础 WAIT 25（效果即时结算后的行动间隔，实际间隔见试跑）。清除指令选中的一名合法目标的全部有害动态状态及永久易伤测试标记。属于魔法动作，被沉默时不能使用。

## mage_group_cleanse

消耗 12 MP；基础 WAIT 60（效果即时结算后的行动间隔，实际间隔见试跑）。清除锚点同队且仍在指令范围内的全部合法目标的全部有害动态状态及永久易伤测试标记。属于魔法动作，被沉默时不能使用。群体只扣一次 MP、预约一次 WAIT；覆盖成员不重复判断锚点条件。

## mage_dispel

消耗 5 MP；基础 WAIT 35（效果即时结算后的行动间隔，实际间隔见试跑）。清除指令选中的一名合法目标的全部增益状态。属于魔法动作，被沉默时不能使用。

## mage_freeze

消耗 8 MP；基础 WAIT 25（效果即时结算后的行动间隔，实际间隔见试跑）。向指令选中的一名合法目标施加定身，阻止主动行动，保留尚余的正常 WAIT，持续 70 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。

## mage_silence

消耗 6 MP；基础 WAIT 35（效果即时结算后的行动间隔，实际间隔见试跑）。向指令选中的一名合法目标施加沉默，阻止 isMagic 为真的动作，持续 80 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。

## mage_weaken

消耗 6 MP；基础 WAIT 35（效果即时结算后的行动间隔，实际间隔见试跑）。向指令选中的一名合法目标施加伤害输出减值 8 的虚弱，持续 100 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。

## mage_haste

消耗 6 MP；基础 WAIT 35（效果即时结算后的行动间隔，实际间隔见试跑）。向指令选中的一名合法目标施加 25 速度点的加速，持续 100 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。

## mage_slow

消耗 6 MP；基础 WAIT 35（效果即时结算后的行动间隔，实际间隔见试跑）。向指令选中的一名合法目标施加 25 速度点的减速，持续 100 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。

## mage_mass_weaken

消耗 14 MP；基础 WAIT 55（效果即时结算后的行动间隔，实际间隔见试跑）。向锚点同队且仍在指令范围内的全部合法目标施加伤害输出减值 5 的虚弱，持续 80 WAIT；同状态 ID 替换刷新。属于魔法动作，被沉默时不能使用。群体只扣一次 MP、预约一次 WAIT；覆盖成员不重复判断锚点条件。
