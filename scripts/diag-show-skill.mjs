/** SOP 装配诊断：倒出 skill 形态与本类清单。临时诊断用。 */
import { fileURLToPath } from 'node:url';
import { assembleSkill, buildCatalog } from '../packages/ggb-core/src/sop.ts';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

const { text, metadata } = assembleSkill('A', REPO_ROOT);
console.log('═══ skill 字符数:', metadata.characters, '｜指到的卡:', metadata.cards.join(','));
console.log('──── skill 末尾 1200 字 ────');
console.log(text.slice(-1200));
console.log('\n──── 清单（A 类）────');
for (const c of buildCatalog('A', REPO_ROOT)) {
  console.log(`- ${c.name}（第${c.step}步）${c.title}｜${c.inputs.slice(0, 40)}`);
}
