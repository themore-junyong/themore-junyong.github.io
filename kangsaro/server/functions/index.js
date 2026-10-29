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
exports.termDaily = onSchedule({ schedule: 'every day 03:00', timeZone: 'Asia/Seoul', region: 'asia-northeast3', timeoutSeconds: 540 }, async () => {
  const ids = (await db.collection('users').select().get()).docs.map(d => d.id);
  for (const id of ids) await syncTerm(id).catch(e => console.error('term', id, e.message));
});
// 업체 공고 수 세기 (요금제 한도용)
exports.jobCount = onDocumentCreated({ ...trig, document: 'jobs/{id}' }, async e => {
  const j = e.data && e.data.data(); if (!j || !j.coId) return;
  await db.doc(`terms/${j.coId}`).set({ cnt: { [ymKst(new Date(e.time))]: FieldValue.increment(1) } }, { merge: true });
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
