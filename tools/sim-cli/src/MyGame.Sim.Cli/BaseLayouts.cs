using System.Text.Json.Nodes;
using Prototype.BaseEconomy;

namespace MyGame.Sim.Cli;

public sealed record BasePoint(long x, long y);
public sealed record BaseGeometry(string instanceId, string buildingId, long x, long y, int width, int height, int rotation, BasePoint entrance);
public sealed record LayoutCheckResult(bool ok, BaseIssue[] errors, BaseIssue[] warnings, BaseGeometry[] geometry);

public static class BaseLayouts
{
    public const int FarFromStorageThreshold = 12;

    public static BasePoint Rotate(int w, int h, int rotation, int x, int y) => rotation switch
    {
        0 => new(x, y), 90 => new(h - 1L - y, x), 180 => new(w - 1L - x, h - 1L - y), 270 => new(y, w - 1L - x),
        _ => throw new ArgumentException("rotation必须为0/90/180/270。")
    };

    public static LayoutCheckResult Check(ContentProject project, JsonObject layout)
    {
        Model model = Build(project, layout);
        var errors = new List<BaseIssue>(); var warnings = new List<BaseIssue>();
        var occupied = new Dictionary<int, List<int>>(); var pairs = new HashSet<(int, int)>();
        JsonArray terrain = BaseContent.Array(layout["tiles"]);
        for (int i = 0; i < terrain.Count; i++)
        {
            JsonObject tile = BaseContent.Object(terrain[i]); long x = BaseContent.Integer(tile["x"]), y = BaseContent.Integer(tile["y"]);
            if (!model.Inside(x, y)) errors.Add(Issue("out_of_bounds", "地形格超出地图。", model, "/tiles/" + i, x: x, y: y));
        }
        for (int i = 0; i < model.Placements.Length; i++)
        {
            Placement placement = model.Placements[i]; BaseGeometry g = placement.Geometry;
            string pointer = "/buildings/" + placement.Index;
            if (g.x < 0 || g.y < 0 || g.x + g.width > model.Width || g.y + g.height > model.Height)
                errors.Add(Issue("out_of_bounds", "建筑占地超出地图。", model, pointer, g.instanceId, x: g.x, y: g.y));
            if (!model.Inside(g.entrance.x, g.entrance.y)) errors.Add(Issue("out_of_bounds", "建筑入口超出地图。", model, pointer + "/rotation", g.instanceId, x: g.entrance.x, y: g.entrance.y));
            string allowed = BaseContent.Text(placement.Definition["ownership"]);
            if (allowed != "both" && allowed != BaseContent.Text(placement.Instance["ownership"]))
                errors.Add(Issue("ownership_not_allowed", "实例归属不被建筑定义允许。", model, pointer + "/ownership", g.instanceId, x: g.x, y: g.y));
            bool terrainReported = false;
            for (long y = g.y; y < g.y + g.height; y++) for (long x = g.x; x < g.x + g.width; x++)
            {
                if (!model.Inside(x, y)) continue;
                int cell = model.Cell(x, y);
                if (model.Terrain[cell] && !terrainReported)
                {
                    errors.Add(Issue("overlap", "建筑占地压在障碍或水上。", model, pointer, g.instanceId, x: x, y: y)); terrainReported = true;
                }
                if (!occupied.TryGetValue(cell, out List<int>? previous)) occupied[cell] = previous = new();
                foreach (int other in previous)
                    if (pairs.Add((other, i))) errors.Add(Issue("overlap", "与" + model.Placements[other].Geometry.instanceId + "占地重叠。", model, pointer, g.instanceId, x: x, y: y));
                previous.Add(i);
            }
        }
        var usable = new List<Anchor>();
        foreach (Anchor anchor in model.Anchors)
        {
            if (!model.Inside(anchor.X, anchor.Y))
            {
                if (anchor.Kind == "spawn") errors.Add(Issue("out_of_bounds", "出生点超出地图。", model, anchor.Pointer, spawn: anchor.Id, x: anchor.X, y: anchor.Y));
                continue;
            }
            if (model.Blocked[model.Cell(anchor.X, anchor.Y)])
            {
                errors.Add(Issue(anchor.Kind == "building" ? "entrance_blocked" : "unreachable", anchor.Kind == "building" ? "入口被障碍、水或不可通行建筑占地堵住。" : "出生点位于不可通行格。", model, anchor.Pointer, anchor.Kind == "building" ? anchor.Id : "", anchor.Kind == "spawn" ? anchor.Id : "", anchor.X, anchor.Y));
                continue;
            }
            usable.Add(anchor);
        }
        if (usable.Count > 1)
        {
            int[] field = Field(model, usable[0].X, usable[0].Y);
            foreach (Anchor anchor in usable.Skip(1)) if (field[model.Cell(anchor.X, anchor.Y)] < 0)
                errors.Add(Issue("unreachable", "与其它入口或出生点不连通。", model, anchor.Pointer, anchor.Kind == "building" ? anchor.Id : "", anchor.Kind == "spawn" ? anchor.Id : "", anchor.X, anchor.Y));
        }
        Anchor[] storage = usable.Where(a => a.Kind == "building" && a.Function == "storage").ToArray();
        if (storage.Length != 0)
        {
            int[][] storageFields = storage.Select(a => Field(model, a.X, a.Y)).ToArray();
            foreach (Anchor workshop in usable.Where(a => a.Kind == "building" && a.Function == "workshop"))
            {
                int[] values = storageFields.Select(f => f[model.Cell(workshop.X, workshop.Y)]).Where(d => d >= 0).ToArray();
                if (values.Length != 0 && values.Min() > FarFromStorageThreshold)
                    warnings.Add(Issue("far_from_storage", "工坊到最近仓储入口超过12格。", model, workshop.Pointer, workshop.Id, x: workshop.X, y: workshop.Y, warning: true));
            }
        }
        return new(errors.Count == 0, Ordered(errors), Ordered(warnings), model.Placements.Select(p => p.Geometry).ToArray());
    }

    public static object Distance(ContentProject project, JsonObject body)
    {
        if (body.Any(p => p.Key is not "layout" and not "from") || body["layout"] is not JsonObject layout || body["from"] is not JsonObject from)
            throw new ArgumentException("distance body必须为{layout,from:{instanceId}|{x,y}}。");
        Model model = Build(project, layout); long x = 0, y = 0;
        if (from.Count == 1 && from["instanceId"] is JsonValue idNode && idNode.TryGetValue<string>(out string? id))
        {
            Anchor? anchor = model.Anchors.SingleOrDefault(a => a.Kind == "building" && a.Id == id);
            if (anchor is null) CombatContent.Fail("layouts/" + model.Id + ".json", "/from/instanceId", "source_missing", "找不到距离源实例。");
            x = anchor!.X; y = anchor.Y;
        }
        else if (from.Count == 2 && from.ContainsKey("x") && from.ContainsKey("y") && Coordinate(from["x"], out x) && Coordinate(from["y"], out y)) { }
        else CombatContent.Fail("layouts/" + model.Id + ".json", "/from", "source", "from必须仅为instanceId或一组整数x/y。");
        if (!model.Inside(x, y) || model.Blocked[model.Cell(x, y)]) CombatContent.Fail("layouts/" + model.Id + ".json", "/from", "source_blocked", "距离起点越界或不可通行。");
        int[] distances = Field(model, x, y);
        return new
        {
            width = model.Width, height = model.Height, from = new BasePoint(x, y), distanceField = distances,
            targets = model.Anchors.OrderBy(a => a.Kind, StringComparer.Ordinal).ThenBy(a => a.Id, StringComparer.Ordinal).Select(a =>
            {
                int tiles = model.Inside(a.X, a.Y) ? distances[model.Cell(a.X, a.Y)] : -1;
                return new { kind = a.Kind, id = a.Id, instanceId = a.Kind == "building" ? a.Id : "", spawnId = a.Kind == "spawn" ? a.Id : "", x = a.X, y = a.Y, tiles, ticks = tiles < 0 ? -1L : (long)tiles * model.MovementTicks };
            }).ToArray()
        };
    }

    public static (ContentError[] Errors, string[] Warnings) ValidateAll(ContentProject project)
    {
        var errors = new List<ContentError>(); var warnings = new List<string>();
        foreach (EntityDocument doc in project.Documents.Values.Where(d => d.Type == "layout" && !ContentProject.Flag(d.Value["draft"])))
        {
            LayoutCheckResult result = Check(project, doc.Value);
            errors.AddRange(result.errors.Select(e => ContentProject.Error(doc.Path, e.field, e.code, e.message)));
            warnings.AddRange(result.warnings.Select(w => doc.Path + "#" + w.field + ": " + w.message));
        }
        return (errors.ToArray(), warnings.ToArray());
    }

    private static bool Coordinate(JsonNode? value, out long number)
    {
        double raw = CombatContent.Number(value, double.NaN); number = 0;
        if (!double.IsFinite(raw) || Math.Truncate(raw) != raw || raw < int.MinValue || raw > int.MaxValue) return false;
        number = (long)raw; return true;
    }
    private static int[] Field(Model model, long x, long y) => BasePathfinding.DistanceField(model.Width, model.Height, model.Blocked, new GridPosition((int)x, (int)y));
    private static BaseIssue[] Ordered(List<BaseIssue> values) => values.OrderBy(v => v.field, StringComparer.Ordinal).ThenBy(v => v.code, StringComparer.Ordinal).ThenBy(v => v.x).ThenBy(v => v.y).ToArray();
    private static BaseIssue Issue(string code, string message, Model model, string field, string instance = "", string spawn = "", long? x = null, long? y = null, bool warning = false)
        => new(code, message, warning ? "warning" : "error", !warning, "layout", model.Id, field, instance, spawn, x, y);

    private static Model Build(ContentProject project, JsonObject layout)
    {
        ContentValidation validation = CombatContent.ValidateCandidate(project, "layout", layout, "update", null);
        if (!validation.ok) throw new ContentValidationException(validation);
        int width = BaseContent.Integer(layout["width"]), height = BaseContent.Integer(layout["height"]);
        var terrain = new bool[checked(width * height)]; var blocked = new bool[terrain.Length];
        bool Inside(long x, long y) => x >= 0 && y >= 0 && x < width && y < height;
        foreach (JsonObject tile in BaseContent.Array(layout["tiles"]).OfType<JsonObject>())
        {
            int x = BaseContent.Integer(tile["x"]), y = BaseContent.Integer(tile["y"]);
            if (Inside(x, y)) terrain[y * width + x] = blocked[y * width + x] = true;
        }
        var placements = new List<Placement>(); var anchors = new List<Anchor>();
        JsonArray buildings = BaseContent.Array(layout["buildings"]);
        for (int i = 0; i < buildings.Count; i++)
        {
            JsonObject instance = BaseContent.Object(buildings[i]);
            IdLookup lookup = project.Lookup(BaseContent.Text(instance["buildingId"])); JsonObject definition = project.Documents[lookup.path].Value;
            JsonObject footprint = BaseContent.Object(definition["footprint"]), entrance = BaseContent.Object(definition["entrance"]);
            int w = BaseContent.Integer(footprint["w"]), h = BaseContent.Integer(footprint["h"]), rotation = BaseContent.Integer(instance["rotation"]);
            long x = BaseContent.Integer(instance["x"]), y = BaseContent.Integer(instance["y"]);
            BasePoint offset = Rotate(w, h, rotation, BaseContent.Integer(entrance["x"]), BaseContent.Integer(entrance["y"]));
            var geometry = new BaseGeometry(BaseContent.Text(instance["instanceId"]), lookup.canonicalId, x, y, rotation is 90 or 270 ? h : w, rotation is 90 or 270 ? w : h, rotation, new(x + offset.x, y + offset.y));
            placements.Add(new(i, instance, definition, geometry));
            anchors.Add(new("building", geometry.instanceId, geometry.entrance.x, geometry.entrance.y, "/buildings/" + i, BaseContent.Text(definition["function"])));
            if (!ContentProject.Flag(definition["walkableFootprint"]))
                for (long dy = y; dy < y + geometry.height; dy++) for (long dx = x; dx < x + geometry.width; dx++) if (Inside(dx, dy)) blocked[(int)dy * width + (int)dx] = true;
        }
        JsonArray spawns = BaseContent.Array(layout["spawns"]);
        for (int i = 0; i < spawns.Count; i++)
        {
            JsonObject spawn = BaseContent.Object(spawns[i]); anchors.Add(new("spawn", BaseContent.Text(spawn["id"]), BaseContent.Integer(spawn["x"]), BaseContent.Integer(spawn["y"]), "/spawns/" + i, ""));
        }
        return new(BaseContent.Text(layout["id"]), width, height, BaseContent.Integer(layout["movementTicksPerTile"]), terrain, blocked, placements.ToArray(), anchors.ToArray());
    }
    private sealed record Placement(int Index, JsonObject Instance, JsonObject Definition, BaseGeometry Geometry);
    private sealed record Anchor(string Kind, string Id, long X, long Y, string Pointer, string Function);
    private sealed record Model(string Id, int Width, int Height, int MovementTicks, bool[] Terrain, bool[] Blocked, Placement[] Placements, Anchor[] Anchors)
    {
        public bool Inside(long x, long y) => x >= 0 && y >= 0 && x < Width && y < Height;
        public int Cell(long x, long y) => checked((int)y * Width + (int)x);
    }
}
