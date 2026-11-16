using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace MyGame.Sim.Cli;

public static class UnityJson
{
    private static readonly JsonSerializerOptions Normal = Options(true);
    private static readonly JsonSerializerOptions Reports = Options(false);
    public static readonly UTF8Encoding Utf8 = new(false);

    private static JsonSerializerOptions Options(bool relaxed) => new()
    {
        IncludeFields = true,
        WriteIndented = true,
        Encoder = relaxed ? JavaScriptEncoder.UnsafeRelaxedJsonEscaping : JavaScriptEncoder.Default
    };

    public static T Read<T>(string json, bool reportMode = false) where T : class
    {
        T value = JsonSerializer.Deserialize<T>(json, reportMode ? Reports : Normal)
            ?? throw new JsonException("JSON root must be an object.");
        if (!reportMode) FillDefaults(value);
        return value;
    }

    public static string Serialize(object value, bool reportMode = false)
    {
        string text = JsonSerializer.Serialize(value, value.GetType(), reportMode ? Reports : Normal);
        return (reportMode ? text : Lf(text)) + "\n";
    }

    public static string Lf(string value) => value.Replace("\r\n", "\n").Replace('\r', '\n');

    public static void WriteFile(string path, string text)
    {
        string full = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, Lf(text), Utf8);
    }

    public static void WriteReportJson(string path, object value)
    {
        string full = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, Serialize(value, true), Utf8);
    }

    private static void FillDefaults(object value)
    {
        foreach (FieldInfo field in value.GetType().GetFields(BindingFlags.Instance | BindingFlags.Public))
        {
            if (field.IsInitOnly) continue;
            Type type = field.FieldType;
            object? child = field.GetValue(value);
            if (child is null)
            {
                if (type == typeof(string)) child = "";
                else if (type.IsArray) child = Array.CreateInstance(type.GetElementType()!, 0);
                else if (type.IsClass && type.IsDefined(typeof(SerializableAttribute), false))
                    child = Activator.CreateInstance(type);
                if (child is not null) field.SetValue(value, child);
            }
            if (child is Array array)
            {
                for (int i = 0; i < array.Length; i++)
                {
                    object? item = array.GetValue(i);
                    if (item is null && type.GetElementType() == typeof(string)) array.SetValue("", i);
                    else if (item is not null && item is not string && !item.GetType().IsValueType)
                        FillDefaults(item);
                }
            }
            else if (child is not null && child is not string && !type.IsValueType &&
                     type.IsDefined(typeof(SerializableAttribute), false)) FillDefaults(child);
        }
    }
}
