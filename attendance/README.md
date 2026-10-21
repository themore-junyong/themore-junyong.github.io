# 교회 출석 (Firebase)

여러 교회가 함께 쓰는 출석 체크 웹앱. 앱은 하나, 교회별 데이터는 분리.

- `index.html` 화면 전체 (빌드 없음, Firebase JS SDK를 CDN에서 불러옴)
- `finance.html` 재정 (헌금·통장 정리·장부·보고서·성도별·기부금 영수증). 재정 담당만. `?demo` 미리보기
- `firebase-config.js` Firebase 웹 앱 설정값 (공개 값)
- `firestore.rules` 보안 규칙. Firebase 콘솔 → Firestore → 규칙에 붙여 넣고 게시
- `?demo` 를 붙이면 가짜 성도 9명으로 미리보기 (저장 안 됨)

## 데이터 구조
- `config/admins` `{ emails: [...] }` 관리자. 콘솔에서만 수정
- `churches/{교회}` `{ name, services: [...], leaders: [이메일...], staff: [...], pastors: [담임목사...], finance: [재정 담당 이메일...] }`
- `churches/{교회}/members/{성도ID}` 성도 (시트 '성도' 탭과 같은 칸, 연락처·메모 빼고)
- `churches/{교회}/contacts/{성도ID}` `{ phone, memo }` 연락처·메모. 담임목사·교역자·관리자만 읽음 (리더 폰에는 안 내려감). 예전 성도 문서의 연락처·메모는 교역자가 앱을 열면 자동으로 옮겨짐
- `churches/{교회}/attendance/{날짜_예배_성도ID}` `{ date, service, memberId, name, present, checkedBy, checkedAt }`
  - 문서 ID가 정해져 있어서 같은 사람이 같은 예배에 두 번 기록되지 않음

## 동작
- 출석 버튼은 누르는 즉시 화면에 반영되고 저장은 뒤에서 함 (Firestore 오프라인 캐시)
- 인터넷이 끊겨도 체크가 폰에 남았다가 연결되면 자동 저장
- 리더는 `leaders`에 이메일이 있는 교회만 보고 쓸 수 있음
- 출석한 사람은 목록에서 빠지고 아래에 '되돌리기'가 잠깐 뜸. '출석한 사람 보기'나 ✎ 정보 중에는 모두 보임
- 사진은 가운데를 잘라 112px JPEG로 줄여 성도 문서의 `thumb`에 저장 (장당 수 KB, Storage 불필요)
- 관리 → 사진 가져오기: 시트 '사진' 칸 파일 이름 → 성도ID → 이름 순으로 짝을 찾음
- 출석 화면 위 "이번 주 생일·기념일": 오늘부터 7일 안의 양력·음력 생일, 결혼기념일 (음력은 브라우저 음력 달력으로 계산)
- 통계 → 월별 생일·기념일: 달을 넘기며 양력·음력 생일, 결혼기념일, 세례일 보기
- 권한: 관리 화면의 "교역자 이메일"(staff)은 성도 추가·수정·삭제 가능, "리더 이메일"은 출석 체크와 정보 보기만. `?demo&leader`로 리더 화면 미리보기
- 관리 → 교회 삭제: 교회 이름을 똑같이 입력해야 지워짐. 성도·출석 기록까지 모두 삭제
- 구글 시트 연동 (`sheet-sync/`): 시트 메뉴 '출석앱'에서 성도를 불러오고, 시트에서 바뀐 칸만 앱에 저장 (사진·출석 기록은 그대로). 시트를 쓰는 사람의 구글 계정으로 앱에 로그인해서 접속하므로, 앱 '관리'에서 교역자로 등록된 사람은 누구나 자기 교회 시트에서 불러오기·저장을 할 수 있음 (교회마다 자기 시트를 둘 수 있음). 성도 붙여넣기 가져오기도 이제 사진 등 기존 칸을 지우지 않음.
- 새 버전 자동 반영: `<meta name="build">` 값이 홈페이지와 다르면 앱이 스스로 새로고침. **앱을 고칠 때마다 이 값을 바꿀 것.**

## 재정 (finance.html)
- 역할: 담임목사(`pastors`) = 출석+성도 관리+재정 / 교역자(`staff`) = 출석+성도 관리 / 리더(`leaders`) = 출석 체크 / 재정 담당(`finance`) = 재정만
- 재정을 볼 수 있는 사람: 그 교회 `pastors`·`finance`만. 교역자·리더·앱 관리자도 못 봄 (관리자는 교회 삭제 때 지우기만) 헌금 기록은 폰에 저장해 두지 않음 (메모리 캐시)
- `offerings/{ID}` 헌금 한 건 `{ date, type, memberId, name("무명"), amount, method: 현금|계좌, memo, src, by, at }`
- `ledger/{ID}` `{ date, kind: out(지출)|in(헌금 아닌 수입)|dep(현금→통장 입금), amount, category, method, memo, receipts[], by, at }`
- `fin/settings` 헌금 종류·항목·시작 잔액(달, 현금 시재, 통장)·고유번호·대표자·소재지·계좌 / `fin/totals` 달별 합계 `{ months: { YYYY-MM: { offCash, offBank, inCash, inBank, outCash, outBank, dep } } }`
- `days/{날짜}` 현금 계수 마감 `{ counters, counted, bills, appCash, depositId, deposited, depositDate }`
- `issued/{연도-번호}` 기부금 영수증 발급 대장 (지우기 불가), `finlog/{ID}` 수정 기록 (고치기·지우기 불가), `receipts/{ID}` 영수증 사진
- 현금: 헌금 탭에서 봉투별 입력 → 두 사람이 센 현금과 맞춰 마감 → 은행에 넣으면 '은행에 입금함'(현금 시재 → 통장)
- 계좌이체: 통장 정리에 거래내역 붙여넣기 → 이름 있는 입금은 헌금(적요로 종류 짐작), 출금은 지출, ATM·현금 입금은 현금→통장. 같은 줄·같은 날 같은 금액은 건너뜀
