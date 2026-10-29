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
