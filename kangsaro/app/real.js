// 강사로 실제 앱: 로그인과 Firebase 저장. 화면은 index.html(체험판과 같은 코드)이 그림.
// 화면 코드는 전역 S(강사·업체·공고·지원·일정·알림)를 고치고 save()를 부름 → 여기서 바뀐 문서만 Firestore에 씀.
import { firebaseConfig } from './firebase-config.js';

const V = '10.12.2', G = `https://www.gstatic.com/firebasejs/${V}`;
const ADMINS = ['tobadyclub87@gmail.com'];
const Q = new URLSearchParams(location.search);
const EMU = Q.has('emu');
// 소개 링크(?ref=소개한 사람)는 로그인 전에 기억해 둠
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
if (Q.get('ref')) try { localStorage.setItem('kangsaro.ref', Q.get('ref')); } catch (e) { }
// 업체 직원 초대 링크(?staff=코드)도 로그인 전에 기억
if (Q.get('staff')) try { localStorage.setItem('kangsaro.staff', Q.get('staff')); } catch (e) { }

if (!firebaseConfig && !EMU) {
  REAL.gate = () => `<div class="card"><h2>강사로 준비 중이에요</h2><p class="mu">곧 열려요. 그동안 체험판으로 미리 써 보세요.</p><a class="btn pri" href="../try/">체험판 열기</a></div>`;
  render();
  throw new Error('firebaseConfig 없음');
}

const { initializeApp } = await import(`${G}/firebase-app.js`);
const A = await import(`${G}/firebase-auth.js`);
const F = await import(`${G}/firebase-firestore.js`);
const fbApp = initializeApp(firebaseConfig || { apiKey: 'demo', authDomain: 'demo-kangsaro.firebaseapp.com', projectId: 'demo-kangsaro' });
const auth = A.getAuth(fbApp);
const db = F.getFirestore(fbApp);
if (EMU) { A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); F.connectFirestoreEmulator(db, '127.0.0.1', 8080); }
const { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, query, where, limit, onSnapshot } = F;

/* ===== 문서 나누기 ===== */
const PUB = { i: ['name', 'region', 'topics', 'intro', 'certs', 'career', 'photo', 'joined', 'beta', 'refBy'], c: ['name', 'contact', 'joined', 'approved', 'refBy', 'biz', 'blocked', 'logo', 'forms'] };
// 사업자등록번호: 숫자 10자리 + 국세청 검증 숫자 (보안 규칙도 같은 계산)
const bizNum = v => String(v || '').replace(/\D/g, '');
const bizOk = n => { if (!/^\d{10}$/.test(n)) return false; const d = [...n].map(Number), w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; let t = w.reduce((a, x, i) => a + d[i] * x, 0) + Math.floor(d[8] * 5 / 10); return (10 - t % 10) % 10 === d[9]; };
const bizFmt = n => n ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : '';
// 번호 하나에 업체 하나: biz/{번호} 문서를 먼저 잡고 나서 승인
async function claimBiz(n) {
  const r = doc(db, 'biz', n), d = await getDoc(r);
  if (d.exists()) { if (d.data().uid === uidMe) return true; toast('이미 가입된 사업자등록번호예요. 문의: tobadyclup@naver.com'); return false; }
  await setDoc(r, { uid: uidMe, at: new Date().toISOString() }); return true;
}
// 국세청 확인(서버)을 켰으면 서버가 확인하고 승인. 안 켰으면 예전처럼 검증 숫자만 보고 바로 승인
const ntsOn = () => !!(SITE && SITE.nts);
async function verifyBiz(n) {
  try {
    const Fn = await import(`${G}/firebase-functions.js`), fns = Fn.getFunctions(fbApp, 'asia-northeast3');
    if (EMU) Fn.connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    toast('국세청에 확인하는 중이에요…');
    await Fn.httpsCallable(fns, 'verifyBiz')({ biz: n }); return true;
  } catch (e) { toast(e.message && !/^internal$/i.test(e.message) ? e.message : '확인하지 못했어요. 조금 뒤 다시 해 주세요'); return false; }
}
const PRIV = { i: ['phone', 'email', 'bank', 'acct', 'holder', 'kmpl', 'fuel', 'vault'], c: ['phone', 'email'] };
// 한 계정으로 강사·업체 둘 다: 가입한 쪽(role)은 문서 위에, 나중에 더한 쪽은 side 칸에. 업체 승인(biz·approved·blocked)은 늘 위에
const SIDE = { i: ['name', 'region', 'topics', 'intro', 'certs', 'career', 'photo', 'joined'], c: ['name', 'contact', 'joined', 'logo', 'forms'] };
const has = r => !!me && (me.role === r || (me.side && me.side.role === r) || (r === 'c' && !!me.staffOf));
function asRole(x, r) {
  if (!x) return null;
  if (x.role === r) return x;
  if (!x.side || x.side.role !== r) return null;
  return { id: x.id, ...pick(x, [...PRIV.i, 'approved', 'biz', 'blocked', 'refBy']), ...x.side };
}
const pick = (o, ks) => { const r = {}; for (const k of ks) if (o[k] !== undefined) r[k] = o[k]; return r; };
const omit = (o, ks) => { const r = { ...o }; for (const k of ks) delete r[k]; return r; };
// 키 순서와 상관없이 같은 내용이면 같은 글자
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k] === undefined ? null : x[k]])) : x);
const clean = o => JSON.parse(JSON.stringify(o)); // undefined 빼기

let me = null, role = '', uidMe = '', profileLoaded = false;
// 업체 화면에서 일하는 업체 (대표면 나, 직원이면 내가 속한 업체). staffMe = 직원일 때 내 staff 문서
let CO = '', staffMe = null, PEND = null;
const NAV0 = { c: NAV.c.slice() };
const isStaffView = () => role === 'c' && CO !== uidMe;
const last = new Map();         // 경로 → 마지막으로 서버와 맞춘 내용
const links = new Set();        // 업체: 확정한 강사 (서류 열람 허락)
const unsub = [];

// 지금 S에서 내가 쓸 수 있는 문서들 (경로 → 내용)
function payloads() {
  const out = new Map(), u = uidMe;
  if (!u || !S.me) return out;
  const mine = role === 'i' ? S.insts.find(x => x.id === u) : S.cos.find(x => x.id === u);
  // 직원은 업체 정보(이름·양식)를 못 고침 → users 문서는 대표만 씀
  if (mine && me && !isStaffView()) {
    const base = omit(me, ['id', ...PRIV.i]);
    out.set(`users/${u}`, role === me.role ? { ...omit(base, PUB[role]), ...pick(mine, PUB[role]), role } : { ...base, side: { ...pick(mine, SIDE[role]), role } });
    out.set(`users/${u}/private/main`, { ...pick(me, PRIV.i), ...pick(mine, PRIV[role]) });
  }
  const c = role === 'c' ? CO : '';
  for (const j of S.jobs) {
    if (!c || j.coId !== c) continue;
    holdFix(j);
    // 신고(reports)는 강사가 따로 씀 → 업체 저장에서 빼고 합쳐 씀 (flush의 MERGE)
    out.set(`jobs/${j.id}`, omit(j, ['notices', 'reports']));
    for (const n of j.notices || []) out.set(`notices/${n.id}`, { ...n, jobId: j.id, coId: c });
  }
  for (const a of S.apps) {
    const j = job(a.jobId);
    if (a.instId !== u && (!c || !j || j.coId !== c)) continue;
    out.set(`apps/${a.id}`, { ...a, coId: a.coId || (j && j.coId) || '' });
  }
  for (const e of S.evs) if (e.instId === u) out.set(`evs/${e.id}`, e);
  for (const al of S.alerts) { if (!al.by) al.by = c || u; if (al.by === u || (c && al.by === c) || al.instId === u) out.set(`alerts/${al.id}`, { by: al.by || '', ...al }); }
  for (const [k, v] of out) out.set(k, clean(v));
  return out;
}
// 강사가 공지를 읽으면 자기 칸만 고침
function readMarks() {
  const out = new Map();
  if (role !== 'i') return out;
  for (const j of S.jobs) for (const n of j.notices || []) if ((n.to || []).includes(uidMe) && n.reads && n.reads[uidMe]) out.set(`notices/${n.id}#read`, n.reads[uidMe]);
  return out;
}
function prime(keys) {
  const P = payloads(), R = readMarks();
  for (const [k, v] of P) if (!keys || keys.has(k)) last.set(k, stable(v));
  for (const [k, v] of R) if (!keys || keys.has(k.split('#')[0])) last.set(k, v);
}

let timer = null, busy = false, again = false;
SYNC = () => { clearTimeout(timer); timer = setTimeout(flush, 250); };
async function flush() {
  if (LOCK) return;
  if (busy) { again = true; return; }
  busy = true; clearTimeout(timer);
  try {
    const P = payloads(), R = readMarks(), order = k => k.startsWith('users/') ? 0 : k.startsWith('jobs/') ? 1 : k.startsWith('apps/') ? 2 : 3;
    const writes = [...P].filter(([k, v]) => last.get(k) !== stable(v)).sort((a, b) => order(a[0]) - order(b[0]));
    for (const [k, v] of writes) { await setDoc(doc(db, k), v, k.startsWith('jobs/') ? { merge: true } : {}); last.set(k, stable(v)); }
    for (const [k, v] of R) if (last.get(k) !== v) { const p = k.split('#')[0]; await updateDoc(doc(db, p), { ['reads.' + uidMe]: v }); last.set(k, v); }
    for (const k of [...last.keys()]) if (!k.includes('#') && !P.has(k) && mayDelete(k)) { await deleteDoc(doc(db, k)); last.delete(k); }
    if (role === 'c') await syncLinks();
  } catch (e) { console.error(e); toast(e.code === 'permission-denied' ? '저장할 권한이 없어요. 새로고침해 주세요' : '저장하지 못했어요. 인터넷을 확인해 주세요'); }
  busy = false;
  if (again) { again = false; flush(); }
}
const mayDelete = k => /^(evs|notices|jobs|alerts)\//.test(k);
// 업체가 확정한 강사만 그 강사의 연락처·계좌·서류를 볼 수 있게 표시
async function syncLinks() {
  const want = new Map();
  for (const a of S.apps) { const j = job(a.jobId); if (j && j.coId === CO && a.status === '확정') want.set(a.instId, a.id); }
  for (const [iid, appId] of want) if (!links.has(iid)) { await setDoc(doc(db, 'links', `${CO}_${iid}`), { coId: CO, instId: iid, appId }); links.add(iid); loadInst(iid, true); }
  for (const iid of [...links]) if (!want.has(iid)) { await deleteDoc(doc(db, 'links', `${CO}_${iid}`)); links.delete(iid); }
}

/* ===== 불러오기 ===== */
const upsert = (arr, x) => { const i = arr.findIndex(y => y.id === x.id); if (i < 0) arr.push(x); else arr[i] = x; };
async function loadUser(id, withPriv) {
  const d = await getDoc(doc(db, 'users', id));
  if (!d.exists()) return null;
  const x = { id, ...d.data() };
  if (withPriv) { try { const p = await getDoc(doc(db, 'users', id, 'private', 'main')); if (p.exists()) Object.assign(x, p.data()); } catch (e) { /* 확정 전이면 못 봄 */ } }
  return x;
}
async function loadInst(id, priv) { const x = asRole(await loadUser(id, priv).catch(() => null), 'i'); if (x) { upsert(S.insts, x); later(); } }
async function loadCo(id) { if (S.cos.some(c => c.id === id)) return; const x = asRole(await loadUser(id, false).catch(() => null), 'c'); if (x) { upsert(S.cos, x); later(); } }
async function loadJob(id) { if (S.jobs.some(j => j.id === id)) return; const d = await getDoc(doc(db, 'jobs', id)).catch(() => null); if (d && d.exists()) { putJob({ id, ...d.data() }); prime(new Set([`jobs/${id}`])); later(); } }
function putJob(j) { const old = S.jobs.find(x => x.id === j.id); j.notices = old ? old.notices : []; upsert(S.jobs, j); loadCo(j.coId); }

// 서버에서 바뀐 것 반영 (먼저 내 쪽 변경을 보내고)
function live(q, apply) {
  unsub.push(onSnapshot(q, snap => {
    if (snap.metadata.hasPendingWrites) return;
    const keys = new Set();
    for (const ch of snap.docChanges()) { apply(ch); keys.add(ch.doc.ref.path); }
    prime(keys);
    later();
  }, e => console.error(e)));
}
let rt = null;
// 입력 중이면 다 쓰고 나서 다시 그림
function later() { clearTimeout(rt); rt = setTimeout(() => { const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('#main,#sheet')) { a.addEventListener('blur', later, { once: true }); return; } if (!$('#sheet').innerHTML) render(); }, 120); }

function notice(ch) {
  const n = { id: ch.doc.id, ...ch.doc.data() }, j = S.jobs.find(x => x.id === n.jobId);
  if (!j) { loadJob(n.jobId).then(() => { const k = S.jobs.find(x => x.id === n.jobId); if (k) { upsert(k.notices, omit(n, ['jobId', 'coId'])); prime(new Set([`notices/${n.id}`])); later(); } }); return; }
  if (ch.type === 'removed') j.notices = j.notices.filter(x => x.id !== n.id); else upsert(j.notices, omit(n, ['jobId', 'coId']));
}
function app(ch) {
  const a = { id: ch.doc.id, ...ch.doc.data() };
  if (ch.type === 'removed') { S.apps = S.apps.filter(x => x.id !== a.id); return; }
  upsert(S.apps, a);
  if (role === 'i') loadJob(a.jobId); else if (!S.insts.some(x => x.id === a.instId)) loadInst(a.instId, true);
  // 강사가 확정 강의를 취소하면 마감했던 공고를 다시 모집으로
  if (role === 'c' && a.status === '취소' && a.cxConfirmed) { const j = job(a.jobId); if (j && j.status === '마감') { j.status = '모집'; SYNC(); } }
}

async function start(user, want) {
  uidMe = user.uid;
  unsub.splice(0).forEach(f => f()); links.clear(); last.clear();
  Object.assign(S, { insts: [], cos: [], jobs: [], apps: [], evs: [], alerts: [] });
  me = await loadUser(uidMe, true);
  profileLoaded = true; PEND = null; CO = ''; staffMe = null; WHO = '';
  // 직원 초대 링크로 들어왔으면 먼저 합류할지 물음
  const code = lsGet('kangsaro.staff');
  if (code) {
    const iv = await getDoc(doc(db, 'invites', code)).catch(() => null);
    if (!iv || !iv.exists()) { try { localStorage.removeItem('kangsaro.staff'); } catch (e) { } toast('초대 링크가 만료됐어요. 업체에 새 링크를 받아 주세요'); }
    else if (iv.data().coId === uidMe) { try { localStorage.removeItem('kangsaro.staff'); } catch (e) { } }
    else {
      const co = await getDoc(doc(db, 'staff', `${iv.data().coId}_${uidMe}`)).catch(() => null);
      if (co && co.exists() && me && me.staffOf === iv.data().coId) { try { localStorage.removeItem('kangsaro.staff'); } catch (e) { } want = 'c'; }
      else { const cd = await loadUser(iv.data().coId, false).catch(() => null); PEND = { code, coId: iv.data().coId, name: (asRole(cd, 'c') || {}).name || '업체' }; S.me = ''; render(); return; }
    }
  }
  if (!me) { render(); return; }
  // 업체에서 내보내졌으면 연결을 지움
  if (me.staffOf) {
    const sd = await getDoc(doc(db, 'staff', `${me.staffOf}_${uidMe}`)).catch(() => null);
    if (sd && sd.exists()) staffMe = sd.data();
    else { await updateDoc(doc(db, 'users', uidMe), { staffOf: deleteField() }).catch(() => { }); delete me.staffOf; toast('업체 직원 연결이 끝났어요'); }
  }
  if (me.role === 's' && !me.staffOf) { S.me = ''; me.gone = true; render(); return; }
  want = want || lsGet('kangsaro.view.' + uidMe);
  role = has(want) ? want : me.role === 's' ? 'c' : me.role;
  const own = role === 'c' && asRole(me, 'c');
  CO = role !== 'c' ? '' : own ? uidMe : me.staffOf;
  NAV.c = isStaffView() && !(staffMe && staffMe.pay) ? NAV0.c.filter(n => n[0] !== 'pay') : NAV0.c.slice();
  const mine = own ? asRole(me, 'c') : role === 'c' ? (asRole(await loadUser(CO, false).catch(() => null), 'c') || { id: CO, name: '업체' }) : asRole(me, role);
  WHO = isStaffView() ? (staffMe && staffMe.name) || '직원' : role === 'c' ? (mine.contact || '대표') : '';
  if (role === 'i') {
    S.insts = [mine]; S.me = 'i:' + uidMe;
    const ev = await getDocs(query(collection(db, 'evs'), where('instId', '==', uidMe)));
    S.evs = ev.docs.map(d => ({ id: d.id, ...d.data() }));
    const ap = await getDocs(query(collection(db, 'apps'), where('instId', '==', uidMe)));
    S.apps = ap.docs.map(d => ({ id: d.id, ...d.data() }));
    const jb = await getDocs(query(collection(db, 'jobs'), where('status', '==', '모집'), limit(300)));
    for (const d of jb.docs) putJob({ id: d.id, ...d.data() });
    await Promise.all(S.apps.map(a => loadJob(a.jobId)));
    const al = await getDocs(query(collection(db, 'alerts'), where('instId', '==', uidMe)));
    S.alerts = al.docs.map(d => ({ id: d.id, ...d.data() }));
    const nt = await getDocs(query(collection(db, 'notices'), where('to', 'array-contains', uidMe)));
    for (const d of nt.docs) notice({ type: 'added', doc: d });
    await Promise.all([...new Set(S.jobs.map(j => j.coId))].map(loadCo));
    prime();
    live(query(collection(db, 'apps'), where('instId', '==', uidMe)), app);
    live(query(collection(db, 'jobs'), where('status', '==', '모집'), limit(300)), ch => { if (ch.type !== 'removed') putJob({ id: ch.doc.id, ...ch.doc.data() }); });
    live(query(collection(db, 'alerts'), where('instId', '==', uidMe)), ch => { const x = { id: ch.doc.id, ...ch.doc.data() }; if (ch.type === 'removed') S.alerts = S.alerts.filter(y => y.id !== x.id); else upsert(S.alerts, x); });
    live(query(collection(db, 'notices'), where('to', 'array-contains', uidMe)), notice);
  } else {
    S.cos = [mine]; S.me = 'c:' + CO;
    const jb = await getDocs(query(collection(db, 'jobs'), where('coId', '==', CO)));
    S.jobs = jb.docs.map(d => ({ id: d.id, ...d.data(), notices: [] }));
    const nt = await getDocs(query(collection(db, 'notices'), where('coId', '==', CO)));
    for (const d of nt.docs) notice({ type: 'added', doc: d });
    const ap = await getDocs(query(collection(db, 'apps'), where('coId', '==', CO)));
    S.apps = ap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lk = await getDocs(query(collection(db, 'links'), where('coId', '==', CO)));
    for (const d of lk.docs) links.add(d.data().instId);
    await Promise.all([...new Set(S.apps.map(a => a.instId))].map(id => loadInst(id, links.has(id))));
    // 주민번호는 30일이 지나면 업체가 안 봤어도 지움
    const old = Date.now() - 30 * 864e5;
    for (const a of S.apps) if (a.rrn && a.rrnAt && Date.parse(a.rrnAt) < old) { delete a.rrn; delete a.rrnAt; a.docs[RRN] = '기한 지나 지움'; }
    prime();
    live(query(collection(db, 'apps'), where('coId', '==', CO)), app);
    live(query(collection(db, 'notices'), where('coId', '==', CO)), notice);
    // 업체 공고도 실시간 (직원끼리 같이 고칠 때)
    live(query(collection(db, 'jobs'), where('coId', '==', CO)), ch => { if (ch.type === 'removed') S.jobs = S.jobs.filter(x => x.id !== ch.doc.id); else putJob({ id: ch.doc.id, ...ch.doc.data() }); });
    // 대표가 내보내거나 정산 권한을 바꾸면 바로 반영
    if (isStaffView()) unsub.push(onSnapshot(doc(db, 'staff', `${CO}_${uidMe}`), d => { if (!d.exists() || !!d.data().pay !== !!(staffMe && staffMe.pay)) start(auth.currentUser, 'c'); }, () => start(auth.currentUser, 'c')));
    SYNC();
  }
  ui.tab = NAV[role][0][0];
  render();
  showTerm();
  if (isAdm()) adminQueue().then(l => { if (l.length) toast(`확인 대기·신고 공고 ${l.length}건이 있어요. '업체 관리'에서 봐 주세요`); });
}

/* ===== 로그인 화면 ===== */
const isKakaoUA = /KAKAOTALK/i.test(navigator.userAgent);
REAL.gate = () => {
  if (!auth.currentUser) return `<div class="card"><h2>강사로 시작하기</h2>
    <p class="mu"><b>지금 가입하면 3개월 무료</b>예요. 3개월만 써 보세요. 강의 관리에 쓰던 시간이 확실히 줄어듭니다. 카드 등록은 필요 없어요. 강의 업체는 사업자등록번호를 넣으면 바로 공고를 올릴 수 있어요.</p>
    ${isKakaoUA ? '<div class="alert">카카오톡 안에서는 구글 로그인이 막혀요. 아래 이메일로 로그인하거나, 위의 "다른 브라우저로 열기"를 눌러 주세요.</div>' : `<button class="btn pri" data-real="google">구글 계정으로 시작</button>`}
    <label class="f">이메일로 시작 (비밀번호 없이, 메일로 온 링크를 누르면 로그인돼요)<input id="rMail" type="email" autocomplete="email" placeholder="you@example.com"></label>
    <button class="btn ${isKakaoUA ? 'pri' : ''}" data-real="mail">로그인 링크 받기</button>
    <span class="mu sm">가입하면 <a href="../privacy.html">개인정보 처리방침</a>에 동의하는 것으로 봐요.</span></div>
    <a class="btn" href="../try/">먼저 체험판 써 보기</a> <a class="btn" style="text-decoration:none;color:inherit" href="../guide/">사용설명서</a>`;
  if (!profileLoaded) return '<p class="mu">불러오는 중…</p>';
  if (PEND) return `<div class="card"><h2>${esc(PEND.name)} 직원으로 합류할까요?</h2>
    <span class="mu sm">${esc(auth.currentUser.email || '')}로 로그인했어요. 합류하면 이 업체의 공고·강사·공지·서류를 같이 보고 고칠 수 있어요. 업체 정보와 직원 관리는 대표만 해요.</span>
    <label class="f">내 이름 (공지에 '작성: 이름'으로 보여요)<input id="sName" value="${esc((me && me.name) || auth.currentUser.displayName || '')}" autocomplete="name"></label>
    <button class="btn pri" data-real="staffJoin">합류하기</button>
    <button class="btn sm" data-real="staffLater">합류 안 함</button></div>`;
  if (me && me.gone) return `<div class="card"><h2>업체 직원 연결이 끝났어요</h2><p class="mu">업체에서 내보냈거나 스스로 나갔어요. 다시 일하려면 업체에 새 초대 링크를 받아 주세요.</p><button class="btn sm" data-real="out">로그아웃</button></div>`;
  return `<div class="card"><h2>어느 쪽으로 가입할까요?</h2>
    <span class="mu sm">${esc(auth.currentUser.email || '')}로 로그인했어요.</span>
    ${lsGet('kangsaro.ref') ? '<div class="alert">소개로 오셨어요. 가입하면 소개한 분과 함께 무료 기간이 늘어요 (업체 1개월, 강사 1주일).</div>' : ''}
    <div class="row"><label class="sm"><input type="radio" name="rRole" value="i" checked> 강사예요</label><label class="sm"><input type="radio" name="rRole" value="c"> 강의 업체예요</label></div>
    <label class="f">이름 (업체는 업체명)<input id="rName" autocomplete="name"></label>
    <label class="f">연락처<input id="rPhone" type="tel" autocomplete="tel" placeholder="010-0000-0000"></label>
    <label class="f" id="rRegionF">사는 곳 (순수익·거리 계산용)<select id="rRegion">${Object.keys(GEO).map(k => `<option>${k}</option>`).join('')}</select></label>
    <label class="f" id="rContactF" hidden>담당자 (예: 김○○ 팀장)<input id="rContact"></label>
    <label class="f" id="rBizF" hidden>사업자등록번호 (공고 등록에 꼭 필요해요)<input id="rBiz" inputmode="numeric" placeholder="000-00-00000"></label>
    <button class="btn pri" data-real="join">가입하기</button>
    <button class="btn sm" data-real="out">다른 계정으로</button></div>`;
};
REAL.acct = () => {
  const el = $('#acct'); if (!el) return;
  const cur = (role === 'i' ? S.insts.find(x => x.id === uidMe) : S.cos.find(x => x.id === CO)) || me || {}, other = role === 'i' ? 'c' : 'i';
  const pending = role === 'c' && !cur.approved && !isStaffView(), isAdmin = ADMINS.includes(auth.currentUser?.email);
  const sw = me.role === 's' ? '' : has(other) ? `<button class="btn sm" data-real="swap" title="같은 계정으로 화면만 바꿔요">⇄ ${other === 'c' ? '업체 화면' : '강사 화면'}</button>` : `<button class="btn sm" data-real="addSide">${other === 'c' ? '업체로도 쓰기' : '강사로도 쓰기'}</button>`;
  el.style.flexWrap = 'wrap';
  el.innerHTML = `<span class="sp" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:5em">${esc(cur.name || '')} ${role === 'c' ? (isStaffView() ? `(직원 ${esc(WHO)})` : '(업체)') : '(강사)'}</span>${sw}${role === 'c' ? '<button class="btn sm" data-real="staff">직원</button>' : ''}${isAdmin ? `<button class="btn sm" data-real="admin">업체 관리${ADMQ ? ` <span class="chip warn">확인 ${ADMQ}</span>` : ''}</button>` : ''}<a class="btn sm" style="text-decoration:none;color:inherit;display:inline-flex;align-items:center" href="../guide/${role === 'c' ? 'company' : 'instructor'}.html">사용법</a><button class="btn sm" data-real="ref">소개하기</button><button class="btn sm" data-real="out">로그아웃</button>`;
  const bar = $('#pendBar'); if (bar && !pending) bar.remove();
  if (pending && !bar) el.insertAdjacentHTML('afterend', cur.blocked
    ? '<div id="pendBar" class="alert">운영자가 이 업체의 공고 등록을 멈췄어요. 문의: tobadyclup@naver.com</div>'
    : `<div id="pendBar" class="alert">사업자등록번호를 넣으면 ${ntsOn() ? '국세청에서 영업 중인지 확인하고 ' : ''}바로 공고를 올릴 수 있어요.<div class="row"><input id="pBiz" inputmode="numeric" placeholder="000-00-00000" value="${esc(bizFmt(cur.biz || ''))}"><button class="btn pri sm" data-real="bizSet">등록</button></div></div>`);
};

document.addEventListener('change', e => { if (e.target.name === 'rRole') { const c = e.target.value === 'c'; $('#rRegionF').hidden = c; $('#rContactF').hidden = !c; $('#rBizF').hidden = !c; } });
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-real]'); if (!b) return;
  const k = b.dataset.real;
  if (k === 'google') {
    const p = new A.GoogleAuthProvider();
    try { await A.signInWithPopup(auth, p); } catch (err) { if (/popup/.test(err.code)) return A.signInWithRedirect(auth, p); toast('로그인하지 못했어요: ' + err.code); }
  }
  if (k === 'mail') {
    const m = $('#rMail').value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) return toast('메일 주소를 확인해 주세요');
    try { await A.sendSignInLinkToEmail(auth, m, { url: location.origin + location.pathname + (EMU ? '?emu' : ''), handleCodeInApp: true }); localStorage.setItem('kangsaro.mail', m); toast('메일을 보냈어요. 메일의 링크를 누르면 로그인돼요'); b.textContent = '메일을 보냈어요 (안 오면 스팸함 확인)'; }
    catch (err) { toast('메일을 보내지 못했어요: ' + err.code); }
  }
  if (k === 'out') { await A.signOut(auth); location.reload(); }
  if (k === 'join') {
    const r = document.querySelector('[name=rRole]:checked').value, name = $('#rName').value.trim(), phone = telFmt($('#rPhone').value.trim());
    if (!name) return toast('이름을 넣어 주세요'); if (!phone) return toast('연락처를 넣어 주세요');
    const t = todayIso(), email = auth.currentUser.email || '';
    const biz = bizNum($('#rBiz').value);
    if (r === 'c' && !bizOk(biz)) return toast('사업자등록번호 10자리를 확인해 주세요');
    const nts = r === 'c' && ntsOn();
    if (r === 'c' && !nts) { try { if (!await claimBiz(biz)) return; } catch (err) { return toast('사업자등록번호를 저장하지 못했어요: ' + err.code); } }
    const pub = r === 'i' ? { role: 'i', name, region: $('#rRegion').value, topics: '', intro: '', career: '', joined: t, beta: true } : nts ? { role: 'c', name, contact: $('#rContact').value.trim(), joined: t, approved: false } : { role: 'c', name, contact: $('#rContact').value.trim(), joined: t, approved: true, biz };
    const ref = lsGet('kangsaro.ref');
    if (ref && ref !== uidMe) { const rd = await getDoc(doc(db, 'users', ref)).catch(() => null); if (rd && rd.exists()) pub.refBy = ref; }
    const priv = r === 'i' ? { phone, email, bank: '', acct: '', holder: name, kmpl: 15, fuel: 1650, vault: {} } : { phone, email };
    try { await setDoc(doc(db, 'users', uidMe), pub); await setDoc(doc(db, 'users', uidMe, 'private', 'main'), priv); }
    catch (err) { return toast('가입하지 못했어요: ' + err.code); }
    try { localStorage.removeItem('kangsaro.ref'); } catch (err) { }
    if (nts && !await verifyBiz(biz)) { await start(auth.currentUser); return; }
    toast(r === 'i' ? '가입했어요. 프로필을 채우면 지원할 때 같이 가요' : '가입했어요. 바로 공고를 올릴 수 있어요');
    await start(auth.currentUser);
    if (r === 'i') { ui.tab = 'me'; render(); }
  }
  if (k === 'admin') return adminSheet();
  if (k === 'staffJoin') {
    const name = $('#sName').value.trim(); if (!name) return toast('이름을 넣어 주세요');
    const P = PEND, t = new Date().toISOString();
    try {
      await setDoc(doc(db, 'staff', `${P.coId}_${uidMe}`), { coId: P.coId, uid: uidMe, name, email: auth.currentUser.email || '', pay: false, at: t, code: P.code });
      if (!me) await setDoc(doc(db, 'users', uidMe), { role: 's', name, staffOf: P.coId, joined: t.slice(0, 10) });
      else await updateDoc(doc(db, 'users', uidMe), { staffOf: P.coId });
    } catch (err) { return toast('합류하지 못했어요: ' + err.code); }
    try { localStorage.removeItem('kangsaro.staff'); } catch (err) { }
    toast(`${P.name} 직원으로 합류했어요`); return start(auth.currentUser, 'c');
  }
  if (k === 'staffLater') { try { localStorage.removeItem('kangsaro.staff'); } catch (err) { } return start(auth.currentUser); }
  if (k === 'staff') return staffSheet();
  if (k === 'invNew') {
    const old = await getDocs(query(collection(db, 'invites'), where('coId', '==', uidMe)));
    for (const d of old.docs) await deleteDoc(d.ref);
    const code = [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2, '0')).join('');
    await setDoc(doc(db, 'invites', code), { coId: uidMe, at: new Date().toISOString() });
    toast(old.size ? '새 링크를 만들었어요. 예전 링크는 이제 안 돼요' : '초대 링크를 만들었어요'); return staffSheet();
  }
  if (k === 'invCopy') { const t = b.dataset.t; try { await navigator.clipboard.writeText(t); toast('복사했어요. 직원에게 카톡으로 보내세요'); } catch (err) { prompt('길게 눌러 복사해 주세요', t); } return; }
  if (k === 'invOff') { const old = await getDocs(query(collection(db, 'invites'), where('coId', '==', uidMe))); for (const d of old.docs) await deleteDoc(d.ref); toast('초대 링크를 껐어요'); return staffSheet(); }
  if (k === 'staffPay') { const r = doc(db, 'staff', b.dataset.id), d = await getDoc(r); await updateDoc(r, { pay: !d.data().pay }); toast(d.data().pay ? '정산 권한을 껐어요' : '정산 권한을 켰어요'); return staffSheet(); }
  if (k === 'staffOut') { if (!confirm(`${b.dataset.n} 님을 직원에서 내보낼까요? 바로 업체 화면을 못 보게 돼요.`)) return; await deleteDoc(doc(db, 'staff', b.dataset.id)); toast('내보냈어요'); return staffSheet(); }
  if (k === 'staffLeave') { if (!confirm('이 업체에서 나갈까요? 다시 일하려면 새 초대 링크가 필요해요.')) return; await deleteDoc(doc(db, 'staff', `${CO}_${uidMe}`)); closeSheet(); return; }
  if (k === 'maint') { const on = !SITE.maint; if (on && !confirm('모든 사용자 화면에 "업데이트 중입니다"를 띄울까요? 관리자 화면은 그대로예요.')) return; await setDoc(doc(db, 'site', 'main'), { maint: on, at: new Date().toISOString() }, { merge: true }); toast(on ? '업데이트 중 표시를 켰어요' : '업데이트 중 표시를 껐어요. 사용자 화면이 다시 열려요'); return adminSheet(); }
  if (k === 'ntsT') { const on = !SITE.nts; if (on && !confirm('국세청 확인을 켤까요? 서버를 먼저 올려야 해요. 안 올렸으면 새 업체가 승인되지 않아요.')) return; await setDoc(doc(db, 'site', 'main'), { nts: on }, { merge: true }); toast(on ? '국세청 확인을 켰어요' : '국세청 확인을 껐어요'); return adminSheet(); }
  if (k === 'jPass') { await updateDoc(doc(db, 'jobs', b.dataset.j), { cleared: true, hold: false }); toast('통과했어요. 강사에게 보여요'); return adminSheet(); }
  if (k === 'jDown') { if (!confirm('이 공고를 내릴까요? 마감 처리돼서 강사에게 안 보여요.')) return; await updateDoc(doc(db, 'jobs', b.dataset.j), { status: '마감' }); toast('내렸어요'); return adminSheet(); }
  if (k === 'reload') return location.reload();
  if (k === 'lockInfo') return lockSheet();
  if (k === 'ref') return refSheet();
  if (k === 'refCopy') { const t = refText(); try { await navigator.clipboard.writeText(t); toast('복사했어요. 카톡에 붙여 넣으세요'); } catch (err) { prompt('길게 눌러 복사해 주세요', t); } return; }
  if (k === 'refShare') { try { await navigator.share({ title: '강사로', text: refText() }); } catch (err) { } return; }
  if (k === 'approve') { await updateDoc(doc(db, 'users', b.dataset.u), { approved: true, blocked: false }); toast('승인했어요'); return adminSheet(); }
  if (k === 'block') { if (!confirm('이 업체의 공고 등록을 멈출까요? 이미 올린 공고는 그대로 있어요.')) return; await updateDoc(doc(db, 'users', b.dataset.u), { approved: false, blocked: true }); toast('승인을 취소했어요'); return adminSheet(); }
  if (k === 'bizSet') {
    const n = bizNum($('#pBiz').value); if (!bizOk(n)) return toast('사업자등록번호 10자리를 확인해 주세요');
    try { if (ntsOn()) { if (!await verifyBiz(n)) return; } else { if (!await claimBiz(n)) return; await updateDoc(doc(db, 'users', uidMe), { biz: n, approved: true }); } }
    catch (err) { return toast('등록하지 못했어요: ' + err.code); }
    me.biz = n; me.approved = true; const c = S.cos.find(x => x.id === uidMe); if (c) { c.biz = n; c.approved = true; }
    prime(new Set([`users/${uidMe}`])); toast('등록했어요. 이제 공고를 올릴 수 있어요'); render();
  }
  if (k === 'swap') return swapTo(role === 'i' ? 'c' : 'i');
  if (k === 'addSide') return sideSheet(role === 'i' ? 'c' : 'i');
  if (k === 'sideJoin') {
    const r = b.dataset.r, name = $('#sName').value.trim(), t = todayIso();
    if (!name) return toast(r === 'c' ? '업체명을 넣어 주세요' : '이름을 넣어 주세요');
    try {
      if (r === 'c') {
        const biz = bizNum($('#sBiz').value); if (!bizOk(biz)) return toast('사업자등록번호 10자리를 확인해 주세요');
        if (!ntsOn() && !await claimBiz(biz)) return;
        const side = { role: 'c', name, contact: $('#sContact').value.trim(), joined: t };
        await updateDoc(doc(db, 'users', uidMe), { side }); me.side = side;
        if (ntsOn()) { if (await verifyBiz(biz)) Object.assign(me, { biz, approved: true }); }
        else { await updateDoc(doc(db, 'users', uidMe), { biz, approved: true }); Object.assign(me, { biz, approved: true }); }
      } else {
        const side = { role: 'i', name, region: $('#sRegion').value, topics: '', intro: '', career: '', joined: t };
        await updateDoc(doc(db, 'users', uidMe), { side }); me.side = side;
        await setDoc(doc(db, 'users', uidMe, 'private', 'main'), { bank: '', acct: '', holder: name, kmpl: 15, fuel: 1650, vault: {} }, { merge: true });
      }
    } catch (err) { return toast('추가하지 못했어요: ' + err.code); }
    closeSheet(); await swapTo(r);
    if (r === 'i') { ui.tab = 'me'; render(); }
  }
});
// 강사 화면 ↔ 업체 화면 (같은 계정, 달력·결산은 따로)
async function swapTo(r) {
  clearTimeout(timer); await flush();
  try { localStorage.setItem('kangsaro.view.' + uidMe, r); } catch (e) { }
  ui.jobId = null; $('#pendBar')?.remove();
  await start(auth.currentUser, r);
  toast(r === 'c' ? '업체 화면이에요. 위쪽 버튼으로 언제든 강사 화면으로 돌아가요' : '강사 화면이에요. 위쪽 버튼으로 언제든 업체 화면으로 가요');
}
function sideSheet(r) {
  openSheet(r === 'c' ? `<div class="row"><h2 class="sp">업체로도 쓰기</h2><button class="btn sm" data-act="closeSheet">닫기</button></div>
    <p>이 계정 그대로 <b>업체 화면</b>이 하나 더 생겨요. 위쪽 버튼으로 강사 화면과 오가요. 강사 달력·결산은 그대로 있어요.</p>
    <label class="f">업체명<input id="sName"></label>
    <label class="f">담당자 (예: 김○○ 대표)<input id="sContact" value="${esc(me.name || '')}"></label>
    <label class="f">사업자등록번호 (공고 등록에 꼭 필요해요)<input id="sBiz" inputmode="numeric" placeholder="000-00-00000"></label>
    <button class="btn pri" data-real="sideJoin" data-r="c">업체 화면 만들기</button>`
    : `<div class="row"><h2 class="sp">강사로도 쓰기</h2><button class="btn sm" data-act="closeSheet">닫기</button></div>
    <p>이 계정 그대로 <b>강사 화면</b>이 하나 더 생겨요. 내 강의 달력·순수익·결산을 따로 봐요. 위쪽 버튼으로 업체 화면과 오가요.</p>
    <span class="mu sm">우리 업체 공고에 강사로 지원하고 업체 화면에서 확정하면, 강사 달력에도 바로 들어가요.</span>
    <label class="f">강사 이름<input id="sName" value="${esc((me.contact || '').replace(/\s*(대표|팀장|실장|과장|부장|매니저|님)$/, '').replace(/^.$/, ''))}"></label>
    <label class="f">사는 곳 (순수익·거리 계산용)<select id="sRegion">${Object.keys(GEO).map(k => `<option>${k}</option>`).join('')}</select></label>
    <button class="btn pri" data-real="sideJoin" data-r="i">강사 화면 만들기</button>`);
}
/* ===== 소개하기: 업체가 가입하면 양쪽 1개월, 강사가 가입하면 양쪽 1주일 무료 (최대 6개월) ===== */
const REF_MAX = 180, refDays = r => r === 'c' ? 30 : 7;
const dayTxt = d => [Math.floor(d / 30) && Math.floor(d / 30) + '개월', d % 30 && d % 30 + '일'].filter(Boolean).join(' ') || '0일';
const refLink = () => location.origin + location.pathname + '?ref=' + uidMe;
const refText = () => `강사 일정·강사료 관리, 강의 업체 강사 관리를 한 앱에서 하는 '강사로'예요. 이 링크로 가입하면 무료 기간을 더 드려요 (업체 1개월, 강사 1주일).\n${refLink()}`;
// 인정 조건: 강사는 프로필(분야·소개) 완성, 업체는 승인 후 공고 1건
async function refDone(u) {
  if (u.role === 'i') return !!((u.topics || '').trim() && (u.intro || '').trim());
  if (!u.approved) return false;
  const j = await getDocs(query(collection(db, 'jobs'), where('coId', '==', u.id), limit(1))).catch(() => null);
  return !!(j && !j.empty);
}
// 이용 기간: 가입일 + 3개월 + 소개로 쌓인 기간 (직원은 업체 기준)
async function termEnd() {
  const id = role === 'c' ? CO : uidMe, u = id === uidMe ? me : await loadUser(id, false).catch(() => null);
  const js = u ? [u.joined, u.side && u.side.joined].filter(Boolean).sort() : [];
  if (!js.length) return '';
  const d = await getDocs(query(collection(db, 'users'), where('refBy', '==', id))).catch(() => null);
  let got = u.refBy && await refDone({ ...u, id }) ? refDays(u.role) : 0;
  for (const x of d ? d.docs : []) if (await refDone({ id: x.id, ...x.data() })) got += refDays(x.data().role);
  const e = new Date(js[0] + 'T00:00:00'); e.setMonth(e.getMonth() + 3); e.setDate(e.getDate() + Math.min(REF_MAX, got));
  return `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`;
}
// 운영자 계정은 기간 없이 계속 씀. 기간이 지나면 보기만 (LOCK)
let LOCK = false, TERM = '';
// 업체 요금제 (한 달에 올리는 강의 수 기준)
const PLANS = [['베이직', '10건 미만', '1만 원'], ['스탠다드', '30건 미만', '3만 원'], ['프로', '30건 이상', '5만 원']];
const PLANS_I = [['베이직', '달력·지원', '4,900원'], ['프로', '+ 결산', '9,900원']];
async function showTerm() {
  const el = $('#term'); if (!el) return;
  TERM = !S.me || isAdm() ? '' : await termEnd().catch(() => '');
  LOCK = !!TERM && todayIso() > TERM;
  const t = !S.me ? '' : isAdm() ? '운영자 · 기간 없음' : !TERM ? '' : LOCK ? '이용 기간 끝남 · 보기만 가능' : `이용 기간 ~${TERM.replace(/-/g, '.')}`;
  el.textContent = t; el.hidden = !t; el.style.cssText = LOCK ? 'background:var(--r2);color:#fff;cursor:pointer' : '';
  if (LOCK) el.dataset.real = 'lockInfo'; else delete el.dataset.real;
}
// 기간이 끝나면 화면 이동·보기만 되고, 지원·등록·수정·내려받기·복사 등은 막음
const OPEN_ACT = new Set(['report', 'alMore', 'alertGo', 'alertOk', 'back', 'closeSheet', 'closeSheetBg', 'cmon', 'csel', 'jmore', 'jf', 'mgo', 'mmon', 'mon', 'mview', 'openJob', 'sel', 'unpaid', 'year', 'install']);
const OPEN_REAL = new Set(['out', 'ref', 'refCopy', 'refShare', 'reload', 'swap', 'lockInfo', 'staffLeave']);
function lockSheet() {
  openSheet(`<div class="row"><h2 class="sp">이용 기간이 끝났어요</h2><button class="btn sm" data-act="closeSheet">닫기</button></div>
    <p>${TERM.replace(/-/g, '.')}까지였던 이용 기간이 끝나서 지금은 <b>지금까지 한 것을 보기만</b> 할 수 있어요. 지원, 등록, 수정, 내려받기는 잠겨 있어요.</p>
    ${role === 'i' ? `<div class="card"><b>강사 요금</b>${PLANS_I.map(x => `<div class="row"><b class="sp">${x[0]}</b><span class="sm">${x[1]}</span><b>월 ${x[2]}</b></div>`).join('')}</div>` : ''}
    ${role === 'c' ? `<div class="card"><b>업체 요금 (한 달에 올리는 강의 수 기준)</b>${PLANS.map(x => `<div class="row"><b class="sp">${x[0]}</b><span class="sm">${x[1]}</span><b>월 ${x[2]}</b></div>`).join('')}<span class="mu sm">직원 수와 상관없이 같아요.</span></div>` : ''}
    <p class="mu sm">계속 쓰려면 <a href="mailto:tobadyclup@naver.com">tobadyclup@naver.com</a>으로 문의해 주세요. 소개하기로 가입한 분이 생기면 기간이 늘어나서 바로 다시 열려요.</p>
    <button class="btn pri" data-real="ref">소개하고 기간 늘리기</button>`);
}
function lockGuard(e) {
  if (!LOCK) return;
  const t = e.target.closest('[data-act],[data-real]'); if (!t) return;
  if (t.dataset.real ? OPEN_REAL.has(t.dataset.real) : OPEN_ACT.has(t.dataset.act)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.type === 'change' && 'value' in t && t.type !== 'file') render();
  lockSheet();
}
document.addEventListener('click', lockGuard, true);
document.addEventListener('change', lockGuard, true);
async function refSheet() {
  const d = await getDocs(query(collection(db, 'users'), where('refBy', '==', uidMe))).catch(() => null);
  const rows = await Promise.all((d ? d.docs : []).map(async x => { const u = { id: x.id, ...x.data() }; u.done = await refDone(u); return u; }));
  const mine = me && me.refBy && await refDone({ ...me, id: uidMe }) ? refDays(role) : 0;
  const got = Math.min(REF_MAX, mine + rows.filter(r => r.done).reduce((t, r) => t + refDays(r.role), 0));
  const can = !!navigator.share;
  openSheet(`<div class="row"><h2 class="sp">소개하기</h2><button class="btn sm" data-act="closeSheet">닫기</button></div>
    <p>내 링크로 가입하면 소개한 분과 가입한 분 모두 무료 기간이 늘어요. <b>업체가 가입하면 1개월, 강사가 가입하면 1주일</b>씩이에요.</p>
    <span class="mu sm">강사는 프로필(분야·소개)을 채우면, 업체는 공고를 1건 올리면 인정돼요. 최대 ${dayTxt(REF_MAX)}까지 쌓여요.</span>
    <label class="f">내 소개 링크<input readonly value="${esc(refLink())}" onclick="this.select()"></label>
    <div class="row"><button class="btn pri" data-real="refCopy">소개 문구 복사</button>${can ? '<button class="btn" data-real="refShare">공유하기</button>' : ''}</div>
    <div class="card"><b>쌓인 무료 기간: ${dayTxt(got)}</b><span class="mu sm">가입 후 3개월에 이 기간이 더해져요. 위에 보이는 '이용 기간'에 이미 들어 있어요.${mine ? ` (소개로 가입한 ${dayTxt(mine)} 포함)` : ''}</span></div>
    <h3>내가 소개한 분 (${rows.length})</h3>
    ${rows.map(r => `<div class="row"><span class="sp">${esc(r.name || '')} <span class="mu sm">${r.role === 'c' ? '업체' : '강사'} · 가입 ${esc(r.joined || '')}</span></span><span class="sm">${r.done ? `✓ ${dayTxt(refDays(r.role))}` : (r.role === 'c' ? '공고 전' : '프로필 작성 전')}</span></div>`).join('') || '<p class="mu">아직 없어요. 링크를 톡방이나 지인에게 보내 보세요.</p>'}`);
}

// 직원: 대표는 초대 링크·정산 권한·내보내기, 직원은 함께 일하는 사람 보기·나가기
async function staffSheet() {
  const owner = !isStaffView();
  const st = (await getDocs(query(collection(db, 'staff'), where('coId', '==', CO)))).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.at.localeCompare(b.at));
  const inv = owner ? (await getDocs(query(collection(db, 'invites'), where('coId', '==', uidMe)))).docs[0] : null;
  const link = inv ? location.origin + location.pathname + '?staff=' + inv.id : '';
  const row = x => `<div class="card"><div class="row"><b class="sp">${esc(x.name)}${x.uid === uidMe ? ' (나)' : ''}</b>${x.pay ? '<span class="chip paid">정산 가능</span>' : '<span class="chip off">정산 안 보임</span>'}</div><span class="mu sm">${esc(x.email || '')} · ${esc(x.at.slice(0, 10))} 합류</span>
    ${owner ? `<div class="row"><button class="btn sm" data-real="staffPay" data-id="${x.id}">${x.pay ? '정산 권한 끄기' : '정산 권한 켜기'}</button><button class="btn sm" data-real="staffOut" data-id="${x.id}" data-n="${esc(x.name)}" style="color:var(--r2)">내보내기</button></div>` : ''}</div>`;
  openSheet(`<div class="row"><h2 class="sp">직원 ${st.length ? st.length + '명' : ''}</h2><button class="btn sm" data-act="closeSheet">닫기</button></div>
    ${owner ? `<p class="mu sm">직원은 자기 구글·메일로 로그인해서 같은 업체의 공고·강사·공지·서류 체크표를 같이 봐요. 공지에는 작성한 사람 이름이 남아요. 업체 정보·양식·직원 관리는 대표만 해요. 지급(정산)은 '정산 권한'을 켠 직원만 봐요.</p>
    <div class="card"><b>직원 초대 링크</b>${inv ? `<input readonly value="${esc(link)}" onclick="this.select()"><div class="row"><button class="btn sm pri" data-real="invCopy" data-t="${esc(link)}">링크 복사</button><button class="btn sm" data-real="invNew">새 링크로 바꾸기</button><button class="btn sm" data-real="invOff">링크 끄기</button></div><span class="mu sm">링크를 받은 사람은 누구나 직원으로 합류할 수 있어요. 다 초대했으면 '링크 끄기'를 눌러 두세요.</span>` : `<span class="mu sm">링크를 만들어 카톡으로 보내면 직원이 눌러서 합류해요.</span><button class="btn pri" data-real="invNew">초대 링크 만들기</button>`}</div>`
    : `<p class="mu sm">함께 일하는 사람이에요. 업체 정보·직원 관리는 대표만 해요.</p>`}
    ${st.map(row).join('') || '<p class="mu">아직 직원이 없어요.</p>'}
    ${owner ? '' : '<button class="btn sm" data-real="staffLeave" style="color:var(--r2)">이 업체에서 나가기</button>'}`);
}
async function adminSheet() {
  const [d, d2] = await Promise.all([getDocs(query(collection(db, 'users'), where('role', '==', 'c'))), getDocs(query(collection(db, 'users'), where('side.role', '==', 'c')))]);
  const rows = (await Promise.all([...d.docs, ...d2.docs].map(async x => { let p = {}; try { const s = await getDoc(doc(db, 'users', x.id, 'private', 'main')); p = s.data() || {}; } catch (e) { } return { ...asRole({ id: x.id, ...x.data(), ...p }, 'c'), ...p }; })))
    .sort((a, b) => (b.joined || '').localeCompare(a.joined || ''));
  const card = r => `<div class="card"><b>${esc(r.name)} ${r.blocked ? '<span class="mu sm">(멈춤)</span>' : ''}</b><span class="mu sm">사업자 ${esc(bizFmt(r.biz || '') || '없음')}${r.bizCheck ? ` <b style="color:var(--ac)">국세청 ✓ ${esc(r.bizCheck.at.slice(0, 10))}</b>` : ' (국세청 확인 전)'} · ${esc(r.contact || '')} · ${esc(telFmt(r.phone || ''))} · ${esc(r.email || '')} · 가입 ${esc(r.joined || '')}</span>${r.approved ? `<button class="btn sm" data-real="block" data-u="${r.id}">승인 취소</button>` : `<button class="btn pri sm" data-real="approve" data-u="${r.id}">승인</button>`}</div>`;
  openSheet(`<div class="row"><h2 class="sp">업체 관리</h2><button class="btn sm" data-act="closeSheet">닫기</button></div>
    <div class="card" style="${SITE.maint ? 'border-color:var(--r2)' : ''}"><div class="row"><b class="sp">업데이트 중 표시 ${SITE.maint ? '<span class="chip warn">켜짐</span>' : '<span class="chip off">꺼짐</span>'}</b><button class="btn sm ${SITE.maint ? 'pri' : ''}" data-real="maint">${SITE.maint ? '끄기' : '켜기'}</button></div><span class="mu sm">데이터 구조를 바꾸는 큰 업데이트 때만 켜요. 켜면 사용자 화면에 "업데이트 중입니다. 잠시만 기다려 주세요"가 뜨고, 끄면 저절로 다시 열려요.</span></div>
    <div class="card"><div class="row"><b class="sp">국세청 사업자 확인 ${SITE.nts ? '<span class="chip paid">켜짐</span>' : '<span class="chip off">꺼짐</span>'}</b><button class="btn sm" data-real="ntsT">${SITE.nts ? '끄기' : '켜기'}</button></div><span class="mu sm">서버(verifyBiz)를 올린 뒤에 켜요. 켜면 새 업체는 국세청에서 '계속사업자'로 확인돼야 승인돼요. 끄면 예전처럼 번호 검증 숫자만 봐요.</span></div>
    <p class="mu sm">업체는 사업자등록번호를 넣으면 바로 공고를 올려요. 이상한 업체는 '승인 취소'로 멈출 수 있어요. 홈택스 '사업자 상태 조회'로 휴·폐업 여부를 볼 수 있어요.</p>
    ${await jobAdmin()}
    ${await refAdmin()}
    ${rows.map(card).join('') || '<p class="mu">가입한 업체가 없어요.</p>'}`);
}

// 확인 대기(사기 의심 단어) + 신고 3건 이상(통과 안 된) 공고
let ADMQ = 0;
async function adminQueue() {
  const [h, r] = await Promise.all([getDocs(query(collection(db, 'jobs'), where('hold', '==', true))).catch(() => null), getDocs(query(collection(db, 'jobs'), where('status', '==', '모집'), limit(500))).catch(() => null)]);
  const m = new Map();
  for (const d of [...(h ? h.docs : []), ...(r ? r.docs : [])]) { const j = { id: d.id, ...d.data() }; if (j.status === '모집' && (j.hold || (Object.keys(j.reports || {}).length >= 3 && j.cleared !== true))) m.set(j.id, j); }
  const list = [...m.values()];
  if (ADMQ !== list.length) { ADMQ = list.length; REAL.acct(); }
  return list;
}
async function jobAdmin() {
  const list = await adminQueue();
  if (!list.length) return '<div class="card"><b>확인 대기·신고 공고</b><span class="mu sm">지금은 없어요.</span></div>';
  const names = new Map(await Promise.all([...new Set(list.map(j => j.coId))].map(async id => [id, (asRole(await loadUser(id, false).catch(() => null), 'c') || {}).name || id.slice(0, 6)])));
  return `<div class="card" style="border-color:var(--r2)"><b>확인 대기·신고 공고 ${list.length}건</b><span class="mu sm">통과하면 강사에게 바로 보여요(통과 뒤 신고로는 다시 안 내려가요). 내리면 마감 처리돼요.</span></div>` + list.map(j => `<div class="card"><b>${esc(j.region || '')} ${esc(j.school || '')} ${esc(j.title || '')}</b>
    <span class="mu sm">${esc(names.get(j.coId) || '')} · 1일 ${(+j.fee || 0).toLocaleString()}원 · ${j.hold ? '<b>확인 대기</b>: ' + esc(scamWhy(j)) : ''}${Object.keys(j.reports || {}).length ? ` · 신고 ${Object.keys(j.reports).length}건` : ''}</span>
    ${j.desc ? `<span class="sm" style="white-space:pre-wrap">${esc(String(j.desc).slice(0, 400))}</span>` : ''}
    <div class="row"><button class="btn pri sm" data-real="jPass" data-j="${j.id}">통과</button><button class="btn sm" data-real="jDown" data-j="${j.id}" style="color:var(--r2)">내리기</button></div></div>`).join('');
}

async function refAdmin() {
  const d = await getDocs(query(collection(db, 'users'), where('refBy', '>', ''))).catch(() => null);
  if (!d || d.empty) return '';
  const by = new Map();
  for (const x of d.docs) { const r = x.data().refBy; by.set(r, (by.get(r) || 0) + 1); }
  const names = await Promise.all([...by.keys()].map(async id => { const u = await getDoc(doc(db, 'users', id)).catch(() => null); return [id, u && u.exists() ? u.data().name : id.slice(0, 6)]; }));
  return `<div class="card"><b>소개 현황 (가입 기준)</b>${names.map(([id, n]) => `<span class="sm">${esc(n)}: ${by.get(id)}명</span>`).join('')}<span class="mu sm">인정 여부는 각자 '소개하기' 화면에서 봐요.</span></div>`;
}

/* ===== 파일 (서류 사진은 줄여서 Firestore에 저장, 1MB 한도) ===== */
async function fileData(f) {
  if (/^image\//.test(f.type)) { const u = await shrink(f, 1600); return u && u.length < 900000 ? u : ''; }
  // 한글·워드·엑셀·PDF 등은 650KB까지 그대로
  if (f.size < 650000) return await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(f); });
  return '';
}
REAL.vault = async (n, f) => {
  const data = await fileData(f);
  if (!data) return toast('사진이나 650KB 이하 파일만 올릴 수 있어요');
  await setDoc(doc(db, 'users', uidMe, 'files', n), { name: f.name, type: data.slice(5, data.indexOf(';')), data, at: new Date().toISOString() });
  const p = inst(uidMe); p.vault = { ...(p.vault || {}), [n]: f.name }; save(); render(); toast(`${n} 저장했어요. 확정된 업체에만 보여요`);
};
REAL.doc = async (appId, n, f) => {
  const a = S.apps.find(x => x.id === appId); let data = await fileData(f), name = f.name;
  if (!data) { const u = prompt('파일이 커서 바로 올릴 수 없어요. 구글 드라이브 공유 링크를 붙여 주세요'); if (!u || !/^https?:\/\//.test(u.trim())) return; name = u.trim(); }
  else await setDoc(doc(db, 'apps', appId, 'files', n), { name, type: data.slice(5, data.indexOf(';')), data, at: new Date().toISOString() });
  a.docs = { ...(a.docs || {}), [n]: name }; save(); render(); toast(`${n} 냈어요`);
};

// 강사 신고: 공고 문서의 reports.{내 uid} 한 칸만 씀
REAL.report = async id => {
  try { await updateDoc(doc(db, 'jobs', id), { ['reports.' + uidMe]: new Date().toISOString() }); toast('신고했어요. 고마워요'); }
  catch (e) { const j = job(id); if (j && j.reports) delete j.reports[uidMe]; render(); toast(e.code === 'permission-denied' ? '강사 계정만 신고할 수 있어요' : '신고하지 못했어요. 인터넷을 확인해 주세요'); }
};
REAL.formUp = async (n, f) => {
  const data = await fileData(f);
  if (!data) return toast('650KB 이하 파일만 올릴 수 있어요');
  if (isStaffView()) return toast('서류 양식은 대표만 올릴 수 있어요');
  try { await setDoc(doc(db, 'users', uidMe, 'forms', n), { name: f.name, data, at: new Date().toISOString() }); } catch (e) { return toast('올리지 못했어요: ' + e.code); }
  const c = S.cos.find(x => x.id === uidMe); c.forms = { ...(c.forms || {}), [n]: f.name }; save(); render(); toast(`${n} 양식을 올렸어요`);
};
REAL.formDel = async n => {
  if (isStaffView()) return toast('서류 양식은 대표만 지울 수 있어요');
  try { await deleteDoc(doc(db, 'users', uidMe, 'forms', n)); } catch (e) { return toast('지우지 못했어요: ' + e.code); }
  const c = S.cos.find(x => x.id === uidMe); const f = { ...(c.forms || {}) }; delete f[n]; c.forms = f; save(); render(); toast('양식을 지웠어요');
};
// 저장해 둔 파일 내려받기 (양식, 강사가 낸 서류)
REAL.getFile = async (path, name) => {
  let d; try { d = await getDoc(doc(db, path)); } catch (e) { return toast(e.code === 'permission-denied' ? '볼 수 있는 권한이 없어요' : '받지 못했어요. 인터넷을 확인해 주세요'); }
  if (!d.exists()) return toast('파일이 없어요. 다시 올려 달라고 해 주세요');
  const x = d.data(), blob = await (await fetch(x.data)).blob(), u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = x.name || name || '파일'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
};

/* ===== 업데이트 중 표시 · 새 버전 알림 ===== */
// site/main.maint 를 관리자가 켜면 사용자 화면 전체를 덮음 (관리자는 위에 띠만). 끄면 새로 불러옴
let SITE = {};
const isAdm = () => ADMINS.includes(auth.currentUser?.email);
function maintPaint() {
  let o = document.getElementById('maint');
  const show = SITE.maint && !isAdm();
  if (show && !o) { o = document.createElement('div'); o.id = 'maint'; o.setAttribute('role', 'alert'); o.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center'; o.innerHTML = '<div style="font-size:44px">🔧</div><h2>업데이트 중입니다</h2><p class="mu">더 좋아지는 중이에요. 잠시만 기다려 주세요.<br>끝나면 이 화면이 저절로 바뀌어요.</p>'; document.body.appendChild(o); }
  if (!show && o) { o.remove(); location.reload(); }
  const bar = document.getElementById('maintBar');
  if (SITE.maint && isAdm() && !bar) document.body.insertAdjacentHTML('afterbegin', '<div id="maintBar" style="background:var(--r2);color:#fff;text-align:center;padding:6px;font-size:14px;font-weight:700">지금 사용자에게 "업데이트 중" 화면이 보이고 있어요 (관리자만 사용 가능)</div>');
  if (!(SITE.maint && isAdm()) && bar) bar.remove();
}
onSnapshot(doc(db, 'site', 'main'), d => { SITE = d.data() || {}; maintPaint(); }, () => { });
// 새 버전이 올라오면 띠로 알려 줌 (화면을 열어 둔 채 업데이트됐을 때)
const BUILD = document.querySelector('meta[name="build"]')?.content || '';
async function verCheck() {
  if (document.hidden || document.getElementById('verBar')) return;
  try { const t = await (await fetch(location.pathname + '?v=' + Date.now(), { cache: 'no-store' })).text(), m = t.match(/<meta name="build" content="([^"]*)">/);
    if (m && BUILD && m[1] !== BUILD) document.body.insertAdjacentHTML('beforeend', '<div id="verBar" style="position:fixed;left:12px;right:12px;bottom:84px;z-index:50;background:var(--ac);color:#fff;border-radius:12px;padding:10px 12px;display:flex;gap:8px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,.2)"><span style="flex:1;font-size:14px">새 버전이 나왔어요. 새로고침하면 바로 적용돼요.</span><button class="btn sm" data-real="reload" style="background:#fff;color:var(--ac)">새로고침</button></div>');
  } catch (e) { }
}
setInterval(verCheck, 3 * 60 * 1000);
document.addEventListener('visibilitychange', verCheck);

/* ===== 시작 ===== */
if (A.isSignInWithEmailLink(auth, location.href)) {
  let m = localStorage.getItem('kangsaro.mail') || prompt('로그인할 메일 주소를 한 번 더 넣어 주세요');
  try { await A.signInWithEmailLink(auth, m, location.href); history.replaceState(null, '', location.pathname + (EMU ? '?emu' : '')); } catch (e) { toast('링크가 만료됐어요. 다시 받아 주세요'); }
}
A.onAuthStateChanged(auth, u => { maintPaint(); if (u) start(u).catch(e => { console.error(e); toast('불러오지 못했어요: ' + (e.code || e.message)); }); else { profileLoaded = false; render(); } });
window.KS = { auth, db, F, A, S: () => S, flush }; // 시험용
