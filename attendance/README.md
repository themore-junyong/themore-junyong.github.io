# 교회 출석 (Firebase)

여러 교회가 함께 쓰는 출석 체크 웹앱. 앱은 하나, 교회별 데이터는 분리.

- `index.html` 화면 전체 (빌드 없음, Firebase JS SDK를 CDN에서 불러옴)
- `firebase-config.js` Firebase 웹 앱 설정값 (공개 값)
- `firestore.rules` 보안 규칙. Firebase 콘솔 → Firestore → 규칙에 붙여 넣고 게시
- `?demo` 를 붙이면 가짜 성도 9명으로 미리보기 (저장 안 됨)

## 데이터 구조
- `config/admins` `{ emails: [...] }` 관리자. 콘솔에서만 수정
- `churches/{교회}` `{ name, services: [...], leaders: [이메일...] }`
- `churches/{교회}/members/{성도ID}` 성도 (시트 '성도' 탭과 같은 칸)
- `churches/{교회}/attendance/{날짜_예배_성도ID}` `{ date, service, memberId, name, present, checkedBy, checkedAt }`
  - 문서 ID가 정해져 있어서 같은 사람이 같은 예배에 두 번 기록되지 않음

## 동작
- 출석 버튼은 누르는 즉시 화면에 반영되고 저장은 뒤에서 함 (Firestore 오프라인 캐시)
- 인터넷이 끊겨도 체크가 폰에 남았다가 연결되면 자동 저장
- 리더는 `leaders`에 이메일이 있는 교회만 보고 쓸 수 있음
- 출석한 사람은 목록에서 빠지고 아래에 '되돌리기'가 잠깐 뜸. '출석한 사람 보기'나 ✎ 정보 중에는 모두 보임
- 사진은 가운데를 잘라 112px JPEG로 줄여 성도 문서의 `thumb`에 저장 (장당 수 KB, Storage 불필요)
- 관리 → 사진 가져오기: 시트 '사진' 칸 파일 이름 → 성도ID → 이름 순으로 짝을 찾음
