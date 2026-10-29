# 강사로 서버 (Cloud Functions)

`verifyBiz`: 업체가 넣은 사업자등록번호를 국세청 '사업자등록 상태조회'(공공데이터포털)로 확인하고, 계속사업자면 `biz/{번호}`를 잡고 `users/{uid}`를 승인(`approved`, `bizCheck`)해요. 한 사람이 하루 10번까지만 확인할 수 있어요.

## 처음 한 번 (PC)
1. Node.js 22 설치, `npm i -g firebase-tools`, `firebase login`
2. 이 폴더에서 `cd functions && npm install && cd ..`
3. `firebase functions:secrets:set NTS_KEY` → data.go.kr '일반 인증키(Decoding)' 붙여 넣기
4. `firebase deploy --only functions`
5. 앱에서 운영자로 로그인 → '업체 관리' → '국세청 사업자 확인' 켜기 (보안 규칙도 최신으로 게시)

키는 저장소에 넣지 않아요. 로컬 시험용 `functions/.secret.local`, `functions/.env.local`은 git에서 빠져 있어요.
