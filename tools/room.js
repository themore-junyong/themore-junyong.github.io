/* 수업 방 연결 (학생 화면 공통)
   - 강사가 teacher.html에서 방을 만들어야 학생이 쓸 수 있어요. 방 번호 + 이름은 이 휴대폰(localStorage tm-room-s)에 기억.
   - <script src="room.js" data-guard></script> : 방에 안 들어왔으면 첫 화면(방 번호 입력)으로 보냄, 오른쪽 위에 "방 1234 · 이름" 표시
   - 강사가 방을 종료(closed)하거나 강사 화면이 3분 넘게 꺼져 있으면(hb 멈춤) "수업이 끝났어요"로 끊김
   - TM_ROOM.send(도구, 제목, 내용) : 결과를 그 방 강사 화면으로 보냄(도구마다 1개, 다시 보내면 덮어씀). 강사만 읽을 수 있음 */
(function(){
  var V='10.12.2', G='https://www.gstatic.com/firebasejs/'+V, K='tm-room-s', STALE=3*60e3;
  var me=document.currentScript, GUARD=me&&me.hasAttribute('data-guard');
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
  function check(pin){
    return boot().then(function(b){return b.F.getDoc(b.F.doc(b.db,'rooms',pin))}).then(function(d){return alive(d.exists()?d.data():null)});
  }
  function join(pin,nick){
    pin=String(pin||'').replace(/\D/g,'');nick=String(nick||'').trim().slice(0,12);
    if(pin.length!==4)return Promise.reject(new Error('방 번호 4자리를 넣어 주세요'));
    if(!nick)return Promise.reject(new Error('이름(또는 번호)을 넣어 주세요'));
    return check(pin).then(function(bad){if(bad)throw new Error(bad);put({pin:pin,nick:nick,t:Date.now()});return {pin:pin,nick:nick}});
  }
  function toast(t,bad){var d=document.createElement('div');d.textContent=t;
    d.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:90;background:'+(bad?'#c8432f':'#2e8b4c')+';color:#fff;font:700 15px system-ui;padding:10px 18px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.2);max-width:90vw;text-align:center';
    document.body.appendChild(d);setTimeout(function(){d.remove()},2600)}
  function send(tool,title,body){
    var r=get();if(!r)return Promise.resolve(false);
    return boot().then(function(b){
      return b.F.setDoc(b.F.doc(b.db,'rooms',r.pin,'work',b.uid+'_'+tool),{tool:tool,nick:r.nick,title:String(title||'').slice(0,80),body:String(body||'').slice(0,6000),t:b.F.serverTimestamp()});
    }).then(function(){toast('✔ 선생님께 보냈어요');return true},function(){toast('선생님께 보내지 못했어요 (방이 끝났을 수 있어요)',true);return false});
  }
  function ended(why){
    put(null);
    var o=document.createElement('div');
    o.style.cssText='position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px';
    o.innerHTML='<div style="background:#fff;color:#222;border-radius:12px;padding:24px;max-width:420px;text-align:center;font-family:system-ui;display:flex;flex-direction:column;gap:12px"><b style="font-size:1.4rem">수업이 끝났어요 👋</b><span>'+why+'</span><span style="color:#666;font-size:.9rem">내가 쓴 내용은 이 휴대폰에 그대로 남아 있어요.</span><a href="./" style="background:#4e6bf1;color:#fff;padding:12px;border-radius:6px;text-decoration:none;font-weight:700">처음 화면으로</a></div>';
    document.body.appendChild(o);
  }
  function watch(){
    var r=get();if(!r)return;
    boot().then(function(b){
      var last=null;
      b.F.onSnapshot(b.F.doc(b.db,'rooms',r.pin),function(d){last=d.exists()?d.data():null;var w=alive(last);if(w)ended(w)},function(){});
      setInterval(function(){if(!get())return;var w=alive(last);if(last!==null&&w)ended(w)},30e3);
    }).catch(function(){});
  }
  function badge(){
    var r=get();if(!r)return;var a=document.createElement('a');a.href='./';a.id='tmRoomBadge';
    a.textContent='🏠 방 '+r.pin+' · '+r.nick;
    a.style.cssText='position:fixed;top:max(8px,env(safe-area-inset-top,0px));right:max(8px,env(safe-area-inset-right,0px));z-index:40;background:#4e6bf1;color:#fff;font:700 13px system-ui;padding:6px 12px;border-radius:999px;text-decoration:none;opacity:.92';
    document.body.appendChild(a);
  }
  window.TM_ROOM={get:get,join:join,check:check,send:send,leave:function(){put(null)},watch:watch};
  if(GUARD){
    if(!get()){location.replace('./?need=1');return}
    if(document.body)badge();else document.addEventListener('DOMContentLoaded',badge);
    watch();
  }
})();
