/* 업체 이름 숨기기 스위치 (2026-11-18 정선정보공고 감온 캠프용)
   HIDE = true  → 화면·제목에서 '위듀케이션'을 지움
   HIDE = false → 원래대로 보임 (이 한 줄만 바꾸면 됨) */
(function(){
  var HIDE = true;
  window.TM_BRAND_HIDDEN = HIDE;
  if(!HIDE) return;
  var RULES = [
    [/\(위듀케이션\)\s*/g, ''],
    [/위듀케이션에서\s*/g, ''],
    [/위듀케이션\s*·\s*/g, ''],
    [/위듀케이션\s+(?=취업)/g, ''],
    [/위듀케이션\s*/g, '']
  ];
  function clean(s){
    for(var i=0;i<RULES.length;i++) s = s.replace(RULES[i][0], RULES[i][1]);
    return s;
  }
  function fixText(n){
    var v = n.nodeValue;
    if(v && v.indexOf('위듀케이션') > -1){
      var c = clean(v);
      if(!c.trim() && n.parentNode && n.parentNode.tagName === 'SMALL') c = '취업 연구소';
      n.nodeValue = c;
    }
  }
  var ATTR = ['placeholder','title','alt','aria-label','content'];
  function fixEl(el){
    for(var i=0;i<ATTR.length;i++){
      var a = el.getAttribute && el.getAttribute(ATTR[i]);
      if(a && a.indexOf('위듀케이션') > -1) el.setAttribute(ATTR[i], a = clean(a));
      if(a && ATTR[i] === 'placeholder' && a.indexOf('WEDU-') > -1) el.setAttribute('placeholder', a.replace(/WEDU-0000/g, '받은 코드'));
    }
  }
  function walk(root){
    if(!root) return;
    if(root.nodeType === 3){ fixText(root); return; }
    if(root.nodeType !== 1 && root.nodeType !== 9) return;
    if(root.nodeType === 1){ if(root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return; fixEl(root); }
    var w = document.createTreeWalker(root, 5 /* element + text */, null);
    var n;
    while((n = w.nextNode())){
      if(n.nodeType === 3){ var p = n.parentNode; if(p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) continue; fixText(n); }
      else fixEl(n);
    }
  }
  function fixTitle(){ if(document.title.indexOf('위듀케이션') > -1) document.title = clean(document.title); }
  walk(document.documentElement); fixTitle();
  new MutationObserver(function(ms){
    for(var i=0;i<ms.length;i++){
      var m = ms[i];
      if(m.type === 'characterData') fixText(m.target);
      else if(m.type === 'attributes') fixEl(m.target);
      else for(var j=0;j<m.addedNodes.length;j++) walk(m.addedNodes[j]);
    }
    fixTitle();
  }).observe(document.documentElement, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:ATTR});
  document.addEventListener('DOMContentLoaded', function(){ walk(document.body); fixTitle(); });
})();
