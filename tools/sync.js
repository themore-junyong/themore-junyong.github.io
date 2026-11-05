/* 게임 화면 → 학생 폰 실시간 연동 (강사 노트북에서만 동작)
   - 강사가 teacher.html에서 방을 만든 노트북(localStorage live-host)이면, 게임 화면(빔)의 지금 상태를 방 문서 g={k,s,t}에 씀
   - 학생 폰(play.html)은 그 방 문서를 보고 같은 문제·보기·점수·타이머를 보여 줌 (정답은 강사가 공개했을 때만 넣음)
   - TM_SYNC.pub(종류, 화면모델) : 같은 내용이면 다시 안 씀, 0.4초 모아서 씀 */
(function(){
  var V='10.12.2', G='https://www.gstatic.com/firebasejs/'+V;
  function lsGet(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}}
  var host=lsGet('live-host'), pin=host&&host.pin, on=!!pin&&!/[?&](r|teach)=/.test(location.search)&&!/#host/.test(location.hash);
  var fb=null, last='', timer=null, want=null, dead=false;
  function boot(){
    if(fb)return fb;
    fb=Promise.all([import('./firebase-config.js'),import(G+'/firebase-app.js'),import(G+'/firebase-auth.js'),import(G+'/firebase-firestore.js')]).then(function(m){
      var app=m[1].getApps().length?m[1].getApp():m[1].initializeApp(m[0].firebaseConfig),auth=m[2].getAuth(app);
      return auth.authStateReady().then(function(){return auth.currentUser||m[2].signInAnonymously(auth)}).then(function(){
        var F=m[3],db=F.getFirestore(app),ref=F.doc(db,'rooms',pin);
        return F.getDoc(ref).then(function(d){var r=d.exists()?d.data():null;
          if(!r||r.owner!==auth.currentUser.uid||r.closed||!r.exp||r.exp.toMillis()<Date.now())throw new Error('no room');
          return {F:F,ref:ref,db:db,teams:Array.isArray(r.teams)?r.teams:[]}});
      });
    });
    fb.catch(function(){dead=true});
    return fb;
  }
  /* 강사 화면이 켜져 있다는 신호(hb): 빔 게임 화면만 띄워 둬도 학생 폰이 '수업 끝'으로 끊기지 않게 1분마다 */
  if(on){var beat=function(){if(!dead)boot().then(function(b){return b.F.updateDoc(b.ref,{hb:b.F.serverTimestamp()})}).catch(function(){})};setTimeout(beat,3000);setInterval(beat,60e3)}
  function flush(){timer=null;if(!want||dead)return;var w=want;want=null;
    boot().then(function(b){return b.F.updateDoc(b.ref,{g:{k:w.k,s:w.s,t:b.F.serverTimestamp()}})}).catch(function(){});
  }
  /* 학생 응답 받기: 방 문서 q={id,open,type:'ice'}를 열고, ans(q==id)를 실시간으로 받음 (강사만 읽기 가능) */
  var lastQ='', aUnsub=null, aId='';
  function ask(q){if(!on||dead)return;var k=JSON.stringify(q||null);if(k===lastQ)return;lastQ=k;
    boot().then(function(b){return b.F.updateDoc(b.ref,{q:q||null})}).catch(function(){})}
  function onAns(id,cb){if(!on||dead)return;if(id===aId)return;aId=id;if(aUnsub){aUnsub();aUnsub=null}if(!id)return;
    boot().then(function(b){if(aId!==id)return;var F=b.F;
      aUnsub=F.onSnapshot(F.query(F.collection(b.db,'rooms',pin,'ans'),F.where('q','==',id)),function(s){var A=[];s.docs.forEach(function(d){A.push(d.data())});cb(id,A)},function(){});
    }).catch(function(){})}
  /* 접속 명단(work/*_join): [{nick,team}] 실시간 */
  function roster(cb){if(!on)return;boot().then(function(b){var F=b.F;F.onSnapshot(F.query(F.collection(b.db,'rooms',pin,'work'),F.where('tool','==','join')),function(s){var A=[];s.docs.forEach(function(d){var x=d.data();A.push({nick:x.nick||'',team:x.team||''})});cb(A)},function(){})}).catch(function(){})}
  window.TM_SYNC={on:on,roster:roster,ask:ask,onAns:onAns,teams:function(cb){if(on)boot().then(function(b){return b.F.getDoc(b.ref)}).then(function(d){var r=d.data()||{};cb(Array.isArray(r.teams)?r.teams:[])}).catch(function(){})},pub:function(kind,view){
    if(!on||dead)return;var s;try{s=JSON.stringify(view).slice(0,7900)}catch(e){return}
    if(s===last)return;last=s;want={k:String(kind).slice(0,20),s:s};if(!timer)timer=setTimeout(flush,400);
  }};
  if(on)boot();
})();
