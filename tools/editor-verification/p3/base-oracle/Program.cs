using System.Security.Cryptography;
using System.Text;
using MyGame.Sim.Cli;
using Prototype.BaseEconomy;

static string Required(string[] values, string name)
{
    int index = Array.IndexOf(values, name);
    if (index < 0 || index + 1 >= values.Length) throw new ArgumentException("Missing " + name);
    return values[index + 1];
}

string input = Path.GetFullPath(Required(args, "--input"));
string output = Path.GetFullPath(Required(args, "--out"));
if (Directory.Exists(output) || File.Exists(output)) throw new IOException("Use a fresh output directory.");
Directory.CreateDirectory(output);
byte[] sourceBytes = File.ReadAllBytes(input);
File.WriteAllBytes(Path.Combine(output, "input.json"), sourceBytes);
BaseScenario original = UnityJson.Read<BaseScenario>(Encoding.UTF8.GetString(sourceBytes));
original.Validate();
var results = new List<object>();
foreach (var entry in new[] { (name: "near", position: original.nearKitchenPosition), (name: "far", position: original.farKitchenPosition) })
{
    BaseScenario scenario = original.WithKitchen(entry.position);
    BaseSession session = new BaseSession(scenario);
    BaseCommandResult recruitment = session.RecruitCook();
    if (!recruitment.Success) throw new InvalidOperationException(recruitment.Reason);
    var snapshots = new List<BaseSnapshot> { session.GetSnapshot() };
    for (int step = 0; step < scenario.runUntilFirstMealMaxTicks && !session.GetSnapshot().IsComplete; step++)
        snapshots.Add(session.Step());
    BaseSnapshot settled = session.GetSnapshot();
    byte[] ledgerBytes = Encoding.UTF8.GetBytes(session.ExportLedgerCsv());
    string ledgerPath = Path.Combine(output, entry.name + ".ledger.csv");
    File.WriteAllBytes(ledgerPath, ledgerBytes);
    UnityJson.WriteReportJson(Path.Combine(output, entry.name + ".snapshots.json"), snapshots);
    results.Add(new { name = entry.name, scenario, recruitment, settled,
        ledger = new { path = ledgerPath, bytes = ledgerBytes.Length, sha256 = Convert.ToHexString(SHA256.HashData(ledgerBytes)).ToLowerInvariant() },
        snapshotCount = snapshots.Count });
}
var report = new { schemaVersion = 1, mode = "existing-first-meal-kernel", newPathfindingInvoked = false,
    input = new { path = input, bytes = sourceBytes.Length, sha256 = Convert.ToHexString(SHA256.HashData(sourceBytes)).ToLowerInvariant() }, results };
UnityJson.WriteReportJson(Path.Combine(output, "result.json"), report);
Console.Write(UnityJson.Serialize(report, true));
