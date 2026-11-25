#!/usr/bin/env node
/**
 * ggb-core 的 inspectLedger 命令行入口，供 scripts/verify_sops.py 调用。
 *
 * 为什么要这一层：SOP 示例的「能否被生产解析器接受」这项静态校验原本走 Python 的
 * ggb_parser.validate_text，那是 ggb-core 的第二套实现（已删除）。这里改成直接调用
 * TS 生产解析器，校验口径与 ggb_apply 的自查完全一致，不再有双实现漂移。
 *
 * 用法：
 *   stdin : {"lines": ["A=(1,2)", "Circle(A,3)"], "mode"?: "2D" | "3D"}
 *   stdout: {"problems": [...], "unknownLines": [...], "mode": "2D"}
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectLedger } from '../packages/ggb-core/src/catalog.ts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const payload = JSON.parse(readFileSync(0, 'utf8'));
const lines = Array.isArray(payload.lines) ? payload.lines : [];
const result = inspectLedger(lines, undefined, rootDir, payload.mode ?? '2D');
process.stdout.write(JSON.stringify(result));
