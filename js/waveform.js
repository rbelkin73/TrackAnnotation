// ═══════════════════════════════════════════════
// WAVEFORM — рисование, zoom, canvas sizing
// ═══════════════════════════════════════════════

// ─── Build waveform data (полная волна) ──────────

function buildWaveformData() {
    if (!APP.audioBuffer) return;
    const ch   = APP.audioBuffer.getChannelData(0);
    const N    = 4000;
    const step = Math.floor(ch.length / N) || 1;
    APP.waveformData = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const s = i * step;
        const e = Math.min(s + step, ch.length);
        let sum = 0;
        for (let j = s; j < e; j++) sum += Math.abs(ch[j]);
        APP.waveformData[i] = sum / (e - s);
    }
    updateWaveformView();
}

// ─── Update waveform view (под текущий zoom) ─────

function updateWaveformView() {
    if (!APP.waveformData || !APP.duration) return;

    const canvas = document.getElementById('waveformCanvas');
    const dpr    = window.devicePixelRatio || 1;
    const r      = canvas.getBoundingClientRect();
    const width  = Math.floor(r.width * dpr);

    const N          = APP.waveformData.length;
    const startRatio = APP.viewStart / APP.duration;
    const endRatio   = APP.viewEnd   / APP.duration;
    const startIdx   = Math.max(0, Math.floor(N * startRatio));
    const endIdx     = Math.min(N, Math.ceil(N * endRatio));
    const slice      = APP.waveformData.slice(startIdx, endIdx);

    APP.waveformView = new Float32Array(width);
    const ppp        = slice.length / width; // points per pixel

    for (let x = 0; x < width; x++) {
        const s = Math.floor(x * ppp);
        const e = Math.min(Math.floor((x + 1) * ppp), slice.length);
        if (e <= s) {
            APP.waveformView[x] = slice[s] || 0;
            continue;
        }
        let sum = 0;
        for (let i = s; i < e; i++) sum += slice[i];
        APP.waveformView[x] = sum / (e - s);
    }
}

// ─── Sync canvas sizes ───────────────────────────

function syncAllCanvases() {
    const dpr = window.devicePixelRatio || 1;
    const ids = [
        'waveformCanvas',
        'sectionCanvas',
        'eventCanvas',
        'energyCanvas',
    ];
    ids.forEach(id => {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const r       = canvas.getBoundingClientRect();
        canvas.width  = Math.floor(r.width  * dpr);
        canvas.height = Math.floor(r.height * dpr);
        const ctx     = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
}

// ─── Draw waveform ───────────────────────────────

function drawWaveform() {
    const canvas = document.getElementById('waveformCanvas');
    const ctx    = canvas.getContext('2d');
    const r      = canvas.getBoundingClientRect();
    const W = r.width, H = r.height;

    ctx.fillStyle = 'rgba(15,23,42,0.5)';
    ctx.fillRect(0, 0, W, H);

    if (!APP.duration) return;

    const viewLen = APP.viewEnd - APP.viewStart;

    // сетка баров
    if (APP.bpm) {
        const barDur    = (60 / APP.bpm) * 4;
        const phraseDur = barDur * 16;

        // барные линии (тонкие)
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth   = 1;
        let t = APP.offset;
        while (t < APP.viewStart) t += barDur;
        for (; t <= APP.viewEnd; t += barDur) {
            const x = ((t - APP.viewStart) / viewLen) * W;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }

        // фразовые линии (каждые 16 баров, ярче)
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth   = 1;
        t = APP.offset;
        while (t < APP.viewStart) t += phraseDur;
        for (; t <= APP.viewEnd; t += phraseDur) {
            const x = ((t - APP.viewStart) / viewLen) * W;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
    }

    // waveform столбики снизу вверх
    if (APP.waveformView) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth   = 1;
        const N = APP.waveformView.length;
        for (let i = 0; i < N; i++) {
            const x = (i / N) * W;
            const h = APP.waveformView[i] * H * 0.9;
            ctx.beginPath();
            ctx.moveTo(x, H);
            ctx.lineTo(x, H - h);
            ctx.stroke();
        }
    }

    // point-события поверх waveform (вертикальные линии)
    APP.events
        .filter(ev => EVENT_TYPES[ev.type] && EVENT_TYPES[ev.type].kind === 'point')
        .forEach(ev => {
            if (ev.startTime < APP.viewStart || ev.startTime > APP.viewEnd) return;
            const x = ((ev.startTime - APP.viewStart) / viewLen) * W;
            ctx.strokeStyle = EVENT_TYPES[ev.type].color;
            ctx.globalAlpha = 0.4;
            ctx.lineWidth   = 1;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        });
    ctx.globalAlpha = 1;
}

// ─── Draw section timeline ───────────────────────

function drawSectionTimeline() {
    const canvas = document.getElementById('sectionCanvas');
    const ctx    = canvas.getContext('2d');
    const r      = canvas.getBoundingClientRect();
    const W = r.width, H = r.height;

    ctx.fillStyle = 'rgba(15,23,42,0.6)';
    ctx.fillRect(0, 0, W, H);

    if (!APP.duration) return;

    const viewLen = APP.viewEnd - APP.viewStart;

    // фразовая сетка
    if (APP.bpm) {
        const phraseDur = (60 / APP.bpm) * 4 * 16;
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth   = 1;
        let t = APP.offset;
        while (t < APP.viewStart) t += phraseDur;
        for (; t <= APP.viewEnd; t += phraseDur) {
            const x = ((t - APP.viewStart) / viewLen) * W;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
    }

    // секции
    APP.sections.forEach(s => {
        const x1 = ((s.startTime - APP.viewStart) / viewLen) * W;
        const x2 = ((s.endTime   - APP.viewStart) / viewLen) * W;
        const ww = x2 - x1;
        if (ww <= 0) return;

        const info = SECTION_TYPES[s.type] || SECTION_TYPES.INTRO;
        ctx.save();
        ctx.fillStyle   = info.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x1, 0, ww, H);
        ctx.globalAlpha  = 1;
        ctx.fillStyle    = '#ffffff';
        ctx.font         = '11px -apple-system,sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign    = 'center';
        const lbl = s.label && s.label.trim() ? s.label : info.label;
        ctx.fillText(lbl, x1 + ww / 2, H / 2);
        ctx.restore();
    });
}

// ─── Draw event timeline ─────────────────────────
// Верхняя зона: range-события (блоки)
// Нижняя зона: point-события (треугольники острием ВВЕРХ)

function drawEventTimeline() {
    const canvas = document.getElementById('eventCanvas');
    const ctx    = canvas.getContext('2d');
    const r      = canvas.getBoundingClientRect();
    const W = r.width, H = r.height;

    ctx.fillStyle = 'rgba(15,23,42,0.55)';
    ctx.fillRect(0, 0, W, H);

    if (!APP.duration) return;

    const viewLen = APP.viewEnd - APP.viewStart;

    // разделительная линия
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.5);
    ctx.lineTo(W, H * 0.5);
    ctx.stroke();

    const rangeH = H * 0.44; // высота зоны range (верх)
    const pointY = H * 0.54; // начало зоны point (низ)
    const pointH = H * 0.44;

    APP.events.forEach(ev => {
        const info = EVENT_TYPES[ev.type];
        if (!info) return;

        if (info.kind === 'range') {
            // ── блок в верхней зоне ──
            const x1 = ((ev.startTime - APP.viewStart) / viewLen) * W;
            const x2 = ((ev.endTime   - APP.viewStart) / viewLen) * W;
            const ww = Math.max(3, x2 - x1);

            if (x2 < 0 || x1 > W) return;

            ctx.save();
            ctx.fillStyle   = info.color;
            ctx.globalAlpha = 0.82;
            ctx.fillRect(x1, 1, ww, rangeH - 2);

            if (ww > 28) {
                ctx.globalAlpha  = 1;
                ctx.fillStyle    = '#ffffff';
                ctx.font         = '10px -apple-system,sans-serif';
                ctx.textBaseline = 'middle';
                ctx.textAlign    = 'center';
                ctx.fillText(info.label, x1 + ww / 2, rangeH / 2);
            }
            ctx.restore();

        } else if (info.kind === 'point') {
            // ── треугольник в нижней зоне, острие ВВЕРХ ──
            if (ev.startTime < APP.viewStart || ev.startTime > APP.viewEnd) return;

            const x  = ((ev.startTime - APP.viewStart) / viewLen) * W;
            const th = pointH * 0.72;  // высота треугольника
            const tw = th * 0.65;      // ширина основания
            const ty = pointY;         // верх треугольника (острие)

            ctx.save();
            ctx.fillStyle   = info.color;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.moveTo(x,          ty);          // острие вверх
            ctx.lineTo(x - tw / 2, ty + th);     // левый низ
            ctx.lineTo(x + tw / 2, ty + th);     // правый низ
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    });
}

// ─── Draw energy graph ───────────────────────────

function drawEnergyGraph() {
    const canvas = document.getElementById('energyCanvas');
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    const r      = canvas.getBoundingClientRect();
    const W = r.width, H = r.height;

    ctx.fillStyle = 'rgba(15,23,42,0.4)';
    ctx.fillRect(0, 0, W, H);

    if (!APP.energyData) return;

    const { rms, sub, high, flux } = APP.energyData;
    const N = rms.length;

    const drawLine = (arr, color, alpha) => {
        const max = Math.max(...arr) || 1;
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        arr.forEach((v, i) => {
            const x = (i / N) * W;
            const y = H - (v / max) * H * 0.9;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    };

    drawLine(rms,  '#3b82f6', 0.9);
    drawLine(sub,  '#ef4444', 0.85);
    drawLine(high, '#10b981', 0.8);
    drawLine(flux, '#f97316', 0.75);
    ctx.globalAlpha = 1;
}

// ─── Redraw all canvases ─────────────────────────

function redrawAll() {
    syncAllCanvases();
    updateWaveformView();
    drawWaveform();
    drawSectionTimeline();
    drawEventTimeline();
    drawEnergyGraph();
    updatePlayheads();
}

// ─── Zoom (колесико мыши) ────────────────────────

function initZoom() {
    const canvas = document.getElementById('waveformCanvas');
    canvas.addEventListener('wheel', (e) => {
        if (!APP.duration) return;
        e.preventDefault();

        const rect        = canvas.getBoundingClientRect();
        const cursorRatio = (e.clientX - rect.left) / rect.width;

        const zoomFactor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
        const minZoom    = 1;
        const maxZoom    = 32;

        APP.zoom = Math.min(maxZoom, Math.max(minZoom, APP.zoom * zoomFactor));

        const viewLen = APP.duration / APP.zoom;

        // центр зума привязываем к позиции курсора
        let center = APP.viewStart + (APP.viewEnd - APP.viewStart) * cursorRatio;
        center     = Math.max(viewLen / 2, Math.min(APP.duration - viewLen / 2, center));

        APP.viewStart = center - viewLen / 2;
        APP.viewEnd   = center + viewLen / 2;

        // отображаем текущий zoom
        document.getElementById('zoomInfo').textContent =
            `Zoom: ${APP.zoom.toFixed(1)}x`;

        redrawAll();
    }, { passive: false });

    // seek по клику на waveform
    let isDragging = false;
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        seekFromCanvas(e, canvas);
    });
    canvas.addEventListener('mouseup',   () => { isDragging = false; });
    canvas.addEventListener('mouseleave',() => { isDragging = false; });
    canvas.addEventListener('mousemove', (e) => {
        if (isDragging) seekFromCanvas(e, canvas);
    });

    // seek по клику на section timeline
    const sCanvas = document.getElementById('sectionCanvas');
    sCanvas.addEventListener('click', (e) => seekFromCanvas(e, sCanvas));

    // seek по клику на event timeline
    const eCanvas = document.getElementById('eventCanvas');
    eCanvas.addEventListener('click', (e) => seekFromCanvas(e, eCanvas));
}

function seekFromCanvas(e, canvas) {
    if (!APP.duration) return;
    const rect    = canvas.getBoundingClientRect();
    const ratio   = (e.clientX - rect.left) / rect.width;
    const viewLen = APP.viewEnd - APP.viewStart;
    const t       = APP.viewStart + ratio * viewLen;
    seekTo(Math.max(0, Math.min(APP.duration, t)));
}