// 교회 출석앱 ↔ 구글 시트 성도 연동 (Apps Script)
// 시트 메뉴 '출석앱' → ① 앱에서 성도 불러오기 ② 시트 내용을 앱에 저장
// 앱이 원본. 시트에서 바뀐 칸만 앱에 저장하고 사진·출석 기록은 건드리지 않는다.
// 처음 불러올 때 값을 숨은 탭 '_불러온값'에 보관해 두고, 그와 다른 칸만 '바뀐 칸'으로 본다.

const PROJECT = "themore-attendance";
const API_KEY = "AIzaSyCyiKN_E00J9kSIC6Kjw2dMyvh-t2k652I"; // 앱 firebase-config.js 와 같은 공개 값
const BASE = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents";
const SHEET = "성도", SNAP = "_불러온값", SETUP = "설정";

// 앱 index.html 의 COLS 와 같은 제목 (사진 칸 제외)
const COLS = [
  ["id", "성도ID"], ["name", "이름"], ["role", "직분"], ["group", "분류"], ["gender", "성별"], ["phone", "연락처"],
  ["regDate", "등록일"], ["birthSolar", "생일_양력"], ["birthLunar", "생일_음력"], ["anniversary", "결혼기념일"],
  ["district", "구역"], ["baptism", "세례일"], ["household", "세대ID"], ["relation", "가족관계"],
  ["isLeader", "리더여부"], ["longAbsent", "장결자"], ["memo", "메모"], ["noTrack", "추적제외"], ["extra", "기타출석"]
];
const BOOL_FIELDS = ["isLeader", "longAbsent", "noTrack", "extra"];
const DATE_FIELDS = ["regDate", "birthSolar", "anniversary", "baptism"];

function onOpen() {
  SpreadsheetApp.getUi().createMenu("출석앱")
    .addItem("① 앱에서 성도 불러오기", "pullMembers")
    .addItem("② 시트 내용을 앱에 저장", "pushMembers")
    .addSeparator()
    .addItem("③ 앱 변경 자동 반영 켜기 (열 때마다 + 10분마다)", "autoOn")
    .addItem("자동 반영 끄기", "autoOff")
    .addSeparator()
    .addItem("앱 연결 번호 보기", "showClientId")
    .addToUi();
}

// ---------- Firestore REST ----------
// 시트를 쓰는 사람의 구글 계정으로 출석앱에 로그인한 것처럼 접속한다.
// 그래서 앱 '관리'에 교역자로 등록된 사람이면 누구든(준용님이 아니어도) 자기 교회 성도를 불러오고 저장할 수 있다.
// 로그인 교환이 안 되면 예전처럼 Firebase 프로젝트 주인 권한으로 접속한다.
function me_() { return (Session.getEffectiveUser().getEmail() || "").toLowerCase(); }
let loginErr_ = "";
// 이 시트 스크립트의 구글 로그인 ID 토큰 (aud = 이 스크립트의 OAuth 클라이언트 ID)
function idToken_() { try { return ScriptApp.getIdentityToken() || ""; } catch (e) { return ""; } }
function clientId_() {
  const t = idToken_().split(".")[1];
  if (!t) return "";
  try { return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(t + "===".slice((t.length + 3) % 4))).getDataAsString()).aud || ""; } catch (e) { return ""; }
}
function fbToken_() {
  const cache = CacheService.getUserCache();
  const hit = cache.get("fbIdToken");
  if (hit) return hit;
  // ID 토큰으로 먼저 (Firebase에 이 스크립트의 클라이언트 ID를 허용해 두면 됨), 안 되면 access 토큰으로
  const tries = [];
  const idt = idToken_();
  if (idt) tries.push("id_token=" + idt);
  tries.push("access_token=" + ScriptApp.getOAuthToken());
  for (const body of tries) {
    const res = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=" + API_KEY, {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      payload: JSON.stringify({ postBody: body + "&providerId=google.com", requestUri: "http://localhost", returnSecureToken: true })
    });
    if (res.getResponseCode() < 300) {
      const t = JSON.parse(res.getContentText()).idToken;
      if (t) { cache.put("fbIdToken", t, 50 * 60); return t; }
    } else if (!loginErr_) loginErr_ = res.getContentText().slice(0, 160);
  }
  const cid = clientId_();
  loginErr_ = "시트가 앱에 로그인하지 못했어요. 앱 관리자(준용)가 Firebase 콘솔 → Authentication → 로그인 방법 → Google → '외부 프로젝트의 클라이언트 ID 허용 목록'에 아래 번호를 한 번 넣어 주면 돼요.\n"
    + (cid || "(번호를 못 읽음: appsscript.json에 openid 권한이 있는지 확인)") + "\n" + loginErr_;
  return null;
}
// 메뉴: 위 번호를 보여 줌
function showClientId() {
  SpreadsheetApp.getUi().alert("이 시트의 앱 연결 번호 (Firebase 허용 목록에 넣을 값):\n\n" + (clientId_() || "못 읽었어요. appsscript.json을 새로 붙여 넣었는지 확인해 주세요."));
}
function api_(method, url, body) {
  const fb = fbToken_();
  const res = UrlFetchApp.fetch(url, {
    method: method, contentType: "application/json", muteHttpExceptions: true,
    headers: fb ? { Authorization: "Bearer " + fb } : { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "x-goog-user-project": PROJECT },
    payload: body ? JSON.stringify(body) : undefined
  });
  const code = res.getResponseCode(), text = res.getContentText();
  if ((code === 403 || code === 401) && !fb) throw new Error(loginErr_ || "시트가 앱에 로그인하지 못했어요.");
  if (code === 403 || code === 401) throw new Error(me_() + " 계정은 이 교회 성도를 " + (method === "get" ? "볼" : "저장할") + " 권한이 없어요.\n앱 '관리'에서 이 이메일을 교역자로 넣어 주세요. (응답 " + code + ")" + "\n" + text.slice(0, 200));
  if (code >= 300) throw new Error("앱 서버 응답 " + code + ": " + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}
function listDocs_(path) {
  const out = [];
  let token = "";
  do {
    const r = api_("get", BASE + "/" + path + "?pageSize=300" + (token ? "&pageToken=" + encodeURIComponent(token) : ""));
    (r.documents || []).forEach(d => out.push(d));
    token = r.nextPageToken || "";
  } while (token);
  return out;
}
function fromValue_(v) {
  if (!v) return "";
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return String(v.integerValue);
  if ("doubleValue" in v) return String(v.doubleValue);
  return "";
}
function toValue_(k, v) {
  return BOOL_FIELDS.indexOf(k) >= 0 ? { booleanValue: v === true } : { stringValue: String(v) };
}
function docId_(d) { return d.name.split("/").pop(); }

// ---------- 교회 찾기 ----------
function church_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SETUP);
  if (!sh) {
    sh = ss.insertSheet(SETUP);
    sh.getRange("A1:B1").setValues([["교회 이름", ""]]);
    sh.getRange("A3").setValue("B1 칸에 앱에 등록한 교회 이름을 그대로 적고, 메뉴 '출석앱'에서 불러오기를 누르세요.");
  }
  const name = String(sh.getRange("B1").getValue()).trim();
  if (!name) throw new Error("'설정' 탭 B1 칸에 교회 이름을 적어 주세요.");
  // 관리자(준용)는 교회 전체를, 교역자·리더는 자기가 들어 있는 교회만 볼 수 있다
  let docs;
  try { docs = listDocs_("churches"); }
  catch (e) {
    const r = api_("post", BASE + ":runQuery", { structuredQuery: { from: [{ collectionId: "churches" }],
      where: { fieldFilter: { field: { fieldPath: "leaders" }, op: "ARRAY_CONTAINS", value: { stringValue: me_() } } } } });
    docs = r.filter(x => x.document).map(x => x.document);
  }
  const found = docs.filter(d => fromValue_((d.fields || {}).name) === name);
  if (!found.length) throw new Error("앱에서 '" + name + "' 교회를 찾지 못했어요. 이름이 앱과 똑같은지 확인해 주세요.");
  const arr = (k) => ((((found[0].fields || {})[k] || {}).arrayValue || {}).values || []).map(v => String(v.stringValue || "").toLowerCase());
  return { id: docId_(found[0]), name: name, staff: arr("staff"), leaders: arr("leaders") };
}

// ---------- 시트 읽기·쓰기 ----------
// 연락처·메모는 contacts/{성도ID}에 따로 있음 (교역자·담임목사만 읽힘). 못 읽으면 그 칸은 비워 둠
const PRIVATE = ["phone", "memo"];
function memberRows_(ch) {
  const priv = {};
  try { listDocs_("churches/" + ch.id + "/contacts").forEach(d => { priv[docId_(d)] = d.fields || {}; }); } catch (e) {}
  return rowsFromDocs_(listDocs_("churches/" + ch.id + "/members"), priv);
}
function rowsFromDocs_(docs, priv) {
  const rows = docs.map(d => {
    const f = Object.assign({}, d.fields || {}, priv[docId_(d)] || {});
    return COLS.map(([k]) => k === "id" ? docId_(d) : (BOOL_FIELDS.indexOf(k) >= 0 ? fromValue_(f[k]) === true : fromValue_(f[k])));
  });
  rows.sort((a, b) => String(a[1]).localeCompare(String(b[1]), "ko"));
  return rows;
}
function writeTable_(sh, rows) {
  sh.clear();
  const head = COLS.map(c => c[1]);
  const all = [head].concat(rows);
  const range = sh.getRange(1, 1, all.length, head.length);
  range.setNumberFormat("@"); // 010…, 2026-10-12, 03-15 가 숫자·날짜로 바뀌지 않게
  range.setValues(all.map(r => r.map(v => typeof v === "boolean" ? String(v) : v)));
  BOOL_FIELDS.forEach(k => {
    const c = COLS.findIndex(x => x[0] === k) + 1;
    if (rows.length) {
      const r = sh.getRange(2, c, rows.length, 1);
      r.setNumberFormat("General").setValues(rows.map(x => [x[c - 1] === true])).insertCheckboxes();
    }
  });
  if (sh.getName() === SHEET) dress_(sh, all.length, head.length);
  else sh.getRange(1, 1, 1, head.length).setFontWeight("bold");
}
// 보기 좋게: 칸 너비, 제목 줄 색, 줄무늬, 필터. 값은 건드리지 않아 저장 비교에는 영향 없다.
const WIDTH = { id: 60, name: 80, role: 60, group: 60, gender: 45, phone: 115, regDate: 95, birthSolar: 95, birthLunar: 95,
  anniversary: 95, district: 70, baptism: 95, household: 60, relation: 70, isLeader: 60, longAbsent: 55, memo: 220, noTrack: 60, extra: 60 };
const CENTER = ["id", "role", "group", "gender", "phone", "regDate", "birthSolar", "birthLunar", "anniversary", "district", "baptism", "household", "relation", "isLeader", "longAbsent", "noTrack", "extra"];
function dress_(sh, nRows, nCols) {
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getBandings().forEach(b => b.remove());
  const all = sh.getRange(1, 1, nRows, nCols);
  all.setFontFamily("Malgun Gothic").setFontSize(10).setVerticalAlignment("middle")
    .setBorder(true, true, true, true, true, true, "#d9dee8", SpreadsheetApp.BorderStyle.SOLID);
  all.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor("#3b5bdb").setFirstRowColor("#ffffff").setSecondRowColor("#f4f6fb");
  sh.getRange(1, 1, 1, nCols).setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center").setWrap(true);
  // 칸 너비·줄 높이는 한 번도 안 건드린 기본값(너비 100, 높이 21)일 때만 맞춤. 손으로 조정한 크기는 그대로 둔다
  if (sh.getRowHeight(1) === 21) sh.setRowHeight(1, 34);
  if (nRows > 1 && sh.getRowHeight(2) === 21) sh.setRowHeights(2, nRows - 1, 24);
  COLS.forEach(([k], i) => {
    if (sh.getColumnWidth(i + 1) === 100) sh.setColumnWidth(i + 1, WIDTH[k] || 90);
    if (nRows < 2) return;
    const body = sh.getRange(2, i + 1, nRows - 1, 1);
    if (CENTER.indexOf(k) >= 0) body.setHorizontalAlignment("center");
    if (k === "id" || k === "household") body.setFontColor("#8a94a6").setFontSize(9);
    if (k === "name") body.setFontWeight("bold");
    if (k === "memo") body.setWrap(false);
  });
  all.createFilter();
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
}
function readTable_(sh) {
  const v = sh.getDataRange().getDisplayValues();
  if (v.length < 1) return [];
  const head = v[0], idx = COLS.map(([, h]) => head.indexOf(h));
  if (idx[1] < 0) throw new Error("'" + sh.getName() + "' 탭에 '이름' 제목이 없어요.");
  return v.slice(1).filter(r => r.some(c => String(c).trim())).map(r => {
    const o = {};
    COLS.forEach(([k], i) => {
      if (idx[i] < 0) return;
      const s = String(r[idx[i]]).trim();
      o[k] = BOOL_FIELDS.indexOf(k) >= 0 ? /^(true|y|yes|o|1|예|✓|v)$/i.test(s) : DATE_FIELDS.indexOf(k) >= 0 ? normDate_(s) : s;
    });
    return o;
  });
}
function normDate_(v) {
  const m = String(v || "").match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  return m ? m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2) : String(v || "");
}

// ---------- ① 불러오기 ----------
function pullMembers() {
  const ui = SpreadsheetApp.getUi();
  try {
    const ch = church_();
    const ss = SpreadsheetApp.getActive();
    const rows = memberRows_(ch);
    const sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET, 0);
    writeTable_(sh, rows);
    const snap = ss.getSheetByName(SNAP) || ss.insertSheet(SNAP);
    writeTable_(snap, rows);
    snap.hideSheet();
    sh.activate();
    ui.alert(ch.name + " 성도 " + rows.length + "명을 불러왔어요.\n고친 뒤 메뉴 '출석앱 → ② 시트 내용을 앱에 저장'을 누르세요.");
  } catch (e) { ui.alert("불러오지 못했어요.\n" + e.message); }
}

// ---------- ② 저장 ----------
// 시트 값과 '_불러온값'을 비교해 바뀐 칸만 고른다. 새 줄(성도ID 비었거나 처음 보는 ID)은 새 성도.
function diff_(rows, snapRows) {
  const before = {};
  snapRows.forEach(r => { if (r.id) before[r.id] = r; });
  // 새 성도 번호는 지금 있는 P번호 다음으로 (P185 → P186, P187…)
  let maxP = 0, w = 3;
  snapRows.concat(rows).forEach(r => { const m = /^P(\d+)$/.exec(r.id || ""); if (m) { maxP = Math.max(maxP, +m[1]); w = Math.max(w, m[1].length); } });
  const changes = [];
  rows.forEach((r, i) => {
    if (!r.name) return;
    const old = r.id ? before[r.id] : null;
    const fields = {};
    COLS.forEach(([k]) => {
      if (k === "id" || !(k in r)) return;
      const v = r[k];
      const was = old ? (k in old ? old[k] : (BOOL_FIELDS.indexOf(k) >= 0 ? false : "")) : undefined;
      if (!old ? (v !== "" && v !== false) : v !== was) fields[k] = v;
    });
    if (!old && !r.id) r.id = "P" + String(++maxP).padStart(w, "0");
    if (Object.keys(fields).length) changes.push({ id: r.id.replace(/[\/.#$\[\]]/g, "-"), isNew: !old, name: r.name, fields: fields });
  });
  return changes;
}
function pushMembers() {
  const ui = SpreadsheetApp.getUi();
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(SHEET), snap = ss.getSheetByName(SNAP);
    if (!sh || !snap) throw new Error("먼저 '① 앱에서 성도 불러오기'를 눌러 주세요.");
    const ch = church_();
    // 저장은 교역자(담임목사 포함)만. 리더로만 들어 있으면 미리 알려 줌 (관리자는 config/admins를 읽을 수 있음)
    if (ch.staff.indexOf(me_()) < 0) {
      let admin = false; try { api_("get", BASE + "/config/admins"); admin = true; } catch (e) {}
      if (!admin) throw new Error(me_() + " 계정이 앱에서 '" + ch.name + "'에 " + (ch.leaders.indexOf(me_()) >= 0 ? "리더로만 등록돼 있어요." : "교역자로 등록돼 있지 않아요.") + "\n앱 '관리 → 교회'에서 이 이메일을 담임목사나 교역자 칸에 넣고 '저장'을 눌러 주세요.");
    }
    const changes = diff_(readTable_(sh), readTable_(snap));
    if (!changes.length) return ui.alert("바뀐 칸이 없어요.");
    const added = changes.filter(c => c.isNew).length;
    const preview = changes.slice(0, 15).map(c => (c.isNew ? "＋ " : "· ") + c.name + ": " + Object.keys(c.fields).map(k => COLS.find(x => x[0] === k)[1]).join(", ")).join("\n");
    const ok = ui.alert(ch.name + " 앱에 저장할까요?",
      "고친 성도 " + (changes.length - added) + "명, 새 성도 " + added + "명\n\n" + preview + (changes.length > 15 ? "\n… 외 " + (changes.length - 15) + "명" : ""),
      ui.ButtonSet.OK_CANCEL);
    if (ok !== ui.Button.OK) return;
    for (let i = 0; i < changes.length; i += 200) {
      const doc = (sub, id) => "projects/" + PROJECT + "/databases/(default)/documents/churches/" + ch.id + "/" + sub + "/" + id;
      const writes = [];
      changes.slice(i, i + 200).forEach(c => {
        const fields = {};
        Object.keys(c.fields).forEach(k => { if (PRIVATE.indexOf(k) < 0) fields[k] = toValue_(k, c.fields[k]); });
        if (Object.keys(fields).length) writes.push({ update: { name: doc("members", c.id), fields: fields }, updateMask: { fieldPaths: Object.keys(fields) } });
        // 연락처·메모는 contacts 문서로. 빈 값이면 마스크에만 넣어 그 칸을 지움
        const pk = PRIVATE.filter(k => k in c.fields), pf = {};
        pk.forEach(k => { if (c.fields[k]) pf[k] = { stringValue: String(c.fields[k]) }; });
        if (pk.length) writes.push({ update: { name: doc("contacts", c.id), fields: pf }, updateMask: { fieldPaths: pk } });
      });
      api_("post", BASE + ":commit", { writes: writes });
    }
    pullMembers_quiet_(ch);
    ui.alert("저장했어요. 고친 " + (changes.length - added) + "명, 새로 넣은 " + added + "명.\n앱에 바로 보여요.");
  } catch (e) { ui.alert("저장하지 못했어요. 시트 내용은 그대로예요.\n" + e.message); }
}
// ---------- ③ 자동 반영 ----------
// 시트를 열거나 새로고침할 때, 그리고 10분마다 앱 내용을 시트로 새로 받는다. 시트에 아직 앱에 저장 안 한 칸이 있으면 덮어쓰지 않고 건너뛴다.
function autoOn() {
  autoOff_();
  ScriptApp.newTrigger("autoPull").timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger("autoPull").forSpreadsheet(SpreadsheetApp.getActive()).onOpen().create();
  autoPull();
  SpreadsheetApp.getUi().alert("켰어요. 시트를 열거나 새로고침하면, 그리고 10분마다 앱에서 바꾼 내용이 시트에 들어와요.\n시트에서 고치고 아직 ② 저장을 안 했으면, 그동안은 덮어쓰지 않고 기다려요.");
}
function autoOff() { autoOff_(); SpreadsheetApp.getUi().alert("자동 반영을 껐어요."); }
function autoOff_() { ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "autoPull").forEach(t => ScriptApp.deleteTrigger(t)); }
function autoPull() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET), snap = ss.getSheetByName(SNAP);
  const note = (t) => { const s = ss.getSheetByName(SETUP); if (s) s.getRange("A2:B2").setValues([["자동 반영", t]]); };
  const now = Utilities.formatDate(new Date(), "Asia/Seoul", "M/d HH:mm");
  if (sh && snap && diff_(readTable_(sh), readTable_(snap)).length) return note(now + " 건너뜀: 시트에 저장 안 한 칸이 있어요 (② 저장 필요)");
  pullMembers_quiet_(church_());
  note(now + " 앱 내용으로 새로 받음");
}

function pullMembers_quiet_(ch) {
  const ss = SpreadsheetApp.getActive();
  const rows = memberRows_(ch);
  writeTable_(ss.getSheetByName(SHEET) || ss.insertSheet(SHEET, 0), rows);
  const snap = ss.getSheetByName(SNAP) || ss.insertSheet(SNAP);
  writeTable_(snap, rows);
  snap.hideSheet();
}
