(() => {
  'use strict';

  const DATA = Array.isArray(window.EBF_DATA) ? window.EBF_DATA : [];
  const ILLINOIS_BOUNDS = L.latLngBounds([36.86, -91.55], [42.55, -87.00]);
  const BOUNDARY_URL = "/nces/opengis/rest/services/School_District_Boundaries/EDGE_SCHOOLDISTRICT_TL25_SY2425/MapServer/1/query?where=STATEFP%3D%2717%27&outFields=*&returnGeometry=true&f=geojson";

  const els = {
    mapMetric: document.getElementById('mapMetric'),
    search: document.getElementById('districtSearch'),
    clearSearch: document.getElementById('clearSearch'),
    searchResults: document.getElementById('searchResults'),
    typeFilters: document.getElementById('typeFilters'),
    iftOnly: document.getElementById('iftOnly'),
    legend: document.getElementById('legend'),
    joinStatus: document.getElementById('joinStatus'),
    resetView: document.getElementById('resetView'),
    emptyState: document.getElementById('emptyState'),
    districtDetails: document.getElementById('districtDetails'),
    kpiGap: document.getElementById('kpiGap'),
    kpiUnder90: document.getElementById('kpiUnder90'),
    kpiUnder100: document.getElementById('kpiUnder100'),
    kpiIFT: document.getElementById('kpiIFT')
  };

  const map = L.map('map', { zoomControl: true, preferCanvas: true, minZoom: 6, maxZoom: 12 });
  map.fitBounds(ILLINOIS_BOUNDS);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  let currentType = 'all';
  let boundaryLayer = null;
  let boundaryFeatures = [];
  let featureToDistrict = new Map();
  let districtToLayers = new Map();
  let selectedDistrict = null;

  const dataByKey = new Map();
  DATA.forEach(d => {
    allKeysForDistrict(d).forEach(k => {
      if (!dataByKey.has(k)) dataByKey.set(k, []);
      dataByKey.get(k).push(d);
    });
  });

  populateKPIs();
  renderLegend();
  bindControls();
  loadBoundaries();

  function populateKPIs() {
    const totalGap = DATA.reduce((s, d) => s + (Number(d.gap) || 0), 0);
    const under90 = DATA.filter(d => d.adequacyPct != null && d.adequacyPct < 90).length;
    const under100 = DATA.filter(d => d.adequacyPct != null && d.adequacyPct < 100).length;
    const ift = DATA.filter(d => d.affiliation === 'IFT-AFT').length;
    els.kpiGap.textContent = compactCurrency(totalGap);
    els.kpiUnder90.textContent = under90.toLocaleString('en-US');
    els.kpiUnder100.textContent = under100.toLocaleString('en-US');
    els.kpiIFT.textContent = ift.toLocaleString('en-US');
  }

  async function loadBoundaries() {
    els.joinStatus.textContent = 'Loading 2024–25 Illinois district boundaries…';
    try {
      const response = await fetch(BOUNDARY_URL, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Boundary request failed (${response.status})`);
      const geojson = await response.json();
      boundaryFeatures = geojson.features || [];
      createBoundaryLayer();
      const matchedDistricts = new Set(Array.from(featureToDistrict.values()).filter(Boolean).map(d => d.districtCode));
      const unmatched = DATA.length - matchedDistricts.size;
      els.joinStatus.innerHTML = `<strong>${matchedDistricts.size}</strong> of ${DATA.length} funding records matched to map boundaries${unmatched ? `; ${unmatched} remain unmatched by district name.` : '.'}`;
    } catch (err) {
      console.error(err);
      els.joinStatus.innerHTML = '<strong>Boundary service unavailable.</strong> Funding data is loaded, but the NCES map layer could not be reached. Refresh when online.';
    }
  }

  function createBoundaryLayer() {
    if (boundaryLayer) map.removeLayer(boundaryLayer);
    featureToDistrict = new Map();
    districtToLayers = new Map();

    boundaryLayer = L.geoJSON({ type: 'FeatureCollection', features: boundaryFeatures }, {
      style: feature => styleForFeature(feature),
      filter: feature => featureVisible(feature),
      onEachFeature: (feature, layer) => {
        const district = matchFeature(feature);
        featureToDistrict.set(feature, district);
        if (district) {
          if (!districtToLayers.has(district.districtCode)) districtToLayers.set(district.districtCode, []);
          districtToLayers.get(district.districtCode).push(layer);
        }
        layer.bindTooltip(() => tooltipHtml(feature, district), { sticky: true, direction: 'top', opacity: 0.96 });
        layer.on({
          click: () => {
            if (district) selectDistrict(district, true);
          },
          mouseover: e => {
            e.target.setStyle({ weight: 2.2, color: '#24374a', fillOpacity: 0.88 });
            if (e.target.bringToFront) e.target.bringToFront();
          },
          mouseout: e => {
            if (boundaryLayer) boundaryLayer.resetStyle(e.target);
          }
        });
      }
    }).addTo(map);
  }

  function redrawBoundaries() {
    if (!boundaryFeatures.length) return;
    createBoundaryLayer();
  }

  function featureVisible(feature) {
    const d = matchFeature(feature);
    if (!d) return currentType === 'all' && !els.iftOnly.checked;
    if (currentType !== 'all' && d.districtType !== currentType) return false;
    if (els.iftOnly.checked && d.affiliation !== 'IFT-AFT') return false;
    return true;
  }

  function styleForFeature(feature) {
    const d = matchFeature(feature);
    const selected = selectedDistrict && d && selectedDistrict.districtCode === d.districtCode;
    return {
      color: selected ? '#071f33' : '#51606f',
      weight: selected ? 2.5 : 0.65,
      opacity: selected ? 1 : 0.55,
      fillColor: metricColor(d),
      fillOpacity: d ? 0.72 : 0.18
    };
  }

  function metricColor(d) {
    if (!d) return '#cbd5df';
    const metric = els.mapMetric.value;
    if (metric === 'adequacy') {
      const p = Number(d.adequacyPct);
      if (!Number.isFinite(p)) return '#cbd5df';
      if (p < 60) return '#8b1e1e';
      if (p < 70) return '#c33d2b';
      if (p < 80) return '#e87531';
      if (p < 90) return '#e7b94c';
      if (p < 100) return '#8fb85a';
      return '#3f8f5f';
    }
    if (metric === 'gapPerStudent') {
      const g = Number(d.gapPerStudent);
      if (!Number.isFinite(g)) return '#cbd5df';
      if (g >= 8000) return '#7f1d1d';
      if (g >= 6000) return '#b83227';
      if (g >= 4000) return '#df6d2f';
      if (g >= 2000) return '#e6b54a';
      if (g > 0) return '#8fb85a';
      return '#3f8f5f';
    }
    const c = Number(d.changePctPoints);
    if (!Number.isFinite(c)) return '#cbd5df';
    if (c <= -5) return '#8b1e1e';
    if (c < -1) return '#d95f35';
    if (c <= 1) return '#d9d9d9';
    if (c < 5) return '#8fb85a';
    return '#3f8f5f';
  }

  function renderLegend() {
    const metric = els.mapMetric.value;
    let items;
    if (metric === 'adequacy') {
      items = [
        ['#8b1e1e','Below 60%'],['#c33d2b','60–69.9%'],['#e87531','70–79.9%'],['#e7b94c','80–89.9%'],['#8fb85a','90–99.9%'],['#3f8f5f','100% or more'],['#cbd5df','No matched data']
      ];
    } else if (metric === 'gapPerStudent') {
      items = [
        ['#7f1d1d','$8,000+ per student'],['#b83227','$6,000–$7,999'],['#df6d2f','$4,000–$5,999'],['#e6b54a','$2,000–$3,999'],['#8fb85a','$1–$1,999'],['#3f8f5f','$0 gap'],['#cbd5df','No matched data']
      ];
    } else {
      items = [
        ['#8b1e1e','Down 5+ points'],['#d95f35','Down 1–5 points'],['#d9d9d9','Within ±1 point'],['#8fb85a','Up 1–5 points'],['#3f8f5f','Up 5+ points'],['#cbd5df','No matched data']
      ];
    }
    els.legend.innerHTML = items.map(([color,label]) => `<div class="legend-row"><span class="legend-swatch" style="background:${color}"></span><span>${label}</span></div>`).join('');
  }

  function tooltipHtml(feature, d) {
    const name = d ? d.district : featureName(feature);
    let stat = 'No matched FY27 funding record';
    if (d) {
      if (els.mapMetric.value === 'adequacy') stat = `${formatPct(d.adequacyPct)} of adequacy • ${compactCurrency(d.gap)} gap`;
      if (els.mapMetric.value === 'gapPerStudent') stat = `${currency0(d.gapPerStudent)} gap per student`;
      if (els.mapMetric.value === 'change') stat = `${signedNumber(d.changePctPoints)} percentage points from FY26`;
    }
    return `<div class="tip-name">${escapeHtml(name)}</div><div class="tip-stat">${escapeHtml(stat)}</div>`;
  }

  function selectDistrict(d, zoom) {
    selectedDistrict = d;
    els.emptyState.classList.add('hidden');
    els.districtDetails.classList.remove('hidden');
    els.districtDetails.innerHTML = detailHtml(d);
    if (boundaryLayer) boundaryLayer.setStyle(feature => styleForFeature(feature));
    if (zoom) {
      const layers = districtToLayers.get(d.districtCode) || [];
      if (layers.length) {
        const group = L.featureGroup(layers);
        map.fitBounds(group.getBounds(), { padding: [25, 25], maxZoom: 10 });
      }
    }
  }

  function detailHtml(d) {
    const pct = Number(d.adequacyPct);
    const width = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
    const barColor = metricColor({ ...d, adequacyPct: d.adequacyPct });
    const localLabel = d.affiliation === 'IFT-AFT' && d.iftLocal ? `IFT Local ${escapeHtml(String(d.iftLocal))}` : escapeHtml(d.affiliation || '—');
    return `
      <div class="detail-top">
        <div class="eyebrow">${escapeHtml(d.county || '')} County • ${escapeHtml(d.districtType || '')}</div>
        <h2>${escapeHtml(d.district)}</h2>
        <div class="detail-sub">${escapeHtml(d.city || '')}${d.affiliation ? ` <span class="pill">${localLabel}</span>` : ''}</div>
      </div>
      <div class="adequacy-hero">
        <div class="hero-number">${formatPct(d.adequacyPct)}</div>
        <div class="hero-label">FY2027 capacity to meet the EBF adequacy target • Tier ${escapeHtml(String(d.tier))}</div>
        <div class="adequacy-bar"><div class="adequacy-fill" style="width:${width}%;background:${barColor}"></div></div>
      </div>
      <div class="metric-grid">
        <div class="metric"><div class="metric-label">Funding gap</div><div class="metric-value">${compactCurrency(d.gap)}</div></div>
        <div class="metric"><div class="metric-label">Gap per student</div><div class="metric-value">${currency0(d.gapPerStudent)}</div></div>
        <div class="metric"><div class="metric-label">FY27 new funding</div><div class="metric-value">${compactCurrency(d.newFunding)}</div></div>
        <div class="metric"><div class="metric-label">Enrollment</div><div class="metric-value">${formatNumber(d.enrollment)}</div></div>
      </div>
      <div class="section-title">Year-over-year</div>
      <table class="detail-table">
        <tr><td>FY26 adequacy</td><td>${formatPct(d.fy26AdequacyPct)}</td></tr>
        <tr><td>Change</td><td>${signedNumber(d.changePctPoints)} pts</td></tr>
        <tr><td>FY26 funding gap</td><td>${compactCurrency(d.fy26Gap)}</td></tr>
      </table>
      <div class="section-title">Representation</div>
      <table class="detail-table">
        <tr><td>State House</td><td>${d.houseDistrict ? `District ${escapeHtml(String(d.houseDistrict))}` : '—'}${d.stateRep ? `<br>${escapeHtml(d.stateRep)}` : ''}</td></tr>
        <tr><td>State Senate</td><td>${d.senateDistrict ? `District ${escapeHtml(String(d.senateDistrict))}` : '—'}${d.stateSenator ? `<br>${escapeHtml(d.stateSenator)}` : ''}</td></tr>
      </table>
      <div class="section-title">Student population</div>
      <table class="detail-table">
        <tr><td>Low income</td><td>${formatPct(d.lowIncomePct)}</td></tr>
        <tr><td>IEP</td><td>${formatPct(d.iepPct)}</td></tr>
        <tr><td>English learners</td><td>${formatPct(d.elPct)}</td></tr>
        <tr><td>Black</td><td>${formatPct(d.blackPct)}</td></tr>
        <tr><td>Hispanic / Latino</td><td>${formatPct(d.hispanicPct)}</td></tr>
        <tr><td>White</td><td>${formatPct(d.whitePct)}</td></tr>
      </table>
      <div class="source-small">Funding and demographic values come from the spreadsheet supplied for this project. The FY27 funding gap is the dollar amount below adequacy reported in that file.</div>
    `;
  }

  function bindControls() {
    els.mapMetric.addEventListener('change', () => {
      renderLegend();
      if (boundaryLayer) boundaryLayer.setStyle(feature => styleForFeature(feature));
    });
    els.iftOnly.addEventListener('change', redrawBoundaries);
    els.typeFilters.addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      currentType = btn.dataset.type;
      els.typeFilters.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      redrawBoundaries();
    });
    els.resetView.addEventListener('click', () => map.fitBounds(ILLINOIS_BOUNDS));
    els.clearSearch.addEventListener('click', () => {
      els.search.value = '';
      els.searchResults.style.display = 'none';
      els.search.focus();
    });
    els.search.addEventListener('input', runSearch);
    document.addEventListener('click', e => {
      if (e.target !== els.search && !els.searchResults.contains(e.target)) els.searchResults.style.display = 'none';
    });
  }

  function runSearch() {
    const q = els.search.value.trim().toLowerCase();
    if (!q) { els.searchResults.style.display = 'none'; return; }
    const results = DATA
      .map(d => ({ d, score: searchScore(d, q) }))
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score || a.d.district.localeCompare(b.d.district))
      .slice(0, 12);
    if (!results.length) {
      els.searchResults.innerHTML = '<div class="search-result"><strong>No matching district</strong></div>';
    } else {
      els.searchResults.innerHTML = results.map((x,i) => `<div class="search-result" role="option" data-i="${i}"><strong>${escapeHtml(x.d.district)}</strong><span>${escapeHtml(x.d.city || '')}${x.d.county ? ` • ${escapeHtml(x.d.county)} County` : ''} • ${formatPct(x.d.adequacyPct)}</span></div>`).join('');
      els.searchResults.querySelectorAll('.search-result[data-i]').forEach(node => node.addEventListener('click', () => {
        const d = results[Number(node.dataset.i)].d;
        els.search.value = d.district;
        els.searchResults.style.display = 'none';
        if (d.districtType !== currentType && currentType !== 'all') {
          currentType = 'all';
          els.typeFilters.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'all'));
          redrawBoundaries();
        }
        if (els.iftOnly.checked && d.affiliation !== 'IFT-AFT') {
          els.iftOnly.checked = false;
          redrawBoundaries();
        }
        selectDistrict(d, true);
      }));
    }
    els.searchResults.style.display = 'block';
  }

  function searchScore(d, q) {
    const name = (d.district || '').toLowerCase();
    const city = (d.city || '').toLowerCase();
    const county = (d.county || '').toLowerCase();
    const local = d.iftLocal ? String(d.iftLocal) : '';
    if (name === q) return 100;
    if (name.startsWith(q)) return 90;
    if (name.includes(q)) return 75;
    if (city === q) return 65;
    if (city.includes(q)) return 55;
    if (county.includes(q)) return 35;
    if (local === q) return 30;
    return 0;
  }

  function matchFeature(feature) {
    if (featureToDistrict.has(feature)) return featureToDistrict.get(feature);
    const name = featureName(feature);
    const variants = featureKeys(name);
    for (const key of variants) {
      const candidates = dataByKey.get(key);
      if (candidates && candidates.length === 1) return candidates[0];
      if (candidates && candidates.length > 1) {
        const picked = disambiguate(name, candidates);
        if (picked) return picked;
      }
    }

    const featureNums = numberTokens(name);
    if (featureNums.length) {
      const narrowed = DATA.filter(d => sameNumbers(featureNums, numberTokens(d.district)));
      if (narrowed.length === 1) return narrowed[0];
      if (narrowed.length > 1) {
        const picked = bestTokenMatch(name, narrowed);
        if (picked && picked.score >= 0.45) return picked.d;
      }
    }

    const picked = bestTokenMatch(name, DATA);
    return picked && picked.score >= 0.72 ? picked.d : null;
  }

  function disambiguate(name, candidates) {
    const best = bestTokenMatch(name, candidates);
    return best && best.score >= 0.35 ? best.d : null;
  }

  function bestTokenMatch(name, candidates) {
    const a = tokenSet(name);
    let best = null;
    for (const d of candidates) {
      const b = tokenSet(d.district);
      const score = jaccard(a, b);
      if (!best || score > best.score) best = { d, score };
    }
    return best;
  }

  function allKeysForDistrict(d) {
    const keys = new Set(featureKeys(d.district));
    if (d.city) {
      const nums = numberTokens(d.district).join(' ');
      keys.add(canonical(`${d.city} ${nums}`));
    }
    return Array.from(keys).filter(Boolean);
  }

  function featureKeys(name) {
    const base = canonical(name);
    const stripped = canonical(stripInstitutionWords(name));
    const cityLike = canonical(stripInstitutionWords(name).replace(/^city of /i,''));
    return Array.from(new Set([base, stripped, cityLike])).filter(Boolean);
  }

  function canonical(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g,' and ')
      .replace(/city of chicago school district 299/g,'chicago 299')
      .replace(/chicago public schools district 299/g,'chicago 299')
      .replace(/community consolidated school district/g,'ccsd')
      .replace(/community unit school district/g,'cusd')
      .replace(/community high school district/g,'chsd')
      .replace(/township high school district/g,'thsd')
      .replace(/elementary school district/g,'esd')
      .replace(/public school district/g,'sd')
      .replace(/school district/g,'sd')
      .replace(/comm cons sch dist/g,'ccsd')
      .replace(/comm unit sch dist/g,'cusd')
      .replace(/comm h s dist/g,'chsd')
      .replace(/unit dist/g,'cusd')
      .replace(/school dist/g,'sd')
      .replace(/sch dist/g,'sd')
      .replace(/[^a-z0-9]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function stripInstitutionWords(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\b(community|comm|consolidated|cons|unit|public|elementary|elem|high|township|twp|school|sch|district|dist|schools|usd|cusd|ccsd|chsd|thsd|esd|sd|c u|c c|h s|u s d)\b/g,' ')
      .replace(/[^a-z0-9]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function tokenSet(value) {
    return new Set(stripInstitutionWords(value).split(' ').filter(Boolean));
  }

  function numberTokens(value) {
    return String(value || '').match(/\d+(?:[-.]\d+)?/g)?.map(x => x.replace(/[-.]/g,'')) || [];
  }

  function sameNumbers(a,b) {
    if (a.length !== b.length) return false;
    const aa=[...a].sort().join('|'), bb=[...b].sort().join('|');
    return aa===bb;
  }

  function jaccard(a,b) {
    if (!a.size || !b.size) return 0;
    let inter=0;
    a.forEach(x => { if (b.has(x)) inter++; });
    return inter / (a.size + b.size - inter);
  }

  function featureName(feature) {
    const p = feature && feature.properties ? feature.properties : {};
    return p.NAME || p.NAME25 || p.NAMELSAD || p.SDNAME || p.LEA_NAME || p.NAME24 || p.NAME23 || 'Unnamed district';
  }

  function compactCurrency(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e9) return `$${(n/1e9).toFixed(abs >= 10e9 ? 0 : 1)}B`;
    if (abs >= 1e6) return `$${(n/1e6).toFixed(abs >= 10e6 ? 0 : 1)}M`;
    if (abs >= 1e3) return `$${(n/1e3).toFixed(abs >= 10e3 ? 0 : 1)}K`;
    return currency0(n);
  }

  function currency0(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
  }

  function formatNumber(value) {
    const n=Number(value); return Number.isFinite(n)?new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n):'—';
  }
  function formatPct(value) {
    const n=Number(value); return Number.isFinite(n)?`${n.toFixed(1)}%`:'—';
  }
  function signedNumber(value) {
    const n=Number(value); if(!Number.isFinite(n)) return '—'; return `${n>0?'+':''}${n.toFixed(1)}`;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
})();
