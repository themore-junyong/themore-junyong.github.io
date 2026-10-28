# 강사로 실제 앱 (Firebase)

- `index.html`은 **직접 고치지 말 것.** 화면은 체험판 `../try/index.html`을 고친 뒤 `python3 scripts/build_kangsaro_app.py`로 만든다.
- `real.js` 로그인(구글·이메일 링크)과 Firebase 저장. 화면 코드가 `S`를 고치고 `save()`를 부르면 바뀐 문서만 씀
- `firebase-config.js` kangsaro 프로젝트 웹 앱 설정값 (공개 값)
- `firestore.rules` 보안 규칙. 콘솔 → Firestore → 규칙에 붙여 넣고 게시
- `?emu` 를 붙이면 로컬 에뮬레이터(Auth 9099, Firestore 8080)에 붙음 (시험용)

## 데이터
- `users/{uid}` 공개 프로필 `{role:'i'|'c', name, region, topics, intro, career, photo, joined, beta | contact, approved}`
- `users/{uid}/private/main` 연락처·계좌·서류 이름. 본인 + `links`로 확정한 업체 + 관리자만
- `users/{uid}/files/{서류}` 통장사본·신분증 사본 (사진은 줄여서 data URL, 1MB 안)
- `links/{업체uid}_{강사uid}` 업체가 확정하면 생김 → 서류 열람 허락. 확정 취소하면 지움
- `jobs/{id}` 공고 (승인된 업체만 등록) · `notices/{id}` 공지 `{jobId, coId, to[], reads{}}`
- `apps/{id}` 지원 `{jobId, coId, instId, status, docs, paidAt, recv, rrn?…}` 강사는 확정·지급을 못 바꾸고, 업체는 강사 서류·주민번호를 못 넣음
- `apps/{id}/files/{서류}` 강의별로 낸 파일 · `evs/{id}` 강사 개인 달력 · `alerts/{id}` 알림 `{by, instId}`
- 주민등록번호: 업체가 '복사하고 지우기' 하면 삭제, 30일 지나면 업체가 앱을 열 때 삭제
- 관리자(업체 승인): 규칙과 `real.js`의 `ADMINS`
