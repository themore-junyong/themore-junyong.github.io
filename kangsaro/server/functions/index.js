// 강사로 서버: 업체 사업자등록번호를 국세청(공공데이터포털 '사업자등록 상태조회')으로 확인하고 승인.
// 키는 코드에 없음 → `firebase functions:secrets:set NTS_KEY` 로 넣음 (data.go.kr '일반 인증키(Decoding)')
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();
const NTS_KEY = defineSecret('NTS_KEY');
const NTS_URL = process.env.NTS_URL || 'https://api.odcloud.kr/api/nts-businessman/v1/status';
const DAY_MAX = 10; // 한 사람이 하루에 확인할 수 있는 횟수 (번호 대입 막기)

// 국세청 검증 숫자 (앱과 같은 계산)
const bizOk = n => { if (!/^\d{10}$/.test(n)) return false; const d = [...n].map(Number), w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; const t = w.reduce((a, x, i) => a + d[i] * x, 0) + Math.floor(d[8] * 5 / 10); return (10 - t % 10) % 10 === d[9]; };
const isCo = u => u.role === 'c' || (u.side && u.side.role === 'c');
const fail = (code, msg) => { throw new HttpsError(code, msg); };

exports.verifyBiz = onCall({ region: 'asia-northeast3', secrets: [NTS_KEY], maxInstances: 3, timeoutSeconds: 20 }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) fail('unauthenticated', '로그인이 필요해요');
  const n = String((req.data && req.data.biz) || '').replace(/\D/g, '');
  if (!bizOk(n)) fail('invalid-argument', '사업자등록번호 10자리를 확인해 주세요');

  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), logRef = db.doc(`ntslog/${uid}`);
  const log = (await logRef.get()).data() || {};
  if (log.day === today && log.n >= DAY_MAX) fail('resource-exhausted', '오늘은 확인 횟수를 다 썼어요. 내일 다시 해 주시거나 tobadyclup@naver.com 으로 문의해 주세요');
  await logRef.set({ day: today, n: log.day === today ? log.n + 1 : 1, last: n, at: new Date().toISOString() });

  let x;
  try {
    const r = await fetch(`${NTS_URL}?serviceKey=${encodeURIComponent(NTS_KEY.value())}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ b_no: [n] }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    x = ((await r.json()).data || [])[0] || {};
  } catch (e) { console.error('nts', e.message); fail('unavailable', '국세청 확인이 잠시 안 돼요. 조금 뒤 다시 해 주세요'); }
  // b_stt_cd: 01 계속사업자, 02 휴업, 03 폐업, 빈 값 = 등록되지 않은 번호
  if (x.b_stt_cd !== '01') fail('failed-precondition', x.b_stt_cd === '02' ? '국세청에 휴업 중으로 나와요. 영업 중인 사업자만 공고를 올릴 수 있어요' : x.b_stt_cd === '03' ? '국세청에 폐업한 사업자로 나와요' : '국세청에 등록되지 않은 사업자등록번호예요. 번호를 다시 확인해 주세요');

  await db.runTransaction(async t => {
    const bRef = db.doc(`biz/${n}`), uRef = db.doc(`users/${uid}`);
    const [b, u] = await Promise.all([t.get(bRef), t.get(uRef)]);
    if (!u.exists || !isCo(u.data())) fail('failed-precondition', '업체로 가입한 뒤에 확인할 수 있어요');
    if (u.data().blocked) fail('permission-denied', '운영자가 이 업체의 공고 등록을 멈췄어요. 문의: tobadyclup@naver.com');
    if (b.exists && b.data().uid !== uid) fail('already-exists', '이미 가입된 사업자등록번호예요. 문의: tobadyclup@naver.com');
    if (!b.exists) t.set(bRef, { uid, at: new Date().toISOString() });
    t.update(uRef, { biz: n, approved: true, bizCheck: { at: new Date().toISOString(), stt: x.b_stt || '계속사업자', tax: x.tax_type || '' } });
  });
  return { ok: true };
});

/* ===== 푸시 알림 =====
   앱이 users/{uid}/push/{id} 에 기기 토큰을 저장 → 아래 트리거가 새 알림·공지·지원·취소 때 그 사람 기기로 보냄.
   Firestore 트리거는 데이터베이스와 같은 지역이어야 함 (DB_REGION) */
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const DB_REGION = process.env.DB_REGION || 'asia-northeast3';
const APP_URL = 'https://themore-junyong.github.io/kangsaro/app/';
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const nameOf = async (id, side) => { const d = (await db.doc(`users/${id}`).get()).data() || {}; return (d.role === side ? d.name : d.side && d.side.role === side ? d.side.name : d.name) || ''; };

async function pushTo(uids, title, body, tag) {
  uids = [...new Set(uids.filter(Boolean))];
  const rows = (await Promise.all(uids.map(u => db.collection(`users/${u}/push`).get()))).flatMap(s => s.docs);
  if (!rows.length) return 0;
  const tokens = rows.map(d => d.data().token);
  if (process.env.PUSH_DRY) { console.log('PUSH', JSON.stringify({ uids, n: tokens.length, title, body })); return tokens.length; } // 에뮬레이터 시험용
  // data 메시지로 보내고 화면 표시는 sw.js가 함 (알림이 두 번 뜨지 않게)
  const res = await getMessaging().sendEachForMulticast({ tokens, data: { title, body: clip(body, 180), url: APP_URL, tag: tag || 'kangsaro' }, webpush: { headers: { Urgency: 'high', TTL: '86400' } } });
  // 앱을 지웠거나 알림을 끈 기기의 토큰은 정리
  await Promise.all(res.responses.map((r, i) => !r.success && /registration-token-not-registered|invalid-argument|invalid-registration-token/.test((r.error && r.error.code) || '') ? rows[i].ref.delete() : null));
  return res.successCount;
}
// 업체 대표 + 직원
async function coPeople(coId) { const s = await db.collection('staff').where('coId', '==', coId).get(); return [coId, ...s.docs.map(d => d.data().uid)]; }

const trig = { region: DB_REGION, maxInstances: 5 };
// 강사에게 가는 알림 (확정·마감·입금·리마인드)
exports.pushAlert = onDocumentCreated({ ...trig, document: 'alerts/{id}' }, async e => {
  const a = e.data && e.data.data(); if (!a || !a.instId) return;
  const m = String(a.text || '').match(/^\[([^\]]+)\]\s*(.*)$/s);
  await pushTo([a.instId], m ? `강사로 · ${m[1]}` : '강사로', m ? m[2] : a.text, 'al-' + e.params.id);
});
// 업체 공지 → 받는 강사들
exports.pushNotice = onDocumentCreated({ ...trig, document: 'notices/{id}' }, async e => {
  const n = e.data && e.data.data(); if (!n || !(n.to || []).length) return;
  const co = await nameOf(n.coId, 'c');
  await pushTo(n.to, `강사로 · ${co || '업체'} 공지`, n.text, 'nt-' + e.params.id);
});
// 새 지원 → 업체 대표·직원
exports.pushApply = onDocumentCreated({ ...trig, document: 'apps/{id}' }, async e => {
  const a = e.data && e.data.data(); if (!a || !a.coId) return;
  const [who, j] = await Promise.all([nameOf(a.instId, 'i'), db.doc(`jobs/${a.jobId}`).get().then(d => d.data() || {})]);
  await pushTo(await coPeople(a.coId), '강사로 · 새 지원', `${who || '강사'} 님이 ${[j.school, j.title].filter(Boolean).join(' ')}에 지원했어요`, 'ap-' + e.params.id);
});
// 확정했던 강사가 취소 → 업체 대표·직원
exports.pushCancel = onDocumentUpdated({ ...trig, document: 'apps/{id}' }, async e => {
  const b = e.data.before.data() || {}, a = e.data.after.data() || {};
  if (b.status === a.status || a.status !== '취소' || b.status !== '확정' || !a.coId) return;
  const [who, j] = await Promise.all([nameOf(a.instId, 'i'), db.doc(`jobs/${a.jobId}`).get().then(d => d.data() || {})]);
  await pushTo(await coPeople(a.coId), '강사로 · 확정 취소', `${who || '강사'} 님이 ${[j.school, j.title].filter(Boolean).join(' ')} 확정을 취소했어요${a.cxWhy ? ` (사유: ${a.cxWhy})` : ''}`, 'cx-' + e.params.id);
});
// 강의 대화방 새 메시지 → 방 사람들(보낸 사람 빼고). 같은 방 알림은 하나로 묶임
exports.pushChat = onDocumentCreated({ ...trig, document: 'rooms/{j}/msgs/{m}' }, async e => {
  const m = e.data && e.data.data(); if (!m) return;
  const r = (await db.doc(`rooms/${e.params.j}`).get()).data(); if (!r) return;
  const to = [...(r.members || []), ...(await coPeople(r.coId))].filter(u => u && u !== m.by);
  await pushTo(to, `강사로 · ${clip(r.title || '강의 대화방', 30)}`, `${m.who || ''}: ${m.text || '사진을 보냈어요'}`, 'ch-' + e.params.j);
});
// 확정 강사 모두 지급 완료 + 모두 입금 확인 → 대화방에 끝난 시각(doneAt)만 표시 (마감 안 눌러도)
// 화면 목록에서는 바로 빠지고, 서버 기록은 분쟁 대비로 30일 두었다가 chatPurge가 방·메시지를 지움
// 끝난 뒤 강사를 새로 확정하는 등 다시 '진행 중'이 되면 표시를 지움
const CHAT_KEEP_DAYS = 30;
async function chatDoneCheck(jobId) {
  if (!jobId) return;
  const [j, room] = await Promise.all([db.doc(`jobs/${jobId}`).get(), db.doc(`rooms/${jobId}`).get()]);
  if (!room.exists || !j.exists) return;
  const cf = (await db.collection('apps').where('jobId', '==', jobId).get()).docs.map(d => d.data()).filter(a => a.status === '확정');
  const done = cf.length > 0 && cf.every(a => a.paidAt && a.recv === 'ok'), was = !!(room.data() || {}).doneAt;
  if (done && !was) { await room.ref.update({ doneAt: new Date().toISOString() }); console.log('chatDone', jobId); }
  else if (!done && was) await room.ref.update({ doneAt: FieldValue.delete() });
}
exports.chatDoneApp = onDocumentUpdated({ ...trig, document: 'apps/{id}' }, async e => {
  const b = e.data.before.data() || {}, a = e.data.after.data() || {};
  if (b.recv === a.recv && b.paidAt === a.paidAt && b.status === a.status) return;
  await chatDoneCheck(a.jobId);
});
exports.chatDoneJob = onDocumentUpdated({ ...trig, document: 'jobs/{id}' }, async e => {
  const b = e.data.before.data() || {}, a = e.data.after.data() || {};
  if (b.status === a.status || a.status !== '마감') return;
  await chatDoneCheck(e.params.id);
});

/* ===== 이용 기간·요금제 =====
   terms/{uid}: free(무료 끝 날짜) · paid(운영자가 늘린 끝 날짜) · end(둘 중 늦은 날, 마지막 날) · until(end 다음 날 0시 KST, 보안 규칙이 봄)
   · planC(업체 요금제 베이직/스탠다드/프로) · planI(강사 요금제 베이직/프로) · cnt.{YYYYMM}(그 달 올린 공고 수, KST)
   사용자는 못 고침. 이 서버와 운영자만 씀. 요금제가 없으면(무료 기간) 모든 기능을 씀 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { FieldValue } = require('firebase-admin/firestore');
const ADMIN = 'tobadyclub87@gmail.com';
const REF_MAX = 180, refDays = r => r === 'c' ? 30 : 7; // 앱(real.js)과 같은 값
const ymd = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const addMonths = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return ymd(d); };
const untilOf = end => new Date(addDays(end, 1) + 'T00:00:00+09:00');
const ymKst = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 7).replace('-', '');
// 소개 인정: 강사는 프로필(분야·소개), 업체는 승인 후 공고 1건
async function refDone(id, u) {
  if (u.role === 'i') return !!(String(u.topics || '').trim() && String(u.intro || '').trim());
  if (!u.approved) return false;
  return !(await db.collection('jobs').where('coId', '==', id).limit(1).get()).empty;
}
// 무료 기간 끝: 가입일 + 3개월 + 소개로 쌓인 날 (앱의 termEnd와 같은 계산)
async function freeEnd(id) {
  const s = await db.doc(`users/${id}`).get(); if (!s.exists) return '';
  const u = s.data(), js = [u.joined, u.side && u.side.joined].filter(Boolean).sort();
  if (!js.length) return '';
  let got = u.refBy && await refDone(id, u) ? refDays(u.role) : 0;
  for (const x of (await db.collection('users').where('refBy', '==', id).get()).docs) if (await refDone(x.id, x.data())) got += refDays(x.data().role);
  return addDays(addMonths(js[0], 3), Math.min(REF_MAX, got));
}
async function syncTerm(id) {
  const free = await freeEnd(id); if (!free) return null;
  const ref = db.doc(`terms/${id}`), t = (await ref.get()).data() || {};
  const end = [free, t.paid || ''].sort().pop(), day = ymd(new Date(Date.now() + 9 * 3600e3));
  if (t.free !== free || t.end !== end || t.day !== day) await ref.set({ free, end, until: untilOf(end), day }, { merge: true });
  return { ...t, free, end };
}
// 앱을 열 때 내 기간을 다시 계산 (소개 보너스가 바로 반영되게). 직원은 자기 업체, 운영자는 아무나
exports.termSync = onCall({ region: 'asia-northeast3', maxInstances: 5, timeoutSeconds: 30 }, async req => {
  const uid = req.auth && req.auth.uid; if (!uid) fail('unauthenticated', '로그인이 필요해요');
  const id = String((req.data && req.data.uid) || uid);
  const adm = req.auth.token.email === ADMIN && req.auth.token.email_verified === true;
  if (id !== uid && !adm && !(await db.doc(`staff/${id}_${uid}`).get()).exists) fail('permission-denied', '볼 수 없는 계정이에요');
  const t = await syncTerm(id);
  return { end: t ? t.end : '' };
});
// 매일 새벽 3시: 모든 계정 기간 다시 계산
// 끝난 지 30일 지난 대화방은 메시지까지 지움 (매일 새벽 4시)
exports.chatPurge = onSchedule({ schedule: 'every day 04:00', timeZone: 'Asia/Seoul', region: 'asia-northeast3', timeoutSeconds: 540 }, async () => {
  const cut = new Date(Date.now() - CHAT_KEEP_DAYS * 864e5).toISOString();
  const old = await db.collection('rooms').where('doneAt', '<=', cut).get();
  for (const d of old.docs) { await db.recursiveDelete(d.ref); console.log('chatPurge', d.id); }
});
exports.termDaily = onSchedule({ schedule: 'every day 03:00', timeZone: 'Asia/Seoul', region: 'asia-northeast3', timeoutSeconds: 540 }, async () => {
  const ids = (await db.collection('users').select().get()).docs.map(d => d.id);
  for (const id of ids) await syncTerm(id).catch(e => console.error('term', id, e.message));
});
// 업체 공고 수 세기 (요금제 한도용)
exports.jobCount = onDocumentCreated({ ...trig, document: 'jobs/{id}' }, async e => {
  const j = e.data && e.data.data(); if (!j || !j.coId || j.pre) return; // 인수로 넘어온 공고는 안 셈
  await db.doc(`terms/${j.coId}`).set({ cnt: { [ymKst(new Date(e.time))]: FieldValue.increment(1) } }, { merge: true });
});

/* ===== 톡방 공고 인수 =====
   운영자가 pre/{코드}에 미가입 업체 공고를 모아 둠(비공개) → 업체가 ?claim=코드 링크로 가입·승인되면
   그 공고를 jobs로 옮김: 안 지난 강의는 '모집', 지난 강의는 '마감'(정산용 기록). 한 코드는 한 업체만 */
const PRE_SCAM = /텔레그램|telegram|open\.kakao|오픈\s*카톡|오픈\s*채팅|선입금|보증금|가입비|등록비|교재비\s*(입금|선납|구입)|고수익|리딩방|코인|해외\s*취업/i;
exports.claimPre = onCall({ region: 'asia-northeast3', maxInstances: 3, timeoutSeconds: 60 }, async req => {
  const uid = req.auth && req.auth.uid; if (!uid) fail('unauthenticated', '로그인이 필요해요');
  const code = String((req.data && req.data.code) || '').replace(/[^0-9a-f]/gi, '').slice(0, 16);
  if (code.length < 8) fail('invalid-argument', '인수 링크가 잘못됐어요');
  const u = (await db.doc(`users/${uid}`).get()).data();
  if (!u || !isCo(u)) fail('failed-precondition', '업체로 가입한 뒤에 받을 수 있어요');
  if (u.approved !== true || u.blocked) fail('failed-precondition', '사업자 확인이 끝난 뒤에 받을 수 있어요');
  const ref = db.doc(`pre/${code}`), today = ymd(new Date(Date.now() + 9 * 3600e3)), now = new Date().toISOString();
  return db.runTransaction(async t => {
    const p = await t.get(ref);
    if (!p.exists) fail('not-found', '인수 링크를 찾지 못했어요. 운영자에게 문의해 주세요: tobadyclup@naver.com');
    const d = p.data();
    if (d.claimedBy && d.claimedBy !== uid) fail('already-exists', '이미 다른 계정이 받은 링크예요. 문의: tobadyclup@naver.com');
    if (d.claimedBy === uid) return { n: 0, again: true };
    let n = 0;
    for (const j of (d.jobs || []).slice(0, 400)) {
      const dates = (j.dates || []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort(); if (!dates.length) continue;
      const fee = Math.max(0, Math.round(+j.fee || 0)), scam = PRE_SCAM.test(`${j.title} ${j.school} ${j.desc}`) || fee > 1000000;
      t.set(db.collection('jobs').doc(), { coId: uid, title: clip(j.title, 60) || '강의', school: clip(j.school, 40), region: clip(j.region, 20), dates, time: clip(j.time, 30), 교시: clip(j.교시, 20), 대상: clip(j.대상, 40),
        desc: String(j.desc || '').slice(0, 3000), fee, status: dates[dates.length - 1] < today ? '마감' : '모집', needs: ['프로필'], created: today, at: now, cleared: false, hold: scam, pre: code });
      n++;
    }
    t.update(ref, { claimedBy: uid, claimedAt: now, claimedN: n });
    return { n };
  });
});

/* ===== AI 상담 봇 =====
   사용설명서·상세페이지 글만 보고 제미나이(Vertex AI, 이 프로젝트 결제)로 답함. 질문 내용은 저장하지 않음.
   남용 막기: 한 곳(IP)에서 하루 20번, 전체 하루 1,500번 */
const { onRequest } = require('firebase-functions/v2/https');
const SITE = 'https://themore-junyong.github.io/kangsaro/';
const DOCS = ['guide/instructor.html', 'guide/company.html', ''];
const BOT_MODELS = (process.env.BOT_MODEL || 'gemini-3-flash,gemini-3-flash-preview,gemini-2.5-flash,gemini-2.5-flash-lite').split(',');
const BOT_IP_MAX = 20, BOT_ALL_MAX = 1500;
let botDocs = null, botAt = 0, botModel = '';
const plain = h => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<(br|\/p|\/li|\/h\d|\/summary|\/details|\/section)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
async function guideText() {
  if (botDocs && Date.now() - botAt < 3600e3) return botDocs; // 1시간마다 새로 읽음 (설명서를 고치면 저절로 반영)
  const t = await Promise.all(DOCS.map(p => fetch(SITE + p).then(r => r.ok ? r.text() : '').catch(() => '')));
  botDocs = DOCS.map((p, i) => `### ${p || '상세페이지'}\n${plain(t[i]).slice(0, 30000)}`).join('\n\n'); botAt = Date.now();
  return botDocs;
}
const BOT_RULE = `너는 '강사로'(강사·강의 업체용 일정·공고·정산 앱)의 상담 도우미야.
- 아래 [설명서]에 있는 내용으로만 답해. 없는 내용은 지어내지 말고 "설명서에 없는 내용이라 tobadyclup@naver.com 으로 문의해 주세요"라고 해.
- 한국어 존댓말(~해요체)로, 3~6문장 안에서 짧게. 누를 버튼 이름은 '작은따옴표'로.
- 주민등록번호·계좌번호·비밀번호 같은 개인정보는 묻지도 받지도 마. 사용자가 적으면 지우라고 안내해.
- 강의·앱 사용과 관계없는 질문(숙제, 코드, 다른 주제)은 정중히 거절해.`;
exports.askBot = onRequest({ region: 'asia-northeast3', invoker: 'public', cors: ['https://themore-junyong.github.io', /localhost/], maxInstances: 3, timeoutSeconds: 60, memory: '512MiB' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 돼요' });
  const q = String((req.body && req.body.q) || '').trim().slice(0, 500);
  const hist = (Array.isArray(req.body && req.body.h) ? req.body.h : []).slice(-6).map(x => ({ role: x.r === 'a' ? 'model' : 'user', parts: [{ text: String(x.t || '').slice(0, 800) }] }));
  if (!q) return res.status(400).json({ error: '질문을 적어 주세요' });
  const day = ymd(new Date(Date.now() + 9 * 3600e3)), ip = require('crypto').createHash('sha256').update(day + String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim()).digest('hex').slice(0, 16); // IP는 그날 값으로 해시만
  const lim = db.doc(`botlog/${day}`);
  const over = await db.runTransaction(async t => {
    const d = (await t.get(lim)).data() || {}, n = (d.ip || {})[ip] || 0;
    if (n >= BOT_IP_MAX) return '오늘은 질문을 많이 하셨어요. 내일 다시 물어보시거나 tobadyclup@naver.com 으로 문의해 주세요';
    if ((d.all || 0) >= BOT_ALL_MAX) return '오늘은 상담이 많아 잠시 쉬어요. tobadyclup@naver.com 으로 문의해 주세요';
    t.set(lim, { all: FieldValue.increment(1), ip: { [ip]: FieldValue.increment(1) } }, { merge: true });
    return '';
  });
  if (over) return res.json({ a: over });
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ vertexai: true, project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT, location: 'global' });
  const sys = BOT_RULE + '\n\n[설명서]\n' + await guideText();
  for (const m of botModel ? [botModel] : BOT_MODELS) {
    try {
      const r = await ai.models.generateContent({ model: m, contents: [...hist, { role: 'user', parts: [{ text: q }] }], config: { systemInstruction: sys, temperature: 0.2, maxOutputTokens: 4096 } }); // 생각하는 모델은 생각에도 토큰을 써서 넉넉히
      botModel = m; if (r.candidates && r.candidates[0] && r.candidates[0].finishReason === 'MAX_TOKENS') console.warn('bot cut', m);
      return res.json({ a: (r.text || '').trim() || '답을 만들지 못했어요. 다시 물어봐 주세요' });
    } catch (e) {
      console.error('bot', m, e.status || '', String(e.message || e).slice(0, 200));
      if (!/404|not found|NOT_FOUND|not supported/i.test(String(e.message || e))) break; // 모델이 없을 때만 다음 모델
    }
  }
  res.json({ a: '지금은 답하기 어려워요. 잠시 뒤 다시 물어보시거나 tobadyclup@naver.com 으로 문의해 주세요' });
});

/* ===== 구글 캘린더로 자동 보내기 (구독 주소 .ics) =====
   강사가 '구글 캘린더에 연결'을 누르면 calLink가 내 전용 주소를 만들어 줌 (열쇠는 calKeys/{uid}, 앱에서는 못 읽음)
   구글 캘린더가 몇 시간마다 calFeed 주소를 읽어 강사로의 강의 일정(지원·확정·미입금·입금)만 보여 줌. 한쪽 방향(강사로 → 구글) */
const CAL_URL = 'https://asia-northeast3-kangsaro-4ad33.cloudfunctions.net/calFeed';
exports.calLink = onCall({ region: 'asia-northeast3', maxInstances: 3 }, async req => {
  const uid = req.auth && req.auth.uid; if (!uid) fail('unauthenticated', '로그인이 필요해요');
  const ref = db.doc(`calKeys/${uid}`), d = await ref.get();
  let k = d.exists && !(req.data && req.data.reset) ? d.data().k : '';
  if (!k) { k = require('crypto').randomBytes(18).toString('base64url'); await ref.set({ k, at: new Date().toISOString() }); }
  return { url: `${CAL_URL}?u=${uid}&k=${k}` };
});
const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsFold = l => { const o = []; let s = l; while (Buffer.byteLength(s) > 73) { let n = 60; while (Buffer.byteLength(s.slice(0, n)) > 73) n--; o.push(s.slice(0, n)); s = ' ' + s.slice(n); } o.push(s); return o.join('\r\n'); };
// 제목 앞 동그라미로 상태 구분 (강사로 달력 색과 같게). 구독 캘린더는 일정마다 색을 못 바꿔서 이걸로 구분
const TAG = { applied: '⚪ 지원', confirmed: '🔵 확정', done: '🟣 미입금', paid: '🟢 입금' };
const calTitle = (e, plain) => { const m = String(e.time || '').match(/(\d{1,2}):(\d{2})/); return `${plain ? '' : TAG[e.st] + ' '}${m ? m[1].padStart(2, '0') + ':' + m[2] + ' ' : ''}${e.title || '강의'}`; };
const calDesc = e => [e.org && `업체: ${e.org}`, e.time && `시간: ${e.time}`, +e.fee ? `강사료: ${(+e.fee).toLocaleString('ko-KR')}원` : '', e.st === 'done' ? '페이 지급: ☐ 미입금' : e.st === 'paid' ? '페이 지급: ☑ 입금' : '', '강사로에서 자동으로 보냄 (고치려면 강사로 앱에서)'].filter(Boolean).join('\n');
const dayAfter = d => ymd(new Date(Date.parse(d + 'T00:00:00Z') + 864e5));
// 강사 한 명의 강의 일정 목록 (구독 주소와 구글 바로 연결이 같이 씀). 90일 전부터
async function calEvents(u) {
  const today = ymd(new Date(Date.now() + 9 * 3600e3)), from = ymd(new Date(Date.now() - 90 * 864e5));
  const ev = [], add = (id, d, st, title, time, org, fee, where) => { if (d >= from) ev.push({ id, d, st, title, time, org, fee, where }); };
  const over = ds => ds.length && ds[ds.length - 1] < today;
  // 내가 직접 넣은 일정 (메모·'안 됨' 빼고)
  const evs = await db.collection('evs').where('instId', '==', u).get();
  for (const x of evs.docs) { const e = x.data(); if (e.kind === 'memo' || e.st === 'no') continue; const ds = (e.dates || []).slice().sort();
    const st = e.st === 'paid' ? 'paid' : e.st === 'applied' ? 'applied' : e.st === 'done' || over(ds) ? 'done' : 'confirmed';
    for (const d of ds) add(x.id, d, st, e.title, e.time, e.org, e.fee, ''); }
  // 강사로 안에서 지원·확정한 강의
  const apps = await db.collection('apps').where('instId', '==', u).get(), orgs = {};
  for (const x0 of apps.docs) { const a = x0.data(); if (a.status !== '지원' && a.status !== '확정') continue;
    const jd = await db.doc(`jobs/${a.jobId}`).get(); if (!jd.exists) continue; const j = jd.data();
    if (!(j.coId in orgs)) { const c = (await db.doc(`users/${j.coId}`).get()).data() || {}; orgs[j.coId] = c.role === 'c' ? c.name : (c.side && c.side.name) || c.name || ''; }
    let days = (j.dates || []).map(d => ({ d, time: j.time }));
    if (a.status === '확정' && j.op) { // 운영 시간표가 있으면 내 칸이 있는 날만 (없으면 강의 날짜 전체)
      const pl = (await db.doc(`jobs/${a.jobId}/plan/main`).get()).data(), M = {};
      for (const s of (pl && pl.slots) || []) if (s.inst === u || s.sub === u) (M[s.d] = M[s.d] || []).push(s.time);
      if (Object.keys(M).length) days = Object.keys(M).sort().map(d => ({ d, time: M[d].filter(Boolean).sort().join(', ') }));
      else if (Array.isArray(a.days) && a.days.length) days = days.filter(x => a.days.includes(x.d)); }
    const ds = days.map(x => x.d).sort(), st = a.status === '지원' ? 'applied' : a.paidAt || a.selfPaid ? 'paid' : over(ds) ? 'done' : 'confirmed';
    for (const x of days) add(x0.id, x.d, st, [j.region, j.school, j.title].filter(Boolean).join(' '), x.time, orgs[j.coId], j.fee, [j.region, j.school].filter(Boolean).join(' ')); }
  return ev;
}
exports.calFeed = onRequest({ region: 'asia-northeast3', invoker: 'public', maxInstances: 5, timeoutSeconds: 60 }, async (req, res) => {
  const u = String(req.query.u || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40), k = String(req.query.k || '').slice(0, 60);
  const kd = u && k ? await db.doc(`calKeys/${u}`).get() : null;
  if (!kd || !kd.exists || kd.data().k !== k) return res.status(404).send('주소가 바뀌었거나 없어요. 강사로 앱에서 다시 연결해 주세요');
  const ev = await calEvents(u);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//kangsaro//ko', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:강사로 강의 일정', 'X-WR-TIMEZONE:Asia/Seoul', 'REFRESH-INTERVAL;VALUE=DURATION:PT3H', 'X-PUBLISHED-TTL:PT3H'];
  for (const e of ev) {
    const d0 = e.d.replace(/-/g, ''), d1 = dayAfter(e.d).replace(/-/g, '');
    L.push('BEGIN:VEVENT', `UID:${e.id}-${d0}@kangsaro`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d0}`, `DTEND;VALUE=DATE:${d1}`,
      icsFold(`SUMMARY:${icsEsc(calTitle(e))}`), icsFold(`DESCRIPTION:${icsEsc(calDesc(e))}`),
      ...(e.where ? [icsFold(`LOCATION:${icsEsc(e.where)}`)] : []), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  res.set('Content-Type', 'text/calendar; charset=utf-8').set('Cache-Control', 'private, max-age=900').send(L.join('\r\n') + '\r\n');
});

/* ===== 구글 캘린더 바로 연결 (구글 캘린더 API, 몇 초 안에 반영) =====
   강사가 '구글 계정으로 연결'을 누르면 구글 허용 화면 → 앱으로 돌아오며 gcalCode가 열쇠(refresh token)를 받아 gcal/{uid}에 둠 (앱에서는 못 읽음)
   구글 캘린더에 '강사로 강의 일정' 캘린더를 하나 만들고, 강의·지원·시간표·일정이 바뀔 때마다 그 강사 것만 다시 맞춤.
   권한은 calendar.app.created: 강사로가 만든 캘린더만 만지고 강사의 다른 일정은 못 봄.
   키는 코드에 없음 → `firebase functions:secrets:set GCAL_ID`, `GCAL_SECRET` (구글 클라우드 → OAuth 클라이언트) */
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const GCAL_ID = defineSecret('GCAL_ID'), GCAL_SECRET = defineSecret('GCAL_SECRET');
const gsec = { secrets: [GCAL_ID, GCAL_SECRET] };
const gId = () => String(GCAL_ID.value() || '').trim(), gSec = () => String(GCAL_SECRET.value() || '').trim(); // 붙여 넣을 때 들어간 빈칸·줄바꿈 무시
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const GAUTH = process.env.GAUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const GTOKEN = process.env.GTOKEN_URL || 'https://oauth2.googleapis.com';
const GAPI = process.env.GAPI_URL || 'https://www.googleapis.com/calendar/v3';
const GCOLOR = { applied: '8', confirmed: '7', done: '3', paid: '2' }; // 회색·하늘(공작)·보라(포도)·연두(세이지). 바로 연결은 색으로 구분해서 제목 앞 동그라미는 뺌
const gForm = o => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
const gNow = () => new Date().toISOString();
async function gToken(uid, g) {
  const r = await fetch(`${GTOKEN}/token`, gForm({ grant_type: 'refresh_token', refresh_token: g.rt, client_id: gId(), client_secret: gSec() }));
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) { if (t.error === 'invalid_grant') await db.doc(`gcal/${uid}`).update({ err: 'revoked', errAt: gNow() }); throw new Error('gcal token ' + (t.error || r.status)); }
  return t.access_token;
}
async function gApi(tok, method, path, body) {
  for (let i = 0; ; i++) {
    const r = await fetch(GAPI + path, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    const why = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || '';
    if (i < 3 && (r.status === 429 || r.status >= 500 || /rateLimit/.test(why))) { await new Promise(f => setTimeout(f, 1000 * 2 ** i)); continue; } // 잠깐 많이 보내면 쉬었다가 다시
    const e = new Error(`gcal ${method} ${path.split('?')[0]} ${r.status} ${(j.error && j.error.message) || ''}`); e.status = r.status; throw e;
  }
}
// 구글에 들어갈 모양 (아이디는 강사로 문서·날짜로 늘 같게 → 두 번 들어가지 않음)
const gIdOf = (id, d) => require('crypto').createHash('sha1').update(`${id}-${d}`).digest('hex');
const gEvent = e => ({ summary: calTitle(e, true), description: calDesc(e), location: e.where || '', start: { date: e.d }, end: { date: dayAfter(e.d) },
  colorId: GCOLOR[e.st], transparency: 'transparent', extendedProperties: { private: { ks: '1' } } });
const gSame = (h, w) => (h.summary || '') === w.summary && (h.description || '') === w.description && (h.location || '') === w.location
  && (h.colorId || '') === w.colorId && h.start && h.start.date === w.start.date && h.end && h.end.date === w.end.date && h.status !== 'cancelled';

// 강사 한 명의 구글 캘린더를 강사로와 똑같이 맞춤. 바꾼 개수를 돌려줌
async function gcalSync(uid, tok) {
  const ref = db.doc(`gcal/${uid}`), g = (await ref.get()).data();
  if (!g || !g.rt || g.err === 'revoked') return -1;
  tok = tok || await gToken(uid, g);
  let cal = g.cal || '';
  if (cal) try { await gApi(tok, 'GET', `/calendars/${encodeURIComponent(cal)}`); } catch (e) { if ([403, 404, 410].includes(e.status)) cal = ''; else throw e; } // 강사가 구글에서 캘린더를 지웠으면 새로 만듦
  if (!cal) {
    cal = (await gApi(tok, 'POST', '/calendars', { summary: '강사로 강의 일정', description: '강사로 앱이 자동으로 넣는 강의 일정이에요. 고치려면 강사로 앱에서 바꿔 주세요.', timeZone: 'Asia/Seoul' })).id;
    await ref.update({ cal });
  }
  const C = `/calendars/${encodeURIComponent(cal)}/events`, from = ymd(new Date(Date.now() - 90 * 864e5));
  const want = new Map(); for (const e of await calEvents(uid)) want.set(gIdOf(e.id, e.d), gEvent(e));
  const have = new Map(); let pt = '';
  do { const j = await gApi(tok, 'GET', `${C}?maxResults=2500&showDeleted=true&privateExtendedProperty=ks%3D1&timeMin=${encodeURIComponent(from + 'T00:00:00+09:00')}${pt ? '&pageToken=' + encodeURIComponent(pt) : ''}`);
    for (const x of j.items || []) have.set(x.id, x); pt = j.nextPageToken || ''; } while (pt);
  let n = 0;
  for (const [id, w] of want) { const h = have.get(id);
    if (h && gSame(h, w)) continue;
    if (!h) { try { await gApi(tok, 'POST', C, { id, ...w }); } catch (e) { if (e.status !== 409) throw e; await gApi(tok, 'PUT', `${C}/${id}`, { ...w, status: 'confirmed' }); } }
    else await gApi(tok, 'PUT', `${C}/${id}`, { ...w, status: 'confirmed' });
    n++; }
  // 강사로에서 없어진 일정은 구글에서도 지움 (강사로가 넣은 것만. 90일보다 지난 일정은 기록으로 둠)
  for (const [id, h] of have) if (!want.has(id) && h.status !== 'cancelled') { try { await gApi(tok, 'DELETE', `${C}/${id}`); } catch (e) { if (![404, 410].includes(e.status)) throw e; } n++; }
  await ref.update({ last: gNow(), n: want.size, err: '' });
  return n;
}
const gFail = (uid, e) => { console.warn('gcal', uid, e.message); return /invalid_grant/.test(e.message) ? null : db.doc(`gcal/${uid}`).update({ err: 'fail', errAt: gNow() }).catch(() => { }); }; // 'revoked'(강사가 구글에서 허용을 거둠)는 그대로 둠
const gcalSafe = uid => gcalSync(uid).catch(e => gFail(uid, e));
// 연결한 강사만 골라서 맞춤
async function gcalKick(uids) {
  uids = [...new Set(uids.filter(u => typeof u === 'string' && u))]; if (!uids.length) return;
  const ds = await db.getAll(...uids.map(u => db.doc(`gcal/${u}`)));
  await Promise.all(ds.filter(d => d.exists && d.data().rt && d.data().err !== 'revoked').map(d => gcalSafe(d.id)));
}
const instsOfJob = async jobId => (await db.collection('apps').where('jobId', '==', jobId).get()).docs.map(d => d.data().instId);
const bothSides = e => [e.data.before && e.data.before.data(), e.data.after && e.data.after.data()].filter(Boolean);

exports.gcalStart = onCall({ region: 'asia-northeast3', ...gsec, maxInstances: 3 }, async req => {
  const uid = req.auth && req.auth.uid; if (!uid) fail('unauthenticated', '로그인이 필요해요');
  const state = require('crypto').randomBytes(24).toString('base64url');
  await db.doc(`gcalState/${state}`).set({ uid, exp: Date.now() + 20 * 60e3 });
  const q = new URLSearchParams({ client_id: gId(), redirect_uri: APP_URL, response_type: 'code', scope: GCAL_SCOPE, access_type: 'offline', prompt: 'consent', state });
  return { url: `${GAUTH}?${q}` };
});
// 구글 허용 화면에서 앱으로 돌아왔을 때. 휴대폰 홈 화면 앱은 로그인이 안 된 브라우저로 돌아올 수 있어서 로그인 대신 state로 누구인지 앎
exports.gcalCode = onCall({ region: 'asia-northeast3', ...gsec, maxInstances: 3, timeoutSeconds: 120 }, async req => {
  const st = String((req.data && req.data.state) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64), code = String((req.data && req.data.code) || '').slice(0, 512);
  const sd = st && code ? await db.doc(`gcalState/${st}`).get() : null;
  if (!sd || !sd.exists || sd.data().exp < Date.now()) fail('failed-precondition', '연결 시간이 지났어요. 강사로 프로필에서 다시 눌러 주세요');
  await sd.ref.delete(); const uid = sd.data().uid;
  const r = await fetch(`${GTOKEN}/token`, gForm({ code, client_id: gId(), client_secret: gSec(), redirect_uri: APP_URL, grant_type: 'authorization_code' }));
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.refresh_token) fail('failed-precondition', '구글 연결이 안 됐어요. 다시 눌러 주세요');
  if (!String(t.scope || '').split(' ').includes(GCAL_SCOPE)) fail('permission-denied', "구글 화면에서 캘린더 항목에 체크해 주세요. 다시 눌러 연결해 주세요");
  await db.doc(`gcal/${uid}`).set({ rt: t.refresh_token, at: gNow(), err: '' }, { merge: true });
  try { await gcalSync(uid, t.access_token); } catch (e) { await gFail(uid, e); }
  const g = (await db.doc(`gcal/${uid}`).get()).data();
  return { on: true, n: g.n || 0, last: g.last || '', err: g.err || '' };
});
exports.gcalState = onCall({ region: 'asia-northeast3', maxInstances: 5 }, async req => {
  const uid = req.auth && req.auth.uid; if (!uid) fail('unauthenticated', '로그인이 필요해요');
  const g = (await db.doc(`gcal/${uid}`).get()).data();
  return g && g.rt ? { on: g.err !== 'revoked', err: g.err || '', n: g.n || 0, last: g.last || '' } : { on: false };
});
exports.gcalNow = onCall({ region: 'asia-northeast3', ...gsec, maxInstances: 3, timeoutSeconds: 120 }, async req => {
  const uid = req.auth && req.auth.uid; if (!uid) fail('unauthenticated', '로그인이 필요해요');
  try { if (await gcalSync(uid) < 0) fail('failed-precondition', '구글 계정이 연결돼 있지 않아요. 다시 연결해 주세요'); }
  catch (e) { if (e instanceof HttpsError) throw e; await gFail(uid, e); if (/invalid_grant/.test(e.message)) fail('failed-precondition', '구글 연결이 끊겼어요. 다시 연결해 주세요'); fail('unavailable', '구글에 보내지 못했어요. 잠시 뒤 다시 눌러 주세요'); }
  const g = (await db.doc(`gcal/${uid}`).get()).data();
  return { on: true, n: g.n || 0, last: g.last || '', err: '' };
});
// 연결 끊기: 강사로가 만든 캘린더를 지우고 구글 허용도 거둠
exports.gcalOff = onCall({ region: 'asia-northeast3', ...gsec, maxInstances: 3, timeoutSeconds: 60 }, async req => {
  const uid = req.auth && req.auth.uid; if (!uid) fail('unauthenticated', '로그인이 필요해요');
  const ref = db.doc(`gcal/${uid}`), g = (await ref.get()).data();
  if (g && g.rt) {
    try { const tok = await gToken(uid, g); if (g.cal) await gApi(tok, 'DELETE', `/calendars/${encodeURIComponent(g.cal)}`); } catch (e) { console.warn('gcalOff', e.message); }
    await fetch(`${GTOKEN}/revoke`, gForm({ token: g.rt })).catch(() => { });
  }
  await ref.delete();
  return { on: false };
});
// 바뀔 때마다 그 강사 것만 다시 맞춤
const gtrig = { ...trig, ...gsec, timeoutSeconds: 120 };
exports.gcalEv = onDocumentWritten({ ...gtrig, document: 'evs/{id}' }, async e => gcalKick(bothSides(e).map(x => x.instId)));
exports.gcalApp = onDocumentWritten({ ...gtrig, document: 'apps/{id}' }, async e => gcalKick(bothSides(e).map(x => x.instId)));
exports.gcalJob = onDocumentUpdated({ ...gtrig, document: 'jobs/{id}' }, async e => {
  const a = e.data.before.data() || {}, b = e.data.after.data() || {}, K = ['dates', 'time', 'title', 'region', 'school', 'fee', 'op', 'coId'];
  if (K.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]))) return;
  await gcalKick(await instsOfJob(e.params.id));
});
exports.gcalPlan = onDocumentWritten({ ...gtrig, document: 'jobs/{j}/plan/{p}' }, async e => gcalKick(await instsOfJob(e.params.j)));
// 매일 새벽: 날짜가 지나 '확정 → 미입금'으로 바뀌는 것 반영
exports.gcalDaily = onSchedule({ schedule: 'every day 05:00', timeZone: 'Asia/Seoul', region: 'asia-northeast3', ...gsec, timeoutSeconds: 540 }, async () => {
  const s = await db.collection('gcal').get();
  for (const d of s.docs) if (d.data().rt && d.data().err !== 'revoked') await gcalSafe(d.id);
  const old = await db.collection('gcalState').where('exp', '<', Date.now()).get(); await Promise.all(old.docs.map(d => d.ref.delete()));
});
