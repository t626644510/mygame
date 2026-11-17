namespace MyGame.Sim.Cli;

public sealed record BaseIssue(string code, string message, string severity, bool blocking, string entityType, string entityId, string field, string instanceId = "", string spawnId = "", long? x = null, long? y = null);
public sealed record BaseFlow(string kind, string sourceType, string sourceId, string path, string jsonPointer, int? quantity);
