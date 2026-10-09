/** 金基线差异诊断。临时用。 */
import fs from 'node:fs';
import { assembleExpertPrompt, sha256Utf8, participatingFiles } from '../packages/ggb-core/src/sop.ts';

const g = JSON.parse(fs.readFileSync('D:/Mathmover/packages/ggb-core/src/data/prompt-goldens.json', 'utf8')).goldens[0];
const { text, metadata } = assembleExpertPrompt('A', 'D:/Mathmover');
console.log('chars  mine/golden:', metadata.characters, g.characters);
console.log('skill  mine/golden:', metadata.skill_characters, g.skill_characters);
console.log('sop    mine/golden:', metadata.sop_characters, g.sop_characters);
console.log('sha    mine:      ', sha256Utf8(text));
console.log('sha    golden:    ', g.text_sha256);
console.log('bytes  mine/golden:', Buffer.byteLength(text, 'utf8'), g.text_bytes_utf8);
console.log('files mine[0]:', JSON.stringify(participatingFiles('A', 'D:/Mathmover')[0]));
console.log('files gold[0]:', JSON.stringify(g.files[0]));
const raw = fs.readFileSync('D:/Mathmover/skills/function-expert/SKILL.md');
console.log('SKILL.md 含 CRLF?', raw.includes('\r\n'), 'bytes:', raw.length);
console.log('cards mine  :', metadata.cards.join(','));
console.log('cards golden:', g.cards.join(','));
console.log('cards equal?', JSON.stringify(metadata.cards) === JSON.stringify(g.cards));
// 逐卡对拍：按金测试的读法重算每卡长度，找出多出来的
import { readFileSync } from 'node:fs';
let sum = 0;
for (const n of g.cards) {
  const raw = readFileSync(`D:/Mathmover/skills/shared/sops/${n}.md`, 'utf8').replace(/\s+$/, '');
  sum += raw.length;
}
console.log('golden cards 按 rstrip 重算和:', sum, '(golden sop_characters:', g.sop_characters, ')');
