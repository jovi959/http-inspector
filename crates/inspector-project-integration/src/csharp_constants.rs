//! Finds C# constants, enum members, property defaults and code-dictionary entries whose value is a GUID or an integer.

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FoundValue {
    pub value: String,
    pub name: String,
    pub line: u32,
}

/// Line-based scan: tracks type nesting by braces (ignoring strings and comments) so names read as `Outer.Inner.Member`.
pub(crate) fn scan_csharp(source: &str) -> Vec<FoundValue> {
    let mut scanner = Scanner::default();
    for (index, line) in source.lines().enumerate() {
        scanner.scan_line(line, index as u32 + 1);
    }
    scanner.found
}

struct OpenType {
    name: String,
    is_enum: bool,
    depth: usize,
}

#[derive(Default)]
struct Scanner {
    types: Vec<OpenType>,
    pending_type: Option<(String, bool)>,
    /// `X = new Dictionary<…>` waiting for its `{`, then the open initializer blocks.
    pending_initializer: Option<String>,
    initializers: Vec<(String, usize)>,
    /// `Type Name { get; set; } = value;`: the property whose accessor block is open, then the one awaiting `= value`.
    pending_property: Option<String>,
    open_property: Option<(String, usize)>,
    property_awaiting_value: Option<String>,
    depth: usize,
    in_block_comment: bool,
    found: Vec<FoundValue>,
}

impl Scanner {
    fn scan_line(&mut self, line: &str, number: u32) {
        let mut segment = String::new();
        let mut quote: Option<char> = None;
        let mut chars = line.chars().peekable();
        while let Some(character) = chars.next() {
            if self.in_block_comment {
                if character == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    self.in_block_comment = false;
                }
                continue;
            }
            if let Some(open) = quote {
                segment.push(character);
                if character == '\\' {
                    if let Some(escaped) = chars.next() { segment.push(escaped); }
                } else if character == open {
                    quote = None;
                }
                continue;
            }
            match character {
                '"' | '\'' => { quote = Some(character); segment.push(character); }
                '/' if chars.peek() == Some(&'/') => break,
                '/' if chars.peek() == Some(&'*') => { chars.next(); self.in_block_comment = true; }
                '{' => { self.scan_segment(&segment, number); segment.clear(); self.open_brace(); }
                '}' => { self.scan_segment(&segment, number); segment.clear(); self.close_brace(); }
                _ => segment.push(character),
            }
        }
        self.scan_segment(&segment, number);
        self.property_awaiting_value = None;
    }

    fn scan_segment(&mut self, segment: &str, number: u32) {
        let text = segment.trim();
        if text.is_empty() { return; }
        if let Some(property) = self.property_awaiting_value.take() {
            if let Some(value) = text.strip_prefix('=').filter(|rest| !rest.starts_with('>')).and_then(|rest| literal_value(rest.trim().trim_end_matches(';').trim())) {
                self.record(property, value, number);
                return;
            }
        }
        if let Some(declaration) = type_declaration(text) { self.pending_type = Some(declaration); }
        if let Some((member, value)) = constant(text) {
            self.record(member, value, number);
            return;
        }
        if let Some(owner) = initializer_owner(text) {
            self.pending_initializer = Some(owner);
        } else if text.contains(';') {
            self.pending_initializer = None;
        }
        self.pending_property = property_header(text);
        if self.types.last().is_some_and(|open| open.is_enum && open.depth == self.depth) {
            for part in text.split(',') {
                if let Some((member, value)) = enum_member(part) { self.record(member, value, number); }
            }
        }
        if let Some((owner, depth)) = self.initializers.last().cloned() {
            let entries: Vec<(String, String)> = if depth == self.depth {
                text.split(',').filter_map(indexer_entry).collect()
            } else if depth + 1 == self.depth {
                pair_entry(text).into_iter().collect()
            } else {
                Vec::new()
            };
            for (key, value) in entries { self.record(format!("{owner}[{key}]"), value, number); }
        }
    }

    fn open_brace(&mut self) {
        self.depth += 1;
        if let Some((name, is_enum)) = self.pending_type.take() {
            self.types.push(OpenType { name, is_enum, depth: self.depth });
        } else if let Some(owner) = self.pending_initializer.take() {
            self.initializers.push((owner, self.depth));
        } else if let Some(property) = self.pending_property.take() {
            self.open_property = Some((property, self.depth));
        }
        self.pending_property = None;
    }

    fn close_brace(&mut self) {
        if self.types.last().is_some_and(|open| open.depth == self.depth) { self.types.pop(); }
        if self.initializers.last().is_some_and(|(_, depth)| *depth == self.depth) { self.initializers.pop(); }
        if self.open_property.as_ref().is_some_and(|(_, depth)| *depth == self.depth) {
            self.property_awaiting_value = self.open_property.take().map(|(name, _)| name);
        }
        self.depth = self.depth.saturating_sub(1);
    }

    fn record(&mut self, member: String, value: String, line: u32) {
        let path: Vec<&str> = self.types.iter().map(|open| open.name.as_str()).collect();
        let name = if path.is_empty() { member } else { format!("{}.{member}", path.join(".")) };
        self.found.push(FoundValue { value, name, line });
    }
}

fn type_declaration(text: &str) -> Option<(String, bool)> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let position = words.iter().position(|word| matches!(*word, "class" | "struct" | "enum" | "record" | "interface"))?;
    let mut name_word = words.get(position + 1)?;
    if words[position] == "record" && matches!(*name_word, "class" | "struct") { name_word = words.get(position + 2)?; }
    let name: String = name_word.chars().take_while(|character| character.is_alphanumeric() || *character == '_').collect();
    is_identifier(&name).then(|| (name, words[position] == "enum"))
}

fn constant(text: &str) -> Option<(String, String)> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let is_static_readonly = words.contains(&"static") && words.contains(&"readonly");
    if !words.contains(&"const") && !is_static_readonly { return None; }
    let (left, right) = text.split_once('=')?;
    if right.starts_with('>') || right.starts_with('=') { return None; }
    let member = left.split_whitespace().last()?;
    if !is_identifier(member) { return None; }
    Some((member.to_string(), literal_value(right.trim().trim_end_matches(';').trim())?))
}

/// `Map = new Dictionary<…>(…)` (the `new` may be on the next line) whose `{ … }` holds `["Key"] = 1` or `{ "Key", 1 }` entries.
fn initializer_owner(text: &str) -> Option<String> {
    if text.contains(';') { return None; }
    let (left, right) = text.split_once('=')?;
    let right = right.trim();
    if right.starts_with('>') || right.starts_with('=') || !(right.is_empty() || right.starts_with("new")) { return None; }
    let owner = left.split_whitespace().last()?;
    is_identifier(owner).then(|| owner.to_string())
}

/// `Type Name` right before an accessor block, e.g. `public Guid TemplateId { get; set; } = …`.
fn property_header(text: &str) -> Option<String> {
    if text.contains(['=', '(', ';', ',']) { return None; }
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < 2 || words.iter().any(|word| matches!(*word, "class" | "struct" | "enum" | "record" | "interface" | "namespace" | "new")) { return None; }
    let name = *words.last()?;
    is_identifier(name).then(|| name.to_string())
}

fn indexer_entry(part: &str) -> Option<(String, String)> {
    let (key, value) = part.trim().split_once('=')?;
    let key = string_literal(key.trim().strip_prefix('[')?.strip_suffix(']')?)?;
    Some((key.to_string(), literal_value(value.trim())?))
}

fn pair_entry(text: &str) -> Option<(String, String)> {
    let (key, value) = text.trim().trim_end_matches(',').split_once(',')?;
    Some((string_literal(key)?.to_string(), literal_value(value.trim())?))
}

fn enum_member(part: &str) -> Option<(String, String)> {
    let (member, value) = part.split_once('=')?;
    let member = member.trim();
    if !is_identifier(member) { return None; }
    Some((member.to_string(), integer(value)?))
}

fn literal_value(expression: &str) -> Option<String> {
    if let Some(inner) = string_literal(expression) { return guid(inner).or_else(|| integer(inner)); }
    for prefix in ["new Guid(", "new System.Guid(", "Guid.Parse(", "System.Guid.Parse(", "new("] {
        if let Some(rest) = expression.strip_prefix(prefix) {
            return string_literal(rest.strip_suffix(')')?).and_then(guid);
        }
    }
    integer(expression)
}

fn string_literal(text: &str) -> Option<&str> {
    let text = text.trim();
    text.strip_prefix('@').unwrap_or(text).strip_prefix('"')?.strip_suffix('"')
}

fn guid(text: &str) -> Option<String> {
    let text = text.trim().trim_start_matches('{').trim_end_matches('}');
    let valid = text.len() == 36 && text.char_indices().all(|(index, character)| {
        if matches!(index, 8 | 13 | 18 | 23) { character == '-' } else { character.is_ascii_hexdigit() }
    });
    valid.then(|| text.to_ascii_lowercase())
}

fn integer(text: &str) -> Option<String> {
    let digits = text.trim().trim_end_matches(['u', 'U', 'l', 'L']).replace('_', "");
    digits.parse::<i64>().ok().map(|value| value.to_string())
}

fn is_identifier(text: &str) -> bool {
    let mut characters = text.chars();
    characters.next().is_some_and(|first| first.is_alphabetic() || first == '_')
        && characters.all(|character| character.is_alphanumeric() || character == '_')
}

#[cfg(test)]
#[path = "csharp_constants_tests.rs"]
mod tests;
