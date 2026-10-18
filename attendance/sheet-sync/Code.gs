// 교회 출석앱 ↔ 구글 시트 성도 연동 (Apps Script)
// 시트 메뉴 '출석앱' → ① 앱에서 성도 불러오기 ② 시트 내용을 앱에 저장
// 앱이 원본. 시트에서 바뀐 칸만 앱에 저장하고 사진·출석 기록은 건드리지 않는다.
// 처음 불러올 때 값을 숨은 탭 '_불러온값'에 보관해 두고, 그와 다른 칸만 '바뀐 칸'으로 본다.

const PROJECT = "themore-attendance";
const BASE = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents";
const SHEET = "성도", SNAP = "_불러온값", SETUP = "설정";

// 앱 index.html 의 COLS 와 같은 제목 (사진 칸 제외)
const COLS = [
  ["id", "성도ID"], ["name", "이름"], ["role", "직분"], ["group", "분류"], ["gender", "성별"], ["phone", "연락처"],
  ["regDate", "등록일"], ["birthSolar", "생일_양력"], ["birthLunar", "생일_음력"], ["anniversary", "결혼기념일"],
  ["district", "구역"], ["baptism", "세례일"], ["household", "세대ID"], ["relation", "가족관계"],
  ["isLeader", "리더여부"], ["longAbsent", "장결자"], ["memo", "메모"], ["noTrack", "추적제외"]
];
const BOOL_FIELDS = ["isLeader", "longAbsent", "noTrack"];
const DATE_FIELDS = ["regDate", "birthSolar", "anniversary", "baptism"];

function onOpen() {
  SpreadsheetApp.getUi().createMenu("출석앱")
    .addItem("① 앱에서 성도 불러오기", "pullMembers")
    .addItem("② 시트 내용을 앱에 저장", "pushMembers")
    .addSeparator()
    .addItem("③ 앱 변경 자동 반영 켜기 (열 때마다 + 10분마다)", "autoOn")
    .addItem("자동 반영 끄기", "autoOff")
    .addToUi();
}

// ---------- Firestore REST ----------
function api_(method, url, body) {
  const res = UrlFetchApp.fetch(url, {
    method: method, contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "x-goog-user-project": PROJECT },
    payload: body ? JSON.stringify(body) : undefined
  });
  const code = res.getResponseCode(), text = res.getContentText();
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
  const found = listDocs_("churches").filter(d => fromValue_((d.fields || {}).name) === name);
  if (!found.length) throw new Error("앱에서 '" + name + "' 교회를 찾지 못했어요. 이름이 앱과 똑같은지 확인해 주세요.");
  return { id: docId_(found[0]), name: name };
}

// ---------- 시트 읽기·쓰기 ----------
function rowsFromDocs_(docs) {
  const rows = docs.map(d => {
    const f = d.fields || {};
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
  sh.getRange(1, 1, 1, head.length).setFontWeight("bold").setBackground("#eef2ff");
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
    const rows = rowsFromDocs_(listDocs_("churches/" + ch.id + "/members"));
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
    const changes = diff_(readTable_(sh), readTable_(snap));
    if (!changes.length) return ui.alert("바뀐 칸이 없어요.");
    const added = changes.filter(c => c.isNew).length;
    const preview = changes.slice(0, 15).map(c => (c.isNew ? "＋ " : "· ") + c.name + ": " + Object.keys(c.fields).map(k => COLS.find(x => x[0] === k)[1]).join(", ")).join("\n");
    const ok = ui.alert(ch.name + " 앱에 저장할까요?",
      "고친 성도 " + (changes.length - added) + "명, 새 성도 " + added + "명\n\n" + preview + (changes.length > 15 ? "\n… 외 " + (changes.length - 15) + "명" : ""),
      ui.ButtonSet.OK_CANCEL);
    if (ok !== ui.Button.OK) return;
    for (let i = 0; i < changes.length; i += 400) {
      const writes = changes.slice(i, i + 400).map(c => {
        const fields = {};
        Object.keys(c.fields).forEach(k => { fields[k] = toValue_(k, c.fields[k]); });
        return {
          update: { name: "projects/" + PROJECT + "/databases/(default)/documents/churches/" + ch.id + "/members/" + c.id, fields: fields },
          updateMask: { fieldPaths: Object.keys(fields) }
        };
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
  const rows = rowsFromDocs_(listDocs_("churches/" + ch.id + "/members"));
  writeTable_(ss.getSheetByName(SHEET) || ss.insertSheet(SHEET, 0), rows);
  const snap = ss.getSheetByName(SNAP) || ss.insertSheet(SNAP);
  writeTable_(snap, rows);
  snap.hideSheet();
}
