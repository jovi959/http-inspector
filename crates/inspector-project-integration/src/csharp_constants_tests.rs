use super::*;

const SAMPLE: &str = r#"
namespace Sample.Models
{
public static class SampleConstants
{
    public static class Stages
    {
        // workflow stages
        public const string ReviewStage = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    }

    public static class Assignment
    {
        public const string AssignedToQueue = "100000001";
    }

    public static class Categories
    {
        public const int PrimaryCategoryCode = 100000033;
        public static readonly Guid ProcessId = new Guid("11111111-2222-4333-8444-555555555555");
        public static readonly Guid OtherId = Guid.Parse("{66666666-7777-4888-8999-000000000000}");
        public const string Navigation = "relation_workflow";
        // public const int Removed = 100000099;
        /* public const int AlsoRemoved = 100000098; */
        public const int Computed = OtherValue + 1;
    }
}

public enum CategoryCode
{
    Primary = 100000033,
    Secondary = 100000023, // second
    Implicit,
}

public class Generic<T> where T : class, new() { public const long Big = 9000000000L; }
}
"#;

fn pairs(found: &[FoundValue]) -> Vec<(&str, &str)> {
    found.iter().map(|value| (value.value.as_str(), value.name.as_str())).collect()
}

#[test]
fn finds_guid_and_integer_constants_and_enum_members_with_their_full_type_path() {
    let found = scan_csharp(SAMPLE);

    assert_eq!(pairs(&found), vec![
        ("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "SampleConstants.Stages.ReviewStage"),
        ("100000001", "SampleConstants.Assignment.AssignedToQueue"),
        ("100000033", "SampleConstants.Categories.PrimaryCategoryCode"),
        ("11111111-2222-4333-8444-555555555555", "SampleConstants.Categories.ProcessId"),
        ("66666666-7777-4888-8999-000000000000", "SampleConstants.Categories.OtherId"),
        ("100000033", "CategoryCode.Primary"),
        ("100000023", "CategoryCode.Secondary"),
        ("9000000000", "Generic.Big"),
    ]);
}

#[test]
fn reports_the_line_of_each_declaration() {
    let found = scan_csharp(SAMPLE);

    assert_eq!(found[0].line, 9);
    assert_eq!(found[5].line, 31);
}

const DEFAULTS_AND_MAPS: &str = r#"
public class Settings
{
public Guid TemplateId { get; set; } = Guid.Parse("12345678-1234-4234-8234-123456789012");
public int Retries { get; } = 3;
public string Label { get; set; } = "plain text";
private static readonly IReadOnlyDictionary<string, int> CodeMap =
    new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["Alpha"] = 100000010,
        ["Beta"] = 100000011
    };
private static readonly Dictionary<string, int> PairMap = new()
{
    { "Gamma", 100000012 },
};
public void Run() { var total = Compute(); if (total > 0) { Log(total); } }
}
"#;

#[test]
fn finds_property_defaults_and_code_dictionary_entries() {
    let found = scan_csharp(DEFAULTS_AND_MAPS);

    assert_eq!(pairs(&found), vec![
        ("12345678-1234-4234-8234-123456789012", "Settings.TemplateId"),
        ("3", "Settings.Retries"),
        ("100000010", "Settings.CodeMap[Alpha]"),
        ("100000011", "Settings.CodeMap[Beta]"),
        ("100000012", "Settings.PairMap[Gamma]"),
    ]);
}
