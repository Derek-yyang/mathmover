"""Direct skill/SOP assembly and live source edits; no network calls."""
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
        self.workflow = ("COMPLETE GUIDANCE\n## 1. Foundation\n{{SOP:base}}\n"
                         "## 2. Main object\n{{SOP:function}}\n"
                         "## 3. Optional operation\n{{SOP:optional}}\n## 4. Check")
        self.skill.write_text("---\nname: expert\n---\n" + self.workflow, encoding="utf-8")
        self.cards = self.root / "shared" / "sops"
        self.cards.mkdir(parents=True)
        for name in ("base", "function", "optional", "unused"):
            (self.cards / (name + ".md")).write_text("CARD " + name, encoding="utf-8")
        self.rules = self.root / "shared" / "generation-rules.md"
        self.rules.write_text("common rules", encoding="utf-8")
        self.patches = [patch.object(prompts, attr, value) for attr, value in (
            ("_SKILLS_DIR", self.root), ("_SOPS_DIR", self.cards), ("_RULES_PATH", self.rules))]
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

    def test_skill_alone_defines_complete_card_set_and_order(self):
        result = prompts.assemble_expert_prompt("A")
        self.assertEqual(result.metadata["cards"], ["base", "function", "optional"])
        self.assertEqual(result.metadata["mode"], "full")
        self.assertEqual(result.metadata["characters"], len(result.text))
        self.assertTrue(result.text.startswith("common rules\n\nCOMPLETE GUIDANCE"))
        self.assertNotIn("name: expert", result.text)
        self.assertNotIn("CARD unused", result.text)
        self.assertNotIn("{{SOP", result.text)
        for name in result.metadata["cards"]:
            self.assertEqual(result.text.count("CARD " + name), 1)
        self.assertEqual(result.text, self.catalog["A"])

    def test_cards_expand_inside_corresponding_steps(self):
        result = prompts.assemble_expert_prompt("A")
        for step, name in ((1, "base"), (2, "function"), (3, "optional")):
            self.assertLess(result.text.index(f"## {step}."), result.text.index("CARD " + name))
            self.assertLess(result.text.index("CARD " + name), result.text.index(f"## {step + 1}."))
        self.assertIn("## 4. Check", result.text)

    def test_removed_reference_removes_only_card_not_step(self):
        self.skill.write_text(self.workflow.replace("{{SOP:optional}}", ""), encoding="utf-8")
        result = prompts.assemble_expert_prompt("A")
        self.assertEqual(result.metadata["cards"], ["base", "function"])
        self.assertIn("## 3. Optional operation", result.text)
        self.assertNotIn("CARD optional", result.text)

    def test_same_card_can_be_reused_by_another_skill(self):
        second_skill = self.root / "planar-geometry-expert" / "SKILL.md"
        second_skill.parent.mkdir()
        second_skill.write_text("## 1. Construct\n{{SOP:function}}", encoding="utf-8")
        first = prompts.assemble_expert_prompt("A")
        second = prompts.assemble_expert_prompt("B")
        self.assertIn("CARD function", first.text)
        self.assertIn("CARD function", second.text)
        self.assertEqual(second.metadata["cards"], ["function"])
        self.assertNotIn("CARD base", second.text)

    def test_live_card_skill_and_rules_edits(self):
        initial = self.catalog["A"]
        self.edit(self.cards / "function.md", "NEW function")
        self.assertNotEqual(self.catalog["A"], initial)
        self.assertIn("NEW function", self.catalog["A"])
        self.edit(self.skill, self.workflow.replace("COMPLETE GUIDANCE", "NEW complete guidance"))
        self.assertIn("NEW complete guidance", self.catalog["A"])
        self.edit(self.rules, "NEW rules")
        self.assertTrue(self.catalog["A"].startswith("NEW rules"))
        self.edit(self.skill, self.workflow.replace("{{SOP:optional}}", ""))
        (self.cards / "optional.md").unlink()
        self.assertNotIn("CARD optional", self.catalog["A"])

    def test_new_reference_invalidates_cache_and_expands_new_card(self):
        self.catalog["A"]
        self.edit(self.skill, self.workflow.replace("{{SOP:optional}}", "{{SOP:unused}}"))
        self.assertIn("CARD unused", self.catalog["A"])
        self.assertNotIn("CARD optional", self.catalog["A"])

    def test_unreferenced_card_cannot_affect_generation(self):
        initial = self.catalog["A"]
        self.edit(self.cards / "unused.md", "{{SOP:missing}}")
        self.assertEqual(self.catalog["A"], initial)
        self.assertEqual(prompts.assemble_expert_prompt("A").text, initial)

    def test_missing_card_and_nested_reference_fail_loudly(self):
        self.catalog["A"]
        (self.cards / "optional.md").unlink()
        with self.assertRaises(FileNotFoundError):
            self.catalog["A"]
        (self.cards / "optional.md").write_text("{{SOP:function}}", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "嵌套引用"):
            self.catalog["A"]

    def test_bad_references_duplicate_steps_and_outside_references_fail(self):
        for body in ("no references", "{{SOP: function}}", "prose {{SOP:base}}",
                     "## 1. Construct\n{{SOP:base}}\n{{SOP:base}}",
                     "## 1. Construct\n{{SOP:../function}}", "## 1. Construct\n{{SOP:broken",
                     self.workflow.replace("## 3.", "## 2."),
                     "{{SOP:base}}\n" + self.workflow.replace("{{SOP:base}}", "")):
            with self.subTest(body=body):
                self.skill.write_text(body, encoding="utf-8")
                with self.assertRaises(ValueError):
                    prompts.assemble_expert_prompt("A")
        self.skill.write_text(self.workflow.replace("{{SOP:optional}}", "{{SOP:missing}}"),
                              encoding="utf-8")
        with self.assertRaises(FileNotFoundError):
            prompts.assemble_expert_prompt("A")

    def test_unknown_category(self):
        for operation in (prompts.assemble_expert_prompt, prompts.load_expert_prompt,
                          self.catalog.__getitem__):
            with self.assertRaises(KeyError):
                operation("E")

    def test_frontmatter_reference_is_not_loaded(self):
        self.skill.write_text("---\ndescription: {{SOP:missing}}\n---\n" + self.workflow,
                              encoding="utf-8")
        self.assertNotIn("missing", self.catalog["A"])

    def test_inline_markdown_nesting_preserves_executable_example(self):
        code = "f(x) = x^2\n\n\nP = (1, f(1))"
        card = "# SOP: function\n\n<!-- example: test -->\n```ggb\n" + code + "\n```"
        (self.cards / "function.md").write_text(card, encoding="utf-8")
        result = prompts.assemble_expert_prompt("A")
        self.assertIn("### SOP: function", result.text)
        self.assertIn("```ggb\n" + code + "\n```", result.text)


class RepositoryAssemblyTests(unittest.TestCase):
    def test_every_skill_reference_is_loaded_once_inside_a_step(self):
        used = set()
        for category in prompts.CATEGORY_TO_SKILL:
            with self.subTest(category=category):
                skill = prompts._strip_frontmatter(prompts._read(prompts._skill_path(category)))
                names = prompts._sop_names(skill, category)
                result = prompts.assemble_expert_prompt(category)
                self.assertEqual(result.metadata["cards"], names)
                self.assertNotIn("{{SOP", result.text)
                for name in names:
                    heading = "### SOP: " + name + " —"
                    self.assertEqual(result.text.count(heading), 1)
                    source_step = next(block.group(1) for block in prompts._STEP_BLOCK.finditer(skill)
                                       if "{{SOP:" + name + "}}" in block.group(0))
                    target_step = next(block.group(1) for block in prompts._STEP_BLOCK.finditer(result.text)
                                       if heading in block.group(0))
                    self.assertEqual(target_step, source_step)
                used.update(names)
        self.assertEqual(used, {path.stem for path in prompts._SOPS_DIR.glob("*.md")})


if __name__ == "__main__":
    unittest.main()
