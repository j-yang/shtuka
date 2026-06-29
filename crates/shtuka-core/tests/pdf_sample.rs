//! Integration test against the real TLF sample PDF, ported from pdf_test.go.
//! Skips gracefully if the sample is absent.

use shtuka_core::pdf::{extract_pdf_lines, pdf_diff};

const SAMPLE_PDF: &str = "../../tests/sample.pdf";

#[test]
fn pdf_self_diff_clean() {
    if !std::path::Path::new(SAMPLE_PDF).exists() {
        eprintln!("no sample PDF, skipping");
        return;
    }
    let r = pdf_diff(SAMPLE_PDF, SAMPLE_PDF).expect("pdf_diff");
    assert_eq!(r.summary.insert, 0, "self-diff inserts");
    assert_eq!(r.summary.delete, 0, "self-diff deletes");
    // pdf-extract groups text into fewer, denser lines than Go's GetPlainText
    // (113 raw -> 78 after header/footer stripping for this sample), so the bar
    // is lower than the Go test's 100 while still proving substantial extraction.
    assert!(
        r.summary.equal >= 50,
        "expected substantial text, got {} equal",
        r.summary.equal
    );
}

#[test]
fn pdf_header_footer_stripping() {
    if !std::path::Path::new(SAMPLE_PDF).exists() {
        eprintln!("no sample PDF, skipping");
        return;
    }
    let lines = extract_pdf_lines(SAMPLE_PDF).expect("extract");
    let joined = format!("\n{}\n", lines.join("\n"));
    for noisy in ["\nConfidential\n", "Page 1 of 2", "Study number TESTSTUDY"] {
        assert!(
            !joined.contains(noisy),
            "running element not stripped: {:?}",
            noisy
        );
    }
    for keep in ["n (%)", "ResultToken"] {
        assert!(
            joined.contains(keep),
            "real content wrongly stripped: {:?}",
            keep
        );
    }
}
