//! XML diff for define.xml (CDISC ODM) and similar stylesheet-backed XML. We
//! return each file's raw XML plus the XSL it references (found in the same
//! directory via the `<?xml-stylesheet href="...">` processing instruction).
//! The frontend transforms each through the browser's XSLTProcessor, renders the
//! two documents side by side, and diffs the rendered text line-by-line.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use tate::tree::{tree_diff as tate_tree_diff, AttrChange, ChangeKind, TreeNode};

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
    #[serde(
        rename = "changedAttrs",
        default,
        skip_serializing_if = "Vec::is_empty"
    )]
    pub changed_attrs: Vec<String>,
    /// Bare names of changed attributes (e.g. ["Length","SignificantDigits"]) so
    /// the UI can map them to table columns and tint only those cells.
    #[serde(rename = "changedKeys", default, skip_serializing_if = "Vec::is_empty")]
    pub changed_keys: Vec<String>,
    /// Semantic columns of the rendered variable table that this change affects:
    /// any of name | label | type | role | length | terms | origin. The UI tints
    /// exactly those cells instead of the whole row. Empty ⇒ tint whole row
    /// (e.g. an added/removed variable).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cols: Vec<String>,
    /// For CodeList: the individual terms (CodedValue) that were added/removed/
    /// modified, so the UI tints only those rows — not the whole codelist.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<ItemChg>,
    /// For CodeList: true when the codelist's own attributes (Name/etc.) changed,
    /// so the UI should also tint the caption (not just term rows).
    #[serde(rename = "captionChanged", default, skip_serializing_if = "is_false")]
    pub caption_changed: bool,
    /// True for value-level ItemDefs (OID like IT.EG.EGORRES.EG.EGTESTCD.EQ.EGALL)
    /// — these render in a collapsible `tr.vlm` sub-table, not the main row.
    #[serde(rename = "valueLevel", default, skip_serializing_if = "is_false")]
    pub value_level: bool,
    /// For value-level changes: the parent variable's ItemDef OID (IT.EG.EGORRES),
    /// used to find the VLM container rows (whose class carries it).
    #[serde(
        rename = "parentOid",
        default,
        skip_serializing_if = "String::is_empty"
    )]
    pub parent_oid: String,
    /// For value-level changes: the where-clause variable + value (EGTESTCD, EGALL)
    /// parsed from the OID, to match the specific VLM row by its rendered text.
    #[serde(rename = "whereVar", default, skip_serializing_if = "String::is_empty")]
    pub where_var: String,
    #[serde(rename = "whereVal", default, skip_serializing_if = "String::is_empty")]
    pub where_val: String,
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// A single changed CodeList term, keyed by its CodedValue (the text rendered in
/// the codelist table's first cell). `kind` ∈ added | removed | modified.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemChg {
    pub value: String,
    pub kind: String,
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

// --- tree diff via tate -----------------------------------------------------

/// tree_diff parses both documents, converts them to tate's format-agnostic
/// [`TreeNode`] representation, runs [`tate::tree::tree_diff`], then enriches
/// each structural change with CDISC-specific fields (column mapping, codelist
/// term diffs, OID parsing).
fn tree_diff(xml_a: &str, xml_b: &str) -> Result<Vec<XmlChange>, String> {
    let da = roxmltree::Document::parse(xml_a).map_err(|e| format!("parse A: {e}"))?;
    let db = roxmltree::Document::parse(xml_b).map_err(|e| format!("parse B: {e}"))?;

    // OID → original roxmltree node, so CDISC enrichment (which needs to inspect
    // child element signatures) can look nodes up by identity after tate returns.
    let mut a_map: HashMap<String, roxmltree::Node> = HashMap::new();
    let mut b_map: HashMap<String, roxmltree::Node> = HashMap::new();
    let ta = convert_node(da.root_element(), &mut a_map);
    let tb = convert_node(db.root_element(), &mut b_map);

    let diff = tate_tree_diff(&ta, &tb);

    let mut out = Vec::new();
    for tc in &diff.changes {
        let kind_str = match tc.kind {
            ChangeKind::Added => "added",
            ChangeKind::Removed => "removed",
            ChangeKind::Modified => "modified",
        };
        let elem_type = tc.elem_type.clone();
        let oid = tc.id.clone();
        let idp = id_prefix(&elem_type).to_string();

        let changed_attrs: Vec<String> = tc.changed_attrs.iter().map(format_attr_change).collect();
        let changed_keys: Vec<String> = changed_attrs
            .iter()
            .filter_map(|s| s.split(':').next().map(|k| k.trim().to_string()))
            .filter(|k| !k.is_empty() && k != "(text changed)")
            .collect();

        // tate reports Added/Modified from the B side, Removed from the A side —
        // mirror that to fetch the Name attribute used for ItemDef var_name.
        let primary = match tc.kind {
            ChangeKind::Removed => a_map.get(&oid).copied(),
            _ => b_map.get(&oid).copied(),
        };
        let name = primary
            .and_then(|n| n.attribute("Name").map(|s| s.to_string()))
            .unwrap_or_default();

        let (domain, var_name, value_level, parent_oid, where_var, where_val) =
            parse_itemdef_oid(&elem_type, &oid, &name);

        // CDISC-specific enrichment for Modified nodes: map the change to exact
        // rendered columns (ItemDef) or changed terms (CodeList) so the UI tints
        // precisely rather than lighting the whole row/list. These need both the
        // A and B roxmltree nodes, looked up by OID.
        let mut cols = Vec::new();
        let mut items = Vec::new();
        let mut caption_changed = false;
        if tc.kind == ChangeKind::Modified {
            if elem_type == "ItemDef" {
                if let (Some(a), Some(b)) = (a_map.get(&oid).copied(), b_map.get(&oid).copied()) {
                    cols = item_def_columns(a, b);
                }
            } else if elem_type == "CodeList" {
                if let (Some(a), Some(b)) = (a_map.get(&oid).copied(), b_map.get(&oid).copied()) {
                    let (it, cap) = codelist_changes(a, b);
                    items = it;
                    caption_changed = cap;
                }
            }
        }

        // A Modified node with no attribute changes still changed somehow (text
        // or a non-locatable descendant). Surface a marker so the UI has something
        // to show; the bare key list excludes it.
        let mut changed_attrs = changed_attrs;
        if tc.kind == ChangeKind::Modified && changed_attrs.is_empty() {
            let text_changed = match (a_map.get(&oid).copied(), b_map.get(&oid).copied()) {
                (Some(a), Some(b)) => direct_text(a) != direct_text(b),
                _ => false,
            };
            changed_attrs.push(
                if text_changed {
                    "(text changed)"
                } else {
                    "(items changed)"
                }
                .to_string(),
            );
        }

        out.push(XmlChange {
            kind: kind_str.to_string(),
            elem_type,
            oid,
            label: tc.label.clone(),
            id_prefix: idp,
            domain,
            var_name,
            changed_attrs,
            changed_keys,
            cols,
            items,
            caption_changed,
            value_level,
            parent_oid,
            where_var,
            where_val,
        });
    }

    Ok(out)
}

/// Convert a roxmltree element into a format-agnostic [`TreeNode`].
///
/// Identity is set from `OID` (or `Name` when absent) — exactly the attributes
/// that give a node a rendered anchor, so tate's "identity = locatable" rule
/// matches CDISC's notion of a listable node. Other key-like attributes
/// (CodedValue, ItemOID, …) are intentionally left unset: those elements stay
/// positional in tate and bubble up to their nearest OID/Name ancestor, which is
/// what gets enriched (e.g. a CodeList surfaces when its terms change). Every
/// locatable node is also recorded in `map` for later CDISC enrichment.
fn convert_node<'a, 'input: 'a>(
    n: roxmltree::Node<'a, 'input>,
    map: &mut HashMap<String, roxmltree::Node<'a, 'input>>,
) -> TreeNode {
    let tag = n.tag_name().name().to_string();
    let oid = n.attribute("OID").map(|s| s.to_string());
    let name = n.attribute("Name").unwrap_or("");
    let identity = oid.clone().or_else(|| {
        if !name.is_empty() {
            Some(name.to_string())
        } else {
            None
        }
    });
    let label = if !name.is_empty() {
        name.to_string()
    } else {
        identity.clone().unwrap_or_default()
    };

    if let Some(id) = &identity {
        map.insert(id.clone(), n);
    }

    let attributes: Vec<(String, String)> = n
        .attributes()
        .map(|a| (a.name().to_string(), a.value().to_string()))
        .collect();
    let text = direct_text(n);
    let children: Vec<TreeNode> = n
        .children()
        .filter(|c| c.is_element())
        .map(|c| convert_node(c, map))
        .collect();

    TreeNode {
        kind: tag,
        identity,
        label,
        attributes,
        text,
        children,
    }
}

/// Format a tate [`AttrChange`] as "name: old → new" (with `(added)`/`(removed)`
/// markers for attributes present on only one side), matching the prior
/// roxmltree-based attr_diffs output.
fn format_attr_change(c: &AttrChange) -> String {
    if c.old.is_empty() && !c.new.is_empty() {
        format!("{}: (added) → {}", c.name, c.new)
    } else if !c.old.is_empty() && c.new.is_empty() {
        format!("{}: {} → (removed)", c.name, c.old)
    } else {
        format!("{}: {} → {}", c.name, c.old, c.new)
    }
}

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

/// Parse an ItemDef OID into the location hints the UI needs.
///
/// Regular:      `IT.<DOMAIN>.<VAR>`                              (3 segments)
/// Value-level:  `IT.<DOMAIN>.<VAR>.<WDOM>.<WVAR>.<COMP>.<VAL>`   (>3 segments)
/// The value-level rows render in a collapsible VLM sub-table keyed by the
/// parent variable's OID, matched on the where-clause text "<WVAR> = <VAL>".
fn parse_itemdef_oid(
    elem_type: &str,
    oid: &str,
    name: &str,
) -> (String, String, bool, String, String, String) {
    let mut domain = String::new();
    let mut var_name = String::new();
    let mut value_level = false;
    let mut parent_oid = String::new();
    let mut where_var = String::new();
    let mut where_val = String::new();
    if elem_type == "ItemDef" {
        let parts: Vec<&str> = oid.split('.').collect();
        if parts.len() >= 3 {
            domain = parts[1].to_string();
        }
        if parts.len() > 3 {
            value_level = true;
            parent_oid = parts[..3].join(".");
            // trailing where segments: <WDOM> <WVAR> <COMP> <VAL...>
            if parts.len() >= 5 {
                where_var = parts[4].to_string();
            }
            if let Some(last) = parts.last() {
                where_val = (*last).to_string();
            }
            var_name = name.to_string();
        } else {
            var_name = name.to_string();
        }
    }
    (
        domain,
        var_name,
        value_level,
        parent_oid,
        where_var,
        where_val,
    )
}

// --- CDISC enrichment (roxmltree-based) -------------------------------------

/// Canonical signature of an element subtree (tag + sorted attrs + text +
/// children, recursively). Two structurally identical subtrees produce the same
/// string, so we can detect a change in any descendant by comparing signatures.
fn subtree_sig(n: roxmltree::Node) -> String {
    let mut s = String::new();
    s.push('<');
    s.push_str(n.tag_name().name());
    let mut attrs: Vec<(&str, &str)> = n.attributes().map(|a| (a.name(), a.value())).collect();
    attrs.sort_unstable();
    for (k, v) in attrs {
        s.push(' ');
        s.push_str(k);
        s.push('=');
        s.push_str(v);
    }
    s.push('>');
    let t = direct_text(n);
    if !t.is_empty() {
        s.push_str(&t);
    }
    for c in n.children().filter(|c| c.is_element()) {
        s.push_str(&subtree_sig(c));
    }
    s
}

/// Signature of the first child element with the given local tag name, or "" if
/// there's no such child. Used to compare one logical "column" (Description,
/// Origin, CodeListRef…) of an ItemDef across the two sides.
fn child_sig(n: roxmltree::Node, tag: &str) -> String {
    n.children()
        .filter(|c| c.is_element())
        .find(|c| c.tag_name().name() == tag)
        .map(subtree_sig)
        .unwrap_or_default()
}

/// Which rendered-table COLUMNS of an ItemDef changed. The define.xml variable
/// table has fixed columns (Variable, Label, Type, Role, Length, Controlled
/// Terms, Origin); we attribute each change to the specific column so the UI
/// tints only those cells instead of the whole row. Role lives on the ItemRef,
/// not the ItemDef, so it isn't covered here.
fn item_def_columns(a: roxmltree::Node, b: roxmltree::Node) -> Vec<String> {
    let mut cols = Vec::new();
    if a.attribute("Name") != b.attribute("Name") {
        cols.push("name".to_string());
    }
    if child_sig(a, "Description") != child_sig(b, "Description") {
        cols.push("label".to_string());
    }
    if a.attribute("DataType") != b.attribute("DataType") {
        cols.push("type".to_string());
    }
    if a.attribute("Length") != b.attribute("Length")
        || a.attribute("DisplayFormat") != b.attribute("DisplayFormat")
        || a.attribute("SignificantDigits") != b.attribute("SignificantDigits")
    {
        cols.push("length".to_string());
    }
    if child_sig(a, "CodeListRef") != child_sig(b, "CodeListRef")
        || child_sig(a, "ValueListRef") != child_sig(b, "ValueListRef")
    {
        cols.push("terms".to_string());
    }
    if child_sig(a, "Origin") != child_sig(b, "Origin")
        || a.attribute("CommentOID") != b.attribute("CommentOID")
    {
        cols.push("origin".to_string());
    }
    cols
}

/// Child elements of a CodeList keyed by their CodedValue (the term text).
fn coded_items<'a>(n: roxmltree::Node<'a, 'a>) -> BTreeMap<String, roxmltree::Node<'a, 'a>> {
    n.children()
        .filter(|c| c.is_element())
        .filter_map(|c| c.attribute("CodedValue").map(|v| (v.to_string(), c)))
        .collect()
}

/// For a modified CodeList: which individual terms (by CodedValue) were added,
/// removed, or modified, plus whether the codelist's own attributes (e.g. Name)
/// changed (caption). Lets the UI tint only the affected term rows.
fn codelist_changes(a: roxmltree::Node, b: roxmltree::Node) -> (Vec<ItemChg>, bool) {
    let caption_changed = a.attribute("Name") != b.attribute("Name")
        || a.attribute("DataType") != b.attribute("DataType");
    let am = coded_items(a);
    let bm = coded_items(b);
    let mut items = Vec::new();
    for (k, bn) in &bm {
        match am.get(k) {
            None => items.push(ItemChg {
                value: k.clone(),
                kind: "added".into(),
            }),
            Some(an) => {
                if subtree_sig(*an) != subtree_sig(*bn) {
                    items.push(ItemChg {
                        value: k.clone(),
                        kind: "modified".into(),
                    });
                }
            }
        }
    }
    for k in am.keys() {
        if !bm.contains_key(k) {
            items.push(ItemChg {
                value: k.clone(),
                kind: "removed".into(),
            });
        }
    }
    (items, caption_changed)
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

/// load_side reads one XML file and the stylesheet it references (same dir).
/// Returns (xml_text, xsl_text, optional_note).
fn load_side(path: &str) -> Result<(String, String, Option<String>), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {}", path, e))?;
    let xml = String::from_utf8_lossy(&bytes).into_owned();

    let Some(href) = stylesheet_href(&xml) else {
        return Ok((
            xml,
            String::new(),
            Some("no xml-stylesheet reference".into()),
        ));
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

    // A change confined to <def:Origin> (a PDFPageRef was added) must map to the
    // "origin" column only — not light the whole variable row (bug #3).
    #[test]
    fn item_def_change_maps_to_single_column() {
        let a = r#"<ODM><ItemDef OID="IT.DM.SEX" Name="SEX" DataType="text" Length="1">
            <def:Origin xmlns:def="d" Type="CRF"><def:DocumentRef leafID="LF.acrf"/></def:Origin>
        </ItemDef></ODM>"#;
        let b = r#"<ODM><ItemDef OID="IT.DM.SEX" Name="SEX" DataType="text" Length="1">
            <def:Origin xmlns:def="d" Type="CRF"><def:DocumentRef leafID="LF.acrf"><def:PDFPageRef PageRefs="9"/></def:DocumentRef></def:Origin>
        </ItemDef></ODM>"#;
        let c = tree_diff(a, b).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].cols, vec!["origin"]);
        assert!(!c[0].value_level);
    }

    // A value-level ItemDef (OID has where-clause segments) is flagged value_level
    // with its parent OID and where parts parsed out (bug #2).
    #[test]
    fn value_level_item_detected() {
        let a = r#"<ODM><ItemDef OID="IT.EG.EGORRES.EG.EGTESTCD.EQ.EGALL" Name="x" DataType="text" Length="1"/></ODM>"#;
        let b = r#"<ODM><ItemDef OID="IT.EG.EGORRES.EG.EGTESTCD.EQ.EGALL" Name="x" DataType="text" Length="99"/></ODM>"#;
        let c = tree_diff(a, b).unwrap();
        assert_eq!(c.len(), 1);
        assert!(c[0].value_level);
        assert_eq!(c[0].parent_oid, "IT.EG.EGORRES");
        assert_eq!(c[0].where_var, "EGTESTCD");
        assert_eq!(c[0].where_val, "EGALL");
        assert_eq!(c[0].cols, vec!["length"]);
    }

    // A CodeList whose terms change reports the specific terms (added/removed),
    // not the whole list; caption_changed tracks the codelist's own attrs (bug #1).
    #[test]
    fn codelist_reports_only_changed_terms() {
        let a = r#"<ODM><CodeList OID="CL.X" Name="X">
            <EnumeratedItem CodedValue="KEEP"/><EnumeratedItem CodedValue="GONE"/>
        </CodeList></ODM>"#;
        let b = r#"<ODM><CodeList OID="CL.X" Name="X">
            <EnumeratedItem CodedValue="KEEP"/><EnumeratedItem CodedValue="NEW"/>
        </CodeList></ODM>"#;
        let c = tree_diff(a, b).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].elem_type, "CodeList");
        assert!(!c[0].caption_changed);
        let mut got: Vec<(String, String)> = c[0]
            .items
            .iter()
            .map(|i| (i.value.clone(), i.kind.clone()))
            .collect();
        got.sort();
        assert_eq!(
            got,
            vec![
                ("GONE".to_string(), "removed".to_string()),
                ("NEW".to_string(), "added".to_string())
            ]
        );
    }

    #[test]
    fn codelist_caption_change_flagged() {
        let a = r#"<ODM><CodeList OID="CL.X" Name="Old"><EnumeratedItem CodedValue="A"/></CodeList></ODM>"#;
        let b = r#"<ODM><CodeList OID="CL.X" Name="New"><EnumeratedItem CodedValue="A"/></CodeList></ODM>"#;
        let c = tree_diff(a, b).unwrap();
        assert_eq!(c.len(), 1);
        assert!(c[0].caption_changed);
        assert!(c[0].items.is_empty());
    }
}
