/* 강사로 시간표 보기 (읽기 전용). 강사 화면의 '전체 시간표'와 로그인 없는 시간표 링크(/kangsaro/plan/)가 같이 씀.
   KSRPV.html(data) → HTML 문자열, KSRPV.bind(root) 은 한 번만.
   data = {title, sub, me, lead:{'날짜|시간|교시':'담당 이름'}, slots:[{d, cls, time, per, who, sub, memo}]}
   memo 첫 줄 = 강의명, 다음 줄들 = 세부 내용. 강사료·연락처는 받지도 그리지도 않음. */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DOW = '일월화수목금토';
  const md = d => { const [, m, dd] = d.split('-'); return `${+m}/${+dd}`; };
  const dow = d => DOW[new Date(d + 'T00:00:00').getDay()];
  const kSort = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });
  const start = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 9999; };
  const tKey = x => [x.time || '', x.per || ''].join('|');
  const part = x => { if (/오전|오후|종일/.test(x.per || '')) return x.per; const m = [...String(x.time || '').matchAll(/(\d{1,2}):(\d{2})/g)].map(m => +m[1] * 60 + +m[2]); if (m.length < 2) return x.per || ''; return m[0] < 720 && m[1] > 780 ? '종일' : m[1] <= 780 ? '오전' : '오후'; };
  // 강사마다 고정 색 (밝은 바탕 + 진한 글씨)
  const PAL = ['#FDE0D2', '#CFEEFB', '#FFF3A8', '#DCF3D6', '#F6D3EF', '#E3DEFF', '#FFE1B3', '#D3F1EC', '#F3E1D3', '#E2E8F0', '#FAD4D8', '#D9EBFF'];
  const lines = m => String(m || '').split(/\r?\n/).map(s => s.replace(/^\s*[-·•*]\s*/, '').trim()).filter(Boolean);

  function css() {
    if (document.getElementById('pvcss')) return;
    const st = document.createElement('style'); st.id = 'pvcss';
    st.textContent = `
.pv{--pvln:#C9CDD3;--pvhd:#2B2F36;--pvmu:#6B7280;color:inherit;display:flex;flex-direction:column;gap:10px;min-width:0}
.pv h2{margin:0;font-size:19px}.pv .pvsub{color:var(--pvmu);font-size:13px}
.pv .pvlg{display:flex;flex-wrap:wrap;gap:6px}
.pv .pvlg button{font:inherit;font-size:13px;border:1px solid var(--pvln);border-radius:16px;padding:4px 11px;background:#fff;color:#1D1F23;cursor:pointer}
.pv .pvlg button i{display:inline-block;width:12px;height:12px;border:1px solid #0002;border-radius:3px;vertical-align:-1px;margin-right:5px}
.pv .pvlg button.on{background:var(--pvhd);color:#fff;border-color:var(--pvhd)}
.pv .pvwrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.pv table{border-collapse:collapse;width:100%;table-layout:fixed;background:#fff;color:#1D1F23}
.pv th,.pv td{border:1px solid var(--pvln);text-align:left}.pv th.pvd,.pv th.pvt,.pv thead th{text-align:center}
.pv thead th{background:var(--pvhd);color:#fff;padding:8px;font-size:14px}
.pv th.pvd{background:#EEF0F3;font-size:20px;font-weight:800;line-height:1.2}.pv th.pvd small{display:block;font-size:12px;font-weight:600;color:var(--pvmu)}
.pv th.pvt{background:#F8F9FA;font-size:13px;font-weight:700;padding:4px}.pv th.pvt small{display:block;font-size:11px;color:#888;font-weight:400;margin-top:2px}
.pv tr.pvend>*{border-bottom:3px solid var(--pvhd)}
.pv td.pvc{vertical-align:top;padding:0}
.pv .pvb{padding:8px 10px;color:#1D1F23}.pv .pvb+.pvb{border-top:1px dashed #0003}
.pv .pvb.mine{outline:3px solid #E8453C;outline-offset:-3px}
.pv .pvb.off{opacity:.15;filter:grayscale(1)}
.pv .pvtt{font-weight:800;font-size:13.5px;color:#1450A3;line-height:1.35}
.pv .pvw{margin:4px 0}.pv .pvw button{font:inherit;font-size:12px;font-weight:700;background:#ffffffb0;border:1px solid #0003;border-radius:10px;padding:1px 9px;cursor:pointer;color:#1D1F23}
.pv .pvw .none{font-size:12px;color:#999}
.pv ul{margin:0;padding:5px 0 0 16px;font-size:12.5px;line-height:1.5;border-top:1px dashed #0002}
.pv .pvme{background:#fff;color:#1D1F23;border:2px solid var(--pvhd);border-radius:10px;padding:10px 12px}
.pv .pvme h3{margin:0 0 6px;font-size:16px}.pv .pvme h3 span{font-size:13px;color:#777;font-weight:400;margin-left:6px}
.pv .pvme div{font-size:13px;padding:4px 0;border-top:1px solid #eee}.pv .pvme div:first-of-type{border-top:0}
.pv .pvm{display:none}
.pv .pvtabs{position:sticky;top:0;z-index:2;display:flex;gap:6px;padding:4px 0;overflow-x:auto}
.pv .pvtabs button{flex:1 0 auto;font:inherit;font-size:15px;font-weight:800;padding:8px 10px;border:1px solid var(--pvln);border-radius:10px;background:#fff;color:#1D1F23}
.pv .pvtabs button.on{background:var(--pvhd);color:#fff;border-color:var(--pvhd)}
.pv .pvday{display:none}.pv .pvday.show{display:block}.pv.filt .pvday{display:block}.pv.filt .pvtabs{display:none}
.pv .pvday h3{margin:8px 0;font-size:17px}
.pv .pvcls{background:#fff;color:#1D1F23;border:1px solid #D9DCE1;border-radius:12px;padding:8px;margin-bottom:10px}
.pv .pvcls>b{display:block;font-size:15px;margin:2px 2px 6px}
.pv .pvm .pvb{border:1px solid #0001;border-radius:10px;margin-bottom:6px}.pv .pvm .pvb+.pvb{border-top:1px solid #0001}
.pv .pvm .pvb.off{display:none}.pv .pvm .pvcls.empty{display:none}
.pv .pvap{font-size:12px;background:#0000001a;padding:2px 8px;border-radius:8px;margin-right:6px;font-weight:700}
.pv .pvlead{font-size:12px;color:var(--pvmu);font-weight:400;margin-left:4px}
@media (max-width:820px){.pv .pvwrap{display:none}.pv .pvm{display:block}}
@media print{.pv .pvwrap{display:block}.pv .pvm,.pv .pvlg{display:none}}`;
    document.head.appendChild(st);
  }

  function html(D) {
    css();
    const S = (D.slots || []).filter(x => x && x.d);
    if (!S.length) return '<div class="pv"><p>아직 시간표가 없어요.</p></div>';
    const days = [...new Set(S.map(x => x.d))].sort();
    // 반 순서: 업체가 만든 순서 그대로 ('2학년 1반'·'2-1'처럼 번호 반이면 번호순)
    let cls = [...new Set(S.map(x => x.cls || ''))]; if (cls.every(c => /\d/.test(c))) cls = cls.sort(kSort);
    const names = []; for (const x of S.slice().sort((a, b) => (a.d + start(a.time)) < (b.d + start(b.time)) ? -1 : 1)) for (const n of [x.who, x.sub]) if (n && !names.includes(n)) names.push(n);
    const col = n => n ? PAL[names.indexOf(n) % PAL.length] : '#FFFFFF';
    const lead = D.lead || {}, me = D.me || '';
    const tks = d => [...new Set(S.filter(x => x.d === d).map(tKey))].sort((a, b) => start(a.split('|')[0]) - start(b.split('|')[0]) || kSort(a, b));
    const tLab = (d, k) => { const [t, p] = k.split('|'), x = { time: t, per: p }, pa = part(x), l = lead[d + '|' + k]; return { main: pa || p || t || '강의', time: t && pa !== t ? t : '', per: p && p !== pa ? p : '', lead: l }; };
    const block = x => {
      const L = lines(x.memo), t = L[0] || '', rest = L.slice(1), who = x.who || '';
      return `<div class="pvb${me && (who === me || x.sub === me) ? ' mine' : ''}" style="background:${col(who)}" data-pvw="${esc(who)}" data-pvs="${esc(x.sub || '')}" data-pvd="${x.d}" data-pvk="${esc(tKey(x))}" data-pvc="${esc(x.cls || '')}" data-pvt="${esc(t)}">
        ${t ? `<div class="pvtt">${esc(t)}</div>` : ''}<div class="pvw">${who ? `<button type="button" data-pvn="${esc(who)}">${esc(who)}</button>` : '<span class="none">강사 미정</span>'}${x.sub ? ` <button type="button" data-pvn="${esc(x.sub)}">보조 ${esc(x.sub)}</button>` : ''}</div>
        ${rest.length ? `<ul>${rest.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</div>`;
    };
    const at = (d, k, c) => S.filter(x => x.d === d && tKey(x) === k && (x.cls || '') === c);
    const hd = cls.length === 1 && !cls[0] ? ['강의'] : cls;
    const tb = `<div class="pvwrap"><table style="min-width:${130 + hd.length * 190}px"><colgroup><col style="width:58px"><col style="width:76px">${hd.map(() => '<col>').join('')}</colgroup>
      <thead><tr><th colspan="2"></th>${hd.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${days.map(d => {
        const K = tks(d); return K.map((k, i) => { const T = tLab(d, k); return `<tr${i === K.length - 1 ? ' class="pvend"' : ''}>${i ? '' : `<th class="pvd" rowspan="${K.length}">${dow(d)}<small>${md(d)}</small></th>`}<th class="pvt">${esc(T.main)}${T.time ? `<small>${esc(T.time)}</small>` : ''}${T.per ? `<small>${esc(T.per)}</small>` : ''}${T.lead ? `<small>담당 ${esc(T.lead)}</small>` : ''}</th>${cls.map(c => { const B = at(d, k, c); return `<td class="pvc"${B.length ? '' : ' style="background:#FAFAFA"'}>${B.map(block).join('')}</td>`; }).join('')}</tr>`; }).join('');
      }).join('')}</tbody></table></div>`;
    const tn = new Date(), td = `${tn.getFullYear()}-${String(tn.getMonth() + 1).padStart(2, '0')}-${String(tn.getDate()).padStart(2, '0')}`, d0 = Math.max(0, days.findIndex(d => d >= td));
    const mb = `<div class="pvm"><div class="pvtabs">${days.map((d, i) => `<button type="button" class="${i === d0 ? 'on' : ''}" data-pvday="${d}">${dow(d)} <small style="font-weight:400">${md(d)}</small></button>`).join('')}</div>
      ${days.map((d, i) => { const K = tks(d), ld = K.map(k => { const T = tLab(d, k); return T.lead ? `${T.main} ${T.lead}` : ''; }).filter(Boolean);
        return `<section class="pvday${i === d0 ? ' show' : ''}" data-pvday="${d}"><h3>${md(d)}(${dow(d)})${ld.length ? `<span class="pvlead">담당 ${esc(ld.join(' · '))}</span>` : ''}</h3>${cls.map(c => { const B = K.flatMap(k => at(d, k, c)); if (!B.length) return '';
          return `<div class="pvcls">${c ? `<b>${esc(c)}</b>` : ''}${B.map(x => { const T = tLab(d, tKey(x)); return block(x).replace('<div class="pvw">', `<div class="pvw"><span class="pvap">${esc(T.main)}${T.time ? ' ' + esc(T.time) : ''}</span>`); }).join('')}</div>`; }).join('')}</section>`; }).join('')}</div>`;
    const lg = `<div class="pvlg"><button type="button" class="on" data-pvn="">전체</button>${names.map(n => `<button type="button" data-pvn="${esc(n)}"><i style="background:${col(n)}"></i>${esc(n)}${n === me ? ' (나)' : ''}</button>`).join('')}</div>`;
    return `<div class="pv" data-pvme="${esc(me)}">${D.title ? `<h2>${esc(D.title)}</h2>` : ''}${D.sub ? `<div class="pvsub">${esc(D.sub)}</div>` : ''}
      ${names.length ? lg + '<div class="pvsub">강사 이름을 누르면 그 강사 일정만 보여요.</div>' : ''}<div class="pvme" hidden></div>${tb}${mb}</div>`;
  }

  function pick(root, n) {
    const pv = root.closest('.pv') || root; const cur = pv.dataset.pvcur === n ? '' : n; pv.dataset.pvcur = cur;
    pv.classList.toggle('filt', !!cur);
    pv.querySelectorAll('.pvlg button').forEach(b => b.classList.toggle('on', b.dataset.pvn === cur));
    const hit = [];
    pv.querySelectorAll('.pvb').forEach(b => { const m = !cur || b.dataset.pvw === cur || b.dataset.pvs === cur; b.classList.toggle('off', !m); if (cur && m && b.closest('.pvwrap')) hit.push(b); });
    pv.querySelectorAll('.pvcls').forEach(g => g.classList.toggle('empty', !!cur && !g.querySelector('.pvb:not(.off)')));
    const P = pv.querySelector('.pvme'); if (!cur) { P.hidden = true; return; }
    P.innerHTML = `<h3>${esc(cur)} 강사 일정<span>총 ${hit.length}회</span></h3>` + hit.map(b => { const d = b.dataset.pvd, [t, p] = b.dataset.pvk.split('|'), x = { time: t, per: p }, pa = part(x);
      return `<div><b>${md(d)}(${dow(d)})</b> ${esc(pa)} ${t && t !== pa ? esc(t) : ''} · ${esc(b.dataset.pvc || '')} ${b.dataset.pvs === cur ? '(보조)' : ''}<br><span style="color:#1450A3">${esc(b.dataset.pvt || '')}</span></div>`; }).join('');
    P.hidden = false;
  }
  let bound = false;
  function bind() {
    if (bound) return; bound = true;
    document.addEventListener('click', e => {
      const n = e.target.closest && e.target.closest('.pv [data-pvn]'); if (n) { e.preventDefault(); return pick(n, n.dataset.pvn); }
      const t = e.target.closest && e.target.closest('.pv .pvtabs [data-pvday]'); if (t) { const pv = t.closest('.pv'); pv.querySelectorAll('.pvtabs button').forEach(b => b.classList.toggle('on', b === t)); pv.querySelectorAll('section.pvday').forEach(s => s.classList.toggle('show', s.dataset.pvday === t.dataset.pvday)); }
    });
  }
  window.KSRPV = { html, bind, pick };
})();
