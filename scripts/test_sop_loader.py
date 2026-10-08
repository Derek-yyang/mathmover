"""Regression checks for live edits and authoring errors; no model/network calls."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import expert_prompts as prompts


class SopLoaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.skill = self.root / "function-expert" / "SKILL.md"
        self.skill.parent.mkdir()
        self.cards = self.root / "shared" / "sops"
        self.cards.mkdir(parents=True)
        self.pitfalls = self.root / "shared" / "ggb-pitfalls.md"
        self.pitfalls.write_text("pitfalls", encoding="utf-8")
        self.card = self.cards / "fixed-point.md"
        self.card.write_text("first card", encoding="utf-8")
        self.skill.write_text("---\nname: expert\n---\nbefore\n{{SOP:fixed-point}}\nafter", encoding="utf-8")
        self.patches = [patch.object(prompts, "_SKILLS_DIR", self.root),
                        patch.object(prompts, "_SOPS_DIR", self.cards),
                        patch.object(prompts, "_PITFALLS_PATH", self.pitfalls)]
        for item in self.patches:
            item.start()
        self.catalog = prompts._ExpertPromptCatalog()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def edit(self, path, text):
        previous = path.stat().st_mtime_ns
        path.write_text(text, encoding="utf-8")
        os.utime(path, ns=(previous + 1_000_000_000, previous + 1_000_000_000))

    def test_live_card_edit_and_reference_change(self):
        self.assertEqual(self.catalog["A"], "before\nfirst card\nafter\n\npitfalls")
        self.edit(self.card, "new card")
        self.assertIn("new card", self.catalog["A"])
        self.edit(self.pitfalls, "new pitfalls")
        self.assertTrue(self.catalog["A"].endswith("new pitfalls"))
        other = self.cards / "intersection.md"
        other.write_text("second card", encoding="utf-8")
        self.edit(self.skill, "{{SOP:intersection}}\n{{SOP:fixed-point}}")
        self.assertTrue(self.catalog["A"].startswith("second card\nnew card"))

    def test_missing_card_reports_expert(self):
        self.skill.write_text("{{SOP:missing-card}}", encoding="utf-8")
        with self.assertRaisesRegex(FileNotFoundError, "function-expert.*missing-card"):
            self.catalog["A"]

    def test_malformed_or_removed_reference(self):
        for text in ("{{SOP: fixed-point}}", "no references", "{{SOP:fixed-point}}\n{{SOP:broken"):
            self.skill.write_text(text, encoding="utf-8")
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.catalog["A"]

    def test_nested_reference_is_rejected(self):
        self.card.write_text("{{SOP:intersection}}", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "嵌套引用"):
            self.catalog["A"]

    def test_frontmatter_is_not_a_dependency(self):
        self.skill.write_text("---\ndescription: {{SOP:nonexistent}}\n---\n{{SOP:fixed-point}}", encoding="utf-8")
        self.assertEqual(self.catalog["A"], "first card\n\npitfalls")


if __name__ == "__main__":
    unittest.main()
