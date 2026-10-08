"""Prompt selection, safe fallback and live source edits; no network calls."""
import json
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
        self.skill = self.root / 'function-expert' / 'SKILL.md'
        self.skill.parent.mkdir()
        self.workflow = ('COMPLETE GUIDANCE\n## 1. Foundation\n{{SOP:base}}\n'
                         '## 2. Main object\n{{SOP:function}}\n'
                         '## 3. Optional operation\n{{SOP:optional}}\n## 4. Check')
        self.skill.write_text('---\nname: expert\n---\n' + self.workflow, encoding='utf-8')
        self.cards = self.root / 'shared' / 'sops'
        self.cards.mkdir(parents=True)
        for name in ('base', 'function', 'optional', 'space'):
            (self.cards / (name + '.md')).write_text('CARD ' + name, encoding='utf-8')
        self.index_path = self.root / 'shared' / 'sop-index.json'
        self.index = {
            'always': ['base'],
            'cards': {
                'base': {'summary': 'common', 'views': ['2D', '3D']},
                'function': {'summary': 'function', 'views': ['2D']},
                'optional': {'summary': 'optional', 'views': ['2D'], 'requires': ['function']},
                'space': {'summary': 'space', 'views': ['3D']}},
            'categories': {'A': ['base', 'function', 'optional'],
                           'B': ['base', 'function'], 'C': ['base', 'function'],
                           'D': ['base', 'space']}}
        self.write_index()
        self.rules = self.root / 'shared' / 'generation-rules.md'
        self.pitfalls = self.root / 'shared' / 'ggb-pitfalls.md'
        self.rules.write_text('common rules', encoding='utf-8')
        self.pitfalls.write_text('pitfalls', encoding='utf-8')
        self.patches = [patch.object(prompts, attr, value) for attr, value in (
            ('_SKILLS_DIR', self.root), ('_SOPS_DIR', self.cards),
            ('_INDEX_PATH', self.index_path), ('_RULES_PATH', self.rules),
            ('_PITFALLS_PATH', self.pitfalls))]
        for item in self.patches:
            item.start()
        self.catalog = prompts._ExpertPromptCatalog()

    def write_index(self):
        self.index_path.write_text(json.dumps(self.index), encoding='utf-8')

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def router(self, names, **fields):
        return json.dumps({'category': 'A', 'sops': names, 'sop_uncertain': False, **fields})

    def edit(self, path, text):
        previous = path.stat().st_mtime_ns
        path.write_text(text, encoding='utf-8')
        os.utime(path, ns=(previous + 1_000_000_000, previous + 1_000_000_000))

    def test_selection_keeps_complete_skill_and_common_rules(self):
        result = prompts.assemble_expert_prompt('A', self.router(['function']))
        self.assertEqual(result.metadata['cards'], ['base', 'function'])
        self.assertIn('COMPLETE GUIDANCE', result.text)
        self.assertIn('common rules', result.text)
        self.assertNotIn('CARD optional', result.text)
        self.assertNotIn('name: expert', result.text)
        self.assertLess(len(result.text), len(self.catalog['A']))

    def test_dependencies_and_duplicate_selections(self):
        result = prompts.assemble_expert_prompt('A', self.router(['optional', 'optional']))
        self.assertEqual(result.metadata['cards'], ['base', 'function', 'optional'])
        self.assertEqual(result.text.count('CARD function'), 1)

    def test_legacy_uncertain_malformed_empty_and_wrong_category_fall_back(self):
        for raw in ('A', '{}', '[]', 'null', '{broken', self.router([]),
                    self.router(['function'], sop_uncertain=True),
                    self.router(['function'], sop_uncertain='false'),
                    self.router(['function'], category='B'),
                    json.dumps({'category': 'A', 'sops': ['function']}),
                    self.router([None])):
            with self.subTest(raw=raw):
                result = prompts.assemble_expert_prompt('A', raw)
                self.assertEqual(result.metadata['mode'], 'full')
                self.assertIn('CARD optional', result.text)

    def test_unknown_incompatible_and_path_names_do_not_silently_drop(self):
        for name in ('typo', 'space', '../function'):
            with self.subTest(name=name):
                result = prompts.assemble_expert_prompt('A', self.router(['function', name]))
                self.assertEqual(result.metadata['mode'], 'full')
                self.assertIn('CARD optional', result.text)

    def test_fenced_json_and_cross_category_capability(self):
        raw = '```json\n' + self.router(['optional']) + '\n```'
        self.assertEqual(prompts.assemble_expert_prompt('A', raw).metadata['mode'], 'selected')
        self.index['categories']['A'] = ['base', 'function']
        self.index['categories']['C'] = ['base', 'function', 'optional']
        self.write_index()
        result = prompts.assemble_expert_prompt('A', self.router(['optional']))
        self.assertEqual(result.metadata['mode'], 'selected')
        self.assertIn('CARD optional', result.text)

    def test_live_card_skill_rules_pitfalls_and_index_edits(self):
        initial = self.catalog['A']
        self.edit(self.cards / 'function.md', 'NEW function')
        self.assertNotEqual(self.catalog['A'], initial)
        self.edit(self.skill, self.workflow.replace('COMPLETE GUIDANCE', 'NEW complete guidance'))
        self.assertIn('NEW complete guidance', self.catalog['A'])
        self.edit(self.rules, 'NEW rules')
        self.assertIn('NEW rules', self.catalog['A'])
        self.edit(self.pitfalls, 'NEW pitfalls')
        self.assertTrue(self.catalog['A'].endswith('NEW pitfalls'))
        self.index['categories']['A'] = ['base', 'function']
        self.index['categories']['C'] = ['base', 'function', 'optional']
        previous = self.index_path.stat().st_mtime_ns
        self.write_index()
        os.utime(self.index_path, ns=(previous+1_000_000_000, previous+1_000_000_000))
        self.assertNotIn('CARD optional', self.catalog['A'])
        selected = prompts.assemble_expert_prompt('A', self.router(['function']))
        self.assertIn('NEW function', selected.text)

    def test_missing_card_and_nested_reference_fail_loudly(self):
        (self.cards / 'optional.md').unlink()
        with self.assertRaises(ValueError):
            self.catalog['A']
        (self.cards / 'optional.md').write_text('{{SOP:function}}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '嵌套引用'):
            self.catalog['A']

    def test_cycle_missing_dependency_incomplete_category_and_view_fail_loudly(self):
        for mutation in ('cycle', 'missing', 'category', 'view'):
            with self.subTest(mutation=mutation):
                original = json.loads(json.dumps(self.index))
                if mutation == 'cycle':
                    self.index['cards']['function']['requires'] = ['optional']
                elif mutation == 'missing':
                    self.index['cards']['function']['requires'] = ['missing']
                elif mutation == 'category':
                    self.index['categories']['A'] = ['base', 'optional']
                else:
                    self.index['categories']['A'].append('space')
                self.write_index()
                with self.assertRaises(ValueError):
                    self.catalog['A']
                self.index = original

    def test_unknown_category(self):
        with self.assertRaises(KeyError):
            prompts.assemble_expert_prompt('E')

    def test_cards_expand_in_steps_and_unselected_step_is_preserved(self):
        result = prompts.assemble_expert_prompt('A', self.router(['function']))
        self.assertLess(result.text.index('1. Foundation'), result.text.index('CARD base'))
        self.assertLess(result.text.index('CARD base'), result.text.index('2. Main object'))
        self.assertLess(result.text.index('2. Main object'), result.text.index('CARD function'))
        self.assertLess(result.text.index('CARD function'), result.text.index('3. Optional operation'))
        self.assertIn('4. Check', result.text)
        self.assertNotIn('{{SOP', result.text)
        self.assertNotIn('CARD optional', result.text)
        self.assertEqual(result.metadata['inline_cards'], ['base', 'function'])
        self.assertEqual(result.metadata['extra_cards'], [])

    def test_cross_category_extra_is_retained_once_and_workflow_stays_complete(self):
        self.skill.write_text(self.workflow.replace('{{SOP:optional}}', ''), encoding='utf-8')
        result = prompts.assemble_expert_prompt('A', self.router(['optional']))
        self.assertEqual(result.metadata['extra_cards'], ['optional'])
        self.assertLess(result.text.index('4. Check'), result.text.index('CARD optional'))
        self.assertEqual(result.text.count('CARD optional'), 1)
        self.assertEqual(result.text.count('CARD function'), 1)

    def test_dependency_follows_its_template_location_not_router_order(self):
        result = prompts.assemble_expert_prompt('A', self.router(['optional', 'base']))
        self.assertLess(result.text.index('CARD function'), result.text.index('CARD optional'))

    def test_inline_author_errors_are_not_silently_removed(self):
        for body in ('no references', '{{SOP: function}}',
                     '{{SOP:base}}\n{{SOP:base}}',
                     '{{SOP:base}}\n{{SOP:misspelled}}',
                     'prose {{SOP:base}}', '{{SOP:base}}\n{{SOP:broken'):
            with self.subTest(body=body):
                self.skill.write_text(body, encoding='utf-8')
                with self.assertRaises(ValueError):
                    prompts.assemble_expert_prompt('A', self.router(['function']))

    def test_frontmatter_reference_is_not_loaded(self):
        self.skill.write_text('---\ndescription: {{SOP:missing}}\n---\n' + self.workflow,
                              encoding='utf-8')
        self.assertNotIn('missing', self.catalog['A'])

    def test_inline_markdown_nesting_preserves_executable_example(self):
        code = 'f(x) = x^2\nP = (1, f(1))'
        card = '# SOP: function\n\n<!-- example: test -->\n```ggb\n' + code + '\n```'
        (self.cards / 'function.md').write_text(card, encoding='utf-8')
        result = prompts.assemble_expert_prompt('A', self.router(['function']))
        self.assertIn('### SOP: function', result.text)
        self.assertIn('```ggb\n' + code + '\n```', result.text)


if __name__ == '__main__':
    unittest.main()
