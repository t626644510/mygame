using System.Text.Json.Nodes;

namespace MyGame.Sim.Cli;

public static class ItemValidation
{
    public static readonly string[] Categories = { "material", "equipment", "consumable", "currency", "key" };
    public static readonly string[] Slots = { "weapon", "armor", "accessory" };
    public static readonly string[] BonusFields = { "equipmentDamageBonus" };
    private static readonly string[] ItemFields = { "schemaVersion", "id", "aliases", "name", "category", "description", "icon", "stackLimit", "baseValue", "tags", "equipment", "consumable", "draft" };

    public static List<ContentError> Validate(EntityDocument doc, ContentProject project)
    {
        var errors = new List<ContentError>();
        JsonObject item = doc.Value;
        void Error(string pointer, string code, string message) => errors.Add(ContentProject.Error(doc.Path, pointer, code, message));
        void Fields(JsonObject value, string pointer, string[] required, params string[] optional)
        {
            foreach (string field in required)
                if (!value.ContainsKey(field)) Error(pointer + "/" + field, "required", "缺少必填字段：" + field);
            foreach (string field in value.Select(pair => pair.Key))
                if (!required.Contains(field) && !optional.Contains(field))
                    Error(pointer + "/" + field.Replace("~", "~0").Replace("/", "~1"), "unknown_field", "未知物品字段：" + field);
        }
        Fields(item, "", ItemFields, "notes");
        if (ContentProject.Integer(item["schemaVersion"]) != 1) Error("/schemaVersion", "schema_version", "schemaVersion必须是1。");
        foreach (string field in new[] { "id", "name", "category", "description", "icon" })
            if (item[field] is not JsonValue value || !value.TryGetValue<string>(out _)) Error("/" + field, "type", "字段必须是字符串：" + field);
        if (string.IsNullOrWhiteSpace(ContentProject.Text(item["name"]))) Error("/name", "required", "名称不能为空。");
        string category = ContentProject.Text(item["category"]);
        if (!Categories.Contains(category)) Error("/category", "enum", "物品类型必须是material、equipment、consumable、currency或key。");
        int? stack = ContentProject.Integer(item["stackLimit"]), price = ContentProject.Integer(item["baseValue"]);
        if (stack is null or < 1) Error("/stackLimit", "minimum", "堆叠必须为大于等于1的整数。");
        if (category == "equipment" && stack != 1) Error("/stackLimit", "equipment_stack", "装备的堆叠必须为1。");
        if (price is null or < 0) Error("/baseValue", "minimum", "参考价必须为大于等于0的整数。");
        foreach (string field in new[] { "aliases", "tags" })
        {
            if (item[field] is not JsonArray list) Error("/" + field, "type", field + "必须是字符串数组。");
            else for (int i = 0; i < list.Count; i++) if (list[i] is not JsonValue text || !text.TryGetValue<string>(out string? s) || string.IsNullOrWhiteSpace(s)) Error("/" + field + "/" + i, "type", "数组成员必须是非空字符串。");
        }
        if (item["draft"] is not JsonValue draft || !draft.TryGetValue<bool>(out _)) Error("/draft", "type", "draft必须为布尔值。");
        bool unsupported = false;
        if (item["equipment"] is not JsonObject equipment) Error("/equipment", "type", "equipment结构必须存在，非装备也须保留空默认值。");
        else
        {
            Fields(equipment, "/equipment", new[] { "slot", "combatBonus", "enhancement" });
            string slot = ContentProject.Text(equipment["slot"]);
            if (category == "equipment" && !Slots.Contains(slot)) Error("/equipment/slot", "enum", "装备槽位必须是weapon、armor或accessory。");
            if (category != "equipment" && slot != "") Error("/equipment/slot", "inactive_extension", "非装备的slot必须为空字符串。");
            if (equipment["slot"] is not JsonValue slotValue || !slotValue.TryGetValue<string>(out _)) Error("/equipment/slot", "type", "slot必须是字符串。");
            if (equipment["combatBonus"] is not JsonArray bonuses) Error("/equipment/combatBonus", "type", "combatBonus必须是数组。");
            else
            {
                if (category != "equipment" && bonuses.Count != 0) Error("/equipment/combatBonus", "inactive_extension", "非装备的combatBonus必须为空数组。");
                for (int i = 0; i < bonuses.Count; i++)
                {
                    if (bonuses[i] is not JsonObject bonus) { Error("/equipment/combatBonus/" + i, "type", "战斗加成必须是对象。"); continue; }
                    Fields(bonus, "/equipment/combatBonus/" + i, new[] { "id", "value" });
                    if (ContentProject.Text(bonus["id"]) == "") Error("/equipment/combatBonus/" + i + "/id", "required", "战斗加成ID不能为空。");
                    if (!BonusFields.Contains(ContentProject.Text(bonus["id"]))) unsupported = true;
                    if (ContentProject.Integer(bonus["value"]) is null or < 0) Error("/equipment/combatBonus/" + i + "/value", "minimum", "战斗加值必须为大于等于0的整数。");
                }
            }
            if (equipment["enhancement"] is not JsonArray levels) Error("/equipment/enhancement", "type", "enhancement必须是数组。");
            else
            {
                if (category != "equipment" && levels.Count != 0) Error("/equipment/enhancement", "inactive_extension", "非装备的enhancement必须为空数组。");
                for (int i = 0; i < levels.Count; i++)
                {
                    string prefix = "/equipment/enhancement/" + i;
                    if (levels[i] is not JsonObject level) { Error(prefix, "type", "强化等级必须是对象。"); continue; }
                    Fields(level, prefix, new[] { "level", "cash", "attackBonusDelta", "materials" });
                    if (ContentProject.Integer(level["level"]) != i + 1) Error(prefix + "/level", "sequence", "强化等级必须从1开始连续递增。");
                    foreach (string name in new[] { "cash", "attackBonusDelta" }) if (ContentProject.Integer(level[name]) is null or < 0) Error(prefix + "/" + name, "minimum", name + "必须为大于等于0的整数。");
                    if (level["materials"] is not JsonArray materials) Error(prefix + "/materials", "type", "强化材料必须是数组。");
                    else for (int j = 0; j < materials.Count; j++)
                    {
                        string field = prefix + "/materials/" + j;
                        if (materials[j] is not JsonObject material) { Error(field, "type", "材料必须是对象。"); continue; }
                        Fields(material, field, new[] { "itemId", "quantity" });
                        IdLookup lookup = project.Lookup(ContentProject.Text(material["itemId"]));
                        if (!lookup.exists || lookup.type != "item") Error(field + "/itemId", "reference_missing", "强化材料物品不存在。");
                        if (ContentProject.Integer(material["quantity"]) is null or < 1) Error(field + "/quantity", "minimum", "材料数量必须为大于等于1的整数。");
                    }
                }
            }
        }
        if (item["consumable"] is not JsonObject consumable) Error("/consumable", "type", "consumable结构必须存在。");
        else
        {
            Fields(consumable, "/consumable", new[] { "effects" });
            if (consumable["effects"] is not JsonArray effects) Error("/consumable/effects", "type", "effects必须是数组。");
            else
            {
                if (category != "consumable" && effects.Count != 0) Error("/consumable/effects", "inactive_extension", "非消耗品的effects必须为空数组。");
                if (effects.Count != 0) unsupported = true;
                for (int i = 0; i < effects.Count; i++)
                {
                    string prefix = "/consumable/effects/" + i;
                    if (effects[i] is not JsonObject effect) { Error(prefix, "type", "效果必须是对象。"); continue; }
                    Fields(effect, prefix, new[] { "kind", "note" });
                    if (ContentProject.Text(effect["kind"]) == "" || effect["note"] is not JsonValue note || !note.TryGetValue<string>(out _)) Error(prefix, "type", "效果必须包含非空kind和字符串note。");
                }
            }
        }
        if (unsupported)
        {
            if (!ContentProject.Flag(item["draft"])) Error("/draft", "capability_unimplemented", "包含尚未实现的能力，必须标记draft。");
            if (!project.HasImplementationRequest(ContentProject.Text(item["id"]))) Error("/draft", "request_required", "尚未实现的能力必须关联一条非note需求单。");
        }
        return errors;
    }
}
