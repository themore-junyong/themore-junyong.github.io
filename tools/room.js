/* 수업 방 연결 (학생 화면 공통)
   - 강사가 teacher.html에서 방을 만들어야 학생이 쓸 수 있어요. 방 번호 + 이름은 이 휴대폰(localStorage tm-room-s)에 기억.
   - <script src="room.js" data-guard></script> : 방에 안 들어왔으면 첫 화면(방 번호 입력)으로 보냄, 오른쪽 위에 "방 1234 · 이름" 표시
   - 강사가 방을 종료(closed)하거나 강사 화면이 3분 넘게 꺼져 있으면(hb 멈춤) "수업이 끝났어요"로 끊김
   - TM_ROOM.send(도구, 제목, 내용) : 결과를 그 방 강사 화면으로 보냄(도구마다 1개, 다시 보내면 덮어씀). 강사만 읽을 수 있음 */
(function(){
  var V='10.12.2', G='https://www.gstatic.com/firebasejs/'+V, K='tm-room-s', STALE=3*60e3;
  var me=document.currentScript, GUARD=me&&me.hasAttribute('data-guard');
  var TEACH=/[?&]teach=1/.test(location.search); // 강사 미리보기: 방 없이 화면만 봄, 결과는 안 보냄
  /* 도구 안 화면(#해시, 예: ai.html#who)도 따라가기: 강사가 보낸 ?h=who 를 #who 로 바꿔 둠(페이지 스크립트보다 먼저) */
  (function(){var u=new URL(location.href),h=u.searchParams.get('h');if(!h||!/^[a-z0-9-]{1,20}$/.test(h))return;
    u.searchParams.delete('h');try{history.replaceState(null,'',u.pathname+u.search+'#'+h)}catch(e){}})();
  var fb=null;
  function get(){try{var r=JSON.parse(localStorage.getItem(K)||'null');return r&&r.pin&&r.nick?r:null}catch(e){return null}}
  function put(r){try{if(r)localStorage.setItem(K,JSON.stringify(r));else localStorage.removeItem(K)}catch(e){}}
  function boot(){
    if(fb)return fb;
    fb=Promise.all([import('./firebase-config.js'),import(G+'/firebase-app.js'),import(G+'/firebase-auth.js'),import(G+'/firebase-firestore.js')]).then(function(m){
      var app=m[1].initializeApp(m[0].firebaseConfig,'tm-room'),auth=m[2].getAuth(app);
      return auth.authStateReady().then(function(){return auth.currentUser||m[2].signInAnonymously(auth)})
        .then(function(u){return {F:m[3],db:m[3].getFirestore(app),uid:auth.currentUser.uid}});
    });
    fb.catch(function(){fb=null});
    return fb;
  }
  function alive(r){ // 방 문서 → 살아 있나
    if(!r)return '없는 방 번호예요. 선생님 화면의 번호를 다시 확인해 주세요.';
    if(r.closed)return '선생님이 방을 종료했어요.';
    var now=Date.now();
    if(!r.exp||r.exp.toMillis()<now)return '시간이 지나 끝난 방이에요.';
    if(!r.hb||now-r.hb.toMillis()>STALE)return '선생님 화면이 꺼져 있어요. 선생님이 방을 열면 다시 들어와 주세요.';
    return '';
  }
  function info(pin){ // 방 문서(조 이름 teams 포함). 없거나 끝났으면 bad에 이유
    return boot().then(function(b){return b.F.getDoc(b.F.doc(b.db,'rooms',pin))}).then(function(d){var r=d.exists()?d.data():null;return {bad:alive(r),teams:r&&Array.isArray(r.teams)?r.teams:[],ak:r&&typeof r.ak==='string'?r.ak:''}});
  }
  function check(pin){return info(pin).then(function(x){return x.bad})}
  /* 들어가기: 방 번호 + 이름 (+ 강사가 조 이름을 정해 둔 방이면 조) */
  function join(pin,nick,team){
    pin=String(pin||'').replace(/\D/g,'');nick=String(nick||'').trim().slice(0,12);team=String(team||'').slice(0,12);
    if(pin.length!==4)return Promise.reject(new Error('방 번호 4자리를 넣어 주세요'));
    if(!nick)return Promise.reject(new Error('이름(또는 번호)을 넣어 주세요'));
    return info(pin).then(function(x){if(x.bad)throw new Error(x.bad);if(x.teams.length&&x.teams.indexOf(team)<0)throw new Error('우리 조를 골라 주세요');
      var r={pin:pin,nick:nick,t:Date.now()};if(team)r.team=team;if(x.ak)r.ak=x.ak;put(r);useCode(r.ak);hello();return r});
  }
  /* AI 초대코드: 강사가 방을 만들 때 쓴 코드(방 문서 ak)를 학생 휴대폰 tm-code에 넣어 둠 → 자소서·꼬꼬무·면접·AI 도구에서 코드 입력 칸이 안 뜸 */
  function useCode(ak){if(!ak)return false;var c=null;try{c=JSON.parse(localStorage.getItem('tm-code')||'null')}catch(e){}
    if(c&&c.code===ak&&c.ok)return false;try{localStorage.setItem('tm-code',JSON.stringify({code:ak,name:(c&&c.code===ak&&c.name)||'',ok:1,room:1}))}catch(e){}return true}
  (function(){var r=get();if(r&&r.ak&&!TEACH)useCode(r.ak)})();
  function setTeam(team){var r=get();if(!r)return;if(team)r.team=String(team).slice(0,12);else delete r.team;put(r);hello();var a=document.getElementById('tmRoomBadge');if(a)a.textContent=label(r)}
  function label(r){return '🏠 방 '+r.pin+' · '+(r.team?r.team+' · ':'')+r.nick}
  function toast(t,bad){var d=document.createElement('div');d.textContent=t;
    d.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:90;background:'+(bad?'#c8432f':'#2e8b4c')+';color:#fff;font:700 15px system-ui;padding:10px 18px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.2);max-width:90vw;text-align:center';
    document.body.appendChild(d);setTimeout(function(){d.remove()},2600)}
  function send(tool,title,body){
    var r=get();if(!r||TEACH)return Promise.resolve(false);
    return boot().then(function(b){
      return b.F.setDoc(b.F.doc(b.db,'rooms',r.pin,'work',b.uid+'_'+tool),{tool:tool,nick:r.nick,team:r.team||'',title:String(title||'').slice(0,80),body:String(body||'').slice(0,6000),t:b.F.serverTimestamp()});
    }).then(function(){toast('✔ 선생님께 보냈어요');return true},function(){toast('선생님께 보내지 못했어요 (방이 끝났을 수 있어요)',true);return false});
  }
  /* 게임 응답(아이스브레이킹 밸런스 선택·퀴즈 답): 방 문서 q가 열려 있을 때 ans/{q.id}_{uid} 1개(다시 보내면 덮어씀). 강사 노트북만 읽음 */
  function answer(qid,v){
    var r=get();if(!r||TEACH)return Promise.resolve(false);
    return boot().then(function(b){
      return b.F.setDoc(b.F.doc(b.db,'rooms',r.pin,'ans',qid+'_'+b.uid),{q:String(qid),v:String(v).slice(0,80),nick:r.nick,team:r.team||'',t:b.F.serverTimestamp()});
    }).then(function(){return true},function(){toast('보내지 못했어요 (마감됐을 수 있어요)',true);return false});
  }
  /* 접속 명단: 학생마다 work/{uid}_join 1개(조·이름). 강사 화면·교실 도구가 조별 명단으로 씀 */
  function hello(){var r=get();if(!r||TEACH)return;try{if(sessionStorage.getItem('tm-hello')===r.pin+'|'+(r.team||'')+'|'+r.nick)return}catch(e){}
    boot().then(function(b){return b.F.setDoc(b.F.doc(b.db,'rooms',r.pin,'work',b.uid+'_join'),{tool:'join',nick:r.nick,team:r.team||'',title:'',body:'',t:b.F.serverTimestamp()})})
      .then(function(){try{sessionStorage.setItem('tm-hello',r.pin+'|'+(r.team||'')+'|'+r.nick)}catch(e){}},function(){})}
  function ended(why){
    put(null);
    var o=document.createElement('div');
    o.style.cssText='position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px';
    o.innerHTML='<div style="background:#fff;color:#222;border-radius:12px;padding:24px;max-width:420px;text-align:center;font-family:system-ui;display:flex;flex-direction:column;gap:12px"><b style="font-size:1.4rem">수업이 끝났어요 👋</b><span>'+why+'</span><span style="color:#666;font-size:.9rem">내가 쓴 내용은 이 휴대폰에 그대로 남아 있어요.</span><a href="./" style="background:#4e6bf1;color:#fff;padding:12px;border-radius:6px;text-decoration:none;font-weight:700">처음 화면으로</a></div>';
    document.body.appendChild(o);
  }
  /* 강사가 '학생 화면 바꾸기'를 누르면 방 문서 go={to,t}가 바뀜 → 들어와 있는 학생 화면이 그 활동으로 넘어감(같은 지시는 한 번만) */
  function here(){var f=location.pathname.split('/').pop()||'';if(f==='index.html')f='';
    var q=location.search.replace(/([?&])(r|need|go)=[^&]*/g,'$1').replace(/[?&]+$/,'').replace(/\?&+/,'?');
    if(f===''){var v=new URLSearchParams(location.search).get('v');return location.hash==='#jaso'?'#jaso':v?'index.html?v='+v:'home'}
    var hh=(location.hash||'').slice(1);return f+q+(/^[a-z0-9-]{1,20}$/.test(hh)?(q?'&':'?')+'h='+hh:'')}
  function follow(r,room){
    var g=room&&room.go;if(!g||!g.to||!g.t||!g.t.toMillis)return;
    var key=r.pin+':'+g.t.toMillis(),seen='';try{seen=localStorage.getItem('tm-room-go')||''}catch(e){}
    if(seen===key)return;try{localStorage.setItem('tm-room-go',key)}catch(e){}
    if(g.to===here())return;
    location.href=g.to==='home'?'./':g.to.charAt(0)==='#'?'./'+g.to:g.to+(g.to.indexOf('?')<0?'?':'&')+'r='+r.pin;
  }
  function codeSync(room){var r=get(),ak=room&&typeof room.ak==='string'?room.ak:'';if(!r||!ak)return;
    if(r.ak!==ak){r.ak=ak;put(r)}if(useCode(ak)&&/(intro|interview|ai)\.html$/.test(location.pathname))location.reload()}
  function watch(onlyFollow){
    var r=get();if(!r||TEACH)return;hello();
    boot().then(function(b){
      var last=null;
      b.F.onSnapshot(b.F.doc(b.db,'rooms',r.pin),function(d){last=d.exists()?d.data():null;var w=alive(last);if(w){if(!onlyFollow)ended(w);return}codeSync(last);follow(r,last)},function(){});
      if(onlyFollow)return;
      setInterval(function(){if(!get())return;var w=alive(last);if(last!==null&&w)ended(w)},30e3);
    }).catch(function(){});
  }
  function badge(){
    var r=get();if(!r)return;var a=document.createElement('a');a.href='./';a.id='tmRoomBadge';
    a.textContent=label(r);a.title='눌러서 조 바꾸기';a.addEventListener('click',function(e){e.preventDefault();teamPick()});
    a.style.cssText='position:fixed;top:max(8px,env(safe-area-inset-top,0px));right:max(8px,env(safe-area-inset-right,0px));z-index:40;background:#4e6bf1;color:#fff;font:700 13px system-ui;padding:6px 12px;border-radius:999px;text-decoration:none;opacity:.92';
    document.body.appendChild(a);
  }
  /* 조 바꾸기(자리 옮긴 학생): 오른쪽 위 방 표시를 누르면 강사가 정한 조 이름 중에서 고름 */
  function teamPick(){
    var r=get();if(!r)return;var o=document.createElement('div');
    o.style.cssText='position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px';
    o.innerHTML='<div style="background:#fff;color:#222;border-radius:12px;padding:20px;width:min(420px,100%);font-family:system-ui;display:flex;flex-direction:column;gap:12px"><b style="font-size:1.2rem">우리 조 바꾸기</b><div id="tmTP" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">불러오는 중…</div><a href="./" style="color:#4e6bf1;font-weight:700;text-align:center">처음 화면으로</a><button style="border:1px solid #ccc;background:#fff;border-radius:6px;padding:10px;font:700 15px system-ui">닫기</button></div>';
    o.addEventListener('click',function(e){var t=e.target;if(t===o||t.tagName==='BUTTON'&&!t.dataset.t){o.remove();return}if(t.dataset&&t.dataset.t!=null){setTeam(t.dataset.t);o.remove();toast('✔ '+t.dataset.t+'(으)로 바꿨어요');try{window.dispatchEvent(new Event('tm-team'))}catch(x){}}});
    document.body.appendChild(o);
    info(r.pin).then(function(x){var b=document.getElementById('tmTP');if(!b)return;
      b.innerHTML=x.teams.length?x.teams.map(function(n){var on=n===r.team;return '<button data-t="'+String(n).replace(/[&<>"]/g,'')+'" style="border:2px solid #4e6bf1;background:'+(on?'#4e6bf1':'#fff')+';color:'+(on?'#fff':'#222')+';border-radius:8px;padding:14px;font:900 17px system-ui">'+String(n).replace(/[&<>"]/g,'')+'</button>'}).join(''):'<span style="grid-column:1/-1;color:#666">선생님이 아직 조 이름을 정하지 않았어요.</span>'},function(){});
  }
  function onRoom(cb){ // 방 문서 실시간(play.html: 강사 게임 화면 따라 보기)
    var r=get();if(!r)return;boot().then(function(b){b.F.onSnapshot(b.F.doc(b.db,'rooms',r.pin),function(d){cb(d.exists()?d.data():null)},function(){})}).catch(function(){});
  }
  window.TM_ROOM={get:get,join:join,check:check,send:send,answer:answer,info:info,setTeam:setTeam,teamPick:teamPick,leave:function(){put(null)},watch:watch,teach:TEACH,onRoom:onRoom};
  /* 강사 미리보기 탭에서 도구 안 화면을 바꾸면(#해시) 학생도 같은 화면으로: 강사 노트북의 기본 Firebase 앱(방 주인)으로 go를 씀 */
  function teachGo(){
    var host=null;try{host=JSON.parse(localStorage.getItem('live-host')||'null')}catch(e){}if(!host||!host.pin)return;
    var f=location.pathname.split('/').pop()||'',hh=(location.hash||'').slice(1),u=new URL(location.href);u.searchParams.delete('teach');
    var q=u.search,to=f+q+(/^[a-z0-9-]{1,20}$/.test(hh)?(q?'&':'?')+'h='+hh:'');if(!/^[a-z]+\.html/.test(to))return;
    Promise.all([import('./firebase-config.js'),import(G+'/firebase-app.js'),import(G+'/firebase-auth.js'),import(G+'/firebase-firestore.js')]).then(function(m){
      var app=m[1].getApps().filter(function(a){return a.name==='[DEFAULT]'})[0]||m[1].initializeApp(m[0].firebaseConfig),auth=m[2].getAuth(app);
      return auth.authStateReady().then(function(){return auth.currentUser||m[2].signInAnonymously(auth)}).then(function(){
        var F=m[3];return F.updateDoc(F.doc(F.getFirestore(app),'rooms',host.pin),{go:{to:to,t:F.serverTimestamp()}})});
    }).then(function(){toast('✔ 학생 화면도 이 화면으로 바꿨어요')},function(){});
  }
  if(TEACH){
    window.addEventListener('hashchange',teachGo);
    var tb=function(){var a=document.createElement('div');a.textContent='👀 선생님 미리보기 (학생이 보는 화면 · 결과는 안 보냄)';
      a.style.cssText='position:fixed;top:max(8px,env(safe-area-inset-top,0px));right:max(8px,env(safe-area-inset-right,0px));z-index:40;background:#2e2e2e;color:#fff;font:700 13px system-ui;padding:6px 12px;border-radius:999px;opacity:.92';document.body.appendChild(a)};
    if(document.body)tb();else document.addEventListener('DOMContentLoaded',tb);
    return;
  }
  if(GUARD){
    var qr=(new URLSearchParams(location.search).get('r')||'').replace(/\D/g,'').slice(0,4), cur=get();
    if(cur&&qr&&qr!==cur.pin){put(null);cur=null}
    if(!cur){ // 방에 안 들어왔으면 첫 화면에서 방 번호·이름 → 들어오면 이 도구로 바로 돌아옴
      var f=(location.pathname.split('/').pop()||'')+location.search.replace(/([?&])r=\d*&?/,'$1').replace(/[?&]$/,'')+location.hash;
      location.replace('./?'+(qr?'r='+qr+'&':'')+'need=1&go='+encodeURIComponent(f));return}
    if(document.body)badge();else document.addEventListener('DOMContentLoaded',badge);
    watch();
  }
})();
