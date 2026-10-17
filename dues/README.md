# 회비 관리 (Firebase)

봉사단체·NGO용 회비·장부 웹앱. 출석앱과 같은 Firebase 프로젝트(`themore-attendance`)를 함께 씀.

- `index.html` 화면 전체 (빌드 없음, Firebase JS SDK를 CDN에서 불러옴)
- `firebase-config.js` 출석앱과 같은 설정값
- 보안 규칙은 `../attendance/firestore.rules` 하나에 출석앱과 함께 있음 (Firestore 규칙은 프로젝트에 하나뿐)
- `?demo` 가짜 회원으로 미리보기 (저장 안 됨), `?demo&viewer` 보기 전용 화면, `?demo&empty` 빈 단체로 가져오기 시험

## 데이터 구조
- `dues/{단체}` `{ name, fee, startMonth, managers[], viewers[], account, smsTemplate, openingMonth, openingBalance }`
  - 지부가 늘면 단체 문서를 더 만들면 됨. 관리자(`config/admins`)는 모든 단체를 봄
- `dues/{단체}/members/{회원ID}` 회원 (시트 '회원' 탭과 같은 칸) + `paid: ["2026-01", …]` 낸 달 목록 + `lastNotice` 마지막 문자 안내일
- `dues/{단체}/payments/{납부ID}` `{ memberId, name, month, amount, paidDate, method, memo, by, at }`
- `dues/{단체}/ledger/{ID}` 회비 아닌 입금·지출 `{ date, kind: in|out, amount, category, memo, by, at }`
- `dues/{단체}/stats/totals` `{ months: { "2026-10": { dues, inn, out } } }` 장부 합계

## 규모를 키워도 버티게 한 점
- 미납은 회원 문서의 `paid`만 보고 계산 → 앱을 열 때 회원 수만큼만 읽음 (납부 기록 전체를 읽지 않음)
- 장부 잔액은 `stats/totals` 한 문서로 계산. 납부·장부를 쓸 때 같은 배치에서 합계를 올리고 내림
- 납부 기록·장부 내역은 고른 달만 불러옴
- 숫자가 어긋나면 관리 → 다시 계산 (전체 기록에서 `paid`와 합계를 새로 만듦)

## 미납 규칙 (앱시트 때 정한 그대로)
- 활동(유지) 회원만, 가입한 달부터(시작 달보다 앞이면 시작 달부터) 지난달까지
- 같은 달을 두 번 낸 기록은 한 번으로 셈. 탈퇴 회원은 세지 않음

## 통장 정리
- 거래내역을 붙여 넣으면 줄마다: 출금 → 장부 지출(항목 짐작), 이자 → 장부 입금, 회원 이름이 있는 입금 → 회비
- 회비 달: 적요의 달("9월", "7-10", "6,7월"), 없으면 안 낸 달부터 채움
- 명단에 없는 이름, 탈퇴 회원, 회비로 안 나눠지는 금액, 이미 낸 달, 금액과 달 수가 안 맞는 경우 → 확인 필요 (사람이 고름)
- 줄 내용으로 ID를 만들어서 같은 내역을 다시 붙여도 두 번 저장되지 않음
- 잔액 칸이 있으면 저장 뒤 장부 잔액과 비교. 시작 잔액이 없으면 첫 줄로 맞출지 물어봄
