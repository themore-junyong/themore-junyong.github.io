// 강의 도구 서버: 초대코드가 있는 학생만 AI 자소서 초안을 받게 함.
// 키는 코드에 없음 → `firebase functions:secrets:set GEMINI_KEY` 로 넣음 (aistudio.google.com 제미나이 API 키)
// 학생 글은 저장하지 않고, 하루 횟수만 use/{날짜}에 셈.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenAI, ApiError } = require('@google/genai');

initializeApp();
const db = getFirestore();
const GEMINI_KEY = defineSecret('GEMINI_KEY');
const MODEL = process.env.JASO_MODEL || 'gemini-flash-latest';
const SPARE = process.env.JASO_SPARE || 'gemini-flash-lite-latest'; // 기본 모델이 붐비면(503) 대신 씀
const ALL_MAX = 300; // 모든 코드 합쳐 하루 최대 (요금 안전장치)

const fail = (code, msg) => { throw new HttpsError(code, msg); };
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const s = (v, n) => String(v == null ? '' : v).replace(/\s+$/g, '').slice(0, n);
const arr = (v, n, m) => (Array.isArray(v) ? v : []).slice(0, n).map(x => s(x, m)).filter(Boolean);

// codes/{코드}: { name: '오산대 보컬K-POP 1106', on: true, perDay: 3, max: 100, until: '2026-12-31', used: 0 }
async function codeOf(raw) {
  const code = s(raw, 40).trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,40}$/.test(code)) fail('invalid-argument', '초대코드를 다시 확인해 주세요');
  const snap = await db.doc(`codes/${code}`).get(), c = snap.data();
  if (!c || c.on !== true) fail('permission-denied', '쓸 수 없는 초대코드예요. 선생님께 확인해 주세요');
  if (c.until && kst() > c.until) fail('permission-denied', '기간이 끝난 초대코드예요');
  return { code, c };
}

exports.codeCheck = onCall({ region: 'asia-northeast3', maxInstances: 3, timeoutSeconds: 10 }, async req => {
  if (!req.auth) fail('unauthenticated', '잠시 뒤 다시 열어 주세요');
  const { c } = await codeOf(req.data && req.data.code);
  return { name: c.name || '', perDay: c.perDay || 3 };
});

// 화면과 같은 질문지 (학생이 보낸 값만 넣고, 길이는 잘라서)
function prompt(d) {
  const lines = (...a) => a.filter(x => x !== false && x != null && x !== 0 && (x === '' || String(x).trim())).join('\n');
  const exps = (Array.isArray(d.exps) ? d.exps : []).slice(0, 3).map(e => e || {}).filter(e => e.title || e.a || e.s).map((e, i) => lines(
    `[${i + 1}] ${e.kind ? s(e.kind, 20) + ' · ' : ''}${s(e.title, 80) || '(제목 없음)'}`,
    e.s && '- 상황(S): ' + s(e.s, 600), e.t && '- 역할·목표(T): ' + s(e.t, 600), e.a && '- 행동(A): ' + s(e.a, 800),
    e.r && '- 결과(R): ' + s(e.r, 600), e.learn && '- 배운 점·강점: ' + s(e.learn, 600))).join('\n\n');
  const traits = arr(d.traits, 3, 20), values = arr(d.values, 2, 20), core = arr(d.core, 2, 20), style = arr(d.style, 4, 30);
  return lines(
    '너는 고등학생·대학생의 첫 취업을 돕는 자기소개서 전문가야. 아래 [내 정보]만 근거로, 실제 회사에 낼 수 있는 자기소개서 초안을 써 줘.',
    '',
    '[쓰는 규칙]',
    '1. 말투: 친근하지만 정중하고 전문적인 "~습니다"체.',
    '2. 내 정보에 없는 경험·숫자·자격증·회사 정보는 절대 지어내지 마. 내용이 모자라면 그 자리에 [추가 필요: 무엇을 쓰면 좋을지]라고 표시해.',
    '3. 각 항목 첫 문장은 핵심 한 줄(소제목처럼)로 시작해.',
    '4. 글자 수(공백 포함)를 넘기지 마.',
    '5. 맨 끝에 "고쳐 쓸 점" 3가지를 짧게 적어 줘.',
    '',
    '[내 정보]',
    '- 학교·학과: ' + (s(d.school, 80) || '(미입력)'),
    '- 지원 회사: ' + (s(d.company, 80) || '(미입력)'),
    '- 지원 직무: ' + (s(d.job, 80) || '(미입력)'),
    d.jobwhy && '- 직무를 알게 된 계기: ' + s(d.jobwhy, 300),
    traits.length && '- 나를 설명하는 단어: ' + traits.join(', '),
    values.length && '- 일할 때 중요하게 여기는 것: ' + values.join(', '),
    style.length && '- 일하는 스타일: ' + style.join(', '),
    core.length && '- 직무 핵심 역량: ' + core.join(', '),
    d.grow && '- 나를 바꾼 경험: ' + s(d.grow, 800),
    d.good && '- 장점: ' + s(d.good, 60) + (d.goodEx ? ' / 사례: ' + s(d.goodEx, 600) : ''),
    d.bad && '- 단점: ' + s(d.bad, 60) + (d.badFix ? ' / 고치려는 노력: ' + s(d.badFix, 600) : ''),
    d.know && '- 회사에 대해 알아본 것: ' + s(d.know, 800),
    d.motive && '- 지원 이유: ' + s(d.motive, 800),
    d.plan && '- 입사 후 목표: ' + s(d.plan, 600),
    '',
    exps ? '[경험]\n' + exps : '[경험] (미입력)',
    '',
    '[써야 할 항목]',
    '1. 성장과정 (700자 이내): 성격·가치관을 만든 경험 1~2가지와 배운 점.',
    '2. 성격의 장단점 (500자 이내): 직무 역량과 이어지는 장점 1개와 사례, 단점 1개와 고치려는 구체적 노력.',
    '3. 직무 관련 경험 (1000자 이내): 경험 1~2개를 STAR(상황-과제-행동-결과) 순서로. 결과의 숫자는 내 정보에 있는 것만.',
    '4. 지원동기와 입사 후 포부 (700자 이내): 이 회사·직무를 고른 이유를 내 경험과 연결하고, 1년·5년 목표.',
    '',
    '출력 형식: 항목마다 "## 1. 성장과정 (OOO자)"처럼 제목과 실제 글자 수를 쓰고 본문. 그 밖의 설명은 쓰지 마.');
}

exports.jasoDraft = onCall({ region: 'asia-northeast3', secrets: [GEMINI_KEY], maxInstances: 5, timeoutSeconds: 300, memory: '512MiB' }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) fail('unauthenticated', '잠시 뒤 다시 열어 주세요');
  const { code, c } = await codeOf(req.data && req.data.code);
  const d = (req.data && req.data.d) || {};
  if (!s(d.job, 80) && !(Array.isArray(d.exps) && d.exps.some(e => e && (e.a || e.s)))) fail('invalid-argument', '지원 직무나 경험을 먼저 적어 주세요');

  const day = kst(), per = c.perDay || 3, ref = db.doc(`use/${day}`), cRef = db.doc(`codes/${code}`);
  let mine = 0;
  const over = await db.runTransaction(async t => {
    const u = (await t.get(ref)).data() || {}, cd = (await t.get(cRef)).data() || {};
    mine = (u.u || {})[uid] || 0;
    if (mine >= per) return `오늘은 ${per}번 다 만들었어요. 지금 초안을 고쳐 쓰고 내일 다시 해 보세요`;
    if (cd.max && (cd.used || 0) >= cd.max) return '이 초대코드의 횟수를 다 썼어요. 선생님께 말씀해 주세요';
    if ((u.all || 0) >= ALL_MAX) return '오늘은 사용하는 사람이 많아 쉬어요. 질문지 복사로 만들어 주세요';
    t.set(ref, { all: FieldValue.increment(1), u: { [uid]: FieldValue.increment(1) }, c: { [code]: FieldValue.increment(1) } }, { merge: true });
    t.update(cRef, { used: FieldValue.increment(1) });
    return '';
  });
  if (over) fail('resource-exhausted', over);
  // AI가 실패하면 깎은 횟수를 돌려줌
  const dec = FieldValue.increment(-1);
  const undo = async (c, m) => {
    await Promise.all([ref.set({ all: dec, u: { [uid]: dec }, c: { [code]: dec } }, { merge: true }), cRef.update({ used: dec })]).catch(() => {});
    fail(c, m);
  };

  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY.value() });
  // 생각은 짧게(LOW): 기본값이면 2분 넘게 걸림. 붐비면 2초 뒤 한 번 더, 그래도 붐비면 가벼운 모델로
  const ask = model => ai.models.generateContent({ model, contents: prompt(d), config: { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'LOW' } } });
  const busy = e => e instanceof ApiError && (e.status === 503 || e.status === 500);
  let r;
  try {
    r = await ask(MODEL).catch(async e => {
      if (!busy(e)) throw e;
      console.warn('jaso retry', e.status);
      await new Promise(ok => setTimeout(ok, 2000));
      return ask(MODEL).catch(e2 => { if (!busy(e2)) throw e2; console.warn('jaso spare', e2.status); return ask(SPARE); });
    });
  } catch (e) {
    console.error('jaso', e.status || '', String(e.message || e).slice(0, 200));
    if (e instanceof ApiError && e.status === 429) await undo('resource-exhausted', '지금 요청이 많아요. 1분 뒤 다시 눌러 주세요');
    await undo('unavailable', `AI 연결이 잠시 안 돼요(${e.status || '?'}). 다시 눌러 주시거나 질문지 복사로 만들어 주세요`);
  }
  const why = (r.candidates && r.candidates[0] && r.candidates[0].finishReason) || '';
  if ((r.promptFeedback && r.promptFeedback.blockReason) || /SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(why)) await undo('failed-precondition', 'AI가 이 내용으로는 쓰지 않았어요. 입력을 고쳐 다시 해 보세요');
  const text = (r.text || '').trim();
  if (!text) await undo('unavailable', '초안을 만들지 못했어요. 다시 눌러 주세요');
  const u = r.usageMetadata || {};
  console.log('jaso ok', code, r.modelVersion, u.promptTokenCount, u.candidatesTokenCount); // 비용 확인용 (글 내용은 안 남김)
  return { text, cut: why === 'MAX_TOKENS', left: Math.max(0, per - mine - 1) };
});

// ───── 1분 자기소개 꼬꼬무 ─────
// 질문은 가벼운 모델로 하나씩(하루 1인 Q_MAX번), 마지막 멘트만 좋은 모델로(하루 1인 perDay번, 코드 횟수 차감). 대화는 저장하지 않음.
const Q_MAX = 60;
function introData(x) {
  const hist = (Array.isArray(x.hist) ? x.hist : []).slice(0, 15).map(h => ({ q: s(h && h.q, 300), a: s(h && h.a, 600) })).filter(h => h.q);
  return { job: s(x.job, 80), company: s(x.company, 80), memo: s(x.memo, 1500), hist };
}
const talk = d => d.hist.map((h, i) => `Q${i + 1}. ${h.q}\nA${i + 1}. ${h.a || '(답 없음)'}`).join('\n\n');
function introAsk(d) {
  return [
    '너는 고등학생·대학생의 면접 1분 자기소개를 함께 만드는 코치야. 학생의 답을 보고 꼬리에 꼬리를 무는 다음 질문 하나만 해.',
    '목표: 마지막에 [서론: 지원 분야의 역량·강점 한 문장] [본론: 전문가로 크려고 경험하고 공부한 것(경쟁력) 첫째·둘째] [결론: 포부]로 된 1분 자기소개를 쓸 재료를 모으는 것.',
    '규칙: 질문은 한 문장, 고등학생이 바로 답할 수 있게 쉽고 구체적으로. 답이 짧거나 모호하면 그 답을 더 파고들어(언제? 무엇을? 결과는? 숫자는?). 재료가 모였으면 아직 비어 있는 부분(강점 근거, 경험 두 번째, 포부)을 물어. 칭찬이나 설명 없이 질문만 출력해.',
    '',
    `지원 분야: ${d.job || '(미입력)'}${d.company ? ' / 회사: ' + d.company : ''}`,
    d.memo ? '학생이 미리 적어 둔 내용:\n' + d.memo : '',
    '',
    d.hist.length ? '지금까지 대화:\n' + talk(d) : '(첫 질문이야. 지원 분야를 고른 이유나 가장 자신 있는 강점부터 물어.)',
  ].filter(x => x !== '').join('\n');
}
function introWrite(d) {
  return [
    '너는 면접 코치야. 아래 [대화]에서 학생이 말한 내용만 근거로 면접 1분 자기소개 멘트를 써 줘.',
    '',
    '[구성]',
    '1) 서론: 지원 분야에서의 나의 역량·강점을 한 문장으로 팩트 있게.',
    '2) 본론: 이 분야 전문가로 크려고 경험하고 공부한 것(경쟁력)을 "첫째", "둘째"로 명료하게.',
    '3) 결론: 포부로 마무리.',
    '',
    '[규칙]',
    '- 소리 내 읽어 1분 안에 끝나게 공백 포함 300~380자. "~습니다"체, 면접관에게 말하는 문장.',
    '- 대화에 없는 경험·숫자·자격증은 지어내지 마. 모자라면 그 자리에 [추가 필요: 무엇]으로 표시.',
    '- 출력: 멘트 본문만. 그 아래 한 줄 띄우고 "고쳐 말할 점" 2가지를 짧게. 굵게(**)·제목 기호 쓰지 마.',
    '',
    `지원 분야: ${d.job || '(미입력)'}${d.company ? ' / 회사: ' + d.company : ''}`,
    d.memo ? '학생이 미리 적어 둔 내용:\n' + d.memo : '',
    '',
    '[대화]\n' + (talk(d) || '(없음)'),
  ].filter(x => x !== '').join('\n');
}

exports.introChat = onCall({ region: 'asia-northeast3', secrets: [GEMINI_KEY], maxInstances: 5, timeoutSeconds: 300, memory: '512MiB' }, async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) fail('unauthenticated', '잠시 뒤 다시 열어 주세요');
  const { code, c } = await codeOf(req.data && req.data.code);
  const d = introData(req.data || {}), write = !!(req.data && req.data.write);
  if (!d.job) fail('invalid-argument', '지원 분야를 먼저 적어 주세요');
  if (write && d.hist.filter(h => h.a).length < 3) fail('invalid-argument', '질문에 3개 이상 답해야 멘트를 쓸 수 있어요');

  const day = kst(), per = c.perDay || 3, ref = db.doc(`use/${day}`), cRef = db.doc(`codes/${code}`);
  const inc = FieldValue.increment(1), dec = FieldValue.increment(-1);
  let mine = 0;
  const over = await db.runTransaction(async t => {
    const u = (await t.get(ref)).data() || {}, cd = (await t.get(cRef)).data() || {};
    if ((u.all || 0) >= ALL_MAX * 10) return '오늘은 사용하는 사람이 많아 쉬어요. 내일 다시 해 주세요';
    if (!write) {
      if (((u.iq || {})[uid] || 0) >= Q_MAX) return '오늘 질문은 다 받았어요. 내일 다시 해 보세요';
      t.set(ref, { iq: { [uid]: inc } }, { merge: true });
      return '';
    }
    mine = (u.iw || {})[uid] || 0;
    if (mine >= per) return `오늘은 멘트를 ${per}번 다 만들었어요. 지금 멘트로 연습해 보세요`;
    if (cd.max && (cd.used || 0) >= cd.max) return '이 초대코드의 횟수를 다 썼어요. 선생님께 말씀해 주세요';
    t.set(ref, { all: inc, iw: { [uid]: inc }, c: { [code]: inc } }, { merge: true });
    t.update(cRef, { used: inc });
    return '';
  });
  if (over) fail('resource-exhausted', over);
  const undo = async (k, m) => {
    await (write
      ? Promise.all([ref.set({ all: dec, iw: { [uid]: dec }, c: { [code]: dec } }, { merge: true }), cRef.update({ used: dec })])
      : ref.set({ iq: { [uid]: dec } }, { merge: true })).catch(() => {});
    fail(k, m);
  };

  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY.value() });
  const busy = e => e instanceof ApiError && (e.status === 503 || e.status === 500);
  // 질문: 가벼운 모델 먼저, 안 되면 기본 모델. 멘트: 기본 모델(생각 짧게), 붐비면 가벼운 모델
  const order = write ? [MODEL, SPARE] : [SPARE, MODEL];
  const ask = model => ai.models.generateContent({
    model, contents: write ? introWrite(d) : introAsk(d),
    config: model === MODEL ? { maxOutputTokens: write ? 4096 : 1024, thinkingConfig: { thinkingLevel: 'LOW' } } : { maxOutputTokens: write ? 4096 : 512 },
  });
  let r;
  try {
    r = await ask(order[0]).catch(e => { if (!busy(e) && !(e instanceof ApiError && e.status === 400)) throw e; console.warn('intro next', e.status); return ask(order[1]); });
  } catch (e) {
    console.error('intro', e.status || '', String(e.message || e).slice(0, 200));
    if (e instanceof ApiError && e.status === 429) await undo('resource-exhausted', '지금 요청이 많아요. 1분 뒤 다시 눌러 주세요');
    await undo('unavailable', `AI 연결이 잠시 안 돼요(${e.status || '?'}). 다시 눌러 주세요`);
  }
  const why = (r.candidates && r.candidates[0] && r.candidates[0].finishReason) || '';
  if ((r.promptFeedback && r.promptFeedback.blockReason) || /SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(why)) await undo('failed-precondition', 'AI가 이 내용으로는 답하지 않았어요. 답을 고쳐 다시 해 보세요');
  const text = (r.text || '').replace(/\*\*/g, '').trim();
  if (!text) await undo('unavailable', '답을 만들지 못했어요. 다시 눌러 주세요');
  const u = r.usageMetadata || {};
  console.log('intro ok', write ? 'write' : 'ask', code, r.modelVersion, u.promptTokenCount, u.candidatesTokenCount);
  return write ? { text, left: Math.max(0, per - mine - 1) } : { q: text.split('\n').find(x => x.trim()).trim().slice(0, 300) };
});
