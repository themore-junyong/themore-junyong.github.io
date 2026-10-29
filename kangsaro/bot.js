// 강사로 AI 상담 봇: 오른쪽 아래 '💬 물어보기' → 사용설명서 내용으로 답함 (서버 askBot, 제미나이)
(() => {
  if (window.__ksBot) return; window.__ksBot = 1;
  const URL_ = 'https://asia-northeast3-kangsaro-4ad33.cloudfunctions.net/askBot';
  const H = []; // 최근 대화 (서버에 6개까지)
  const st = document.createElement('style');
  st.textContent = `.ksb-btn{position:fixed;right:16px;bottom:92px;z-index:9998;border:0;border-radius:99px;padding:12px 16px;background:#2563EB;color:#fff;font:600 15px/1 inherit;box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer}
.ksb{position:fixed;right:16px;bottom:92px;z-index:9999;width:min(380px,calc(100vw - 32px));height:min(520px,calc(100vh - 140px));background:#fff;color:#16222B;border:1px solid #D5DDDC;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden;font-family:inherit}
.ksb[hidden]{display:none}.ksb-h{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#2563EB;color:#fff}.ksb-h b{flex:1}.ksb-h button{background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer}
.ksb-m{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:15px;line-height:1.6}
.ksb-m div{max-width:85%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-break:keep-all}.ksb-m .q{align-self:flex-end;background:#E3ECFF}.ksb-m .a{align-self:flex-start;background:#F3F5F4}
.ksb-f{display:flex;gap:6px;padding:10px;border-top:1px solid #D5DDDC}.ksb-f input{flex:1;min-width:0;padding:10px;border:1px solid #D5DDDC;border-radius:10px;font:inherit;font-size:15px}.ksb-f button{border:0;border-radius:10px;padding:0 14px;background:#2563EB;color:#fff;font-weight:600;cursor:pointer}
.ksb-s{font-size:12px;color:#4F5D66;padding:0 12px 8px}`;
  document.head.appendChild(st);
  const btn = document.createElement('button'); btn.className = 'ksb-btn'; btn.type = 'button'; btn.textContent = '💬 물어보기';
  const box = document.createElement('div'); box.className = 'ksb'; box.hidden = true;
  box.innerHTML = `<div class="ksb-h"><b>강사로 AI 상담</b><button type="button" aria-label="닫기">×</button></div>
    <div class="ksb-m"><div class="a">안녕하세요! 강사로 사용법을 물어보세요. 예: "엑셀로 일정을 한 번에 넣으려면?", "확정된 강사 서류는 어디서 받아요?"</div></div>
    <div class="ksb-s">AI가 사용설명서를 보고 답해요. 틀릴 수 있어요. 주민번호·계좌번호는 적지 마세요.</div>
    <form class="ksb-f"><input placeholder="궁금한 것을 적어 주세요" maxlength="500"><button>보내기</button></form>`;
  document.body.append(btn, box);
  const M = box.querySelector('.ksb-m'), F = box.querySelector('form'), I = F.querySelector('input');
  const add = (c, t) => { const d = document.createElement('div'); d.className = c; d.textContent = t; M.appendChild(d); M.scrollTop = M.scrollHeight; return d; };
  btn.onclick = () => { box.hidden = false; btn.hidden = true; I.focus(); };
  box.querySelector('.ksb-h button').onclick = () => { box.hidden = true; btn.hidden = false; };
  F.onsubmit = async e => {
    e.preventDefault(); const q = I.value.trim(); if (!q) return;
    I.value = ''; add('q', q); const w = add('a', '생각하는 중이에요…'); F.querySelector('button').disabled = true;
    try {
      const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q, h: H.slice(-6) }) });
      const j = await r.json(); w.textContent = j.a || j.error || '답을 받지 못했어요';
      H.push({ r: 'q', t: q }, { r: 'a', t: w.textContent });
    } catch (err) { w.textContent = '연결이 안 돼요. 인터넷을 확인하시거나 tobadyclup@naver.com 으로 문의해 주세요'; }
    F.querySelector('button').disabled = false; I.focus();
  };
})();
