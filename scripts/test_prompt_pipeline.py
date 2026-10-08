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
    def router(self, names=None, **fields):
        return json.dumps({'category': 'A', 'reason': 'test',
                           'sops': names or ['function-object'], 'sop_uncertain': False, **fields})

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

    def test_router_selection_reaches_specialist_without_extra_call(self):
        adapter, result, _ = self.run_pipeline([self.router(), VALID])
        self.assertEqual(len(adapter.prompts), 2)
        self.assertIn('function-object:', adapter.prompts[0])
        self.assertNotIn('{sop_catalog}', adapter.prompts[0])
        self.assertNotIn('# SOP:', adapter.prompts[0])
        self.assertIn('# SOP: function-object', adapter.prompts[1])
        self.assertNotIn('# SOP: circle-tangent', adapter.prompts[1])
        self.assertEqual(result['prompt']['mode'], 'selected')
        self.assertEqual(result['prompt']['input_characters'], len(adapter.prompts[1]))
        self.assertIsNone(result['prompt']['retry_reference_mode'])
        self.assertTrue(result['validation']['semantic_ok'])

    def test_category_only_and_unknown_selection_use_full_set(self):
        for raw in (json.dumps({'category': 'A'}), self.router(['missing'])):
            with self.subTest(raw=raw):
                adapter, result, _ = self.run_pipeline([raw, VALID])
                self.assertEqual(result['prompt']['mode'], 'full')
                self.assertIn('# SOP: circle-tangent', adapter.prompts[1])

    def test_syntax_correction_expands_references(self):
        adapter, result, _ = self.run_pipeline([self.router(), VALID + '\nSetAxesVisible(true)', VALID])
        self.assertEqual(len(adapter.prompts), 3)
        self.assertNotIn('# SOP: circle-tangent', adapter.prompts[1])
        self.assertIn('# SOP: circle-tangent', adapter.prompts[2])
        self.assertEqual(result['prompt']['retry_reference_mode'], 'full')
        self.assertTrue(result['validation']['retried'])

    def test_semantic_correction_expands_references_and_allows_free_point(self):
        invalid = VALID + '\nt=Slider(0,1,0.01)'
        fixed = VALID + '\nP=Point(segAB)'
        adapter, result, _ = self.run_pipeline([self.router(), invalid, fixed])
        self.assertEqual(len(adapter.prompts), 3)
        self.assertIn('# SOP: moving-point-path', adapter.prompts[2])
        self.assertNotIn('动点必须由滑块驱动', adapter.prompts[2])
        self.assertEqual(result['validation']['semantic_retries'], 1)
        self.assertTrue(result['validation']['semantic_ok'])

    def test_correction_preserves_cross_category_references(self):
        raw = self.router(['function-object', 'curve-definition'])
        adapter, result, _ = self.run_pipeline([raw, VALID + '\nSetAxesVisible(true)', VALID])
        self.assertIn('# SOP: curve-definition', adapter.prompts[1])
        self.assertIn('# SOP: curve-definition', adapter.prompts[2])
        self.assertIn('# SOP: circle-tangent', adapter.prompts[2])
        self.assertIn('curve-definition', result['prompt']['retry_cards'])

    def test_router_parse_retry_uses_new_selection(self):
        adapter, result, _ = self.run_pipeline(['cannot classify', self.router(['function-object', 'locus']), VALID])
        self.assertEqual(len(adapter.prompts), 3)
        self.assertIn('# SOP: locus', adapter.prompts[2])
        self.assertEqual(result['prompt']['mode'], 'selected')

    def test_decisions_backend_does_not_add_a_selection_call(self):
        adapter, result, _ = self.run_pipeline([VALID], {'router_mode': 'decisions'}, {
            'category': 'A', 'confidence': 0.99, 'probabilities': {'A': 0.99}})
        self.assertEqual(len(adapter.prompts), 1)
        self.assertEqual(result['prompt']['mode'], 'full')


if __name__ == '__main__':
    unittest.main()
