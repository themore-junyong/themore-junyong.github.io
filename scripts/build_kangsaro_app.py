"""강사로 실제 앱(kangsaro/app/index.html)을 체험판(kangsaro/try/index.html)에서 만든다.

화면 코드는 체험판 하나만 고치고, 이 스크립트로 실제 앱에 옮긴다.
실제 앱에서 다른 점: 저장은 Firebase(real.js), 예시 데이터·'체험 중' 고르기 없음, 로그인 화면.
    python3 scripts/build_kangsaro_app.py
"""
import re, pathlib, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'kangsaro/try/index.html').read_text(encoding='utf-8')
s = src


def rep(old, new, n=1):
    global s
    c = s.count(old)
    assert c == n, f'{c}x: {old[:70]}'
    s = s.replace(old, new)


build = datetime.datetime.now().strftime('%y%m%d-%H%M')
s = re.sub(r'<meta name="build" content="[^"]*">', f'<meta name="build" content="{build}">', s)
rep('<title>강사로 (체험판)</title>', '<title>강사로</title>')
# 가입한 사람에게는 홍보 문구 대신 이용 기간(real.js가 채움)
rep('<span class="beta">체험판</span>', '<span class="beta" id="term" hidden></span>')
rep('<link rel="apple-touch-icon" href="icons/', '<link rel="apple-touch-icon" href="../try/icons/')
rep('<button class="btn sm" data-act="reset" title="체험 데이터 처음으로">처음으로</button>', '')
s, n = re.subn(r'<div class="who">.*?</div>', '<div class="who" id="acct"></div>', s, count=1, flags=re.S)
assert n == 1
rep("S=load();S.alerts=S.alerts||[];",
    "S={v:1,me:'',insts:[],cos:[],jobs:[],apps:[],evs:[],alerts:[]};let SYNC=null;const REAL={};")
rep("function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}", "function save(){if(SYNC)SYNC()}")
# 아직 안 불러온 업체·강사는 이름 없이라도 그려지게
rep("const inst=id=>S.insts.find(x=>x.id===id),co=id=>S.cos.find(x=>x.id===id),",
    "const inst=id=>S.insts.find(x=>x.id===id)||{id,name:'강사',region:'',topics:'',intro:'',career:'',phone:'',email:''},co=id=>S.cos.find(x=>x.id===id)||{id,name:'업체',contact:'',email:''},")
s, n = re.subn(r"const who=\$\('#who'\);who\.innerHTML=.*?who\.value=S\.me;",
               "if(!S.me){$('#nav').innerHTML='';$('#main').innerHTML=REAL.gate?REAL.gate():'<p class=\"mu\">불러오는 중…</p>';return}if(REAL.acct)REAL.acct();", s, count=1, flags=re.S)
assert n == 1
# 리마인드는 업체 쪽에서만 (강사는 지원 기록의 rem을 못 고침)
rep("function render(){runReminders();", "function render(){if(meRole()==='c')runReminders();")
# 파일은 Firebase에 저장
s, n = re.subn(r"  if\(D\.act==='vault'&&el\.files\[0\]\)\{.*?\n", "  if(D.act==='vault'&&el.files[0]){REAL.vault(D.n,el.files[0]);return}\n", s, count=1)
assert n == 1
s, n = re.subn(r"  if\(D\.act==='doc'&&el\.files\[0\]\)\{.*?\n", "  if(D.act==='doc'&&el.files[0]){REAL.doc(D.a,D.n,el.files[0]);return}\n", s, count=1)
assert n == 1
# 체험판 시작 화면 대신 실제 앱 시작
i = s.index('// 처음 들어오면 강사/업체 고르기')
j = s.index('</script>', i)
s = s[:i] + "render();\n" + s[j:]
rep('</script>\n</body>', f'</script>\n<script type="module" src="real.js?v={build}"></script>\n</body>')
(ROOT / 'kangsaro/app/index.html').write_text(s, encoding='utf-8')
print('kangsaro/app/index.html', build)
