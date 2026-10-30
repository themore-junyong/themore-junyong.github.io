# 강사로 서버 (Cloud Functions)

`verifyBiz`: 업체가 넣은 사업자등록번호를 국세청 '사업자등록 상태조회'(공공데이터포털)로 확인하고, 계속사업자면 `biz/{번호}`를 잡고 `users/{uid}`를 승인(`approved`, `bizCheck`)해요. 한 사람이 하루 10번까지만 확인할 수 있어요.

## 처음 한 번 (PC)
1. Node.js 22 설치, `npm i -g firebase-tools`, `firebase login`
2. 이 폴더에서 `cd functions && npm install && cd ..`
3. `firebase functions:secrets:set NTS_KEY` → data.go.kr '일반 인증키(Decoding)' 붙여 넣기
4. `firebase deploy --only functions`
5. 앱에서 운영자로 로그인 → '업체 관리' → '국세청 사업자 확인' 켜기 (보안 규칙도 최신으로 게시)

키는 저장소에 넣지 않아요. 로컬 시험용 `functions/.secret.local`, `functions/.env.local`은 git에서 빠져 있어요.

## 푸시 알림
`pushAlert`(강사 알림: 확정·마감·입금·리마인드), `pushNotice`(업체 공지 → 받는 강사), `pushApply`(새 지원 → 업체 대표·직원), `pushCancel`(확정 취소 → 업체). 기기 토큰은 앱이 `users/{uid}/push/{id}`에 저장해요. Firestore 트리거는 DB와 같은 지역이어야 해서 `DB_REGION`(기본 asia-northeast3)을 써요. 앱의 웹 푸시 키는 `kangsaro/app/real.js`의 `VAPID`.

## 이용 기간·요금제
`termSync`(앱을 열 때 내 기간 다시 계산), `termDaily`(매일 03:00 KST 모든 계정), `jobCount`(공고가 생기면 그 달 수 +1, KST).
`terms/{uid}`에 `free`(가입+3개월+소개 보너스) · `paid`(운영자가 늘린 날) · `end`(둘 중 늦은 날) · `until`(end 다음 날 0시 KST) · `planC`/`planI` · `cnt.{YYYYMM}`.
사용자는 못 고치고 서버·운영자만 써요. 보안 규칙이 `until`이 지나면 공고·공지·지원·달력·알림 쓰기를 막고, 업체 베이직은 한 달 9건, 스탠다드 29건까지(10건·30건 미만)만 공고를 받아요. 요금제가 없으면(무료 기간) 한도 없이 다 써요.
운영자는 앱 '업체 관리 → 이용 기간·요금제'에서 +1개월·+1년·요금제를 정해요.

## AI 상담 봇
`askBot`(HTTP, 공개): 사용설명서 두 개와 상세페이지 글(1시간마다 새로 읽음)만 보고 제미나이(Vertex AI, 이 프로젝트 결제)로 답해요. 화면은 `kangsaro/bot.js`(설명서·상세·앱 오른쪽 아래 '💬 물어보기').
질문 내용은 저장하지 않고, `botlog/{날짜}`에 횟수만 남겨요(IP는 그날 값으로 해시). 한 곳 하루 20번, 전체 하루 1,500번.
처음 한 번: 콘솔에서 Vertex AI API 사용 설정. 모델은 `BOT_MODEL` 환경 변수(쉼표로 여러 개)로 바꿀 수 있어요.

## 톡방 공고 인수
`claimPre`(호출형): 운영자가 '업체 관리 → 톡방 미가입 업체'에 올린 `pre/{코드}`(운영자만 읽음)를, 그 코드의 인수 링크(`/kangsaro/app/?claim=코드`)로 가입해 사업자 확인을 마친 업체 대표에게 옮겨요.
안 지난 강의는 '모집', 지난 강의는 '마감'(정산용 기록)으로 `jobs`에 들어가고 `pre: 코드`가 붙어요. 이 공고는 요금제 공고 수(`jobCount`)에 안 세요. 한 코드는 한 업체만 받을 수 있어요.
