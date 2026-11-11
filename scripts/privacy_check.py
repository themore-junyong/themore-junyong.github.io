"""공개 저장소에 성도·회원 개인정보가 올라가지 않았는지 검사한다 (PRIVACY.md).

python scripts/privacy_check.py          # 저장소의 모든 파일 검사
python scripts/privacy_check.py a b ...  # 지정한 파일만 검사
걸리는 줄이 있으면 목록을 보여 주고 1로 끝난다. GitHub Actions(개인정보 검사)가 커밋마다 돌린다.
"""
import pathlib
import re
import subprocess
import sys

# 일부러 공개한 번호와 누가 봐도 가짜인 예시 번호만 허용
ALLOWED_PHONES = {"01096013080", "01012345678"}
FAKE_PHONE = re.compile(r"^010(0000|1111)\d{4}$")
PHONE = re.compile(r"(?<!\d)01[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)")
RRN = re.compile(r"(?<!\d)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])-?[1-4]\d{6}(?!\d)")  # 주민등록번호
BIRTH = re.compile(r"(생일|생년월일|birth)[^\n]{0,20}?(19[3-9]\d|200\d)[-./년 ]+(\d{1,2})[-./월 ]+(\d{1,2})", re.I)
BLOCKED_EXT = {".xlsx", ".xls", ".csv", ".tsv", ".vcf"}
SKIP = {"scripts/privacy_check.py", "posts.json"}


def tracked():
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout
    return out.split()


def check(path):
    p = pathlib.Path(path)
    if p.suffix.lower() in BLOCKED_EXT:
        return [f"{path}: 표 파일({p.suffix})은 공개 저장소에 올리지 않습니다"]
    if path in SKIP or not p.is_file():
        return []
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []
    found = []
    for n, line in enumerate(text.splitlines(), 1):
        for m in PHONE.finditer(line):
            digits = re.sub(r"\D", "", m.group())
            if digits not in ALLOWED_PHONES and not FAKE_PHONE.match(digits):
                found.append(f"{path}:{n}: 전화번호 {m.group()}")
        if RRN.search(line):
            found.append(f"{path}:{n}: 주민등록번호 모양")
        b = BIRTH.search(line)
        if b and (int(b.group(3)), int(b.group(4))) != (1, 1):  # 1990-01-01 같은 예시는 허용
            found.append(f"{path}:{n}: 생년월일")
    return found


def main():
    files = sys.argv[1:] or tracked()
    found = [f for path in files for f in check(path)]
    if found:
        print("개인정보로 보이는 내용이 있습니다. 예시는 홍길동·010-0000-0001 같은 가짜 값으로 바꿔 주세요.")
        print("\n".join(found))
        sys.exit(1)
    print(f"개인정보 검사 통과 ({len(files)}개 파일)")


if __name__ == "__main__":
    main()
