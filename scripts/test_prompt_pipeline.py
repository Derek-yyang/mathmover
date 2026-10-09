"""Exercise the real upload pipeline using scripted adapters, without credentials."""
import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as backend

VALID = 'MODE: 2D\nf(x)=x^2\nA=(0,0)\nB=(2,0)\nsegAB=Segment(A,B)'


class ScriptedAdapter:
    def __init__(self, outputs):
        self.outputs = iter(outputs)
        self.prompts = []

    def generate(self, prompt, image_bytes=None, mime_type=None):
        self.prompts.append(prompt)
        return next(self.outputs)


class PromptPipelineTests(unittest.TestCase):
    def router(self, **fields):
        return json.dumps({'category': 'A', 'reason': 'test', **fields})

    def run_pipeline(self, outputs, config=None, decisions=None):
        adapter = ScriptedAdapter(outputs)
        cfg = {'router_mode': 'llm', **(config or {})}
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(backend, 'load_local_model_config', return_value=cfg))
            stack.enter_context(patch.object(backend, 'apply_env_defaults', side_effect=lambda x: x))
            stack.enter_context(patch.object(backend.ModelFactory, 'create', return_value=adapter))
            stack.enter_context(patch.object(backend.decision_router, 'classify', return_value=decisions))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            response = backend.app.test_client().post('/api/upload', data={
                'text': '构造函数及相关对象', 'responseMode': 'stream'})
            events = [json.loads(line) for line in response.get_data(as_text=True).splitlines() if line.strip()]
        self.assertEqual(response.status_code, 200)
        self.assertFalse([e for e in events if e['status'] == 'error'], events)
        completed = next(e for e in events if e['status'] == 'completed')
        return adapter, completed, events

    def test_category_router_loads_all_skill_references_without_extra_call(self):
        adapter, result, _ = self.run_pipeline([self.router(), VALID])
        self.assertEqual(len(adapter.prompts), 2)
        self.assertNotIn('function-object', adapter.prompts[0])
        self.assertNotIn('sops', adapter.prompts[0])
        self.assertNotIn('# SOP:', adapter.prompts[0])
        self.assertIn('# SOP: function-object', adapter.prompts[1])
        self.assertIn('# SOP: circle-tangent', adapter.prompts[1])
        self.assertEqual(result['prompt']['mode'], 'full')
        self.assertEqual(result['prompt']['cards'], backend.assemble_expert_prompt('A').metadata['cards'])
        self.assertEqual(result['prompt']['input_characters'], len(adapter.prompts[1]))
        self.assertNotIn('retry_reference_mode', result['prompt'])
        self.assertTrue(result['validation']['semantic_ok'])

    def test_legacy_selection_fields_do_not_change_skill_references(self):
        for raw in (json.dumps({'category': 'A'}),
                    self.router(sops=['missing'], sop_uncertain=False)):
            with self.subTest(raw=raw):
                adapter, result, _ = self.run_pipeline([raw, VALID])
                self.assertEqual(result['prompt']['mode'], 'full')
                self.assertIn('# SOP: circle-tangent', adapter.prompts[1])

    def test_command_errors_reported_without_retry(self):
        adapter, result, _ = self.run_pipeline([self.router(), VALID + '\nSetAxesVisible(true)'])
        self.assertEqual(len(adapter.prompts), 2)
        self.assertTrue(result['validation']['command_errors'])
        self.assertIn('syntax', result['validation']['semantic_failures'])
        self.assertFalse(any('SetAxesVisible' in c for c in result['commands']))

    def test_semantic_failures_reported_without_retry(self):
        invalid = VALID + '\nt=Slider(0,1,0.01)'
        adapter, result, _ = self.run_pipeline([self.router(), invalid])
        self.assertEqual(len(adapter.prompts), 2)
        self.assertFalse(result['validation']['semantic_ok'])
        self.assertIn('orphan_slider', result['validation']['semantic_failures'])

    def test_legacy_router_selection_cannot_inject_unreferenced_cards(self):
        raw = self.router(sops=['function-object', 'curve-definition'], sop_uncertain=False)
        adapter, result, _ = self.run_pipeline([raw, VALID])
        self.assertEqual(len(adapter.prompts), 2)
        self.assertNotIn('# SOP: curve-definition', adapter.prompts[1])
        self.assertIn('# SOP: function-object', adapter.prompts[1])
        self.assertEqual(result['prompt']['mode'], 'full')

    def test_router_parse_retry_uses_final_category(self):
        adapter, result, _ = self.run_pipeline(['cannot classify', self.router(category='B'), VALID])
        self.assertEqual(len(adapter.prompts), 3)
        self.assertEqual(result['category'], 'B')
        self.assertNotIn('# SOP: function-object', adapter.prompts[2])
        self.assertEqual(result['prompt']['cards'], backend.assemble_expert_prompt('B').metadata['cards'])
        self.assertEqual(result['prompt']['mode'], 'full')

    def test_decisions_backend_loads_same_skill_without_extra_call(self):
        adapter, result, _ = self.run_pipeline([VALID], {'router_mode': 'decisions'}, {
            'category': 'A', 'confidence': 0.99, 'probabilities': {'A': 0.99}})
        self.assertEqual(len(adapter.prompts), 1)
        self.assertEqual(result['prompt']['mode'], 'full')
        self.assertEqual(result['prompt']['cards'], backend.assemble_expert_prompt('A').metadata['cards'])

    def test_low_confidence_decisions_falls_back_to_category_only_llm(self):
        adapter, result, events = self.run_pipeline([self.router(), VALID], {'router_mode': 'decisions'}, {
            'category': 'B', 'confidence': 0.1, 'probabilities': {'B': 0.1}})
        self.assertEqual(len(adapter.prompts), 2)
        self.assertEqual(result['category'], 'A')
        self.assertNotIn('sops', adapter.prompts[0])
        classified = next(event for event in events if event['status'] == 'classified')
        self.assertTrue(classified['router']['fallback_to_llm'])

    def test_unparseable_router_after_retry_uses_complete_default_skill(self):
        adapter, result, events = self.run_pipeline(['cannot classify', 'still unknown', VALID])
        self.assertEqual(len(adapter.prompts), 3)
        self.assertEqual(result['category'], 'A')
        self.assertEqual(result['prompt']['cards'], backend.assemble_expert_prompt('A').metadata['cards'])
        classified = next(event for event in events if event['status'] == 'classified')
        self.assertTrue(classified['router_parse_failed'])


if __name__ == '__main__':
    unittest.main()
