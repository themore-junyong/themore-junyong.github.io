// 서버 AI 연결: 익명 로그인 → 서버 함수(서울) 부르기. 화면은 window.TM_AI 로만 씀.
import { firebaseConfig } from './firebase-config.js';
const V = '10.12.2', G = `https://www.gstatic.com/firebasejs/${V}`;
let ready = null;
function boot() {
  if (!ready) ready = (async () => {
    const { initializeApp } = await import(`${G}/firebase-app.js`);
    const A = await import(`${G}/firebase-auth.js`), Fn = await import(`${G}/firebase-functions.js`);
    const app = initializeApp(firebaseConfig), auth = A.getAuth(app);
    if (!auth.currentUser) await A.signInAnonymously(auth);
    const fns = Fn.getFunctions(app, 'asia-northeast3');
    return (name, data, ms) => Fn.httpsCallable(fns, name, { timeout: ms || 70000 })(data).then(r => r.data);
  })().catch(e => { ready = null; throw e; });
  return ready;
}
const msg = e => (e && e.message && !/^(internal|INTERNAL)$/.test(e.message)) ? e.message : '연결이 끊겼어요. 다시 눌러 주세요';
if (firebaseConfig) {
  window.TM_AI = {
    check: code => boot().then(call => call('codeCheck', { code }, 15000)).catch(e => { throw new Error(msg(e)); }),
    intro: p => boot().then(call => call('introChat', p, 120000)).catch(e => { throw new Error(msg(e)); }),
    draft: (code, d) => boot().then(call => call('jasoDraft', { code, d }, 300000)).catch(e => { throw new Error(msg(e)); }),
  };
  window.dispatchEvent(new Event('tm-ai'));
}
