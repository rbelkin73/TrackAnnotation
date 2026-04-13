// ═══════════════════════════════════════════════
// EVENTS — детекция и рендер событий
// ═══════════════════════════════════════════════

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

function _maxOf(arr) {
    let m = 0;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] > m) m = arr[i];
    }
    return m || 1;
}

function _normalize(arr) {
    const max = _maxOf(arr);
    const out = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
    return out;
}

function _getMonoBuffer() {
    const chL = APP.audioBuffer.getChannelData(0);
    const chR = APP.audioBuffer.numberOfChannels > 1
        ? APP.audioBuffer.getChannelData(1)
        : chL;

    const len = Math.min(chL.length, chR.length);
    const mono = new Float32Array(len);

    for (let i = 0; i < len; i++) {
        mono[i] = 0.5 * (chL[i] + chR[i]);
    }
    return mono;
}

function _pushPointEvent(events, type, timeSec, intensity, confidence = 'mid') {
    const snapped = snapToBar(timeSec);
    events.push({
        type,
        startTime: snapped,
        endTime: snapped,
        bar: timeToBar(snapped),
        beat: 1,
        endBar: timeToBar(snapped),
        intensity: parseFloat((intensity || 0).toFixed(2)),
        confidence,
        label: '',
    });
}

function _pushRangeEvent(events, type, startTime, endTime, extra = {}) {
    if (endTime <= startTime) return;

    const startSnap = snapToBar(startTime);
    const finalStart = startSnap;
    const finalEnd   = Math.max(endTime, finalStart + 0.001);

    events.push({
        type,
        startTime: finalStart,
        endTime: finalEnd,
        bar: timeToBar(finalStart),
        beat: 1,
        endBar: Math.max(timeToBar(finalStart), timeToBar(finalEnd)),
        intensity: extra.intensity !== undefined
            ? parseFloat(extra.intensity.toFixed(2))
            : 0,
        confidence: extra.confidence || 'mid',
        label: extra.label || '',
        energyStart: extra.energyStart,
        energyEnd: extra.energyEnd,
    });
}

function _dedupeEvents(events) {
    events.sort((a, b) => a.startTime - b.startTime);

    const out = [];
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const prev = out[out.length - 1];

        if (!prev) {
            out.push(ev);
            continue;
        }

        const sameType = prev.type === ev.type;
        const closePoint =
            EVENT_TYPES[ev.type] &&
            EVENT_TYPES[ev.type].kind === 'point' &&
            Math.abs(prev.startTime - ev.startTime) < 0.15;

        const overlapRange =
            EVENT_TYPES[ev.type] &&
            EVENT_TYPES[ev.type].kind === 'range' &&
            prev.type === ev.type &&
            ev.startTime <= prev.endTime &&
            ev.endTime >= prev.startTime;

        if (sameType && closePoint) {
            if ((ev.intensity || 0) > (prev.intensity || 0)) {
                out[out.length - 1] = ev;
            }
            continue;
        }

        if (overlapRange) {
            prev.startTime = Math.min(prev.startTime, ev.startTime);
            prev.endTime   = Math.max(prev.endTime, ev.endTime);
            prev.bar       = timeToBar(prev.startTime);
            prev.endBar    = timeToBar(prev.endTime);
            prev.intensity = parseFloat(
                (((prev.intensity || 0) + (ev.intensity || 0)) / 2).toFixed(2)
            );
            continue;
        }

        out.push(ev);
    }

    return out;
}

// ───────────────────────────────────────────────
// Kick onset detection
// ───────────────────────────────────────────────
// Возвращает:
// - kickTimes: массив времен киков
// - kickDensity: плотность по 4-барным блокам для sections.js
// - kickStrength: нормализованная "сила" по onset-окнам
// - onsetStepSec: шаг onset-окон

function detectKickOnsets() {
    const sr = APP.audioBuffer.sampleRate;
    const chL = APP.audioBuffer.getChannelData(0);
    const chR = APP.audioBuffer.numberOfChannels > 1
        ? APP.audioBuffer.getChannelData(1)
        : chL;

    const len = Math.min(chL.length, chR.length);
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) mono[i] = 0.5 * (chL[i] + chR[i]);

    const barSamples   = Math.round(sr * (60 / APP.bpm) * 4);
    const blockSamples = barSamples * 4;
    const numBlocks    = Math.floor(len / blockSamples);

    // фильтры
    const rcLow    = Math.exp(-2 * Math.PI * 140  / sr);
    const rcMid    = Math.exp(-2 * Math.PI * 1800 / sr);
    const rcSnareL = Math.exp(-2 * Math.PI * 900  / sr);
    const rcSnareH = Math.exp(-2 * Math.PI * 3200 / sr);

    const lowBuf   = new Float32Array(len);
    const highBuf  = new Float32Array(len);
    const snareBuf = new Float32Array(len);

    let yLow = 0, yMid = 0, ySnL = 0, ySnH = 0;

    for (let i = 0; i < len; i++) {
        const x = mono[i];

        yLow = rcLow * yLow + (1 - rcLow) * x;
        yMid = rcMid * yMid + (1 - rcMid) * x;

        ySnL = rcSnareL * ySnL + (1 - rcSnareL) * x;
        ySnH = rcSnareH * ySnH + (1 - rcSnareH) * x;

        lowBuf[i]   = yLow;
        highBuf[i]  = x - yMid;
        snareBuf[i] = ySnH - ySnL;
    }

    const winSec     = 0.02;
    const winSamples = Math.max(1, Math.round(sr * winSec));
    const numWins    = Math.floor(len / winSamples);

    const lowEnv    = new Float32Array(numWins);
    const highEnv   = new Float32Array(numWins);
    const snareEnv  = new Float32Array(numWins);
    const onsetFlux = new Float32Array(numWins);

    let prevHigh = 0;

    for (let w = 0; w < numWins; w++) {
        const s = w * winSamples;
        const e = Math.min(s + winSamples, len);
        const wl = e - s;

        let lowSum = 0, highSum = 0, snSum = 0, highAbs = 0;

        for (let i = s; i < e; i++) {
            lowSum  += lowBuf[i]   * lowBuf[i];
            highSum += highBuf[i]  * highBuf[i];
            snSum   += snareBuf[i] * snareBuf[i];
            highAbs += Math.abs(highBuf[i]);
        }

        lowEnv[w]   = Math.sqrt(lowSum / wl);
        highEnv[w]  = Math.sqrt(highSum / wl);
        snareEnv[w] = Math.sqrt(snSum / wl);

        const curHigh = highAbs / wl;
        onsetFlux[w] = w === 0 ? 0 : Math.max(0, curHigh - prevHigh);
        prevHigh = curHigh;
    }

    const prefixLow = new Float32Array(numWins + 1);
    for (let i = 0; i < numWins; i++) {
        prefixLow[i + 1] = prefixLow[i] + lowEnv[i];
    }

    const kickTimes = [];
    const minIntervalW = Math.max(2, Math.round(0.085 / winSec));
    const localWins    = Math.max(4, Math.round(0.30 / winSec));
    let lastKick = -minIntervalW;

    for (let w = 1; w < numWins - 1; w++) {
        const s = Math.max(0, w - localWins);
        const e = Math.min(numWins, w + localWins + 1);
        const mean = (prefixLow[e] - prefixLow[s]) / Math.max(1, e - s);
        const thr  = Math.max(0.006, mean * 1.55);

        const peak =
            lowEnv[w] > thr &&
            lowEnv[w] > lowEnv[w - 1] &&
            lowEnv[w] >= lowEnv[w + 1] &&
            (w - lastKick) >= minIntervalW;

        if (peak) {
            kickTimes.push((w * winSamples) / sr);
            lastKick = w;
        }
    }

    const kickDensity = new Float32Array(numBlocks);
    let p = 0;
    for (let b = 0; b < numBlocks; b++) {
        const blockStart = (b * blockSamples) / sr;
        const blockEnd   = blockStart + blockSamples / sr;

        while (p < kickTimes.length && kickTimes[p] < blockStart) p++;

        let q = p, count = 0;
        while (q < kickTimes.length && kickTimes[q] < blockEnd) {
            count++;
            q++;
        }

        kickDensity[b] = Math.min(1, count / 8);
    }

    return {
        kickTimes,
        kickDensity,
        lowEnv,
        highEnv,
        snareEnv,
        onsetFlux,
        envStepSec: winSec,
    };
}

// ───────────────────────────────────────────────
// Detect events
// ───────────────────────────────────────────────

function detectEvents(features, kickData) {
    const events = [];
    const { rms, sub, high, flux, numBlocks, blockSamples } = features;
    const { kickTimes, lowEnv, highEnv, snareEnv, onsetFlux, envStepSec } = kickData;
    const sr = APP.audioBuffer.sampleRate;

    const normalize = (arr) => {
        let max = 0;
        for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
        max = max || 1;
        return Array.from(arr, v => v / max);
    };

    const nRms  = normalize(rms);
    const nSub  = normalize(sub);
    const nHigh = normalize(high);
    const nFlux = normalize(flux);

    const nLowEnv   = normalize(lowEnv);
    const nHighEnv  = normalize(highEnv);
    const nSnareEnv = normalize(snareEnv);
    const nOnset    = normalize(onsetFlux);

    const barDur  = (60 / APP.bpm) * 4;
    const beatDur = 60 / APP.bpm;

    function pushPoint(type, t, intensity, confidence = 'mid') {
        const ts = snapToBar(t);
        events.push({
            type,
            startTime: ts,
            endTime: ts,
            bar: timeToBar(ts),
            beat: 1,
            endBar: timeToBar(ts),
            intensity: parseFloat((intensity || 0).toFixed(2)),
            confidence,
            label: '',
        });
    }

    function pushRange(type, ts, te, extra = {}) {
        if (te <= ts) return;
        const ss = snapToBar(ts);
        events.push({
            type,
            startTime: ss,
            endTime: te,
            bar: timeToBar(ss),
            beat: 1,
            endBar: Math.max(timeToBar(ss), timeToBar(te)),
            intensity: parseFloat((extra.intensity || 0).toFixed(2)),
            confidence: extra.confidence || 'mid',
            label: '',
            energyStart: extra.energyStart,
            energyEnd: extra.energyEnd,
        });
    }

    // ── impacts ──
    for (let b = 1; b < numBlocks; b++) {
        const jumpR = nRms[b] - nRms[b - 1];
        const jumpS = nSub[b] - nSub[b - 1];

        if (nRms[b] > 0.58 && nSub[b] > 0.46 && jumpR > 0.12 && jumpS > 0.08) {
            const t = APP.offset + (b * blockSamples) / sr;

            const last = events.filter(e => e.type === 'impact').slice(-1)[0];
            if (last && t - last.startTime < barDur * 4) continue;

            pushPoint('impact', t, nRms[b], nRms[b] > 0.72 ? 'high' : 'mid');
        }
    }

    // ── breaks ──
    {
        let start = -1;
        for (let b = 0; b < numBlocks; b++) {
            const lowGone  = nSub[b] < 0.22;
            const rmsLow   = nRms[b] < 0.40;
            const brightOk = nHigh[b] > 0.14; // голос/атмосфера еще могут быть

            const isBreak = lowGone && rmsLow && brightOk;

            if (isBreak) {
                if (start === -1) start = b;
            } else if (start !== -1) {
                const end = b - 1;
                const bars = (end - start + 1) * 4;
                if (bars >= 1 && bars <= 4) {
                    const ts = APP.offset + (start * blockSamples) / sr;
                    const te = APP.offset + ((end + 1) * blockSamples) / sr;
                    pushRange('break', ts, te, {
                        intensity: 0.20,
                        confidence: 'mid',
                        energyStart: parseFloat(nRms[start].toFixed(2)),
                        energyEnd: parseFloat(nRms[end].toFixed(2)),
                    });
                }
                start = -1;
            }
        }
    }

 // ── risers: Поиск устойчивого роста "напряжения" (Tension) ──
    {
        // Tension = (High + Mid) / (Sub + 0.1)
        const tension = new Float32Array(numBlocks);
        for (let b = 0; b < numBlocks; b++) {
            tension[b] = (nHigh[b] * 0.7 + nRms[b] * 0.3) / (nSub[b] + 0.1);
        }

        let riserStart = -1;
        let riserLen = 0;

        for (let b = 1; b < numBlocks; b++) {
            // Растет ли напряжение и нет ли плотного саба/кика?
            const isRising = tension[b] > tension[b - 1] + 0.05;
            const noHeavyBass = nSub[b] < 0.5;

            if (isRising && noHeavyBass) {
                if (riserStart === -1) riserStart = b - 1;
                riserLen++;
            } else {
                // Если разгон длился хотя бы 2 блока (8 баров)
                if (riserLen >= 2) {
                    const ts = APP.offset + (riserStart * blockSamples) / sr;
                    const te = APP.offset + (b * blockSamples) / sr;
                    const eStart = parseFloat(nRms[riserStart].toFixed(2));
                    const eEnd   = parseFloat(nRms[b-1].toFixed(2));
                    
                    // Проверка: энергия реально выросла?
                    if (eEnd > eStart) {
                        pushRange('riser', ts, te, {
                            intensity: eEnd,
                            confidence: riserLen >= 4 ? 'high' : 'mid',
                            energyStart: eStart,
                            energyEnd: eEnd,
                        });
                    }
                }
                riserStart = -1;
                riserLen = 0;
            }
        }
    }
    
    
    
    // ── snare rolls: accelerating hit density before impact ──
    {
        const stepPerBar = Math.round(barDur / envStepSec);
        const minSteps = Math.max(8, stepPerBar * 2); // минимум 2 бара

        const impacts = events.filter(e => e.type === 'impact');

        for (const imp of impacts) {
            const endStep = Math.floor((imp.startTime - APP.offset) / envStepSec);
            const startStep = Math.max(0, endStep - stepPerBar * 4); // максимум 4 бара до дропа

            if (endStep - startStep < minSteps) continue;

            const segment = nSnareEnv.slice(startStep, endStep);
            if (segment.length < 8) continue;

            const third = Math.floor(segment.length / 3);
            const a = segment.slice(0, third);
            const b = segment.slice(third, third * 2);
            const c = segment.slice(third * 2);

            const mean = arr => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);

            const m1 = mean(a);
            const m2 = mean(b);
            const m3 = mean(c);

            const accel = (m2 > m1 + 0.05) && (m3 > m2 + 0.05) && m3 > 0.22;

            if (!accel) continue;

            const ts = APP.offset + startStep * envStepSec;
            const te = APP.offset + endStep   * envStepSec;

            pushRange('snare_roll', ts, te, {
                intensity: (m1 + m2 + m3) / 3,
                confidence: m3 > 0.35 ? 'high' : 'mid',
                energyStart: parseFloat(m1.toFixed(2)),
                energyEnd: parseFloat(m3.toFixed(2)),
            });

      // ── drum_fills: Анализ последних 1-2 баров перед сменой квадрата ──
    {
        // В DnB фразы идут по 16 баров.
        for (let b = 1; b < numBlocks; b++) {
            // Проверяем "провал" в басе и скачок плотности транзиентов 
            // Это часто случается прямо перед дропом или сменой части
            const dropInSub = nSub[b] < nSub[b-1] - 0.2;
            const highFlux = nFlux[b] > 0.4;
            
            if (dropInSub && highFlux) {
                // Вычисляем точное время блока
                const ts = APP.offset + (b * blockSamples) / sr;
                const te = APP.offset + ((b + 1) * blockSamples) / sr;
                
                // Snap к сетке. Если это попадает на 15-16 бар фразы — это 100% сбивка.
                const bar = timeToBar(ts);
                if (bar % 16 >= 14 || bar % 16 === 0) {
                     pushRange('drum_fill', ts, te, {
                        intensity: nFlux[b],
                        confidence: 'high',
                        energyStart: parseFloat(nRms[b-1].toFixed(2)),
                        energyEnd: parseFloat(nRms[b].toFixed(2)),
                    });
                }
            }
        }
    }
    
    // ── kick_rolls: Быстрое ускорение бочки (IOI < 150ms) ──
    {
        if (kickTimes.length > 4) {
            let rollStartIdx = -1;
            let rollCount = 0;

            for (let i = 1; i < kickTimes.length; i++) {
                const ioi = kickTimes[i] - kickTimes[i-1];
                
                // В DnB (174 BPM) 1/8 доля = ~172мс. Меньше 150мс = ролл 1/16 или 1/32
                if (ioi > 0.04 && ioi < 0.15) { 
                    if (rollStartIdx === -1) rollStartIdx = i - 1;
                    rollCount++;
                } else {
                    if (rollCount >= 3) { // Минимум 4 удара подряд с высокой скоростью
                        const ts = kickTimes[rollStartIdx];
                        const te = kickTimes[i-1];
                        pushRange('snare_roll', ts, te + 0.1, { // Можно использовать твой тип snare_roll или добавить kick_roll
                            intensity: 0.9,
                            confidence: rollCount >= 6 ? 'high' : 'mid'
                        });
                    }
                    rollStartIdx = -1;
                    rollCount = 0;
                }
            }
        }
    }
    
    

    // ── bridge candidates ──
    {
        for (let b = 1; b < numBlocks - 1; b++) {
            const midEnergy = nRms[b] > 0.35 && nRms[b] < 0.65;
            const subDip    = nSub[b] < nSub[b - 1] - 0.08;
            const notBreak  = nSub[b] > 0.18;

            if (midEnergy && subDip && notBreak) {
                const ts = APP.offset + (b * blockSamples) / sr;
                const te = ts + barDur;
                pushRange('bridge', ts, te, {
                    intensity: nRms[b],
                    confidence: 'low',
                    energyStart: parseFloat(nRms[b].toFixed(2)),
                    energyEnd: parseFloat(nRms[b].toFixed(2)),
                });
            }
        }
    }

    // cleanup
    events.sort((a, b) => a.startTime - b.startTime);

    // merge overlapping same-type ranges
    const merged = [];
    for (const ev of events) {
        const prev = merged[merged.length - 1];
        if (
            prev &&
            prev.type === ev.type &&
            EVENT_TYPES[ev.type]?.kind === 'range' &&
            ev.startTime <= prev.endTime + 0.15
        ) {
            prev.endTime = Math.max(prev.endTime, ev.endTime);
            prev.endBar  = Math.max(prev.endBar, ev.endBar);
            prev.intensity = parseFloat(((prev.intensity + ev.intensity) / 2).toFixed(2));
            prev.energyEnd = ev.energyEnd ?? prev.energyEnd;
        } else {
            merged.push(ev);
        }
    }

    return merged;
}


// ═══════════════════════════════════════════════
// RENDER EVENTS LIST
// ═══════════════════════════════════════════════

function renderEventsList() {
    const list = document.getElementById('eventsList');
    list.innerHTML = '';

    if (APP.events.length === 0) {
        list.innerHTML = '<div class="empty-state">No events detected</div>';
        return;
    }

    APP.events.forEach((ev, idx) => renderEventRow(ev, idx, list));
}

function renderEventRow(ev, idx, container) {
    const info = EVENT_TYPES[ev.type] || EVENT_TYPES.impact;
    const row  = document.createElement('div');
    row.className = `event-row event-kind-${info.kind}`;

    const dot = document.createElement('div');
    dot.className = 'event-dot';
    dot.style.background = info.color;

    const typeSelect = document.createElement('select');
    typeSelect.className = 'event-type-select';

    EVENT_OPTIONS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = EVENT_TYPES[opt].label;
        if (opt === ev.type) o.selected = true;
        typeSelect.appendChild(o);
    });

    typeSelect.addEventListener('change', e => {
        const newType = e.target.value;
        APP.events[idx].type = newType;
        const ni = EVENT_TYPES[newType];
        dot.style.background = ni.color;

        if (ni.kind === 'range' &&
            APP.events[idx].endTime <= APP.events[idx].startTime) {
            const barDur = (60 / APP.bpm) * 4;
            APP.events[idx].endTime = APP.events[idx].startTime + barDur * 4;
            APP.events[idx].endBar  = timeToBar(APP.events[idx].endTime);
        }

        row.className = `event-row event-kind-${ni.kind}`;
        drawEventTimeline();
        drawWaveform();
        renderEventsList();
    });

    const startBarEl = document.createElement('input');
    startBarEl.type = 'number';
    startBarEl.className = 'bar-input';
    startBarEl.value = ev.bar || 1;
    startBarEl.title = 'Start bar';
    startBarEl.addEventListener('change', e => {
        const val = parseInt(e.target.value) || 1;
        APP.events[idx].bar = val;
        APP.events[idx].startTime = barToTime(val);

        if (APP.events[idx].endBar < val) {
            APP.events[idx].endBar = val;
            APP.events[idx].endTime = barToTime(val + 1);
        }

        drawEventTimeline();
        drawWaveform();
        renderEventsList();
    });

    const endBarEl = document.createElement('input');
    endBarEl.type = 'number';
    endBarEl.className = 'bar-input';
    endBarEl.value = ev.endBar || ev.bar || 1;
    endBarEl.title = 'End bar';
    endBarEl.style.display = info.kind === 'range' ? '' : 'none';
    endBarEl.addEventListener('change', e => {
        const val = parseInt(e.target.value) || 1;
        const clamped = Math.max(APP.events[idx].bar, val);
        e.target.value = clamped;
        APP.events[idx].endBar  = clamped;
        APP.events[idx].endTime = barToTime(clamped + 1);
        drawEventTimeline();
    });

    const arrow = document.createElement('span');
    arrow.textContent = '→';
    arrow.style.cssText = 'color:#475569;font-size:13px;flex-shrink:0';
    arrow.style.display = info.kind === 'range' ? '' : 'none';

    const timeEl = document.createElement('div');
    timeEl.className = 'event-time';
    timeEl.textContent = formatTime(ev.startTime);

    const barInfo = info.kind === 'range'
        ? `Bar ${ev.bar}–${ev.endBar || ev.bar}`
        : `Bar ${ev.bar}.${ev.beat || 1}`;

    const barEl = document.createElement('div');
    barEl.className = 'event-bar-info';
    barEl.textContent = barInfo;

    const intEl = document.createElement('div');
    intEl.className = 'event-intensity';
    intEl.textContent = `I:${ev.intensity || 0}`;

    const energyEl = document.createElement('div');
    energyEl.className = 'event-intensity';
    energyEl.style.display = info.kind === 'range' ? '' : 'none';
    energyEl.textContent = ev.energyStart !== undefined
        ? `E:${ev.energyStart}→${ev.energyEnd}`
        : '';

    const badge = document.createElement('span');
    badge.className = `confidence-badge conf-${ev.confidence || 'mid'}`;
    badge.textContent = (ev.confidence || 'mid').toUpperCase();

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'event-label-input';
    labelInput.placeholder = 'Label (optional)';
    labelInput.value = ev.label || '';
    labelInput.addEventListener('input', e => {
        APP.events[idx].label = e.target.value;
    });

    const jumpBtn = document.createElement('button');
    jumpBtn.className = 'event-jump';
    jumpBtn.textContent = '▶';
    jumpBtn.title = 'Jump to event';
    jumpBtn.addEventListener('click', () => seekTo(ev.startTime));

    const delBtn = document.createElement('button');
    delBtn.className = 'event-delete';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
        APP.events.splice(idx, 1);
        renderEventsList();
        drawEventTimeline();
        drawWaveform();
    });

    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0';
    barWrap.appendChild(startBarEl);
    barWrap.appendChild(arrow);
    barWrap.appendChild(endBarEl);

    row.appendChild(dot);
    row.appendChild(typeSelect);
    row.appendChild(barWrap);
    row.appendChild(timeEl);
    row.appendChild(barEl);
    row.appendChild(intEl);
    row.appendChild(energyEl);
    row.appendChild(badge);
    row.appendChild(labelInput);
    row.appendChild(jumpBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
}

// ───────────────────────────────────────────────
// Add event manually
// ───────────────────────────────────────────────

function addEventManual() {
    if (!APP.duration) return;

    const snapped = snapToBar(APP.currentTime);
    const bar  = timeToBar(snapped);
    const beat = timeToBeat(snapped);

    const newEv = {
        type: 'impact',
        startTime: snapped,
        endTime: snapped,
        bar,
        beat,
        endBar: bar,
        intensity: 0.8,
        confidence: 'low',
        label: '',
    };

    APP.events.push(newEv);
    APP.events.sort((a, b) => a.startTime - b.startTime);
    renderEventsList();
    drawEventTimeline();
    drawWaveform();
}