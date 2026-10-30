# 더모어 도구 서버 (themore-tools)

초대코드가 있는 학생만 AI 자소서 초안을 받는 서버. 강사로(kangsaro-4ad33)와 따로 둔 Firebase 프로젝트.

- 함수 (asia-northeast3, Node 22)
  - `codeCheck({code})` 초대코드 확인 → 반 이름, 하루 횟수
  - `jasoDraft({code, d})` 자소서 입력값 → Claude 초안. 학생 글은 저장하지 않음
- Firestore
  - `codes/{코드}` = `{ name, on: true, perDay: 3, max: 100, until: "2026-12-31", used: 0 }` (준용이 콘솔에서 직접 만듦, 코드는 영문 대문자·숫자·- 4자 이상)
  - `use/{날짜}` 하루 사용 횟수 (자동)
  - 규칙은 전부 막음(서버 함수만 읽고 씀)
- 비밀값: `ANTHROPIC_KEY` (Secret Manager에만, 저장소·메모에 쓰지 않음)
- 모델 바꾸기: 함수 환경변수 `JASO_MODEL`, `JASO_EFFORT` (`functions/.env` 에 한 줄씩)

## 배포 (준용 PC PowerShell, 한 줄씩)

```
cd C:\Users\tobad\themore-tools-server
npm.cmd --prefix functions install
npx.cmd -y firebase-tools@latest login
npx.cmd -y firebase-tools@latest functions:secrets:set ANTHROPIC_KEY
npx.cmd -y firebase-tools@latest deploy --only functions,firestore:rules
```
