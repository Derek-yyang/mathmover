"""Validate SOP imports/examples; --html-dir prepares an isolated GeoGebra QA page.

Run from any directory: python -B scripts/verify_sops.py
No model calls, user history writes, or credentials are required. Pure stdlib.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import ggb_parser
import ggb_catalog

# --- SOP 库的路径与 skill 槽位解析（原 expert_prompts.py 的只读部分）---
# 装配实现已随一次性生成管线下线；SOP 静态校验只读卡库与 skill 槽位，这些就够。
_SKILLS_DIR = ROOT / "skills"
_SOPS_DIR = _SKILLS_DIR / "shared" / "sops"
CATEGORY_TO_SKILL = {
    "A": "function-expert", "B": "planar-geometry-expert",
    "C": "conic-expert", "D": "solid-geometry-expert",
}
_SOP_REFERENCE = re.compile(r"^[ \t]*\{\{SOP:([a-z0-9-]+)\}\}[ \t]*$", re.M)
_STEP_BLOCK = re.compile(r"^## ([1-9]\d*)\.[^\n]*\n.*?(?=^## [1-9]\d*\.|\Z)", re.M | re.S)


def _strip_frontmatter(text):
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4:].lstrip("\n")
    return text


def _read(path):
    return path.read_text(encoding="utf-8").rstrip()


def _sop_card_path(name, category):
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9-]+", name):
        raise ValueError(f"非法 SOP 名称: {name!r}")
    card = _SOPS_DIR / f"{name}.md"
    if not card.is_file():
        raise FileNotFoundError(f"SOP 卡缺失: {card}（{CATEGORY_TO_SKILL[category]}）")
    return card


def _sop_names(body, category):
    """SKILL.md 单独决定卡片清单与插入顺序。"""
    names = _SOP_REFERENCE.findall(body)
    if not names or "{{SOP" in _SOP_REFERENCE.sub("", body):
        raise ValueError(f"{CATEGORY_TO_SKILL[category]}: SOP 插入位置缺失或格式错误；"
                         "应独占一行写 {{SOP:card-name}}")
    if len(names) != len(set(names)):
        raise ValueError(f"{CATEGORY_TO_SKILL[category]}: SOP 插入位置重复")
    blocks = list(_STEP_BLOCK.finditer(body))
    steps = [block.group(1) for block in blocks]
    if len(steps) != len(set(steps)):
        raise ValueError(f"{CATEGORY_TO_SKILL[category]}: 编号步骤重复")
    if set(_SOP_REFERENCE.findall("".join(block.group(0) for block in blocks))) != set(names):
        raise ValueError(f"{CATEGORY_TO_SKILL[category]}: SOP 插入位置必须位于编号步骤")
    return names

EXAMPLE = re.compile(r"<!-- example: ([\w-]+) -->\s*```ggb\n(.*?)\n```", re.S)


def collect_cases():
    fixtures = json.loads((ROOT / "scripts/sop_examples.json").read_text(encoding="utf-8"))
    commands = json.loads((ROOT / "ggb_commands.json").read_text(encoding="utf-8"))
    allowed = set(commands["attributes"] + commands["globals"])
    for names in commands["constructors"].values():
        allowed.update(names)
    allowed.update(commands.get("aliases", {}))
    cases = []
    for card in sorted(_SOPS_DIR.glob("*.md")):
        text = card.read_text(encoding="utf-8")
        for required in ("输入：", "写法注意："):
            if required not in text:
                raise ValueError(f"{card.name}: missing {required}")
        examples = EXAMPLE.findall(text)
        if not examples or len(examples) != text.count("```ggb"):
            raise ValueError(f"{card.name}: every ggb block needs an example id")
        for name, code in examples:
            if name not in fixtures:
                raise ValueError(f"{card.name}: no fixture for {name}")
            unknown = set(re.findall(r"\b([A-Z][A-Za-z]+)\s*\(", code)) - allowed
            if unknown:
                raise ValueError(f"{name}: commands outside whitelist: {sorted(unknown)}")
            validation = ggb_parser.validate_text("\n".join(fixtures[name]["prelude"] + [code]))
            if validation["validity"] != 1:
                raise ValueError(f"{name}: production parser rejected {validation['invalid_lines']}")
            fixture = dict(fixtures[name])
            fixture.pop("variants", None)
            cases.append({"id": name, "card": card.stem, "code": code, **fixture})
    ids = [case["id"] for case in cases]
    if len(ids) != len(set(ids)) or set(ids) != set(fixtures):
        raise ValueError("example ids must be unique and match fixtures exactly")
    expanded = []
    for case in cases:
        expanded.append(case)
        for variant in fixtures[case["id"]].get("variants", []):
            modified_code = case["code"]
            for old, new in variant.get("replace", {}).items():
                if old not in modified_code:
                    raise ValueError(f"{case['id']}/{variant['name']}: replacement no longer matches source")
                modified_code = modified_code.replace(old, new)
            fields = {k: v for k, v in variant.items() if k not in ("name", "replace")}
            expanded.append({**case, **fields, "id": case["id"] + "--" + variant["name"], "code": modified_code})
    if len({case['id'] for case in expanded}) != len(expanded):
        raise ValueError("duplicate variation ids")
    return expanded


def collect_command_cases():
    """Focused engine checks for new names, aliases, overloads and view state."""
    cases = json.loads((ROOT / "scripts/command_examples.json").read_text(encoding="utf-8"))
    for case in cases:
        candidate = "MODE: " + case["mode"] + "\n" + "\n".join(case["prelude"] + [case["code"]])
        result = ggb_parser.validate_text(candidate)
        if not result["ok"] or result["unknown_commands"]:
            raise ValueError(f"{case['id']}: catalog rejected engine fixture {result['command_errors']}")
    return cases


def validate_imports():
    all_cards = {p.stem for p in _SOPS_DIR.glob("*.md")}
    used = set()
    results = []
    for category, expert in CATEGORY_TO_SKILL.items():
        text = _strip_frontmatter(_read(_SKILLS_DIR / expert / "SKILL.md"))
        names = _sop_names(text, category)
        for name in names:
            card = _read(_sop_card_path(name, category))
            if '{{SOP' in card:
                raise ValueError(f'{expert}/{name}: nested reference')
        used.update(names)
        results.append({"category": category, "cards": len(names)})
    if all_cards != used:
        raise ValueError(f"Unused SOP cards: {sorted(all_cards - used)}")
    return results


HTML = r'''<!doctype html><html lang="zh"><meta charset="utf-8">
<title>MathMover SOP verification</title>
<style>body{font:14px system-ui;margin:16px}#boards{display:flex;gap:12px}pre{white-space:pre-wrap}button{padding:8px}</style>
<h1>MathMover SOP verification</h1><p id="status">Loading GeoGebra 2D / 3D…</p>
<button id="run" disabled>Run all examples</button><div id="boards"><div id="board2d"></div><div id="board3d"></div></div><pre id="result"></pre>
<script src="https://www.geogebra.org/apps/deployggb.js"></script><script>
const cases = __CASES__;
const catalog = __CATALOG__;
const scriptCommands = new Set([...catalog.attributes,...catalog.globals].map(n=>n.toLowerCase()));
window.sopCases = cases;
window.sopResults = [];
const sleep = ms => new Promise(r=>setTimeout(r,ms));
window.sopReady = Promise.all(['2D','3D'].map(mode => new Promise(resolve=>{
 new GGBApplet({appName:mode==='3D'?'3d':'classic',perspective:mode==='3D'?'T':'2',
 width:600,height:380,showToolBar:false,showMenuBar:false,showAlgebraInput:false,
 errorDialogsActive:false,appletOnLoad:api=>resolve([mode,api])},true).inject(mode==='3D'?'board3d':'board2d');
}))).then(items=>{
 window.sopApis=Object.fromEntries(items);
 document.querySelector('#status').textContent=`Ready: ${cases.length} examples, 2D + 3D`;
 document.querySelector('#run').disabled=false;
});
function validObject(api,name){
 if(!api.getAllObjectNames().includes(name)||!api.isDefined(name)) return false;
 if(/\?|undefined/i.test(api.getValueString(name)||'')) return false;
 if(api.getObjectType(name).startsWith('point'))
  return Number.isFinite(api.getXcoord(name))&&Number.isFinite(api.getYcoord(name))&&Number.isFinite(api.getZcoord(name));
 return true;
}
function command(api,line,allowInvalid=[]){
 if(!line.trim()||line.startsWith('MODE:')) return;
 const result=api.evalCommand(line);
 const match=line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)(?:\([^)]*\))?\s*=/);
 if(match){
  const name=match[1];
  if(!allowInvalid.includes(name)){
   if(!api.getAllObjectNames().includes(name)) throw Error(`Missing ${name}: ${line}`);
   if(!validObject(api,name)) throw Error(`Undefined or nonfinite ${name}: ${line}; ${api.getValueString(name)}`);
  }
 } else if(result===false && !scriptCommands.has((line.match(/^\s*(\w+)\s*\(/)||[])[1]?.toLowerCase()))
  throw Error(`Rejected command: ${line}`);
}
function viewState(api,view,wanted){
 const raw=api.getGraphicsOptions(view);
 const options=typeof raw==='string'?JSON.parse(raw):raw;
 if(!options) throw Error(`Missing graphics options: ${view}`);
 if(wanted.grid!==undefined && !!api.getGridVisible(view)!==wanted.grid) throw Error(`Wrong grid state: ${view}`);
 if(wanted.axes!==undefined){
  const allAxes=Array.isArray(options.axes)?options.axes:Object.values(options.axes||{});
  const axes=allAxes.slice(0,view===3?3:2); // 2D options also contain a dormant z axis
  if(axes.length<2) throw Error(`Missing axes state: ${JSON.stringify(options)}`);
  const visible=axes.map(axis=>typeof axis==='boolean'?axis:axis.visible??axis.show);
  if(visible.some(value=>value!==wanted.axes)) throw Error(`Wrong axes state: ${JSON.stringify(axes)}`);
 }
}
function check(api,expr){
 // Expressions assert mathematics, not exact output names/order of an alternative construction.
 const condition=expr.replace(/(?<![<>!=])=(?!=)/g,'==');
 if(!api.evalCommand(`qaCheck = (${condition})`)||!api.isDefined('qaCheck')||api.getValue('qaCheck')!==1)
  throw Error(`Failed property: ${expr}; got ${api.getValueString('qaCheck')}`);
}
window.runSopBatch = async function(start=0,count=cases.length){
 await window.sopReady;
 const results=[];
 for(const item of cases.slice(start,start+count)){
  const api=window.sopApis[item.mode];
  api.newConstruction();
  await sleep(60);
  try{
   for(const line of item.prelude) command(api,line);
   for(const line of item.code.split('\n')) command(api,line,item.expectInvalid||[]);
   for(const name of item.expectInvalid||[]) if(validObject(api,name)) throw Error(`Expected invalid boundary object ${name}`);
   for(const expr of item.checks) check(api,expr);
   for(const [view,wanted] of Object.entries(item.views||{})) viewState(api,Number(view),wanted);
   for(const [name,wanted] of Object.entries(item.appearance||{})){
    if(wanted.color && api.getColor(name).toLowerCase()!==wanted.color.toLowerCase()) throw Error(`Wrong color ${name}`);
    if(wanted.lineStyle!==undefined && api.getLineStyle(name)!==wanted.lineStyle) throw Error(`Wrong line style ${name}`);
    if(wanted.lineThickness!==undefined && api.getLineThickness(name)!==wanted.lineThickness) throw Error(`Wrong line thickness ${name}`);
    if(wanted.fixed!==undefined && api.isFixed(name)!==wanted.fixed) throw Error(`Wrong fixed state ${name}`);
    if(wanted.labelStyle!==undefined && api.getLabelStyle(name)!==wanted.labelStyle) throw Error(`Wrong label mode ${name}`);
    if(wanted.labelVisible!==undefined && api.getLabelVisible(name)!==wanted.labelVisible) throw Error(`Wrong label visibility ${name}`);
   }
   for(const sample of item.samples){
    for(const [name,value] of Object.entries(sample.set||{})) api.setValue(name,value);
    for(const [name,coords] of Object.entries(sample.coords||{})) api.setCoords(name,...coords);
    await sleep(30);
    for(const expr of sample.checks) check(api,expr);
   }
   const row={id:item.id,card:item.card,mode:item.mode,pass:true,objects:api.getAllObjectNames().length};
   results.push(row);
  }catch(error){results.push({id:item.id,card:item.card,mode:item.mode,pass:false,error:String(error.message||error)});}
 }
 window.sopResults=[...new Map([...window.sopResults,...results].map(r=>[r.id,r])).values()];
 document.querySelector('#result').textContent=JSON.stringify(window.sopResults,null,2);
 document.querySelector('#status').textContent=`Checked ${window.sopResults.length}; failures ${window.sopResults.filter(r=>!r.pass).length}`;
 return results;
};
document.querySelector('#run').onclick=()=>window.runSopBatch();
</script></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html-dir", type=Path)
    args = parser.parse_args()
    imports = validate_imports()
    sop_cases = collect_cases()
    command_cases = collect_command_cases()
    cases = sop_cases + command_cases
    print(json.dumps({"imports": imports, "cards": len({c['card'] for c in sop_cases}), "sop_examples": len(sop_cases), "command_examples": len(command_cases), "static": "PASS"}, ensure_ascii=False))
    if args.html_dir:
        args.html_dir.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(cases, ensure_ascii=False).replace("</", "<\\/")
        catalog = json.dumps(json.loads((ROOT / 'ggb_commands.json').read_text(encoding='utf-8')), ensure_ascii=False).replace("</", "<\\/")
        (args.html_dir / "index.html").write_text(HTML.replace("__CASES__", payload).replace("__CATALOG__", catalog), encoding="utf-8")
        print(str((args.html_dir / "index.html").resolve()))


if __name__ == "__main__":
    main()
