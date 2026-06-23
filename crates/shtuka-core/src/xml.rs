//! XML diff for define.xml (CDISC ODM) and similar stylesheet-backed XML. We
//! return each file's raw XML plus the XSL it references (found in the same
//! directory via the `<?xml-stylesheet href="...">` processing instruction).
//! The frontend transforms each through the browser's XSLTProcessor, renders the
//! two documents side by side, and diffs the rendered text line-by-line.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct XmlResult {
    #[serde(rename = "fileType")]
    pub file_type: String,
    #[serde(rename = "pathA")]
    pub path_a: String,
    #[serde(rename = "pathB")]
    pub path_b: String,
    /// Raw XML text for each side ("" if absent).
    #[serde(rename = "xmlA", default, skip_serializing_if = "String::is_empty")]
    pub xml_a: String,
    #[serde(rename = "xmlB", default, skip_serializing_if = "String::is_empty")]
    pub xml_b: String,
    /// The referenced stylesheet text for each side, if found in the same dir.
    #[serde(rename = "xslA", default, skip_serializing_if = "String::is_empty")]
    pub xsl_a: String,
    #[serde(rename = "xslB", default, skip_serializing_if = "String::is_empty")]
    pub xsl_b: String,
    /// Notes (e.g. "stylesheet not found") for the UI.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
    /// Structural changes from the recursive tree diff (for highlight mapping).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changes: Vec<XmlChange>,
}

/// One changed node, with the hints the frontend needs to locate it in the
/// XSLT-rendered page. `kind` ∈ added | removed | modified.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XmlChange {
    pub kind: String,
    #[serde(rename = "elemType")]
    pub elem_type: String,
    pub oid: String,
    pub label: String,
    /// HTML anchor id prefix the XSL emits ("IG."/"CL."/"MT."), else "".
    #[serde(rename = "idPrefix", default, skip_serializing_if = "String::is_empty")]
    pub id_prefix: String,
    /// For ItemDef: the domain/group code parsed from OID (IT.<DOMAIN>.<VAR>),
    /// so the UI scopes highlight to that group's rendered block.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub domain: String,
    /// For ItemDef: the variable name (row label within the group block).
    #[serde(rename = "varName", default, skip_serializing_if = "String::is_empty")]
    pub var_name: String,
    #[serde(rename = "changedAttrs", default, skip_serializing_if = "Vec::is_empty")]
    pub changed_attrs: Vec<String>,
    /// Bare names of changed attributes (e.g. ["Length","SignificantDigits"]) so
    /// the UI can map them to table columns and tint only those cells.
    #[serde(rename = "changedKeys", default, skip_serializing_if = "Vec::is_empty")]
    pub changed_keys: Vec<String>,
}

pub fn xml_diff(path_a: &str, path_b: &str) -> Result<XmlResult, String> {
    let mut res = XmlResult {
        file_type: "xml".into(),
        path_a: path_a.into(),
        path_b: path_b.into(),
        ..Default::default()
    };

    if !path_a.is_empty() {
        let (xml, xsl, note) = load_side(path_a)?;
        res.xml_a = xml;
        res.xsl_a = xsl;
        if let Some(n) = note {
            res.notes.push(format!("A: {n}"));
        }
    }
    if !path_b.is_empty() {
        let (xml, xsl, note) = load_side(path_b)?;
        res.xml_b = xml;
        res.xsl_b = xsl;
        if let Some(n) = note {
            res.notes.push(format!("B: {n}"));
        }
    }

    if !res.xml_a.is_empty() && !res.xml_b.is_empty() {
        match tree_diff(&res.xml_a, &res.xml_b) {
            Ok(c) => res.changes = c,
            Err(e) => res.notes.push(format!("diff: {e}")),
        }
    }

    Ok(res)
}

// --- recursive tree diff ---------------------------------------------------

/// HTML anchor-id prefix the define.xml stylesheet emits per element type.
fn id_prefix(elem_type: &str) -> &'static str {
    match elem_type {
        "ItemGroupDef" => "IG.",
        "CodeList" => "CL.",
        "MethodDef" => "MT.",
        "CommentDef" => "COMM.",
        _ => "",
    }
}

/// tree_diff parses both documents and walks them in parallel, matching child
/// elements by key (OID > Name > tag@position) and recording every node that is
/// added/removed, or whose attributes/text changed.
fn tree_diff(xml_a: &str, xml_b: &str) -> Result<Vec<XmlChange>, String> {
    let da = roxmltree::Document::parse(xml_a).map_err(|e| format!("parse A: {e}"))?;
    let db = roxmltree::Document::parse(xml_b).map_err(|e| format!("parse B: {e}"))?;
    let mut changes = Vec::new();
    diff_node(da.root_element(), db.root_element(), &mut changes);
    Ok(changes)
}

/// A stable key for matching a node among its siblings. Many ODM elements have
/// no OID/Name — their identity is another attribute: CodeList items key on
/// CodedValue, ItemRefs on ItemOID, etc. Without this, reordered/added codelist
/// terms would be paired positionally and report as all-changed.
fn node_key(n: roxmltree::Node) -> String {
    let tag = n.tag_name().name();
    // Identity attributes in priority order; first present wins.
    for attr in ["OID", "Name", "CodedValue", "ItemOID", "MethodOID", "leafID", "Context"] {
        if let Some(v) = n.attribute(attr) {
            return format!("{tag}#{v}");
        }
    }
    // No identity attr: key by tag only; positional pairing handles order.
    tag.to_string()
}

fn local_tag<'a>(n: roxmltree::Node<'a, 'a>) -> &'a str {
    n.tag_name().name()
}

/// Build a change record for a node (added/removed), pulling location hints.
fn mk_change(kind: &str, n: roxmltree::Node, changed_attrs: Vec<String>) -> XmlChange {
    let elem_type = local_tag(n).to_string();
    let oid = n.attribute("OID").unwrap_or("").to_string();
    let name = n.attribute("Name").unwrap_or("").to_string();
    let label = if !name.is_empty() { name.clone() } else { oid.clone() };
    // ItemDef OID convention IT.<DOMAIN>.<VAR> -> domain for group-scoped locate.
    let (domain, var_name) = if elem_type == "ItemDef" {
        let parts: Vec<&str> = oid.splitn(3, '.').collect();
        let dom = if parts.len() == 3 { parts[1].to_string() } else { String::new() };
        (dom, name)
    } else {
        (String::new(), String::new())
    };
    // Bare attribute names from "Name: old → new" entries, for column mapping.
    let changed_keys: Vec<String> = changed_attrs
        .iter()
        .filter_map(|s| s.split(':').next().map(|k| k.trim().to_string()))
        .filter(|k| !k.is_empty() && k != "(text changed)")
        .collect();
    XmlChange {
        kind: kind.into(),
        elem_type: local_tag(n).to_string(),
        oid,
        label,
        id_prefix: id_prefix(local_tag(n)).to_string(),
        domain,
        var_name,
        changed_attrs,
        changed_keys,
    }
}

/// Compare two matched element nodes: their attributes, then their children.
fn diff_node(a: roxmltree::Node, b: roxmltree::Node, out: &mut Vec<XmlChange>) {
    diff_node_inner(a, b, out);
}

/// Returns true if anything in this subtree (this node or a descendant) changed.
/// A change in a keyless descendant (e.g. a CodeList's EnumeratedItem) bubbles up
/// to the nearest identity-bearing ancestor, which is what gets reported.
fn diff_node_inner(a: roxmltree::Node, b: roxmltree::Node, out: &mut Vec<XmlChange>) -> bool {
    // Locatable = OID/Name (has a rendered anchor, can appear in the list).
    // Keyed-but-not-locatable children (CodedValue/ItemOID) only bubble up.
    let locatable = node_is_locatable(b);

    // This node's own attribute/text changes.
    let attr_changes = attr_diffs(a, b);
    let text_changed = direct_text(a) != direct_text(b);
    let mut own_changed = !attr_changes.is_empty() || text_changed;

    // Recurse into children, matching by key.
    let a_children: Vec<roxmltree::Node> = a.children().filter(|c| c.is_element()).collect();
    let b_children: Vec<roxmltree::Node> = b.children().filter(|c| c.is_element()).collect();
    let mut a_by_key: BTreeMap<String, Vec<roxmltree::Node>> = BTreeMap::new();
    for c in &a_children {
        a_by_key.entry(node_key(*c)).or_default().push(*c);
    }
    let mut a_used: BTreeMap<String, usize> = BTreeMap::new();
    let mut descendant_changed = false;

    for &bc in &b_children {
        let key = node_key(bc);
        let idx = a_used.entry(key.clone()).or_insert(0);
        let matched = a_by_key.get(&key).and_then(|v| v.get(*idx)).copied();
        match matched {
            Some(ac) => {
                *idx += 1;
                let child_changed = diff_node_inner(ac, bc, out);
                // A changed child that isn't itself locatable surfaces via us.
                if child_changed && !node_is_locatable(bc) {
                    descendant_changed = true;
                }
            }
            None => {
                if emit_subtree("added", bc, out) {
                    // added child reported itself; but a keyless added child
                    // (e.g. a new EnumeratedItem) is only visible via this node.
                } else {
                    descendant_changed = true;
                }
            }
        }
    }
    for (key, nodes) in &a_by_key {
        let used = a_used.get(key).copied().unwrap_or(0);
        for &ac in nodes.iter().skip(used) {
            if !emit_subtree("removed", ac, out) {
                descendant_changed = true;
            }
        }
    }

    // Report THIS node only if it's locatable (OID/Name) and something changed —
    // its own attrs, or a non-locatable descendant (so a CodeList surfaces when
    // its terms change, but the individual EnumeratedItems don't clutter the list).
    if locatable && (own_changed || descendant_changed) {
        let mut ch = mk_change("modified", b, attr_changes);
        if ch.changed_attrs.is_empty() {
            ch.changed_attrs.push(if own_changed { "(text changed)".into() } else { "(items changed)".into() });
        }
        out.push(ch);
        own_changed = true;
    }

    own_changed || descendant_changed
}

/// Locatable = has a rendered anchor (OID/Name). These can appear in the change
/// list and be highlighted; keyed-only nodes (CodedValue/ItemOID) cannot.
fn node_is_locatable(n: roxmltree::Node) -> bool {
    n.attribute("OID").is_some() || n.attribute("Name").is_some()
}

/// Emit a change for an added/removed node and its identity-bearing descendants.
/// Returns true if at least one OID/Name-bearing node was reported (so the caller
/// knows whether the change is independently locatable, or must bubble up).
fn emit_subtree(kind: &str, n: roxmltree::Node, out: &mut Vec<XmlChange>) -> bool {
    let mut reported = false;
    // Only OID/Name nodes are independently locatable in the rendered page.
    if n.attribute("OID").is_some() || n.attribute("Name").is_some() {
        out.push(mk_change(kind, n, Vec::new()));
        reported = true;
    }
    for c in n.children().filter(|c| c.is_element()) {
        if emit_subtree(kind, c, out) {
            reported = true;
        }
    }
    reported
}

/// direct_text = concatenation of this node's immediate text children (trimmed).
fn direct_text(n: roxmltree::Node) -> String {
    let mut s = String::new();
    for c in n.children() {
        if c.is_text() {
            s.push_str(c.text().unwrap_or(""));
        }
    }
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// attr_diffs lists attributes that differ as "name: old → new".
fn attr_diffs(a: roxmltree::Node, b: roxmltree::Node) -> Vec<String> {
    let am: BTreeMap<&str, &str> = a.attributes().map(|x| (x.name(), x.value())).collect();
    let bm: BTreeMap<&str, &str> = b.attributes().map(|x| (x.name(), x.value())).collect();
    let mut out = Vec::new();
    for (k, bv) in &bm {
        match am.get(k) {
            Some(av) if av == bv => {}
            Some(av) => out.push(format!("{k}: {av} → {bv}")),
            None => out.push(format!("{k}: (added) → {bv}")),
        }
    }
    for (k, av) in &am {
        if !bm.contains_key(k) {
            out.push(format!("{k}: {av} → (removed)"));
        }
    }
    out
}

/// load_side reads one XML file and the stylesheet it references (same dir).
/// Returns (xml_text, xsl_text, optional_note).
fn load_side(path: &str) -> Result<(String, String, Option<String>), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {}", path, e))?;
    let xml = String::from_utf8_lossy(&bytes).into_owned();

    let Some(href) = stylesheet_href(&xml) else {
        return Ok((xml, String::new(), Some("no xml-stylesheet reference".into())));
    };
    let dir = Path::new(path).parent().unwrap_or_else(|| Path::new("."));
    let xsl_path = dir.join(&href);
    match std::fs::read(&xsl_path) {
        Ok(b) => Ok((xml, String::from_utf8_lossy(&b).into_owned(), None)),
        Err(_) => Ok((
            xml,
            String::new(),
            Some(format!("stylesheet {:?} not found next to the file", href)),
        )),
    }
}

/// stylesheet_href extracts the href from a `<?xml-stylesheet ... ?>` processing
/// instruction (the first one).
fn stylesheet_href(xml: &str) -> Option<String> {
    let pi_start = xml.find("<?xml-stylesheet")?;
    let rest = &xml[pi_start..];
    let pi_end = rest.find("?>")?;
    let pi = &rest[..pi_end];
    let h = pi.find("href")?;
    let after = &pi[h + 4..];
    let q1 = after.find(['"', '\''])?;
    let quote = after.as_bytes()[q1] as char;
    let after = &after[q1 + 1..];
    let q2 = after.find(quote)?;
    Some(after[..q2].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_stylesheet_href() {
        let xml = r#"<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="define2-0-0.xsl"?><ODM/>"#;
        assert_eq!(stylesheet_href(xml).as_deref(), Some("define2-0-0.xsl"));
    }

    #[test]
    fn no_stylesheet() {
        let xml = r#"<?xml version="1.0"?><root/>"#;
        assert_eq!(stylesheet_href(xml), None);
    }

    #[test]
    fn single_quotes() {
        let xml = r#"<?xml-stylesheet href='s.xsl' type='text/xsl'?><x/>"#;
        assert_eq!(stylesheet_href(xml).as_deref(), Some("s.xsl"));
    }
}
