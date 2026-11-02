/* 내 수업함(teachers/{강사 초대코드}) 읽기·쓰기 — 강사 노트북에서만.
   강사가 teacher.html·live.html에서 넣은 초대코드(localStorage tm-code, 학생 폰의 room 표시가 없는 것)를 씀.
   TM_MY.code() · TM_MY.load() → 문서 내용 또는 null · TM_MY.save({필드:값}) → true/false (merge) */
(function(){
  var V='10.12.2', G='https://www.gstatic.com/firebasejs/'+V, fb=null;
  function code(){var c=null;try{c=JSON.parse(localStorage.getItem('tm-code')||'null')}catch(e){}
    var k=c&&!c.room&&typeof c.code==='string'?c.code.trim().toUpperCase():'';return /^[A-Z0-9-]{4,40}$/.test(k)?k:''}
  function boot(){if(fb)return fb;
    fb=Promise.all([import('./firebase-config.js'),import(G+'/firebase-app.js'),import(G+'/firebase-auth.js'),import(G+'/firebase-firestore.js')]).then(function(m){
      var app=m[1].getApps().length?m[1].getApp():m[1].initializeApp(m[0].firebaseConfig),auth=m[2].getAuth(app);
      return auth.authStateReady().then(function(){return auth.currentUser||m[2].signInAnonymously(auth)}).then(function(){return {F:m[3],db:m[3].getFirestore(app)}})});
    fb.catch(function(){fb=null});return fb}
  function load(){var k=code();if(!k)return Promise.resolve(null);
    return boot().then(function(b){return b.F.getDoc(b.F.doc(b.db,'teachers',k))}).then(function(d){return d.exists()?d.data():{}}).catch(function(){return null})}
  function save(p){var k=code();if(!k)return Promise.resolve(false);
    return boot().then(function(b){return b.F.setDoc(b.F.doc(b.db,'teachers',k),Object.assign({},p,{t:b.F.serverTimestamp()}),{merge:true})}).then(function(){return true},function(){return false})}
  window.TM_MY={code:code,load:load,save:save};
})();
