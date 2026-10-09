"""Check outgoing output budgets and token-limit handling without model calls."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as backend
import switch_provider


def chat_response(text='MODE: 2D', finish='stop'):
    return SimpleNamespace(choices=[SimpleNamespace(
        message=SimpleNamespace(content=text, refusal=None), finish_reason=finish)])


def http_response(data, status=200):
    response = MagicMock()
    response.status_code = status
    response.json.return_value = data
    return response


class ModelOutputLimitTests(unittest.TestCase):
    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()

    def tearDown(self):
        self.output.__exit__(None, None, None)

    def assert_default_controls_absent(self, body):
        for field in ('max_tokens', 'max_output_tokens', 'max_completion_tokens',
                      'reasoning', 'reasoning_effort', 'thinking'):
            self.assertNotIn(field, body)

    def test_chat_default_omits_limit_and_reasoning_controls(self):
        for limit in (None, '', '   '):
            with self.subTest(limit=limit), patch.object(backend.openai, 'OpenAI') as factory:
                create = factory.return_value.chat.completions.create
                create.return_value = chat_response()
                adapter = backend.OpenAICompatibleAdapter('test', 'https://example.com/v1', 'test',
                                                           max_tokens=limit)
                self.assertEqual(adapter.generate('prompt'), 'MODE: 2D')
                create.assert_called_once()
                self.assert_default_controls_absent(create.call_args.kwargs)

    def test_chat_explicit_limit_is_respected(self):
        with patch.object(backend.openai, 'OpenAI') as factory:
            create = factory.return_value.chat.completions.create
            create.return_value = chat_response()
            backend.OpenAICompatibleAdapter('test', 'https://example.com/v1', 'test',
                                            max_tokens='8192').generate('prompt')
            self.assertEqual(create.call_args.kwargs['max_tokens'], 8192)

    def test_chat_empty_at_limit_does_not_retry(self):
        with patch.object(backend.openai, 'OpenAI') as factory:
            create = factory.return_value.chat.completions.create
            create.return_value = chat_response('', 'length')
            adapter = backend.OpenAICompatibleAdapter('test', 'https://example.com/v1', 'test')
            self.assertEqual(adapter.generate('prompt'), '')
            create.assert_called_once()
            self.assert_default_controls_absent(create.call_args.kwargs)

    def test_chat_partial_at_limit_is_returned_without_retry(self):
        with patch.object(backend.openai, 'OpenAI') as factory:
            create = factory.return_value.chat.completions.create
            create.return_value = chat_response('MODE: 2D\nA=(0,0)', 'length')
            result = backend.OpenAICompatibleAdapter('test', 'https://example.com/v1', 'test').generate('prompt')
            self.assertEqual(result, 'MODE: 2D\nA=(0,0)')
            create.assert_called_once()

    def test_responses_default_omits_limit_and_reasoning_controls(self):
        with patch.object(backend.requests, 'post', return_value=http_response({'output_text': 'MODE: 2D'})) as post:
            adapter = backend.OpenAIResponsesAdapter('test', 'https://example.com/v1', 'test')
            self.assertEqual(adapter.generate('prompt'), 'MODE: 2D')
            post.assert_called_once()
            self.assert_default_controls_absent(post.call_args.kwargs['json'])

    def test_responses_explicit_limit_is_respected(self):
        with patch.object(backend.requests, 'post', return_value=http_response({'output_text': 'MODE: 2D'})) as post:
            backend.OpenAIResponsesAdapter('test', 'https://example.com/v1', 'test',
                                           max_tokens='8192').generate('prompt')
            self.assertEqual(post.call_args.kwargs['json']['max_output_tokens'], 8192)

    def test_responses_empty_incomplete_does_not_retry(self):
        with patch.object(backend.requests, 'post', return_value=http_response({'status': 'incomplete', 'output': []})) as post:
            adapter = backend.OpenAIResponsesAdapter('test', 'https://example.com/v1', 'test')
            self.assertEqual(adapter.generate('prompt'), '')
            post.assert_called_once()

    def test_responses_partial_incomplete_is_returned_without_retry(self):
        data = {'status': 'incomplete', 'output_text': 'MODE: 2D\nA=(0,0)'}
        with patch.object(backend.requests, 'post', return_value=http_response(data)) as post:
            self.assertEqual(backend.OpenAIResponsesAdapter('test', 'https://example.com/v1', 'test')
                             .generate('prompt'), data['output_text'])
            post.assert_called_once()

    def test_anthropic_requires_explicit_protocol_limit(self):
        with self.assertRaisesRegex(ValueError, 'Anthropic Messages 协议要求 max_tokens'):
            backend.AnthropicMessagesAdapter('test', 'https://example.com/v1', 'test')

    def test_anthropic_explicit_limit_and_no_reasoning_controls(self):
        data = {'content': [{'type': 'text', 'text': 'MODE: 2D'}]}
        with patch.object(backend.requests, 'post', return_value=http_response(data)) as post:
            adapter = backend.AnthropicMessagesAdapter('test', 'https://example.com/v1', 'test',
                                                       max_tokens='8192')
            self.assertEqual(adapter.generate('prompt'), 'MODE: 2D')
            body = post.call_args.kwargs['json']
            self.assertEqual(body['max_tokens'], 8192)
            for field in ('reasoning', 'reasoning_effort', 'thinking'):
                self.assertNotIn(field, body)

    def test_anthropic_empty_at_limit_does_not_retry(self):
        data = {'content': [], 'stop_reason': 'max_tokens'}
        with patch.object(backend.requests, 'post', return_value=http_response(data)) as post:
            adapter = backend.AnthropicMessagesAdapter('test', 'https://example.com/v1', 'test',
                                                       max_tokens='8192')
            self.assertEqual(adapter.generate('prompt'), '')
            post.assert_called_once()

    def test_invalid_explicit_limit_is_not_silently_replaced(self):
        for value in (0, -1, True, 'unknown', '1.5'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                backend._optional_max_tokens(value)

    def test_factory_with_empty_config_limit_keeps_provider_default(self):
        cfg = {'api_protocol': 'openai_chat', 'api_key': 'test', 'base_url': 'https://example.com/v1',
               'model_name': 'test', 'max_tokens': ''}
        with patch.object(backend.openai, 'OpenAI'):
            self.assertIsNone(backend.ModelFactory.create(cfg).max_tokens)

    def test_payload_size_fallback_keeps_limit_unspecified(self):
        ladder = [('large-image', 'image/png'), ('small-image', 'image/jpeg')]
        responses = [http_response({}, 413), http_response({'output_text': 'MODE: 2D'})]
        with patch.object(backend, '_payload_ladder', return_value=ladder), \
                patch.object(backend.requests, 'post', side_effect=responses) as post:
            adapter = backend.OpenAIResponsesAdapter('test', 'https://example.com/v1', 'test')
            self.assertEqual(adapter.generate('prompt', b'image', 'image/png'), 'MODE: 2D')
            self.assertEqual(post.call_count, 2)
            for call in post.call_args_list:
                self.assert_default_controls_absent(call.kwargs['json'])

    def test_provider_switch_clears_previous_limit_without_adding_default(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            path.write_text(json.dumps({'max_tokens': '16384', 'router_mode': 'decisions'}), encoding='utf-8')
            entry = {'base_url': 'https://example.com/v1', 'api_key': 'test'}
            with patch.object(switch_provider, 'CONFIG', path):
                result = switch_provider.write_config('example', 'test', entry)
                self.assertEqual(result['max_tokens'], '')
                self.assertEqual(result['router_mode'], 'decisions')
                entry['max_tokens'] = 8192
                result = switch_provider.write_config('example', 'test', entry)
                self.assertEqual(result['max_tokens'], '8192')


if __name__ == '__main__':
    unittest.main()
