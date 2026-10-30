# 위듀케이션 도구 서버 (themore-tools)

초대코드가 있는 학생만 AI 자소서 초안을 받는 서버. 강사로(kangsaro-4ad33)와 따로 둔 Firebase 프로젝트.

- 함수 (asia-northeast3, Node 22)
  - `codeCheck({code})` 초대코드 확인 → 반 이름, 하루 횟수
  - `introChat({code, job, company, memo, hist, write})` 1분 자기소개 꼬꼬무: 질문 하나씩(가벼운 모델, 1인 하루 60번) / write=true면 1분 멘트(1인 하루 perDay번, 코드 횟수 차감)
  - `jasoDraft({code, d})` 자소서 입력값 → AI 초안. 학생 글은 저장하지 않음
  - `liveRoom({code})` 실시간 반응판 방 만들기 → 4자리 PIN (8시간 유효, 만든 사람만 질문을 띄움)
  - `aiLab({code, mode, prompt|job})` AI 수업 도구: run(프롬프트 실행)·coach(프롬프트 채점)·future(직무 미래 지도)·iv/ivend(AI 모의면접 질문·채점표). 1인 하루 30번, 전체 하루 1500번
- Firestore
  - `codes/{코드}` = `{ name, on: true, perDay: 3, max: 100, until: "2026-12-31", used: 0 }` (준용이 콘솔에서 직접 만듦, 코드는 영문 대문자·숫자·- 4자 이상)
  - `use/{날짜}` 하루 사용 횟수 (자동)
  - `rooms/{PIN}` · `rx/{uid}` · `ans/{id}` 실시간 반응판 (규칙: 방 주인만 질문·답 보기, 학생은 자기 답만 쓰기)
  - 그 밖은 규칙으로 전부 막음(서버 함수만 읽고 씀)
- 비밀값: `GEMINI_KEY` 제미나이 API 키 (Secret Manager에만, 저장소·메모에 쓰지 않음)
- 모델 바꾸기: `functions/.env` 에 `JASO_MODEL=모델이름` (기본 gemini-flash-latest, 붐빌 때 대신 쓰는 모델은 `JASO_SPARE`, 기본 gemini-flash-lite-latest)

## 배포 (준용 PC PowerShell, 한 줄씩)

```
cd C:\Users\tobad\themore-tools-server
npm.cmd --prefix functions install
npx.cmd -y firebase-tools@latest login
npx.cmd -y firebase-tools@latest functions:secrets:set GEMINI_KEY
npx.cmd -y firebase-tools@latest deploy --only functions,firestore:rules
```
