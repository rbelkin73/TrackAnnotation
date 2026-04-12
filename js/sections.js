// ═══════════════════════════════════════════════
// SECTIONS — анализ структуры + рендер списка
// ═══════════════════════════════════════════════

// ─── Extract features — СИНХРОННО, без OfflineAudioContext ──

function extractFeatures() {
    const sr           = APP.audioBuffer.sampleRate;
    const ch           = APP.audioBuffer.getChannelData(0);
    const total        = ch.length;
    const barSamples   = Math.round(sr * (60 / APP.bpm) * 4);
    const blockSamples = barSamples * 4;
    const numBlocks    = Math.floor(total / blockSamples);

    const rms  = new Float32Array(numBlocks);
    const sub  = new Float32Array(numBlocks);
    const high = new Float32Array(numBlocks);
    const flux = new Float32Array(numBlocks);
    const mid  = new Float32Array(numBlocks);

    // IIR фильтры
    const rcSub  = Math.exp(-2 * Math.PI * 80   / sr);
    const rcMid  = Math.exp(-2 * Math.PI * 2000 / sr);

    const subBuf  = new Float32Array(total);
    const midBuf  = new Float32Array(total);
    const highBuf = new Float32Array(total);

    let ySub = 0, yMid = 0;
    for (let i = 0; i < total; i++) {
        const x  = ch[i];
        ySub     = rcSub * ySub + (1 - rcSub) * x;
        yMid     = rcMid * yMid + (1 - rcMid) * x;
        subBuf[i]  = ySub;
        midBuf[i]  = yMid - ySub;
        highBuf[i] = x    - yMid;
    }

    let prevSubRms = 0, prevMidRms = 0, prevHighRms = 0;

    for (let b = 0; b < numBlocks; b++) {
        const start = b * blockSamples;
        const end   = Math.min(start + blockSamples, total);
        const len   = end - start;

        let sumRms = 0, sumSub = 0, sumMid = 0, sumHigh = 0;
        for (let i = start; i < end; i++) {
            sumRms  += ch[i]      * ch[i];
            sumSub  += subBuf[i]  * subBuf[i];
            sumMid  += midBuf[i]  * midBuf[i];
            sumHigh += highBuf[i] * highBuf[i];
        }

        rms[b]  = Math.sqrt(sumRms  / len);
        sub[b]  = Math.sqrt(sumSub  / len);
        mid[b]  = Math.sqrt(sumMid  / len);
        high[b] = Math.sqrt(sumHigh / len);

        flux[b] = Math.abs(sub[b]  - prevSubRms)  * 1.5 +
                  Math.abs(mid[b]  - prevMidRms)  * 1.0 +
                  Math.abs(high[b] - prevHighRms) * 0.5;

        prevSubRms  = sub[b];
        prevMidRms  = mid[b];
        prevHighRms = high[b];
    }

    return { rms, sub, high, flux, mid, numBlocks, blockSamples };
}

// ─── Build sections ───────────────────────────────

function buildSections(features, kickDensity) {
    const { rms, sub, high, flux, numBlocks, blockSamples } = features;
    const sr = APP.audioBuffer.sampleRate;

    const normalize = arr => {
        let max = 0;
        for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
        max = max || 1;
        return Array.from(arr, v => v / max);
    };

    const nRms  = normalize(rms);
    const nSub  = normalize(sub);
    const nHigh = normalize(high);
    const nFlux = normalize(flux);
    const nKick = kickDensity ? Array.from(kickDensity) : new Array(numBlocks).fill(0);

    const macro = new Array(numBlocks).fill('INTRO');

    // coarse classification on 4-bar blocks
    for (let i = 0; i < numBlocks; i++) {
        const r = nRms[i];
        const s = nSub[i];
        const h = nHigh[i];
        const k = nKick[i];

        const nearStart = i < 2;
        const nearEnd   = i >= numBlocks - 2;

        if (nearStart && r < 0.45 && k < 0.28) {
            macro[i] = 'INTRO';
        } else if (nearEnd && r < 0.60 && s < 0.55) {
            macro[i] = 'OUTRO';
        } else if (r > 0.70 && s > 0.58 && k > 0.38) {
            macro[i] = 'DROP';
        } else if (r < 0.35 && s < 0.25 && h > 0.18) {
            macro[i] = 'BREAKDOWN';
        } else if (r > 0.42 && r < 0.75 && (h > 0.22 || nFlux[i] > 0.20)) {
            macro[i] = 'BUILDUP';
        } else {
            macro[i] = 'BRIDGE';
        }
    }

    // smooth pass
    for (let i = 1; i < numBlocks - 1; i++) {
        if (macro[i - 1] === macro[i + 1] && macro[i] !== macro[i - 1]) {
            macro[i] = macro[i - 1];
        }
    }

    // convert to segments
    const raw = [];
    let start = 0;
    let cur   = macro[0];

    for (let i = 1; i <= numBlocks; i++) {
        const t = i < numBlocks ? macro[i] : null;
        if (t !== cur) {
            raw.push({
                type: cur,
                startBlock: start,
                endBlock: i - 1,
            });
            start = i;
            cur = t;
        }
    }

    // merge too-small macro segments
    const mergedMacro = [];
    for (const seg of raw) {
        const size = seg.endBlock - seg.startBlock + 1;
        if (size < 2 && mergedMacro.length) {
            mergedMacro[mergedMacro.length - 1].endBlock = seg.endBlock;
        } else {
            mergedMacro.push({ ...seg });
        }
    }

    // split each macro section into subsections by stable energy/groove changes
    const out = [];

    for (const seg of mergedMacro) {
        const blocks = [];
        for (let b = seg.startBlock; b <= seg.endBlock; b++) {
            blocks.push({
                b,
                rms:  nRms[b],
                sub:  nSub[b],
                high: nHigh[b],
                kick: nKick[b],
            });
        }

        const splitPoints = [];

        // split when stable layer change persists >= 2 macro blocks (8 bars)
        for (let i = 1; i < blocks.length - 1; i++) {
            const prev = blocks[i - 1];
            const cur  = blocks[i];
            const next = blocks[i + 1];

            const jumpKick = (cur.kick - prev.kick) > 0.12 && (next.kick - prev.kick) > 0.08;
            const jumpSub  = (cur.sub  - prev.sub)  > 0.10 && (next.sub  - prev.sub)  > 0.06;
            const jumpRms  = (cur.rms  - prev.rms)  > 0.08 && (next.rms  - prev.rms)  > 0.05;
            const dropKick = (prev.kick - cur.kick) > 0.12 && (prev.kick - next.kick) > 0.08;

            if (jumpKick || jumpSub || jumpRms || dropKick) {
                splitPoints.push(cur.b);
            }
        }

        const uniqSplits = [...new Set(splitPoints)]
            .filter(b => b > seg.startBlock && b <= seg.endBlock);

        let ss = seg.startBlock;
        let phase = 1;

        for (const sp of uniqSplits.concat([seg.endBlock + 1])) {
            const ee = sp - 1;

            let sumR = 0, sumS = 0;
            for (let b = ss; b <= ee; b++) {
                sumR += nRms[b];
                sumS += nSub[b];
            }

            const count = ee - ss + 1;
            const energyLevel = parseFloat(Math.min(1, (sumR / count) * 0.6 + (sumS / count) * 0.4).toFixed(2));

            const startTime = APP.offset + (ss * blockSamples) / sr;
            const endTime   = APP.offset + ((ee + 1) * blockSamples) / sr;
            const startBar  = timeToBar(startTime);
            const endBar    = Math.max(startBar, timeToBar(endTime) - 1);

            let labelBase = SECTION_TYPES[seg.type]?.label || seg.type;
            let label = labelBase;

            const macroLength = seg.endBlock - seg.startBlock + 1;
            if (macroLength >= 3) {
                label = `${labelBase} ${phase}`;
            }

            out.push({
                type: seg.type,
                label,
                startTime,
                endTime,
                startBar,
                endBar,
                energyLevel,
                confidence: count >= 2 ? 'high' : 'mid',
            });

            ss = sp;
            phase++;
        }
    }

    // final polish
    if (out.length) {
        out[0].type = 'INTRO';
        out[out.length - 1].type = 'OUTRO';
    }

    return out;
}
// ═══════════════════════════════════════════════
// RENDER SECTIONS LIST
// ═══════════════════════════════════════════════

function renderSectionsList() {
    const list = document.getElementById('sectionsList');
    list.innerHTML = '';

    if (APP.sections.length === 0) {
        list.innerHTML = '<div class="empty-state">No sections detected</div>';
        return;
    }

    APP.sections.forEach((s, idx) => {
        renderSectionRow(s, idx, list);
        if (idx < APP.sections.length - 1) {
            list.appendChild(makeAddSectionBtn(idx));
        }
    });
}

function renderSectionRow(s, idx, container) {
    const info = SECTION_TYPES[s.type] || SECTION_TYPES.INTRO;
    const row  = document.createElement('div');
    row.className = 'section-row';

    const colorBar            = document.createElement('div');
    colorBar.className        = 'section-color-bar';
    colorBar.style.background = info.color;

    const typeSelect = document.createElement('select');
    typeSelect.className = 'section-type-select';
    SECTION_OPTIONS.forEach(opt => {
        const o         = document.createElement('option');
        o.value         = opt;
        o.textContent   = SECTION_TYPES[opt].label;
        if (opt === s.type) o.selected = true;
        typeSelect.appendChild(o);
    });
    typeSelect.addEventListener('change', e => {
        APP.sections[idx].type        = e.target.value;
        colorBar.style.background     = SECTION_TYPES[e.target.value].color;
        drawSectionTimeline();
    });

    // startBar
    const startBarEl     = document.createElement('input');
    startBarEl.type      = 'number';
    startBarEl.className = 'bar-input';
    startBarEl.value     = s.startBar;
    if (idx === 0) startBarEl.readOnly = true;
    startBarEl.addEventListener('change', e => {
        const minVal  = idx === 0 ? 1 : APP.sections[idx-1].endBar + 1;
        const maxVal  = s.endBar - 1;
        const clamped = Math.max(minVal, Math.min(maxVal, parseInt(e.target.value) || minVal));
        e.target.value = clamped;
        APP.sections[idx].startBar  = clamped;
        APP.sections[idx].startTime = barToTime(clamped);
        if (idx > 0) {
            APP.sections[idx-1].endBar  = clamped - 1;
            APP.sections[idx-1].endTime = barToTime(clamped);
        }
        drawSectionTimeline();
        renderSectionsList();
    });

    const arrow           = document.createElement('span');
    arrow.textContent     = '→';
    arrow.style.cssText   = 'color:#475569;font-size:13px;flex-shrink:0';

    // endBar
    const endBarEl     = document.createElement('input');
    endBarEl.type      = 'number';
    endBarEl.className = 'bar-input';
    endBarEl.value     = s.endBar;
    if (idx === APP.sections.length - 1) endBarEl.readOnly = true;
    endBarEl.addEventListener('change', e => {
        const minVal  = s.startBar + 1;
        const maxVal  = idx < APP.sections.length - 1
            ? APP.sections[idx+1].endBar - 1
            : s.endBar;
        const clamped = Math.max(minVal, Math.min(maxVal, parseInt(e.target.value) || minVal));
        e.target.value = clamped;
        APP.sections[idx].endBar  = clamped;
        APP.sections[idx].endTime = barToTime(clamped + 1);
        if (idx < APP.sections.length - 1) {
            APP.sections[idx+1].startBar  = clamped + 1;
            APP.sections[idx+1].startTime = barToTime(clamped + 1);
        }
        drawSectionTimeline();
        renderSectionsList();
    });

    // время (read-only)
    const timeEl       = document.createElement('div');
    timeEl.className   = 'section-time';
    timeEl.textContent = `${formatTime(s.startTime)} – ${formatTime(s.endTime)}`;

    // energy level
    const energyEl       = document.createElement('div');
    energyEl.className   = 'event-intensity';
    energyEl.textContent = `E:${s.energyLevel || 0}`;

    // confidence badge
    const badge       = document.createElement('span');
    badge.className   = `confidence-badge conf-${s.confidence}`;
    badge.textContent = s.confidence.toUpperCase();

    // label
    const labelInput       = document.createElement('input');
    labelInput.type        = 'text';
    labelInput.className   = 'section-label-input';
    labelInput.placeholder = 'Label';
    labelInput.value       = s.label || '';
    labelInput.addEventListener('input', e => {
        APP.sections[idx].label = e.target.value;
        drawSectionTimeline();
    });

    // jump
    const jumpBtn       = document.createElement('button');
    jumpBtn.className   = 'section-jump';
    jumpBtn.textContent = '▶';
    jumpBtn.title       = 'Jump to section';
    jumpBtn.addEventListener('click', () => seekTo(s.startTime));

    // delete
    const delBtn       = document.createElement('button');
    delBtn.className   = 'section-delete';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => deleteSection(idx));

    // bar wrapper
    const barWrap         = document.createElement('div');
    barWrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0';
    barWrap.appendChild(startBarEl);
    barWrap.appendChild(arrow);
    barWrap.appendChild(endBarEl);

    row.appendChild(colorBar);
    row.appendChild(typeSelect);
    row.appendChild(barWrap);
    row.appendChild(timeEl);
    row.appendChild(energyEl);
    row.appendChild(badge);
    row.appendChild(labelInput);
    row.appendChild(jumpBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
}

function makeAddSectionBtn(afterIdx) {
    const wrap      = document.createElement('div');
    wrap.className  = 'add-section-btn-wrap';
    const btn       = document.createElement('button');
    btn.className   = 'add-section-btn';
    btn.textContent = '+';
    btn.title       = 'Add section here';
    btn.addEventListener('click', () => addSectionAfter(afterIdx));
    wrap.appendChild(btn);
    return wrap;
}

function deleteSection(idx) {
    if (APP.sections.length <= 1) return;
    APP.sections.splice(idx, 1);
    for (let i = 0; i < APP.sections.length; i++) {
        if (i === 0) {
            APP.sections[i].startBar  = 1;
            APP.sections[i].startTime = barToTime(1);
        } else {
            APP.sections[i].startBar  = APP.sections[i-1].endBar + 1;
            APP.sections[i].startTime = barToTime(APP.sections[i].startBar);
        }
    }
    const last    = APP.sections[APP.sections.length - 1];
    last.endTime  = APP.duration;
    last.endBar   = timeToBar(APP.duration) - 1;
    renderSectionsList();
    drawSectionTimeline();
}

function addSectionAfter(afterIdx) {
    const prev        = APP.sections[afterIdx];
    const next        = APP.sections[afterIdx + 1];
    const newStartBar = prev.endBar + 1;
    const newEndBar   = Math.min(newStartBar + 15, next.endBar - 1);
    if (newEndBar <= newStartBar) return;
    const newSec = {
        startBar:    newStartBar,
        endBar:      newEndBar,
        startTime:   barToTime(newStartBar),
        endTime:     barToTime(newEndBar + 1),
        type:        'TRANSITION',
        label:       '',
        energyLevel: 0.5,
        confidence:  'low',
    };
    next.startBar  = newEndBar + 1;
    next.startTime = barToTime(next.startBar);
    APP.sections.splice(afterIdx + 1, 0, newSec);
    renderSectionsList();
    drawSectionTimeline();
}