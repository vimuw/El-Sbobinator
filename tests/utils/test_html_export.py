import unittest

from el_sbobinator.utils.html_export import (
    build_html_document,
    build_html_document_from_body,
    normalize_heading_levels,
    normalize_inline_star_lists,
    sanitize_html_basic,
)


class NormalizeInlineStarListsTests(unittest.TestCase):
    def test_empty_paragraph_typing_marks_survive_save_sanitization(self):
        result = sanitize_html_basic(
            '<p data-editor-empty-marks="[{&quot;type&quot;:&quot;bold&quot;}]" '
            'onclick="bad()"></p><span data-editor-empty-marks="[]">Testo</span>'
        )
        self.assertIn("data-editor-empty-marks", result)
        self.assertNotIn("onclick", result)
        self.assertNotIn("<span data-editor-empty-marks", result)

    def test_standalone_export_uses_shared_editor_typography(self):
        from el_sbobinator.utils.html_export import build_html_document_from_body

        exported = build_html_document_from_body(
            "Appunti", "<h3>Sezione</h3><p>Testo</p>"
        )
        self.assertIn("font-size: 11pt;", exported)
        self.assertIn(
            "h3 { font-size: 14pt; line-height: 1.38; margin: 16pt 0 4pt;", exported
        )
        self.assertIn("p { margin: 0pt 0; }", exported)
        self.assertIn("body > p:first-child { margin-top: 0; }", exported)
        self.assertIn("<h3>Sezione</h3><p>Testo</p>", exported)

    def test_editor_image_layout_survives_sanitization(self):
        source = '<div data-editor-image="true" data-layout="wrap" data-align="right" data-position="100" data-width="35" style="float:right;width:35%"><img src="https://example.com/image.png" width="222"></div>'
        result = sanitize_html_basic(source)
        self.assertIn('data-position="100"', result)
        self.assertIn('data-layout="wrap"', result)
        self.assertIn('data-align="right"', result)
        self.assertIn("float:right", result)

    def test_resized_image_dimensions_survive_sanitization(self):
        source = '<span data-editor-image="true" data-layout="inline" data-width="35" data-aspect-ratio="2.5" data-offset-x="-25" data-offset-y="-30"><img src="https://example.com/image.png" width="222" height="89" style="width:100%;height:auto;aspect-ratio:2.5;object-fit:fill"></span>'
        result = sanitize_html_basic(source)
        self.assertIn('data-aspect-ratio="2.5"', result)
        self.assertIn('data-offset-x="-25"', result)
        self.assertIn('data-offset-y="-30"', result)
        self.assertIn('height="89"', result)
        self.assertIn("aspect-ratio:2.5", result)

    def test_empty_string(self):
        self.assertEqual(normalize_inline_star_lists(""), "")

    def test_none_treated_as_empty(self):
        self.assertEqual(normalize_inline_star_lists(None), "")  # type: ignore[arg-type]

    def test_plain_text_unchanged(self):
        text = "Hello world\nAnother line"
        self.assertEqual(normalize_inline_star_lists(text), text)

    def test_unicode_bullet_at_line_start_converted_to_list(self):
        md = "\u25cf Voce uno\n\u25cf Voce due"
        result = normalize_inline_star_lists(md)
        self.assertIn("- Voce uno", result)
        self.assertIn("- Voce due", result)

    def test_unicode_square_bullet_converted_to_list(self):
        md = "\u25a0 Voce quadrata uno\n\u25a0 Voce quadrata due"
        result = normalize_inline_star_lists(md)
        self.assertIn("- Voce quadrata uno", result)
        self.assertIn("- Voce quadrata due", result)

    def test_unicode_sub_bullet_at_line_start(self):
        md = "\u25e6 Sub-voce"
        result = normalize_inline_star_lists(md)
        self.assertIn("- Sub-voce", result)

    def test_unicode_bullet_with_empty_rest_not_converted(self):
        md = "\u25cf "
        result = normalize_inline_star_lists(md)
        self.assertNotIn("- ", result)

    def test_inline_bullets_split_into_separate_lines(self):
        md = "Esempi: \u25cf Alpha \u25cf Beta"
        result = normalize_inline_star_lists(md)
        self.assertIn("- Alpha", result)
        self.assertIn("- Beta", result)

    def test_colon_star_normalization(self):
        md = "Esempi: * Voce1 * Voce2"
        result = normalize_inline_star_lists(md)
        self.assertIn("- Voce1", result)
        self.assertIn("- Voce2", result)

    def test_blank_line_inserted_before_list_after_text(self):
        md = "Testo normale\n- Voce lista"
        result = normalize_inline_star_lists(md)
        lines = result.splitlines()
        list_idx = next(i for i, l in enumerate(lines) if l.startswith("- "))
        self.assertEqual(lines[list_idx - 1], "")

    def test_no_blank_line_inserted_between_consecutive_list_items(self):
        md = "- Voce uno\n- Voce due\n- Voce tre"
        result = normalize_inline_star_lists(md)
        lines = result.splitlines()
        self.assertNotIn("", lines)

    def test_fenced_code_block_preserved_unchanged(self):
        md = "```\n\u25cf non convertire\n* non convertire\n```"
        result = normalize_inline_star_lists(md)
        self.assertIn("\u25cf non convertire", result)
        self.assertIn("* non convertire", result)

    def test_nbsp_replaced_before_processing(self):
        md = "\u00a0testo"
        result = normalize_inline_star_lists(md)
        self.assertIn(" testo", result)


class NormalizeHeadingLevelsTests(unittest.TestCase):
    def test_empty_string(self):
        self.assertEqual(normalize_heading_levels(""), "")

    def test_none_treated_as_empty(self):
        self.assertEqual(normalize_heading_levels(None), "")  # type: ignore[arg-type]

    def test_h1_to_h5_unchanged(self):
        for level in range(1, 6):
            hashes = "#" * level
            md = f"{hashes} Titolo"
            result = normalize_heading_levels(md)
            self.assertIn(f"{hashes} Titolo", result)

    def test_h6_clamped_to_h5(self):
        result = normalize_heading_levels("###### Profondo")
        self.assertIn("##### Profondo", result)
        self.assertNotIn("######", result)

    def test_h7_clamped_to_h5(self):
        result = normalize_heading_levels("####### Molto profondo")
        self.assertIn("##### Molto profondo", result)

    def test_indented_heading_preserved(self):
        result = normalize_heading_levels("  ## Titolo indentato")
        self.assertIn("## Titolo indentato", result)

    def test_non_heading_lines_unchanged(self):
        md = "Testo normale\n**grassetto**\n- lista"
        result = normalize_heading_levels(md)
        self.assertEqual(result, md)

    def test_fenced_code_block_skipped(self):
        md = "```\n###### non toccare\n```"
        result = normalize_heading_levels(md)
        self.assertIn("###### non toccare", result)

    def test_fence_toggle_with_content_after(self):
        md = "```\n###### dentro\n```\n###### fuori"
        result = normalize_heading_levels(md)
        self.assertIn("###### dentro", result)
        self.assertIn("##### fuori", result)

    def test_trailing_spaces_stripped_from_heading_content(self):
        result = normalize_heading_levels("## Titolo  ")
        self.assertIn("## Titolo", result)
        self.assertNotIn("Titolo  ", result)


class BuildHtmlDocumentTests(unittest.TestCase):
    def test_defaults_match_docs_without_overriding_direct_block_styles(self):
        result = build_html_document_from_body(
            "Profilo", '<h2 style="font-size:24pt;color:#123abc">Scelto</h2>'
        )
        self.assertIn("line-height: 1.38", result)
        self.assertIn("font-weight: 400; color: #666666", result)
        self.assertIn("p { margin: 0pt 0; }", result)
        self.assertIn('style="font-size:24pt;color:#123abc"', result)
        self.assertNotIn("body > p:first-child,  {", result)

    def test_keeps_native_line_spacing_metadata_on_import(self):
        result = build_html_document_from_body(
            "Profilo", '<p data-document-line-spacing="1.15">Testo</p>'
        )
        self.assertIn('data-document-line-spacing="1.15"', result)

    def test_output_is_valid_html_shell(self):
        result = build_html_document("Test", "# Ciao")
        self.assertTrue(result.strip().startswith("<!DOCTYPE html>"))
        self.assertIn("<html", result)
        self.assertIn("</html>", result)

    def test_title_appears_in_head(self):
        result = build_html_document("Lezione 1", "contenuto")
        self.assertIn("Lezione 1", result)

    def test_empty_title_defaults_to_sbobina(self):
        result = build_html_document("", "contenuto")
        self.assertIn("Sbobina", result)

    def test_none_title_defaults_to_sbobina(self):
        result = build_html_document(None, "contenuto")  # type: ignore[arg-type]
        self.assertIn("Sbobina", result)

    def test_markdown_heading_rendered_as_html(self):
        result = build_html_document("T", "## Sezione\n\nTesto qui.")
        self.assertIn("<h2>", result)
        self.assertIn("Sezione", result)

    def test_xss_title_escaped(self):
        result = build_html_document('<script>alert("xss")</script>', "body")
        self.assertNotIn("<script>", result)

    def test_csp_meta_present(self):
        result = build_html_document("T", "body")
        self.assertIn("Content-Security-Policy", result)

    def test_body_content_in_output(self):
        result = build_html_document("T", "Paragrafo semplice")
        self.assertIn("Paragrafo semplice", result)

    def test_none_markdown_produces_empty_body(self):
        result = build_html_document("T", None)  # type: ignore[arg-type]
        self.assertIn("<body>", result)


class SanitizeHtmlBasicTests(unittest.TestCase):
    def test_preserves_ordered_list_start_and_marker_type_on_save(self):
        raw = '<ol start="4" type="A"><li><p>Prima</p><ol start="2" type="i"><li><p>Figlia</p></li></ol></li><li><p>Seconda</p></li></ol>'
        cleaned = sanitize_html_basic(raw)
        self.assertIn('start="4"', cleaned)
        self.assertIn('type="A"', cleaned)
        self.assertIn('start="2"', cleaned)
        self.assertIn('type="i"', cleaned)
        self.assertEqual(cleaned.count("<li>"), 3)

    def test_preserves_data_math_attributes(self):
        raw = '<p><span data-math="E=mc^2" class="math-node-inline">formula</span></p>'
        cleaned = sanitize_html_basic(raw)
        self.assertIn('data-math="E=mc^2"', cleaned)
        self.assertIn('class="math-node-inline"', cleaned)

    def test_preserves_data_math_block_attributes(self):
        raw = '<div data-math-block="\\int x dx" class="math-node-block">integral</div>'
        cleaned = sanitize_html_basic(raw)
        self.assertIn('data-math-block="\\int x dx"', cleaned)

    def test_preserves_table_tags_and_colwidth_attributes(self):
        raw = (
            '<table border="1">'
            "<caption>Dati</caption>"
            '<colgroup><col width="120" span="1"><col width="200"></colgroup>'
            '<thead><tr><th colwidth="120" scope="col">Col 1</th><th colwidth="200" scope="col">Col 2</th></tr></thead>'
            '<tbody><tr><td colwidth="120" colspan="1" rowspan="1">Val 1</td><td colwidth="200">Val 2</td></tr></tbody>'
            '<tfoot><tr><td colspan="2">Totale</td></tr></tfoot>'
            "</table>"
        )
        cleaned = sanitize_html_basic(raw)
        self.assertIn("<table", cleaned)
        self.assertIn("<caption>Dati</caption>", cleaned)
        self.assertIn("<colgroup>", cleaned)
        self.assertIn('width="120"', cleaned)
        self.assertIn('colwidth="120"', cleaned)
        self.assertIn('colwidth="200"', cleaned)
        self.assertIn('scope="col"', cleaned)
        self.assertIn('colspan="2"', cleaned)
        self.assertIn("<tfoot>", cleaned)


if __name__ == "__main__":
    unittest.main()
