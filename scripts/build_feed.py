"""티스토리·네이버·유튜브 새 글을 모아 posts.json 생성 (GitHub Actions에서 매시간 실행)."""
import json, re, urllib.request, xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

FEEDS = [
    ("tistory", "https://changenavigator.tistory.com/rss"),
    ("naver",   "https://rss.blog.naver.com/fiveluck_.xml"),
    ("youtube", "https://www.youtube.com/feeds/videos.xml?channel_id=UC9PrjdPbRZqrPmphj4eCGUA"),
]
# 티스토리 카테고리 → 홈페이지 분류
TISTORY_MAP = [("봉사", "봉사"), ("앱", "앱"), ("말씀", "말씀"), ("묵상", "말씀"), ("설교", "말씀")]
SKIP_NAVER = ["공지"]  # 네이버에서 빼고 싶은 카테고리

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (themore-feed)"})
    return urllib.request.urlopen(req, timeout=30).read()

def clean(s, n=90):
    s = re.sub(r"<[^>]+>", " ", s or ""); s = re.sub(r"&[a-z#0-9]+;", " ", s); s = re.sub(r"\s+", " ", s).strip()
    return s[:n] + ("…" if len(s) > n else "")

def first_img(s):
    m = re.search(r'<img[^>]+src="([^"]+)"', s or ""); return m.group(1) if m else ""

def iso(d):
    try: return parsedate_to_datetime(d).astimezone(timezone.utc).isoformat()
    except Exception:
        try: return datetime.fromisoformat(d.replace("Z", "+00:00")).isoformat()
        except Exception: return ""

def rss(src, xml):
    out = []
    for it in ET.fromstring(xml).iter("item"):
        g = lambda t: (it.findtext(t) or "")
        cat = g("category"); desc = g("description")
        title = g("title")
        if src == "tistory":
            kind = next((v for k, v in TISTORY_MAP if k in cat), None) or ("봉사" if "봉사" in title else "말씀")
        else:
            if any(k in cat for k in SKIP_NAVER): continue
            kind = "봉사" if ("봉사" in cat or "봉사" in title) else "강의"
        out.append({"kind": kind, "src": src, "title": clean(g("title"), 80), "link": g("link").strip(),
                    "date": iso(g("pubDate")), "summary": clean(desc), "image": first_img(desc), "cat": cat.strip()})
    return out

def youtube(xml):
    ns = {"a": "http://www.w3.org/2005/Atom", "media": "http://search.yahoo.com/mrss/", "yt": "http://www.youtube.com/xml/schemas/2015"}
    out = []
    for e in ET.fromstring(xml).findall("a:entry", ns):
        vid = e.findtext("yt:videoId", "", ns)
        out.append({"kind": "영상", "src": "youtube", "title": clean(e.findtext("a:title", "", ns), 80),
                    "link": f"https://www.youtube.com/watch?v={vid}", "date": iso(e.findtext("a:published", "", ns)),
                    "summary": clean(e.findtext("media:group/media:description", "", ns)),
                    "image": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"})
    return out

def dedupe(posts):
    """같은 봉사 글이 티스토리·네이버에 둘 다 있으면 홈페이지엔 티스토리 글만 보여준다 (±1일)."""
    def day(p):
        try: return datetime.fromisoformat(p["date"]).date()
        except Exception: return None
    t_days = [day(p) for p in posts if p["src"] == "tistory" and p["kind"] == "봉사" and day(p)]
    def dup(p):
        d = day(p)
        return p["src"] == "naver" and p["kind"] == "봉사" and d and any(abs((d - x).days) <= 1 for x in t_days)
    return [p for p in posts if not dup(p)]

def main():
    posts, errors = [], []
    for src, url in FEEDS:
        try:
            x = get(url); posts += youtube(x) if src == "youtube" else rss(src, x)
        except Exception as e:
            errors.append(f"{src}: {e}")
    try:
        old = json.load(open("posts.json", encoding="utf-8")).get("posts", [])
    except Exception:
        old = []
    seen = {p["link"] for p in posts}
    posts += [p for p in old if p["link"] not in seen]  # 피드에서 밀려난 예전 글도 유지
    posts = dedupe(posts)
    posts.sort(key=lambda p: p.get("date", ""), reverse=True)
    json.dump({"updated": datetime.now(timezone.utc).isoformat(), "posts": posts[:200], "errors": errors},
              open("posts.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(len(posts), "posts", errors)

if __name__ == "__main__":
    main()
