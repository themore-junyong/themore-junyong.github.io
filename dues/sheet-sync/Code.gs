// 도와줄래 회비 앱 ↔ 구글 시트 연동 (Apps Script)
// 시트 메뉴 '회비앱' → ① 앱에서 불러오기 ② 시트 내용을 앱에 저장 ③ 1시간마다 자동으로 받기
// 앱이 원본이다.
//  - 회원: 시트에서 고친 칸만 앱에 저장 (숨은 탭 '_불러온값'과 비교). 새 줄은 새 회원
//  - 납부내역·장부: 납부ID·장부ID가 빈 새 줄만 앱에 추가. 이미 있는 줄을 고치거나 지우는 건 앱에서 (돈 기록은 수정 기록이 남아야 해서)
//  - 미납현황·월별요약·수정기록: 앱 내용을 보여 주기만 함
// 앱처럼 회원의 낸 달 목록과 장부 합계(stats/totals)를 같은 커밋에서 함께 올리고, 수정 기록도 남긴다.

const PROJECT = "themore-attendance";
const ROOT = "projects/" + PROJECT + "/databases/(default)/documents";
const BASE = "https://firestore.googleapis.com/v1/" + ROOT;
const SETUP = "설정", T_MEM = "회원", T_PAY = "납부내역", T_LED = "장부", T_DUE = "미납현황", T_SUM = "월별요약", T_LOG = "수정기록", SNAP = "_불러온값";

// 앱 index.html 의 MEM_COLS / PAY_COLS 와 같은 제목
const MEM_COLS = [["id", "회원ID"], ["name", "이름"], ["gender", "성별"], ["birth", "생년월일"], ["phone", "연락처"], ["joined", "가입일자"],
  ["vid1365", "1365ID"], ["interest", "관심과목"], ["region", "지역"], ["faith", "신앙여부"], ["status", "회원상태"], ["fee", "월회비"], ["memo", "메모"], ["leftDate", "탈퇴일"]];
const PAY_COLS = [["id", "납부ID"], ["memberId", "회원ID"], ["name", "이름"], ["month", "납부월"], ["amount", "금액"], ["paidDate", "납부일"], ["method", "방법"], ["memo", "메모"], ["by", "입력한사람"]];
const LED_COLS = [["id", "장부ID"], ["date", "날짜"], ["kind", "구분"], ["amount", "금액"], ["category", "항목"], ["memo", "내용"], ["receipts", "영수증"], ["by", "입력한사람"]];
const DATE_FIELDS = ["joined", "leftDate", "birth", "paidDate", "date"];

function onOpen() {
  SpreadsheetApp.getUi().createMenu("회비앱")
    .addItem("① 앱에서 불러오기", "pullAll")
    .addItem("② 시트 내용을 앱에 저장", "pushAll")
    .addSeparator()
    .addItem("③ 앱 변경 자동 반영 켜기 (1시간마다)", "autoOn")
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
function getDoc_(path) {
  try { return api_("get", BASE + "/" + path); } catch (e) { if (/ 404/.test(e.message)) return null; throw e; }
}
function val_(v) {
  if (!v) return "";
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(val_);
  if ("mapValue" in v) { const o = {}; const f = v.mapValue.fields || {}; Object.keys(f).forEach(k => { o[k] = val_(f[k]); }); return o; }
  return "";
}
function fields_(d) { const o = {}; const f = (d && d.fields) || {}; Object.keys(f).forEach(k => { o[k] = val_(f[k]); }); o.id = d ? d.name.split("/").pop() : ""; return o; }
function enc_(v) {
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc_) } };
  return { stringValue: String(v == null ? "" : v) };
}
function encAll_(o) { const f = {}; Object.keys(o).forEach(k => { f[k] = enc_(o[k]); }); return f; }
const toNum_ = (v) => Number(String(v == null ? "" : v).replace(/[^\d.-]/g, "")) || 0;
const me_ = () => String(Session.getEffectiveUser().getEmail() || "시트").toLowerCase();
const stamp_ = () => Utilities.formatDate(new Date(), "Asia/Seoul", "yyMMddHHmmss");
const today_ = () => Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
const won_ = (n) => Number(n || 0).toLocaleString("ko-KR");

// 쓰기 묶음: 저장할 문서 + 수정 기록 + 회원 낸 달 + 장부 합계를 한 번에 (최대 400개씩)
function commit_(writes) {
  for (let i = 0; i < writes.length; i += 400) api_("post", BASE + ":commit", { writes: writes.slice(i, i + 400) });
}
function wSet_(path, obj) { return { update: { name: ROOT + "/" + path, fields: encAll_(obj) } }; }
function wPatch_(path, obj) { return { update: { name: ROOT + "/" + path, fields: encAll_(obj) }, updateMask: { fieldPaths: Object.keys(obj).map(k => "`" + k + "`") } }; }
function wStamp_(path, obj) { // 저장하면서 at = 서버 시각
  const w = wSet_(path, obj); w.updateTransforms = [{ fieldPath: "at", setToServerValue: "REQUEST_TIME" }]; return w;
}
function wBump_(gid, ym, k, n) {
  return { transform: { document: ROOT + "/dues/" + gid + "/stats/totals", fieldTransforms: [{ fieldPath: "months.`" + ym + "`." + k, increment: { integerValue: String(n) } }] } };
}
function wPaid_(gid, mid, ym) {
  return { transform: { document: ROOT + "/dues/" + gid + "/members/" + mid, fieldTransforms: [{ fieldPath: "paid", appendMissingElements: { values: [{ stringValue: ym }] } }] } };
}
function wLog_(gid, action, detail) {
  return wStamp_("dues/" + gid + "/log/S" + stamp_() + Math.random().toString(36).slice(2, 8), { by: me_(), action: action, detail: String(detail).slice(0, 500) });
}

// ---------- 단체 찾기 ----------
function group_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SETUP);
  if (!sh) {
    sh = ss.insertSheet(SETUP);
    sh.getRange("A1:B1").setValues([["단체 이름", ""]]);
    sh.getRange("A4").setValue("B1 칸에 회비 앱에 등록한 단체 이름을 그대로 적고, 메뉴 '회비앱 → ① 앱에서 불러오기'를 누르세요.");
  }
  const name = String(sh.getRange("B1").getValue()).trim();
  if (!name) throw new Error("'설정' 탭 B1 칸에 단체 이름(예: 도와줄래)을 적어 주세요.");
  const found = listDocs_("dues").map(fields_).filter(g => g.name === name);
  if (!found.length) throw new Error("회비 앱에서 '" + name + "' 단체를 찾지 못했어요. 이름이 앱과 똑같은지 확인해 주세요.");
  return found[0];
}

// ---------- 달 계산 (앱과 같은 규칙) ----------
function normDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, "Asia/Seoul", "yyyy-MM-dd");
  const m = String(v || "").match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  return m ? m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2) : String(v || "").trim();
}
function normMonth_(v) {
  const m = String(v || "").match(/(\d{4})\s*[-./년]\s*(\d{1,2})/);
  return m ? m[1] + "-" + ("0" + m[2]).slice(-2) : "";
}
function addMonth_(ym, n) { const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; const d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 7); }
function range_(a, b) { const out = []; for (let m = a; m <= b && out.length < 600; m = addMonth_(m, 1)) out.push(m); return out; }
const lastMonth_ = () => addMonth_(today_().slice(0, 7), -1);
function dueMonths_(m, g) {
  if ((m.status || "유지") !== "유지") return [];
  const start = g.startMonth || "2026-01";
  const from = [normMonth_(m.joined) || start, start].sort().pop();
  const paid = {}; (m.paid || []).forEach(x => { paid[x] = 1; });
  return range_(from, lastMonth_()).filter(x => !paid[x]);
}
function monthsText_(list) {
  const by = {}; list.forEach(ym => { (by[ym.slice(0, 4)] = by[ym.slice(0, 4)] || []).push(+ym.slice(5)); });
  return Object.keys(by).map(y => y + "년 " + by[y].join("·") + "월").join(", ");
}

// ---------- 시트 읽기·쓰기 ----------
// 예전 앱시트 시트처럼: 진한 초록 제목줄 + 흰 굵은 글씨, 줄무늬, 테두리, 드롭다운과 값별 색
const HEAD_BG = "#356856", BAND = "#F2F7F4", GRID = "#D5DDDC";
const CHIPS = {
  gender: { "남성": ["#DDF0D5", "#2E6B1F"], "여성": ["#DCEBFA", "#1F5FA8"] },
  status: { "유지": ["#E6DDF8", "#5B3FA0"], "탈퇴": ["#E3E7EC", "#5B6A72"] },
  kind: { "입금": ["#DDF0D5", "#2E6B1F"], "지출": ["#FBE3E1", "#B3261E"] },
  method: { "계좌이체": ["#E1EEEE", "#1F6F78"], "현금": ["#FBEEDC", "#A15C07"] },
};
function writeTable_(sh, cols, rows, opt) {
  opt = opt || {};
  const n = cols.length, extra = opt.plain ? 0 : 50; // 새 줄을 적을 아래 50줄도 같은 모양
  sh.clear();
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
  sh.getBandings().forEach(b => b.remove());
  sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  const head = cols.map(c => c[1]);
  const all = [head].concat(rows.map(r => cols.map(([k]) => r[k] == null ? "" : r[k])));
  if (sh.getMaxRows() < all.length + extra) sh.insertRowsAfter(sh.getMaxRows(), all.length + extra - sh.getMaxRows());
  const range = sh.getRange(1, 1, all.length, n);
  range.setNumberFormat("@"); // 010…, 2026-10, 2026-10-12 가 숫자·날짜로 바뀌지 않게
  range.setValues(all.map(r => r.map(v => typeof v === "number" ? v : String(v))));
  if (extra) sh.getRange(all.length + 1, 1, extra, n).setNumberFormat("@");
  cols.forEach(([k], i) => { if (opt.numbers && opt.numbers.indexOf(k) >= 0) sh.getRange(2, i + 1, rows.length + extra || 1, 1).setNumberFormat("#,##0").setHorizontalAlignment("right"); });
  sh.setFrozenRows(1);
  if (opt.lock && rows.length) { // 이미 앱에 있는 줄은 고치면 경고 (새 줄은 아래에 자유롭게)
    sh.getRange(2, 1, rows.length, n).protect().setDescription(opt.lock).setWarningOnly(true);
  }
  if (opt.plain) return;

  const body = sh.getRange(1, 1, all.length + extra, n);
  body.applyRowBanding(SpreadsheetApp.BandingTheme.GREEN, true, false)
    .setHeaderRowColor(HEAD_BG).setFirstRowColor("#FFFFFF").setSecondRowColor(BAND);
  body.setBorder(true, true, true, true, true, true, GRID, SpreadsheetApp.BorderStyle.SOLID).setVerticalAlignment("middle").setFontSize(10);
  sh.getRange(1, 1, 1, n).setFontWeight("bold").setFontColor("#FFFFFF").setHorizontalAlignment("center");
  sh.setRowHeights(1, all.length + extra, 28);
  if (opt.freezeCols) sh.setFrozenColumns(opt.freezeCols);

  // 드롭다운 + 값별 색 (성별·회원상태·구분·방법)
  const rules = [];
  cols.forEach(([k], i) => {
    const chip = CHIPS[k]; if (!chip || opt.readOnly) return;
    const col = sh.getRange(2, i + 1, all.length - 1 + extra, 1);
    col.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(chip), true).setAllowInvalid(true).build()).setHorizontalAlignment("center");
    Object.keys(chip).forEach(v => rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(v).setBackground(chip[v][0]).setFontColor(chip[v][1]).setRanges([col]).build()));
  });
  (opt.rules || []).forEach(f => rules.push(f(sh, all.length - 1 + extra)));
  if (rules.length) sh.setConditionalFormatRules(rules);

  sh.autoResizeColumns(1, n);
  cols.forEach(([k], i) => { const w = sh.getColumnWidth(i + 1) + 16; sh.setColumnWidth(i + 1, Math.max(k === "id" ? 80 : 70, Math.min(w, k === "memo" || k === "detail" || k === "months" ? 320 : 200))); });
  if (opt.note) sh.getRange(1, n + 2).setValue(opt.note).setFontColor("#5B6A72").setFontSize(10);
}
// 탈퇴 회원 줄은 흐리게, 3개월 이상 미납은 주황
function inactiveRow_(sh, rows) {
  const c = String.fromCharCode(64 + MEM_COLS.findIndex(x => x[0] === "status") + 1);
  return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=$" + c + "2=\"탈퇴\"").setFontColor("#9AA5AB").setRanges([sh.getRange(2, 1, rows, MEM_COLS.length)]).build();
}
function manyDue_(sh, rows) {
  return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=$D2>=3").setBackground("#FBEEDC").setFontColor("#A15C07").setRanges([sh.getRange(2, 1, rows, 7)]).build();
}
function readTable_(sh, cols) {
  if (!sh) return [];
  const v = sh.getDataRange().getDisplayValues();
  if (v.length < 1) return [];
  const head = v[0].map(h => String(h).replace(/\s/g, "")), idx = cols.map(([, h]) => head.indexOf(h));
  return v.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    cols.forEach(([k], j) => {
      if (idx[j] < 0) return;
      const s = String(r[idx[j]]).trim();
      o[k] = DATE_FIELDS.indexOf(k) >= 0 ? normDate_(s) : s;
    });
    return o;
  }).filter(o => cols.some(([k]) => o[k]));
}
function sheet_(name, index) { const ss = SpreadsheetApp.getActive(); return ss.getSheetByName(name) || ss.insertSheet(name, index); }

// ---------- ① 불러오기 ----------
function load_(g) {
  const base = "dues/" + g.id;
  const members = listDocs_(base + "/members").map(fields_).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const payments = listDocs_(base + "/payments").map(fields_).sort((a, b) => String(a.paidDate).localeCompare(String(b.paidDate)) || String(a.id).localeCompare(String(b.id)));
  const ledger = listDocs_(base + "/ledger").map(fields_).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const totals = fields_(getDoc_(base + "/stats/totals")).months || {};
  const logs = api_("post", BASE + "/" + base + ":runQuery", { structuredQuery: { from: [{ collectionId: "log" }], orderBy: [{ field: { fieldPath: "at" }, direction: "DESCENDING" }], limit: 500 } })
    .filter(r => r.document).map(r => fields_(r.document));
  return { members: members, payments: payments, ledger: ledger, totals: totals, logs: logs };
}
function writeAll_(g, d) {
  const ss = SpreadsheetApp.getActive();
  const memRows = d.members.map(m => { const o = {}; MEM_COLS.forEach(([k]) => { o[k] = m[k] == null ? "" : m[k]; }); return o; });
  writeTable_(sheet_(T_MEM, 0), MEM_COLS, memRows, { numbers: ["fee"], freezeCols: 2, rules: [inactiveRow_], note: "고친 칸·새 줄은 메뉴 ② 저장으로 앱에 들어가요. 회원ID 칸은 비워 두면 새 회원이에요." });
  const snap = sheet_(SNAP); writeTable_(snap, MEM_COLS, memRows, { plain: true }); snap.hideSheet();

  writeTable_(sheet_(T_PAY, 1), PAY_COLS, d.payments, { numbers: ["amount"], freezeCols: 3, lock: "이미 앱에 있는 납부 기록 (고치거나 지울 때는 앱에서)",
    note: "새 납부는 맨 아래 줄에 납부ID를 비우고 회원ID(또는 이름)·납부월(2026-10)·금액을 적은 뒤 ② 저장. 납부일·방법은 비우면 오늘·계좌이체." });

  const ledRows = d.ledger.map(e => ({ id: e.id, date: e.date, kind: e.kind === "in" ? "입금" : "지출", amount: e.amount, category: e.category, memo: e.memo, receipts: (e.receipts || []).length ? (e.receipts || []).length + "장" : "", by: e.by }));
  writeTable_(sheet_(T_LED, 2), LED_COLS, ledRows, { numbers: ["amount"], freezeCols: 2, lock: "이미 앱에 있는 장부 (고치거나 지울 때는 앱에서)",
    note: "회비 아닌 입금·지출만 적어요. 새 줄은 장부ID를 비우고 날짜·구분(입금/지출)·금액·항목을 적은 뒤 ② 저장. 영수증 사진은 앱에서 붙여요." });

  const due = d.members.map(m => ({ m: m, due: dueMonths_(m, g) })).filter(x => x.due.length)
    .sort((a, b) => b.due.length - a.due.length || String(a.m.name).localeCompare(String(b.m.name), "ko"));
  const fee = (m) => toNum_(m.fee) || toNum_(g.fee) || 5000;
  const DUE_COLS = [["id", "회원ID"], ["name", "이름"], ["phone", "연락처"], ["n", "미납개월"], ["months", "미납월"], ["amount", "미납금액"], ["notice", "마지막안내"]];
  writeTable_(sheet_(T_DUE, 3), DUE_COLS, due.map(x => ({ id: x.m.id, name: x.m.name, phone: x.m.phone, n: x.due.length, months: monthsText_(x.due), amount: x.due.length * fee(x.m), notice: x.m.lastNotice || "" })),
    { numbers: ["n", "amount"], freezeCols: 2, rules: [manyDue_], note: lastMonth_() + "까지 · 활동 회원만 · " + due.length + "명 " + won_(due.reduce((s, x) => s + x.due.length * fee(x.m), 0)) + "원 (보기 전용)" });

  const keys = Object.keys(d.totals).sort();
  const open = g.openingMonth || keys[0] || today_().slice(0, 7);
  let bal = toNum_(g.openingBalance);
  const SUM_COLS = [["ym", "월"], ["dues", "회비"], ["inn", "기타입금"], ["out", "지출"], ["bal", "월말잔액"]];
  const sumRows = range_(open, [today_().slice(0, 7), keys[keys.length - 1] || ""].sort().pop()).map(ym => {
    const o = d.totals[ym] || {}; bal += toNum_(o.dues) + toNum_(o.inn) - toNum_(o.out);
    return { ym: ym, dues: toNum_(o.dues), inn: toNum_(o.inn), out: toNum_(o.out), bal: g.openingMonth ? bal : "" };
  }).reverse();
  writeTable_(sheet_(T_SUM, 4), SUM_COLS, sumRows, { numbers: ["dues", "inn", "out", "bal"], freezeCols: 1, note: g.openingMonth ? g.openingMonth + " 시작 잔액 " + won_(g.openingBalance) + "원 기준 (보기 전용)" : "앱 관리에서 장부 시작 잔액을 넣으면 잔액도 보여요." });

  const LOG_COLS = [["at", "시각"], ["by", "누가"], ["action", "무엇을"], ["detail", "내용"]];
  writeTable_(sheet_(T_LOG, 5), LOG_COLS, d.logs.map(x => ({ at: x.at instanceof Date ? Utilities.formatDate(x.at, "Asia/Seoul", "yyyy-MM-dd HH:mm") : "", by: x.by, action: x.action, detail: x.detail })),
    { note: "최근 500건 (보기 전용)" });
  return { members: d.members.length, payments: d.payments.length, ledger: d.ledger.length, due: due.length };
}
function pullAll() {
  const ui = SpreadsheetApp.getUi();
  try {
    const g = group_(), r = writeAll_(g, load_(g));
    note_("마지막으로 받은 때", Utilities.formatDate(new Date(), "Asia/Seoul", "M/d HH:mm"));
    SpreadsheetApp.getActive().getSheetByName(T_MEM).activate();
    ui.alert(g.name + " 불러왔어요.\n회원 " + r.members + "명 · 납부 " + r.payments + "건 · 장부 " + r.ledger + "건 · 미납 " + r.due + "명\n\n" +
      "회원 칸을 고치거나, 납부내역·장부 맨 아래에 새 줄을 적은 뒤 메뉴 '회비앱 → ② 시트 내용을 앱에 저장'을 누르세요.");
  } catch (e) { ui.alert("불러오지 못했어요.\n" + e.message); }
}
function note_(label, text) {
  const s = SpreadsheetApp.getActive().getSheetByName(SETUP);
  if (!s) return;
  const row = label === "자동 반영" ? 2 : 3;
  s.getRange(row, 1, 1, 2).setValues([[label, text]]);
}

// ---------- ② 저장 ----------
function memberChanges_(rows, snapRows, members) {
  const before = {}; snapRows.forEach(r => { if (r.id) before[r.id] = r; });
  const ids = members.map(m => m.id);
  let next = ids.reduce((mx, id) => { const n = /^M\d+$/.test(id) ? +id.slice(1) : 0; return n > mx ? n : mx; }, 0);
  const out = [];
  rows.forEach(r => {
    if (!r.name) return;
    const old = r.id ? before[r.id] : null;
    const f = {};
    MEM_COLS.forEach(([k]) => {
      if (k === "id" || !(k in r)) return;
      const was = old ? String(old[k] == null ? "" : old[k]) : "";
      const same = k === "fee" ? toNum_(r[k]) === toNum_(was) : r[k] === was;
      if (old ? !same : r[k] !== "") f[k] = k === "fee" ? (toNum_(r[k]) || "") : k === "status" ? (r[k] === "탈퇴" ? "탈퇴" : "유지") : r[k];
    });
    if (!old) {
      if (!r.id || ids.indexOf(r.id) >= 0 && !before[r.id]) r.id = "M" + ("00" + (++next)).slice(-3);
      if (!f.status) f.status = "유지";
      f.paid = [];
    }
    if (f.status === "탈퇴" && !r.leftDate && !(old && old.leftDate)) f.leftDate = today_();
    if (Object.keys(f).length) out.push({ id: r.id.replace(/[\/.#$\[\]]/g, "-"), isNew: !old, name: r.name, fields: f, was: old });
  });
  return out;
}
function newPayments_(rows, members, g, errs) {
  const byId = {}, byName = {};
  members.forEach(m => { byId[m.id] = m; (byName[m.name] = byName[m.name] || []).push(m); });
  const st = stamp_();
  return rows.filter(r => !r.id).map((r, k) => {
    const m = r.memberId ? byId[r.memberId] : (byName[r.name] || []).length === 1 ? byName[r.name][0] : null;
    const month = normMonth_(r.month);
    if (!m) { errs.push(r._row + "줄: 회원을 못 찾음 (" + (r.memberId || r.name || "빈칸") + ")"); return null; }
    if (!month) { errs.push(r._row + "줄: 납부월을 못 읽음 (" + r.month + ")"); return null; }
    const amount = toNum_(r.amount) || toNum_(m.fee) || toNum_(g.fee) || 5000;
    return { id: "S" + st + "_" + m.id + "_" + k, memberId: m.id, name: m.name, month: month, amount: amount, paidDate: r.paidDate || today_(), method: r.method || "계좌이체", memo: r.memo || "" };
  }).filter(Boolean);
}
function newLedger_(rows, errs) {
  const st = stamp_();
  return rows.filter(r => !r.id).map((r, k) => {
    const amount = toNum_(r.amount);
    if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) { errs.push(r._row + "줄: 날짜를 못 읽음 (" + r.date + ")"); return null; }
    if (!amount) { errs.push(r._row + "줄: 금액이 없음"); return null; }
    const kind = /입|in|수입/.test(r.kind) ? "in" : "out";
    return { id: "S" + st + "_" + k, date: r.date, kind: kind, amount: amount, category: r.category || "기타", memo: r.memo || "" };
  }).filter(Boolean);
}
function plan_(g) {
  const ss = SpreadsheetApp.getActive();
  const memSh = ss.getSheetByName(T_MEM), snap = ss.getSheetByName(SNAP);
  if (!memSh || !snap) throw new Error("먼저 '① 앱에서 불러오기'를 눌러 주세요.");
  const members = listDocs_("dues/" + g.id + "/members").map(fields_);
  const errs = [];
  const mem = memberChanges_(readTable_(memSh, MEM_COLS), readTable_(snap, MEM_COLS), members);
  const all = members.concat(mem.filter(c => c.isNew).map(c => ({ id: c.id, name: c.name, fee: c.fields.fee })));
  const pays = newPayments_(readTable_(ss.getSheetByName(T_PAY), PAY_COLS), all, g, errs);
  const leds = newLedger_(readTable_(ss.getSheetByName(T_LED), LED_COLS), errs);
  return { mem: mem, pays: pays, leds: leds, errs: errs };
}
function pushAll() {
  const ui = SpreadsheetApp.getUi();
  try {
    const g = group_(), p = plan_(g);
    if (!p.mem.length && !p.pays.length && !p.leds.length) return ui.alert(p.errs.length ? "저장할 수 있는 줄이 없어요.\n\n" + p.errs.join("\n") : "바뀐 칸이나 새 줄이 없어요.");
    const added = p.mem.filter(c => c.isNew).length;
    const lines = [];
    if (p.mem.length) lines.push("회원: 고침 " + (p.mem.length - added) + "명, 새 회원 " + added + "명", ...p.mem.slice(0, 8).map(c => "  " + (c.isNew ? "＋ " : "· ") + c.name + ": " + Object.keys(c.fields).filter(k => k !== "paid").map(k => MEM_COLS.find(x => x[0] === k)[1]).join(", ")));
    if (p.pays.length) lines.push("새 납부 " + p.pays.length + "건 · " + won_(p.pays.reduce((s, x) => s + x.amount, 0)) + "원", ...p.pays.slice(0, 8).map(x => "  ＋ " + x.name + " " + x.month + " " + won_(x.amount) + "원"));
    if (p.leds.length) lines.push("새 장부 " + p.leds.length + "건", ...p.leds.slice(0, 8).map(x => "  ＋ " + x.date + " " + (x.kind === "in" ? "입금" : "지출") + " " + x.category + " " + won_(x.amount) + "원"));
    if (p.errs.length) lines.push("", "저장 안 하는 줄 " + p.errs.length + "개:", ...p.errs.slice(0, 8));
    if (ui.alert(g.name + " 앱에 저장할까요?", lines.join("\n"), ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

    const base = "dues/" + g.id, me = me_(), W = [];
    p.mem.forEach(c => {
      W.push(wPatch_(base + "/members/" + c.id, c.fields));
      W.push(wLog_(g.id, c.isNew ? "회원 추가" : "회원 수정", c.name + (c.isNew ? " (" + c.id + ") · 시트" : ": " + Object.keys(c.fields).map(k => (MEM_COLS.find(x => x[0] === k) || [k, k])[1] + " " + (c.was[k] || "(빈칸)") + "→" + (c.fields[k] || "(빈칸)")).join(", ") + " · 시트")));
    });
    p.pays.forEach(x => {
      W.push(wStamp_(base + "/payments/" + x.id, Object.assign({}, x, { id: undefined, by: me })));
      W.push(wPaid_(g.id, x.memberId, x.month));
      W.push(wBump_(g.id, x.paidDate.slice(0, 7), "dues", x.amount));
    });
    if (p.pays.length) W.push(wLog_(g.id, "납부 추가", p.pays.map(x => x.name + " " + x.month).join(", ") + " · " + won_(p.pays.reduce((s, x) => s + x.amount, 0)) + "원 · 시트"));
    p.leds.forEach(x => {
      W.push(wStamp_(base + "/ledger/" + x.id, Object.assign({}, x, { id: undefined, by: me })));
      W.push(wBump_(g.id, x.date.slice(0, 7), x.kind === "in" ? "inn" : "out", x.amount));
      W.push(wLog_(g.id, "장부 추가", x.date + " " + (x.kind === "in" ? "입금" : "지출") + " " + x.category + " " + won_(x.amount) + "원" + (x.memo ? " · " + x.memo : "") + " · 시트"));
    });
    W.forEach(w => { if (w.update) delete w.update.fields.id; });
    commit_(W);
    writeAll_(g, load_(g));
    ui.alert("저장했어요. 앱에 바로 보여요." + (p.errs.length ? "\n저장 안 한 줄 " + p.errs.length + "개는 위 안내를 보고 고쳐 주세요 (시트를 새로 받아서 지워졌어요)." : ""));
  } catch (e) { ui.alert("저장하지 못했어요. 시트 내용은 그대로예요.\n" + e.message); }
}

// ---------- ③ 자동 반영 ----------
// 1시간마다 앱 내용을 시트로 새로 받는다. 시트에 아직 저장 안 한 칸·새 줄이 있으면 덮어쓰지 않고 건너뛴다.
function autoOn() {
  autoOff_();
  ScriptApp.newTrigger("autoPull").timeBased().everyHours(1).create();
  autoPull();
  SpreadsheetApp.getUi().alert("켰어요. 앱에서 바꾼 내용이 1시간마다 시트에 들어와요.\n시트에서 고치고 아직 ② 저장을 안 했으면, 그동안은 덮어쓰지 않고 기다려요.");
}
function autoOff() { autoOff_(); SpreadsheetApp.getUi().alert("자동 반영을 껐어요."); }
function autoOff_() { ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "autoPull").forEach(t => ScriptApp.deleteTrigger(t)); }
function autoPull() {
  const now = Utilities.formatDate(new Date(), "Asia/Seoul", "M/d HH:mm");
  const g = group_();
  const ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(SNAP)) {
    const p = plan_(g);
    if (p.mem.length || p.pays.length || p.leds.length || p.errs.length) return note_("자동 반영", now + " 건너뜀: 시트에 저장 안 한 칸이 있어요 (② 저장 필요)");
  }
  writeAll_(g, load_(g));
  note_("자동 반영", now + " 앱 내용으로 새로 받음");
}
