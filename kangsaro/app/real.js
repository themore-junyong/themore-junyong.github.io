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
const PUB = { i: ['name', 'region', 'topics', 'intro', 'career', 'photo', 'joined', 'beta', 'refBy'], c: ['name', 'contact', 'joined', 'approved', 'refBy'] };
const PRIV = { i: ['phone', 'email', 'bank', 'acct', 'holder', 'kmpl', 'fuel', 'vault'], c: ['phone', 'email'] };
const pick = (o, ks) => { const r = {}; for (const k of ks) if (o[k] !== undefined) r[k] = o[k]; return r; };
const omit = (o, ks) => { const r = { ...o }; for (const k of ks) delete r[k]; return r; };
// 키 순서와 상관없이 같은 내용이면 같은 글자
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k] === undefined ? null : x[k]])) : x);
const clean = o => JSON.parse(JSON.stringify(o)); // undefined 빼기

let me = null, role = '', uidMe = '', profileLoaded = false;
const last = new Map();         // 경로 → 마지막으로 서버와 맞춘 내용
const links = new Set();        // 업체: 확정한 강사 (서류 열람 허락)
const unsub = [];

// 지금 S에서 내가 쓸 수 있는 문서들 (경로 → 내용)
function payloads() {
  const out = new Map(), u = uidMe;
  if (!u || !S.me) return out;
  const mine = role === 'i' ? S.insts.find(x => x.id === u) : S.cos.find(x => x.id === u);
  if (mine) {
    out.set(`users/${u}`, { role, ...pick(mine, PUB[role]) });
    out.set(`users/${u}/private/main`, pick(mine, PRIV[role]));
  }
  for (const j of S.jobs) {
    if (j.coId !== u) continue;
    out.set(`jobs/${j.id}`, omit(j, ['notices']));
    for (const n of j.notices || []) out.set(`notices/${n.id}`, { ...n, jobId: j.id, coId: u });
  }
  for (const a of S.apps) {
    const j = job(a.jobId);
    if (a.instId !== u && (!j || j.coId !== u)) continue;
    out.set(`apps/${a.id}`, { ...a, coId: a.coId || (j && j.coId) || '' });
  }
  for (const e of S.evs) if (e.instId === u) out.set(`evs/${e.id}`, e);
  for (const al of S.alerts) { if (!al.by) al.by = u; if (al.by === u || al.instId === u) out.set(`alerts/${al.id}`, { by: al.by || '', ...al }); }
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
  if (busy) { again = true; return; }
  busy = true; clearTimeout(timer);
  try {
    const P = payloads(), R = readMarks(), order = k => k.startsWith('users/') ? 0 : k.startsWith('jobs/') ? 1 : k.startsWith('apps/') ? 2 : 3;
    const writes = [...P].filter(([k, v]) => last.get(k) !== stable(v)).sort((a, b) => order(a[0]) - order(b[0]));
    for (const [k, v] of writes) { await setDoc(doc(db, k), v); last.set(k, stable(v)); }
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
  for (const a of S.apps) { const j = job(a.jobId); if (j && j.coId === uidMe && a.status === '확정') want.set(a.instId, a.id); }
  for (const [iid, appId] of want) if (!links.has(iid)) { await setDoc(doc(db, 'links', `${uidMe}_${iid}`), { coId: uidMe, instId: iid, appId }); links.add(iid); loadInst(iid, true); }
  for (const iid of [...links]) if (!want.has(iid)) { await deleteDoc(doc(db, 'links', `${uidMe}_${iid}`)); links.delete(iid); }
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
async function loadInst(id, priv) { const x = await loadUser(id, priv).catch(() => null); if (x) { upsert(S.insts, x); later(); } }
async function loadCo(id) { if (S.cos.some(c => c.id === id)) return; const x = await loadUser(id, false).catch(() => null); if (x) { upsert(S.cos, x); later(); } }
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

async function start(user) {
  uidMe = user.uid;
  me = await loadUser(uidMe, true);
  profileLoaded = true;
  if (!me) { render(); return; }
  role = me.role;
  if (role === 'i') {
    S.insts = [me]; S.me = 'i:' + uidMe;
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
    S.cos = [me]; S.me = 'c:' + uidMe;
    const jb = await getDocs(query(collection(db, 'jobs'), where('coId', '==', uidMe)));
    S.jobs = jb.docs.map(d => ({ id: d.id, ...d.data(), notices: [] }));
    const nt = await getDocs(query(collection(db, 'notices'), where('coId', '==', uidMe)));
    for (const d of nt.docs) notice({ type: 'added', doc: d });
    const ap = await getDocs(query(collection(db, 'apps'), where('coId', '==', uidMe)));
    S.apps = ap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lk = await getDocs(query(collection(db, 'links'), where('coId', '==', uidMe)));
    for (const d of lk.docs) links.add(d.data().instId);
    await Promise.all([...new Set(S.apps.map(a => a.instId))].map(id => loadInst(id, links.has(id))));
    // 주민번호는 30일이 지나면 업체가 안 봤어도 지움
    const old = Date.now() - 30 * 864e5;
    for (const a of S.apps) if (a.rrn && a.rrnAt && Date.parse(a.rrnAt) < old) { delete a.rrn; delete a.rrnAt; a.docs[RRN] = '기한 지나 지움'; }
    prime();
    live(query(collection(db, 'apps'), where('coId', '==', uidMe)), app);
    live(query(collection(db, 'notices'), where('coId', '==', uidMe)), notice);
    SYNC();
  }
  ui.tab = NAV[role][0][0];
  render();
}

/* ===== 로그인 화면 ===== */
const isKakaoUA = /KAKAOTALK/i.test(navigator.userAgent);
REAL.gate = () => {
  if (!auth.currentUser) return `<div class="card"><h2>강사로 시작하기</h2>
    <p class="mu">강사는 무료예요. 강의 업체는 가입 후 확인을 거쳐 공고를 올릴 수 있어요.</p>
    ${isKakaoUA ? '<div class="alert">카카오톡 안에서는 구글 로그인이 막혀요. 아래 이메일로 로그인하거나, 위의 "다른 브라우저로 열기"를 눌러 주세요.</div>' : `<button class="btn pri" data-real="google">구글 계정으로 시작</button>`}
    <label class="f">이메일로 시작 (비밀번호 없이, 메일로 온 링크를 누르면 로그인돼요)<input id="rMail" type="email" autocomplete="email" placeholder="you@example.com"></label>
    <button class="btn ${isKakaoUA ? 'pri' : ''}" data-real="mail">로그인 링크 받기</button>
    <span class="mu sm">가입하면 <a href="../privacy.html">개인정보 처리방침</a>에 동의하는 것으로 봐요.</span></div>
    <a class="btn" href="../try/">먼저 체험판 써 보기</a>`;
  if (!profileLoaded) return '<p class="mu">불러오는 중…</p>';
  return `<div class="card"><h2>어느 쪽으로 가입할까요?</h2>
    <span class="mu sm">${esc(auth.currentUser.email || '')}로 로그인했어요.</span>
    ${lsGet('kangsaro.ref') ? '<div class="alert">소개로 오셨어요. 가입하면 소개한 분과 함께 무료 기간이 늘어요 (업체 1개월, 강사 1주일).</div>' : ''}
    <div class="row"><label class="sm"><input type="radio" name="rRole" value="i" checked> 강사예요</label><label class="sm"><input type="radio" name="rRole" value="c"> 강의 업체예요</label></div>
    <label class="f">이름 (업체는 업체명)<input id="rName" autocomplete="name"></label>
    <label class="f">연락처<input id="rPhone" type="tel" autocomplete="tel" placeholder="010-0000-0000"></label>
    <label class="f" id="rRegionF">사는 곳 (순수익·거리 계산용)<select id="rRegion">${Object.keys(GEO).map(k => `<option>${k}</option>`).join('')}</select></label>
    <label class="f" id="rContactF" hidden>담당자 (예: 김○○ 팀장)<input id="rContact"></label>
    <button class="btn pri" data-real="join">가입하기</button>
    <button class="btn sm" data-real="out">다른 계정으로</button></div>`;
};
REAL.acct = () => {
  const el = $('#acct'); if (!el) return;
  const pending = role === 'c' && me && !me.approved;
  el.innerHTML = `<span class="sp">${esc(me ? me.name : '')} ${role === 'c' ? '(업체)' : ''}</span>${ADMINS.includes(auth.currentUser?.email) ? '<button class="btn sm" data-real="admin">업체 승인</button>' : ''}<button class="btn sm" data-real="ref">소개하기</button><button class="btn sm" data-real="out">로그아웃</button>`;
  if (pending && !$('#pendBar')) el.insertAdjacentHTML('afterend', '<div id="pendBar" class="alert">업체 확인 중이에요. 확인이 끝나면 공고를 올릴 수 있어요. (보통 하루 안)</div>');
};

document.addEventListener('change', e => { if (e.target.name === 'rRole') { const c = e.target.value === 'c'; $('#rRegionF').hidden = c; $('#rContactF').hidden = !c; } });
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
    const r = document.querySelector('[name=rRole]:checked').value, name = $('#rName').value.trim(), phone = $('#rPhone').value.trim();
    if (!name) return toast('이름을 넣어 주세요'); if (!phone) return toast('연락처를 넣어 주세요');
    const t = todayIso(), email = auth.currentUser.email || '';
    const pub = r === 'i' ? { role: 'i', name, region: $('#rRegion').value, topics: '', intro: '', career: '', joined: t, beta: true } : { role: 'c', name, contact: $('#rContact').value.trim(), joined: t, approved: false };
    const ref = lsGet('kangsaro.ref');
    if (ref && ref !== uidMe) { const rd = await getDoc(doc(db, 'users', ref)).catch(() => null); if (rd && rd.exists()) pub.refBy = ref; }
    const priv = r === 'i' ? { phone, email, bank: '', acct: '', holder: name, kmpl: 15, fuel: 1650, vault: {} } : { phone, email };
    try { await setDoc(doc(db, 'users', uidMe), pub); await setDoc(doc(db, 'users', uidMe, 'private', 'main'), priv); }
    catch (err) { return toast('가입하지 못했어요: ' + err.code); }
    try { localStorage.removeItem('kangsaro.ref'); } catch (err) { }
    toast(r === 'i' ? '가입했어요. 프로필을 채우면 지원할 때 같이 가요' : '가입했어요. 업체 확인이 끝나면 공고를 올릴 수 있어요');
    await start(auth.currentUser);
    if (r === 'i') { ui.tab = 'me'; render(); }
  }
  if (k === 'admin') return adminSheet();
  if (k === 'ref') return refSheet();
  if (k === 'refCopy') { const t = refText(); try { await navigator.clipboard.writeText(t); toast('복사했어요. 카톡에 붙여 넣으세요'); } catch (err) { prompt('길게 눌러 복사해 주세요', t); } return; }
  if (k === 'refShare') { try { await navigator.share({ title: '강사로', text: refText() }); } catch (err) { } return; }
  if (k === 'approve') { await updateDoc(doc(db, 'users', b.dataset.u), { approved: true }); toast('승인했어요'); return adminSheet(); }
});
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
async function refSheet() {
  const d = await getDocs(query(collection(db, 'users'), where('refBy', '==', uidMe))).catch(() => null);
  const rows = await Promise.all((d ? d.docs : []).map(async x => { const u = { id: x.id, ...x.data() }; u.done = await refDone(u); return u; }));
  const mine = me && me.refBy && await refDone({ ...me, id: uidMe }) ? refDays(role) : 0;
  const got = Math.min(REF_MAX, mine + rows.filter(r => r.done).reduce((t, r) => t + refDays(r.role), 0));
  const can = !!navigator.share;
  openSheet(`<div class="row"><h2 class="sp">소개하기</h2><button class="btn sm" data-act="closeSheet">닫기</button></div>
    <p>내 링크로 가입하면 소개한 분과 가입한 분 모두 무료 기간이 늘어요. <b>업체가 가입하면 1개월, 강사가 가입하면 1주일</b>씩이에요.</p>
    <span class="mu sm">강사는 프로필(분야·소개)을 채우면, 업체는 확인 후 공고를 1건 올리면 인정돼요. 최대 ${dayTxt(REF_MAX)}까지 쌓여요.</span>
    <label class="f">내 소개 링크<input readonly value="${esc(refLink())}" onclick="this.select()"></label>
    <div class="row"><button class="btn pri" data-real="refCopy">소개 문구 복사</button>${can ? '<button class="btn" data-real="refShare">공유하기</button>' : ''}</div>
    <div class="card"><b>쌓인 무료 기간: ${dayTxt(got)}</b><span class="mu sm">유료로 바뀔 때 이 기간만큼 무료로 써요.${mine ? ` (소개로 가입한 ${dayTxt(mine)} 포함)` : ''}</span></div>
    <h3>내가 소개한 분 (${rows.length})</h3>
    ${rows.map(r => `<div class="row"><span class="sp">${esc(r.name || '')} <span class="mu sm">${r.role === 'c' ? '업체' : '강사'} · 가입 ${esc(r.joined || '')}</span></span><span class="sm">${r.done ? `✓ ${dayTxt(refDays(r.role))}` : (r.role === 'c' ? '공고 전' : '프로필 작성 전')}</span></div>`).join('') || '<p class="mu">아직 없어요. 링크를 톡방이나 지인에게 보내 보세요.</p>'}`);
}

async function adminSheet() {
  const d = await getDocs(query(collection(db, 'users'), where('role', '==', 'c'), where('approved', '==', false)));
  const rows = await Promise.all(d.docs.map(async x => { let p = {}; try { const s = await getDoc(doc(db, 'users', x.id, 'private', 'main')); p = s.data() || {}; } catch (e) { } return { id: x.id, ...x.data(), ...p }; }));
  openSheet(`<div class="row"><h2 class="sp">업체 승인</h2><button class="btn sm" data-act="closeSheet">닫기</button></div>
    ${await refAdmin()}
    ${rows.map(r => `<div class="card"><b>${esc(r.name)}</b><span class="mu sm">${esc(r.contact || '')} · ${esc(r.phone || '')} · ${esc(r.email || '')} · 가입 ${esc(r.joined || '')}</span><button class="btn pri sm" data-real="approve" data-u="${r.id}">승인</button></div>`).join('') || '<p class="mu">기다리는 업체가 없어요.</p>'}`);
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
  if (f.type === 'application/pdf' && f.size < 650000) return await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(f); });
  return '';
}
REAL.vault = async (n, f) => {
  const data = await fileData(f);
  if (!data) return toast('사진이나 650KB 이하 PDF만 올릴 수 있어요');
  await setDoc(doc(db, 'users', uidMe, 'files', n), { name: f.name, type: data.slice(5, data.indexOf(';')), data, at: new Date().toISOString() });
  const p = inst(uidMe); p.vault = { ...(p.vault || {}), [n]: f.name }; save(); render(); toast(`${n} 저장했어요. 확정된 업체에만 보여요`);
};
REAL.doc = async (appId, n, f) => {
  const a = S.apps.find(x => x.id === appId); let data = await fileData(f), name = f.name;
  if (!data) { const u = prompt('파일이 커서 바로 올릴 수 없어요. 구글 드라이브 공유 링크를 붙여 주세요'); if (!u || !/^https?:\/\//.test(u.trim())) return; name = u.trim(); }
  else await setDoc(doc(db, 'apps', appId, 'files', n), { name, type: data.slice(5, data.indexOf(';')), data, at: new Date().toISOString() });
  a.docs = { ...(a.docs || {}), [n]: name }; save(); render(); toast(`${n} 냈어요`);
};

/* ===== 시작 ===== */
if (A.isSignInWithEmailLink(auth, location.href)) {
  let m = localStorage.getItem('kangsaro.mail') || prompt('로그인할 메일 주소를 한 번 더 넣어 주세요');
  try { await A.signInWithEmailLink(auth, m, location.href); history.replaceState(null, '', location.pathname + (EMU ? '?emu' : '')); } catch (e) { toast('링크가 만료됐어요. 다시 받아 주세요'); }
}
A.onAuthStateChanged(auth, u => { if (u) start(u).catch(e => { console.error(e); toast('불러오지 못했어요: ' + (e.code || e.message)); }); else { profileLoaded = false; render(); } });
window.KS = { auth, db, F, A, S: () => S, flush }; // 시험용
