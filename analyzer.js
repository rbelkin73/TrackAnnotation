// ═══════════════════════════════════════════════════════
// DnB Structure Analyzer v0.3
// Структура + События (kick, roll, impact, riser, silence)
// ═══════════════════════════════════════════════════════

// ── Типы секций ─────────────────────────────────────────
const SECTION_TYPES = {
    INTRO:      { label: 'Intro',      color: '#6366f1' },
    BUILDUP:    { label: 'Buildup',    color: '#f97316' },
    DROP:       { label: 'Drop',       color: '#ef4444' },
    BREAKDOWN:  { label: 'Breakdown',  color: '#3b82f6' },
    TRANSITION: { label: 'Transition', color: '#8b5cf6' },
    OUTRO:      { label: 'Outro',      color: '#64748b' },
};
const SECTION_OPTIONS = Object.keys(SECTION_TYPES);

// ── Типы событий ─────────────────────────────────────────
// kind: 'point' = мгновенное (треугольник)
//       'range' = протяжённое (блок)
const EVENT_TYPES = {
    kick:      { label: 'Kick',       color: '#ef4444', kind: 'point' },
    snare:     { label: 'Snare',      color: '#f97316', kind: 'point' },
    impact:    { label: 'Impact',     color: '#ffffff', kind: 'point' },
    fx_hit:    { label: 'FX Hit',     color: '#fbbf24', kind: 'point' },
    silence:   { label: 'Silence',    color: '#475569', kind: 'point' },
    riser:     { label: 'Riser',      color: '#a78bfa', kind: 'range' },
    kick_roll: { label: 'Kick Roll',  color: '#f97316', kind: 'range' },
    breakdown: { label: 'Break',      color: '#38bdf8', kind: 'range' },
    drum_fill: { label: 'Drum Fill',  color: '#34d399', kind: 'range' },
};
const EVENT_OPTIONS      = Object.keys(EVENT_TYPES);
const EVENT_POINT_TYPES  = EVENT_OPTIONS.filter(k => EVENT_TYPES[k].kind === 'point');
const EVENT_RANGE_TYPES  = EVENT_OPTIONS.filter(k => EVENT_TYPES[k].kind === 'range');

class DnBAnalyzer {
    constructor() {
        this.audioContext = null;
        this.audioBuffer  = null;
        this.audioSource  = null;

        this.bpm      = 174;
        this.offset   = 0;
        this.duration = 0;
        this.fileName = '';

        this.isPlaying   = false;
        this.startedAt   = 0;
        this.pausedAt    = 0;
        this.currentTime = 0;
        this.animationId = null;

        this.sections    = [];
        this.events      = [];   // все события
        this.energyData  = null;
        this.waveformData = null;

        // canvas — waveform
        this.waveformCanvas = document.getElementById('waveformCanvas');
        this.wctx           = this.waveformCanvas.getContext('2d');

        // canvas — section timeline
        this.sectionCanvas  = document.getElementById('sectionCanvas');
        this.sctx           = this.sectionCanvas.getContext('2d');

        // canvas — event timeline
        this.eventCanvas    = document.getElementById('eventCanvas');
        this.ectx_ev        = this.eventCanvas.getContext('2d');

        // canvas — energy graph
        this.energyCanvas   = document.getElementById('energyCanvas');
        this.ectx           = this.energyCanvas.getContext('2d');

        // playheads
        this.playhead        = document.getElementById('playhead');
        this.sectionPlayhead = document.getElementById('sectionPlayhead');
        this.eventPlayhead   = document.getElementById('eventPlayhead');

        this.init();
    }

    init() {
        const bpmEl = document.getElementById('bpmInput');
        if (bpmEl) this.bpm = parseFloat(bpmEl.value) || 174;

        this.bindEvents();
        this.syncCanvases();
        window.addEventListener('resize', () => {
            this.syncCanvases();
            this.drawWaveform();
            this.drawSectionTimeline();
            this.drawEventTimeline();
            this.drawEnergyGraph();
            this.updatePlayheads();
        });
    }

    // ─── Bind events ─────────────────────────────────────

    bindEvents() {
        const fileInput = document.getElementById('fileInput');
        document.getElementById('loadBtn')
            .addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', e => {
            const f = e.target.files && e.target.files[0];
            if (f) this.loadFile(f);
        });

        document.getElementById('bpmInput')
            .addEventListener('input', e => {
                this.bpm = parseFloat(e.target.value) || 174;
            });
        document.getElementById('offsetInput')
            .addEventListener('input', e => {
                this.offset = parseFloat(e.target.value) || 0;
            });

        document.getElementById('analyzeBtn')
            .addEventListener('click', () => this.runAnalysis());
        document.getElementById('playBtn')
            .addEventListener('click', () => this.togglePlay());
        document.getElementById('stopBtn')
            .addEventListener('click', () => this.stopPlayback());
        document.getElementById('exportJsonBtn')
            .addEventListener('click', () => this.exportJSON());
        document.getElementById('exportCsvBtn')
            .addEventListener('click', () => this.exportCSV());
        document.getElementById('addEventBtn')
            .addEventListener('click', () => this.addEventManual());

        // seek по клику
        this.waveformCanvas.addEventListener('click',
            e => this.seekFromCanvas(e, this.waveformCanvas));
        this.sectionCanvas.addEventListener('click',
            e => this.seekFromCanvas(e, this.sectionCanvas));
        this.eventCanvas.addEventListener('click',
            e => this.seekFromCanvas(e, this.eventCanvas));
    }

    // ─── Load file ────────────────────────────────────────

    async loadFile(file) {
        this.fileName = file.name;
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('analyzeBtn').disabled  = false;

        if (!this.audioContext) {
            this.audioContext =
                new (window.AudioContext || window.webkitAudioContext)();
        }
        await this.audioContext.resume();

        const ab          = await file.arrayBuffer();
        this.audioBuffer  = await this.audioContext.decodeAudioData(ab);
        this.duration     = this.audioBuffer.duration;

        this.sections    = [];
        this.events      = [];
        this.energyData  = null;

        this.buildWaveformData();
        this.syncCanvases();
        this.drawWaveform();
        this.drawSectionTimeline();
        this.drawEventTimeline();
        this.drawEnergyGraph();

        document.getElementById('playBtn').disabled    = false;
        document.getElementById('stopBtn').disabled    = false;
        document.getElementById('addEventBtn').disabled = false;

        document.getElementById('sectionsList').innerHTML =
            '<div class="empty-state">Press Analyze to detect structure</div>';
        document.getElementById('eventsList').innerHTML =
            '<div class="empty-state">Events will appear after analysis</div>';
    }

    // ─── Waveform data ────────────────────────────────────

    buildWaveformData() {
        const ch   = this.audioBuffer.getChannelData(0);
        const N    = 3000;
        const step = Math.floor(ch.length / N) || 1;
        this.waveformData = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            const s = i * step;
            const e = Math.min(s + step, ch.length);
            let sum = 0;
            for (let j = s; j < e; j++) sum += Math.abs(ch[j]);
            this.waveformData[i] = sum / (e - s);
        }
    }

    // ─── Canvas sizing ────────────────────────────────────

    syncCanvases() {
        const dpr = window.devicePixelRatio || 1;
        for (const [canvas, ctx] of [
            [this.waveformCanvas, this.wctx],
            [this.sectionCanvas,  this.sctx],
            [this.eventCanvas,    this.ectx_ev],
            [this.energyCanvas,   this.ectx],
        ]) {
            const r       = canvas.getBoundingClientRect();
            canvas.width  = Math.floor(r.width  * dpr);
            canvas.height = Math.floor(r.height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }

    // ─── Draw waveform ────────────────────────────────────

    drawWaveform() {
        const ctx = this.wctx;
        const r   = this.waveformCanvas.getBoundingClientRect();
        const W = r.width, H = r.height;

        ctx.fillStyle = 'rgba(15,23,42,0.5)';
        ctx.fillRect(0, 0, W, H);

        if (!this.waveformData) return;

        // сетка фраз (каждые 16 баров)
        if (this.duration && this.bpm) {
            const barDur    = (60 / this.bpm) * 4;
            const phraseDur = barDur * 16;
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth   = 1;
            for (let t = this.offset; t < this.duration; t += phraseDur) {
                const x = (t / this.duration) * W;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, H);
                ctx.stroke();
            }
        }

        // waveform
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth   = 1;
        const N = this.waveformData.length;
        for (let i = 0; i < N; i++) {
            const x = (i / N) * W;
            const h = this.waveformData[i] * H * 0.9;
            ctx.beginPath();
            ctx.moveTo(x, H);
            ctx.lineTo(x, H - h);
            ctx.stroke();
        }

        // точечные события поверх waveform (тонкие линии)
        if (this.events.length > 0) {
            this.events
                .filter(ev => EVENT_TYPES[ev.type] &&
                              EVENT_TYPES[ev.type].kind === 'point')
                .forEach(ev => {
                    const x = (ev.startTime / this.duration) * W;
                    ctx.strokeStyle = EVENT_TYPES[ev.type].color;
                    ctx.globalAlpha = 0.5;
                    ctx.lineWidth   = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, H);
                    ctx.stroke();
                });
            ctx.globalAlpha = 1;
        }
    }

    // ─── Draw section timeline ────────────────────────────

    drawSectionTimeline() {
        const ctx = this.sctx;
        const r   = this.sectionCanvas.getBoundingClientRect();
        const W = r.width, H = r.height;

        ctx.fillStyle = 'rgba(15,23,42,0.6)';
        ctx.fillRect(0, 0, W, H);

        if (!this.duration) return;

        // фразовая сетка
        if (this.bpm) {
            const phraseDur = (60 / this.bpm) * 4 * 16;
            ctx.strokeStyle = 'rgba(255,255,255,0.07)';
            ctx.lineWidth   = 1;
            for (let t = this.offset; t < this.duration; t += phraseDur) {
                const x = (t / this.duration) * W;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, H);
                ctx.stroke();
            }
        }

        // секции
        this.sections.forEach(s => {
            const x1 = (s.startTime / this.duration) * W;
            const x2 = (s.endTime   / this.duration) * W;
            const ww = x2 - x1;
            if (ww <= 0) return;
            const info = SECTION_TYPES[s.type] || SECTION_TYPES.INTRO;
            ctx.save();
            ctx.fillStyle   = info.color;
            ctx.globalAlpha = 0.82;
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

    // ─── Draw event timeline ──────────────────────────────
    // Верхняя половина: range-события (блоки)
    // Нижняя половина: point-события (треугольники)

    drawEventTimeline() {
        const ctx = this.ectx_ev;
        const r   = this.eventCanvas.getBoundingClientRect();
        const W = r.width, H = r.height;

        ctx.fillStyle = 'rgba(15,23,42,0.55)';
        ctx.fillRect(0, 0, W, H);

        if (!this.duration) return;

        // разделительная линия
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();

        const topH = H * 0.44;  // высота зоны range
        const botY = H * 0.54;  // начало зоны point
        const botH = H * 0.42;

        this.events.forEach(ev => {
            const info = EVENT_TYPES[ev.type];
            if (!info) return;

            if (info.kind === 'range' && ev.endTime > ev.startTime) {
                // блок в верхней зоне
                const x1 = (ev.startTime / this.duration) * W;
                const x2 = (ev.endTime   / this.duration) * W;
                const ww = Math.max(2, x2 - x1);

                ctx.save();
                ctx.fillStyle   = info.color;
                ctx.globalAlpha = 0.8;
                ctx.fillRect(x1, 2, ww, topH - 2);

                // подпись если достаточно места
                if (ww > 30) {
                    ctx.globalAlpha  = 1;
                    ctx.fillStyle    = '#ffffff';
                    ctx.font         = '10px -apple-system,sans-serif';
                    ctx.textBaseline = 'middle';
                    ctx.textAlign    = 'center';
                    ctx.fillText(info.label, x1 + ww / 2, topH / 2);
                }
                ctx.restore();

            } else if (info.kind === 'point') {
                // треугольник в нижней зоне
                const x   = (ev.startTime / this.duration) * W;
                const th  = botH * 0.7;   // высота треугольника
                const tw  = th * 0.7;     // ширина
                const ty  = botY + (botH - th) / 2;

                ctx.save();
                ctx.fillStyle   = info.color;
                ctx.globalAlpha = 0.85;
                ctx.beginPath();
                ctx.moveTo(x,      ty + th); // низ (основание)
                ctx.lineTo(x - tw / 2, ty);  // левый верх
                ctx.lineTo(x + tw / 2, ty);  // правый верх
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
        });
    }

    // ─── Draw energy graph ────────────────────────────────

    drawEnergyGraph() {
        const ctx = this.ectx;
        const r   = this.energyCanvas.getBoundingClientRect();
        const W = r.width, H = r.height;

        ctx.fillStyle = 'rgba(15,23,42,0.4)';
        ctx.fillRect(0, 0, W, H);

        if (!this.energyData) return;

        const { rms, sub, high, flux } = this.energyData;
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

    // ═══════════════════════════════════════════════════════
    // ANALYSIS
    // ═══════════════════════════════════════════════════════

    async runAnalysis() {
        if (!this.audioBuffer) return;

        const btn           = document.getElementById('analyzeBtn');
        const progress      = document.getElementById('progressBar');
        const progressFill  = document.getElementById('progressFill');
        const progressLabel = document.getElementById('progressLabel');

        btn.disabled    = true;
        btn.textContent = 'Analyzing...';
        progress.classList.remove('hidden');

        await this.sleep(30);

        progressLabel.textContent = 'Extracting features...';
        progressFill.style.width  = '8%';
        await this.sleep(30);

        this.energyData = await this.extractFeaturesByBlocks();

        progressFill.style.width  = '35%';
        progressLabel.textContent = 'Detecting kick pattern...';
        await this.sleep(30);

        const kickData = await this.detectKickOnsets();

        progressFill.style.width  = '55%';
        progressLabel.textContent = 'Building structure...';
        await this.sleep(30);

        this.sections = this.buildSections(this.energyData, kickData);

        progressFill.style.width  = '70%';
        progressLabel.textContent = 'Detecting events...';
        await this.sleep(30);

        this.events = this.detectEvents(this.energyData, kickData);

        progressFill.style.width  = '90%';
        progressLabel.textContent = 'Rendering...';
        await this.sleep(30);

        this.drawWaveform();
        this.drawEnergyGraph();
        this.drawSectionTimeline();
        this.drawEventTimeline();
        this.renderSectionsList();
        this.renderEventsList();

        document.getElementById('exportJsonBtn').disabled = false;
        document.getElementById('exportCsvBtn').disabled  = false;

        progressFill.style.width = '100%';
        await this.sleep(300);
        progress.classList.add('hidden');

        btn.disabled    = false;
        btn.textContent = 'Re-analyze';
    }

    // ─── Extract features by 4-bar blocks ────────────────

    async extractFeaturesByBlocks() {
        const sr           = this.audioBuffer.sampleRate;
        const ch           = this.audioBuffer.getChannelData(0);
        const total        = ch.length;
        const barSamples   = Math.round(sr * (60 / this.bpm) * 4);
        const blockSamples = barSamples * 4;
        const numBlocks    = Math.floor(total / blockSamples);

        const rms  = new Float32Array(numBlocks);
        const sub  = new Float32Array(numBlocks);
        const high = new Float32Array(numBlocks);
        const flux = new Float32Array(numBlocks);
        const mid  = new Float32Array(numBlocks);

        const fftSize  = 4096;
        const binHz    = sr / fftSize;
        const subBins  = { lo: Math.floor(30  / binHz), hi: Math.floor(80   / binHz) };
        const midBins  = { lo: Math.floor(200 / binHz), hi: Math.floor(2000 / binHz) };
        const highBins = { lo: Math.floor(4000/ binHz), hi: Math.floor(14000/ binHz) };

        let prevSpectrum = null;

        for (let b = 0; b < numBlocks; b++) {
            const start = b * blockSamples;
            const end   = Math.min(start + blockSamples, total);
            const frame = ch.slice(start, end);

            // RMS
            let sumSq = 0;
            for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
            rms[b] = Math.sqrt(sumSq / frame.length);

            // FFT
            const midOff = Math.floor((frame.length - fftSize) / 2);
            const offCtx = new OfflineAudioContext(1, fftSize, sr);
            const buf    = offCtx.createBuffer(1, fftSize, sr);
            const bData  = buf.getChannelData(0);
            for (let i = 0; i < fftSize; i++) {
                const idx = midOff + i;
                bData[i]  = (idx >= 0 && idx < frame.length) ? frame[idx] : 0;
            }
            const src     = offCtx.createBufferSource();
            src.buffer    = buf;
            const analyser = offCtx.createAnalyser();
            analyser.fftSize = fftSize;
            src.connect(analyser);
            analyser.connect(offCtx.destination);
            src.start(0);
            await offCtx.startRendering();

            const spectrum = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(spectrum);

            const bandAvg = (lo, hi) => {
                let s = 0, c = 0;
                for (let i = lo; i <= Math.min(hi, spectrum.length-1); i++) {
                    s += spectrum[i]; c++;
                }
                return c ? s / c / 255 : 0;
            };

            sub[b]  = bandAvg(subBins.lo,  subBins.hi);
            mid[b]  = bandAvg(midBins.lo,  midBins.hi);
            high[b] = bandAvg(highBins.lo, highBins.hi);

            if (prevSpectrum) {
                let fluxSum = 0;
                for (let i = 0; i < spectrum.length; i++) {
                    const d = (spectrum[i] - prevSpectrum[i]) / 255;
                    if (d > 0) fluxSum += d;
                }
                flux[b] = fluxSum / spectrum.length;
            } else {
                flux[b] = 0;
            }
            prevSpectrum = new Uint8Array(spectrum);
        }

        return { rms, sub, high, flux, mid, numBlocks, blockSamples };
    }

    // ─── Kick onset detector ──────────────────────────────
    // Возвращает массив времён кик-онсетов в секундах

    async detectKickOnsets() {
        const sr          = this.audioBuffer.sampleRate;
        const ch          = this.audioBuffer.getChannelData(0);
        const total       = ch.length;

        // окно ~23ms — стандарт для онсет-детекции
        const winMs       = 23;
        const winSamples  = Math.round(sr * winMs / 1000);
        const hopSamples  = Math.floor(winSamples / 2);
        const numWins     = Math.floor((total - winSamples) / hopSamples);

        const kickTimes   = [];   // времена кик-онсетов (сек)
        const kickDensity = [];   // плотность на 4-барный блок

        const barSamples   = Math.round(sr * (60 / this.bpm) * 4);
        const blockSamples = barSamples * 4;
        const numBlocks    = Math.floor(total / blockSamples);

        // sub-энергия по окнам (без FFT — просто low-pass вручную)
        const subEnergy = new Float32Array(numWins);
        for (let w = 0; w < numWins; w++) {
            const s = w * hopSamples;
            const e = Math.min(s + winSamples, total);
            let en  = 0;
            for (let i = s; i < e; i++) en += ch[i] * ch[i];
            subEnergy[w] = Math.sqrt(en / (e - s));
        }

        // онсет = рост энергии > порога
        const threshold = 0.018;
        let lastOnset   = -0.1; // минимальный интервал между ударами

        for (let w = 1; w < numWins - 1; w++) {
            const curr = subEnergy[w];
            const prev = subEnergy[w - 1];
            const t    = (w * hopSamples) / sr;

            if (
                curr > prev * 1.7 &&
                curr > threshold &&
                (t - lastOnset) > 0.08   // минимум 80ms между ударами
            ) {
                kickTimes.push(t);
                lastOnset = t;
            }
        }

        // плотность кика по блокам
        for (let b = 0; b < numBlocks; b++) {
            const blockStart = (b * blockSamples) / sr;
            const blockEnd   = blockStart + (blockSamples / sr);
            const count      = kickTimes.filter(t => t >= blockStart && t < blockEnd).length;
            kickDensity.push(Math.min(1.0, count / 8)); // 8 ударов = норма на 4 бара
        }

        return { kickTimes, kickDensity, numBlocks };
    }
        // ─── Build sections ───────────────────────────────────

    buildSections(features, kickData) {
        const { rms, sub, high, flux, numBlocks, blockSamples } = features;
        const { kickDensity } = kickData;
        const sr = this.audioBuffer.sampleRate;

        const normalize = arr => {
            const max = Math.max(...arr) || 1;
            return Array.from(arr).map(v => v / max);
        };

        const nRms  = normalize(rms);
        const nSub  = normalize(sub);
        const nHigh = normalize(high);
        const nKick = Array.from(kickDensity);

        // тренд: среднее следующих 2 блоков минус предыдущих 2
        const trend = new Array(numBlocks).fill(0);
        for (let i = 2; i < numBlocks - 2; i++) {
            const future = (nRms[i+1] + nRms[i+2]) / 2;
            const past   = (nRms[i-1] + nRms[i-2]) / 2;
            trend[i]     = future - past;
        }

        // классифицируем каждый 4-барный блок
        const blockTypes = new Array(numBlocks);
        for (let i = 0; i < numBlocks; i++) {
            const r = nRms[i];
            const s = nSub[i];
            const k = nKick[i];
            const t = trend[i];
            const isFirst = i < 4;
            const isLast  = i >= numBlocks - 4;

            if (isFirst && r < 0.45) {
                blockTypes[i] = 'INTRO';
            } else if (isLast && r < 0.5) {
                blockTypes[i] = 'OUTRO';
            } else if (r > 0.7 && s > 0.6 && k > 0.45) {
                blockTypes[i] = 'DROP';
            } else if (r < 0.3 && s < 0.3 && k < 0.2) {
                blockTypes[i] = 'BREAKDOWN';
            } else if (t > 0.08 && r > 0.25 && r < 0.75) {
                blockTypes[i] = 'BUILDUP';
            } else if (r < 0.22) {
                blockTypes[i] = 'BREAKDOWN';
            } else {
                blockTypes[i] = 'INTRO';
            }
        }

        // группируем соседние блоки одного типа
        const rawSections = [];
        let startBlock  = 0;
        let currentType = blockTypes[0];

        for (let i = 1; i <= numBlocks; i++) {
            const type = i < numBlocks ? blockTypes[i] : null;
            if (type !== currentType || i === numBlocks) {
                rawSections.push({
                    startBlock,
                    endBlock:  i - 1,
                    type:      currentType,
                    numBlocks: i - startBlock,
                });
                startBlock   = i;
                currentType  = type;
            }
        }

        // объединяем слишком короткие секции (< 4 блоков = < 16 баров)
        const merged = [];
        for (let i = 0; i < rawSections.length; i++) {
            const s = rawSections[i];
            if (s.numBlocks < 4 && merged.length > 0) {
                merged[merged.length - 1].endBlock  = s.endBlock;
                merged[merged.length - 1].numBlocks += s.numBlocks;
            } else {
                merged.push({ ...s });
            }
        }

        // пост-обработка логики последовательности
        for (let i = 1; i < merged.length - 1; i++) {
            const prev = merged[i - 1];
            const cur  = merged[i];
            const next = merged[i + 1];

            if (prev.type === 'DROP' && cur.type === 'DROP') {
                cur.type = 'BREAKDOWN';
            }
            if (cur.type === 'DROP' && prev.type === 'INTRO') {
                prev.type = 'BUILDUP';
            }
            if (cur.type === 'BREAKDOWN' &&
                next && next.type !== 'DROP' && next.type !== 'OUTRO') {
                next.type = 'DROP';
            }
            if (prev.type === 'BREAKDOWN' && cur.type === 'BREAKDOWN') {
                cur.type = 'TRANSITION';
            }
        }

        // последний элемент — Outro
        if (merged.length > 0) {
            merged[merged.length - 1].type = 'OUTRO';
        }

        // автонумерация одинаковых типов
        const typeCount = {};

        // конвертируем в итоговые секции
        const barDur   = (60 / this.bpm) * 4;
        const sections = [];

        merged.forEach((s, idx) => {
            const startTime = this.offset + (s.startBlock * blockSamples) / sr;
            const endTime   = idx === merged.length - 1
                ? this.duration
                : this.offset + ((s.endBlock + 1) * blockSamples) / sr;

            const startBar = this.timeToBar(startTime);
            const endBar   = Math.max(startBar, this.timeToBar(endTime) - 1);

            // energy_level — среднее нормализованное RMS
            let sumRms = 0, sumSub = 0;
            for (let b = s.startBlock; b <= s.endBlock; b++) {
                sumRms += nRms[b];
                sumSub += nSub[b];
            }
            const avgRms      = sumRms / s.numBlocks;
            const avgSub      = sumSub / s.numBlocks;
            const energyLevel = parseFloat(
                Math.min(1, (avgRms * 0.6 + avgSub * 0.4)).toFixed(2)
            );

            // уровень уверенности
            let confidence = 'mid';
            if (s.type === 'DROP'      && avgRms > 0.75) confidence = 'high';
            if (s.type === 'BREAKDOWN' && avgRms < 0.25) confidence = 'high';
            if (s.type === 'INTRO'     && idx === 0)     confidence = 'high';
            if (s.type === 'OUTRO'     && idx === merged.length - 1) confidence = 'high';
            if (s.numBlocks < 6)                         confidence = 'low';

            // автонумерация
            typeCount[s.type] = (typeCount[s.type] || 0) + 1;
            const typeInfo    = SECTION_TYPES[s.type];
            const autoLabel   = merged.filter(x => x.type === s.type).length > 1
                ? `${typeInfo.label} ${typeCount[s.type]}`
                : typeInfo.label;

            sections.push({
                startTime,
                endTime,
                startBar,
                endBar,
                type:        s.type,
                label:       autoLabel,
                energyLevel,
                confidence,
                tags:        [],
            });
        });

        return sections;
    }

    // ─── Detect events ────────────────────────────────────

    detectEvents(features, kickData) {
        const events = [];
        const { rms, sub, high, flux, numBlocks, blockSamples } = features;
        const { kickTimes } = kickData;
        const sr = this.audioBuffer.sampleRate;

        const normalize = arr => {
            const max = Math.max(...arr) || 1;
            return Array.from(arr).map(v => v / max);
        };
        const nRms  = normalize(rms);
        const nSub  = normalize(sub);
        const nHigh = normalize(high);
        const nFlux = normalize(flux);

        // ── 1. Kick события (из уже детектированных онсетов) ──
        // Прореживаем: оставляем только каждые N миллисекунд
        // чтобы не перегружать список — группируем в пачки
        const minKickInterval = (60 / this.bpm) * 0.45; // ~чуть меньше полубита
        let lastKick = -1;
        kickTimes.forEach(t => {
            if (t - lastKick >= minKickInterval) {
                events.push({
                    type:      'kick',
                    startTime: t,
                    endTime:   t,
                    bar:       this.timeToBar(t),
                    beat:      this.timeToBeat(t),
                    intensity: 0.8,
                    confidence: 'mid',
                    label:     '',
                });
                lastKick = t;
            }
        });

        // ── 2. Impact — широкополосный пик (все диапазоны одновременно) ──
        for (let b = 1; b < numBlocks; b++) {
            const allHigh = nRms[b] > 0.8 &&
                            nSub[b] > 0.7 &&
                            nHigh[b] > 0.6;
            const bigJump = nRms[b] - nRms[b-1] > 0.35;
            if (allHigh && bigJump) {
                const t = this.offset + (b * blockSamples) / sr;
                events.push({
                    type:      'impact',
                    startTime: t,
                    endTime:   t,
                    bar:       this.timeToBar(t),
                    beat:      1,
                    intensity: parseFloat(nRms[b].toFixed(2)),
                    confidence: 'high',
                    label:     '',
                });
            }
        }

        // ── 3. Silence — RMS падает ниже порога ──
        const silenceThreshold = 0.05;
        let inSilence = false;
        let silStart  = 0;
        for (let b = 0; b < numBlocks; b++) {
            const t = this.offset + (b * blockSamples) / sr;
            if (!inSilence && nRms[b] < silenceThreshold) {
                inSilence = true;
                silStart  = t;
            } else if (inSilence && nRms[b] >= silenceThreshold) {
                inSilence = false;
                events.push({
                    type:      'silence',
                    startTime: silStart,
                    endTime:   silStart,
                    bar:       this.timeToBar(silStart),
                    beat:      1,
                    intensity: 0,
                    confidence: 'high',
                    label:     '',
                });
            }
        }

        // ── 4. Riser — spectral centroid растёт + нет кика ──
        // Детектируем как range-событие
        const centroids = [];
        for (let b = 0; b < numBlocks; b++) {
            // приближение центроида: взвешенная сумма high/mid/sub
            centroids.push(nHigh[b] * 3 + nRms[b] * 1 - nSub[b] * 2);
        }

        let riserStart  = -1;
        let riserLen    = 0;
        const minRiserBlocks = 4; // минимум 4 блока = 16 баров

        for (let b = 1; b < numBlocks; b++) {
            const rising   = centroids[b] > centroids[b-1] + 0.05;
            const noKick   = kickData.kickDensity[b] < 0.25;
            const midEnergy = nRms[b] > 0.2 && nRms[b] < 0.85;

            if (rising && noKick && midEnergy) {
                if (riserStart === -1) riserStart = b;
                riserLen++;
            } else {
                if (riserLen >= minRiserBlocks) {
                    const ts = this.offset + (riserStart * blockSamples) / sr;
                    const te = this.offset + (b * blockSamples) / sr;
                    events.push({
                        type:      'riser',
                        startTime: ts,
                        endTime:   te,
                        bar:       this.timeToBar(ts),
                        beat:      1,
                        endBar:    this.timeToBar(te),
                        intensity: parseFloat(nRms[riserStart + Math.floor(riserLen/2)].toFixed(2)),
                        confidence: riserLen >= 6 ? 'high' : 'mid',
                        label:     '',
                    });
                }
                riserStart = -1;
                riserLen   = 0;
            }
        }

        // ── 5. Kick Roll — IOI (inter-onset interval) уменьшается ──
        // Паттерн 4-2-2 бара: ищем ускорение киков
        const barDur = (60 / this.bpm) * 4;
        if (kickTimes.length > 4) {
            const ioi = []; // интервалы между ударами
            for (let i = 1; i < kickTimes.length; i++) {
                ioi.push(kickTimes[i] - kickTimes[i-1]);
            }

            // ищем окно где IOI монотонно уменьшается за 4+ удара
            let rollStart = -1;
            let rollLen   = 0;

            for (let i = 1; i < ioi.length; i++) {
                if (ioi[i] < ioi[i-1] * 0.92) { // уменьшение на 8%+
                    if (rollStart === -1) rollStart = i;
                    rollLen++;
                } else {
                    if (rollLen >= 4) {
                        const ts = kickTimes[rollStart];
                        const te = kickTimes[rollStart + rollLen];
                        events.push({
                            type:      'kick_roll',
                            startTime: ts,
                            endTime:   te || ts + barDur * 2,
                            bar:       this.timeToBar(ts),
                            beat:      1,
                            endBar:    this.timeToBar(te || ts + barDur * 2),
                            intensity: 0.9,
                            confidence: rollLen >= 6 ? 'high' : 'mid',
                            label:     '',
                        });
                    }
                    rollStart = -1;
                    rollLen   = 0;
                }
            }
        }

        // сортируем по времени
        events.sort((a, b) => a.startTime - b.startTime);

        return events;
    }

    // ─── Helpers ─────────────────────────────────────────

    snapToBar(timeSec) {
        const barDur   = (60 / this.bpm) * 4;
        const adjusted = timeSec - this.offset;
        const barIndex = Math.round(adjusted / barDur);
        return this.offset + barIndex * barDur;
    }

    timeToBar(timeSec) {
        const barDur   = (60 / this.bpm) * 4;
        const adjusted = Math.max(0, timeSec - this.offset);
        return Math.max(1, Math.round(adjusted / barDur) + 1);
    }

    timeToBeat(timeSec) {
        const beatDur  = 60 / this.bpm;
        const barDur   = beatDur * 4;
        const adjusted = Math.max(0, timeSec - this.offset);
        const posInBar = adjusted % barDur;
        return Math.floor(posInBar / beatDur) + 1;
    }

    barToTime(bar) {
        const barDur = (60 / this.bpm) * 4;
        return this.offset + (bar - 1) * barDur;
    }

    formatTime(sec) {
        const m  = Math.floor(sec / 60);
        const s  = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 1000);
        return `${m}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
    }

    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ═══════════════════════════════════════════════════════
    // RENDER SECTIONS LIST
    // ═══════════════════════════════════════════════════════

    renderSectionsList() {
        const list = document.getElementById('sectionsList');
        list.innerHTML = '';
        if (this.sections.length === 0) {
            list.innerHTML = '<div class="empty-state">No sections detected</div>';
            return;
        }
        this.sections.forEach((s, idx) => {
            this.renderSectionRow(s, idx, list);
            if (idx < this.sections.length - 1) {
                list.appendChild(this.makeAddSectionButton(idx));
            }
        });
    }

    renderSectionRow(s, idx, container) {
        const info = SECTION_TYPES[s.type] || SECTION_TYPES.INTRO;
        const row  = document.createElement('div');
        row.className = 'section-row';

        const colorBar = document.createElement('div');
        colorBar.className        = 'section-color-bar';
        colorBar.style.background = info.color;

        const typeSelect = document.createElement('select');
        typeSelect.className = 'section-type-select';
        SECTION_OPTIONS.forEach(opt => {
            const o       = document.createElement('option');
            o.value       = opt;
            o.textContent = SECTION_TYPES[opt].label;
            if (opt === s.type) o.selected = true;
            typeSelect.appendChild(o);
        });
        typeSelect.addEventListener('change', e => {
            this.sections[idx].type = e.target.value;
            colorBar.style.background = SECTION_TYPES[e.target.value].color;
            this.drawSectionTimeline();
        });

        // startBar
        const startBarEl   = document.createElement('input');
        startBarEl.type    = 'number';
        startBarEl.className = 'bar-input';
        startBarEl.value   = s.startBar;
        if (idx === 0) startBarEl.readOnly = true;
        startBarEl.addEventListener('change', e => {
            const minVal  = idx === 0 ? 1 : this.sections[idx-1].endBar + 1;
            const maxVal  = s.endBar - 1;
            const clamped = Math.max(minVal, Math.min(maxVal, parseInt(e.target.value)));
            e.target.value = clamped;
            this.sections[idx].startBar  = clamped;
            this.sections[idx].startTime = this.barToTime(clamped);
            if (idx > 0) {
                this.sections[idx-1].endBar  = clamped - 1;
                this.sections[idx-1].endTime = this.barToTime(clamped);
            }
            this.drawSectionTimeline();
            this.renderSectionsList();
        });

        const arrow       = document.createElement('span');
        arrow.textContent = '→';
        arrow.style.cssText = 'color:#475569;font-size:13px';

        // endBar
        const endBarEl   = document.createElement('input');
        endBarEl.type    = 'number';
        endBarEl.className = 'bar-input';
        endBarEl.value   = s.endBar;
        if (idx === this.sections.length - 1) endBarEl.readOnly = true;
        endBarEl.addEventListener('change', e => {
            const minVal  = s.startBar + 1;
            const maxVal  = idx < this.sections.length - 1
                ? this.sections[idx+1].endBar - 1
                : s.endBar;
            const clamped = Math.max(minVal, Math.min(maxVal, parseInt(e.target.value)));
            e.target.value = clamped;
            this.sections[idx].endBar  = clamped;
            this.sections[idx].endTime = this.barToTime(clamped + 1);
            if (idx < this.sections.length - 1) {
                this.sections[idx+1].startBar  = clamped + 1;
                this.sections[idx+1].startTime = this.barToTime(clamped + 1);
            }
            this.drawSectionTimeline();
            this.renderSectionsList();
        });

        // время
        const timeEl       = document.createElement('div');
        timeEl.className   = 'section-time';
        timeEl.textContent = `${this.formatTime(s.startTime)} – ${this.formatTime(s.endTime)}`;

        // energy level
        const energyEl       = document.createElement('div');
        energyEl.className   = 'event-intensity';
        energyEl.textContent = `E: ${s.energyLevel || 0}`;

        // confidence
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
            this.sections[idx].label = e.target.value;
            this.drawSectionTimeline();
        });

        // jump
        const jumpBtn       = document.createElement('button');
        jumpBtn.className   = 'section-jump';
        jumpBtn.textContent = '▶';
        jumpBtn.addEventListener('click', () => this.seekTo(s.startTime));

        // delete
        const delBtn       = document.createElement('button');
        delBtn.className   = 'section-delete';
        delBtn.textContent = '×';
        delBtn.addEventListener('click', () => this.deleteSection(idx));

        row.appendChild(colorBar);
        row.appendChild(typeSelect);
        const barWrap = document.createElement('div');
        barWrap.style.cssText = 'display:flex;align-items:center;gap:4px';
        barWrap.appendChild(startBarEl);
        barWrap.appendChild(arrow);
        barWrap.appendChild(endBarEl);
        row.appendChild(barWrap);
        row.appendChild(timeEl);
        row.appendChild(energyEl);
        row.appendChild(badge);
        row.appendChild(labelInput);
        row.appendChild(jumpBtn);
        row.appendChild(delBtn);
        container.appendChild(row);
    }

    makeAddSectionButton(afterIdx) {
        const wrap     = document.createElement('div');
        wrap.className = 'add-section-btn-wrap';
        const btn      = document.createElement('button');
        btn.className  = 'add-section-btn';
        btn.textContent = '+';
        btn.addEventListener('click', () => this.addSectionAfter(afterIdx));
        wrap.appendChild(btn);
        return wrap;
    }

    deleteSection(idx) {
        if (this.sections.length <= 1) return;
        this.sections.splice(idx, 1);
        for (let i = 0; i < this.sections.length; i++) {
            if (i === 0) {
                this.sections[i].startBar  = 1;
                this.sections[i].startTime = this.barToTime(1);
            } else {
                this.sections[i].startBar  = this.sections[i-1].endBar + 1;
                this.sections[i].startTime = this.barToTime(this.sections[i].startBar);
            }
        }
        const last   = this.sections[this.sections.length - 1];
        last.endTime = this.duration;
        last.endBar  = this.timeToBar(this.duration) - 1;
        this.renderSectionsList();
        this.drawSectionTimeline();
    }

    addSectionAfter(afterIdx) {
        const prev        = this.sections[afterIdx];
        const next        = this.sections[afterIdx + 1];
        const newStartBar = prev.endBar + 1;
        const newEndBar   = Math.min(newStartBar + 15, next.endBar - 1);
        if (newEndBar <= newStartBar) return;
        const newSec = {
            startBar:    newStartBar,
            endBar:      newEndBar,
            startTime:   this.barToTime(newStartBar),
            endTime:     this.barToTime(newEndBar + 1),
            type:        'TRANSITION',
            label:       '',
            energyLevel: 0.5,
            confidence:  'low',
            tags:        [],
        };
        next.startBar  = newEndBar + 1;
        next.startTime = this.barToTime(next.startBar);
        this.sections.splice(afterIdx + 1, 0, newSec);
        this.renderSectionsList();
        this.drawSectionTimeline();
    }

    // ═══════════════════════════════════════════════════════
    // RENDER EVENTS LIST
    // ═══════════════════════════════════════════════════════

    renderEventsList() {
        const list = document.getElementById('eventsList');
        list.innerHTML = '';
        if (this.events.length === 0) {
            list.innerHTML = '<div class="empty-state">No events detected</div>';
            return;
        }
        this.events.forEach((ev, idx) => {
            this.renderEventRow(ev, idx, list);
        });
    }

    renderEventRow(ev, idx, container) {
        const info = EVENT_TYPES[ev.type] || EVENT_TYPES.kick;
        const row  = document.createElement('div');
        row.className = `event-row event-kind-${info.kind}`;

        const dot = document.createElement('div');
        dot.className        = 'event-dot';
        dot.style.background = info.color;

        const typeBadge       = document.createElement('span');
        typeBadge.className   = 'event-type-badge';
        typeBadge.textContent = info.label;
        typeBadge.style.background = info.color + '28';
        typeBadge.style.color      = info.color;

        const typeSelect = document.createElement('select');
        typeSelect.className = 'event-type-select';
        EVENT_OPTIONS.forEach(opt => {
            const o       = document.createElement('option');
            o.value       = opt;
            o.textContent = EVENT_TYPES[opt].label;
            if (opt === ev.type) o.selected = true;
            typeSelect.appendChild(o);
        });
        typeSelect.addEventListener('change', e => {
            this.events[idx].type = e.target.value;
            const ni = EVENT_TYPES[e.target.value];
            dot.style.background       = ni.color;
            typeBadge.textContent      = ni.label;
            typeBadge.style.background = ni.color + '28';
            typeBadge.style.color      = ni.color;
            this.drawEventTimeline();
            this.drawWaveform();
        });

        const timeEl       = document.createElement('div');
        timeEl.className   = 'event-time';
        timeEl.textContent = this.formatTime(ev.startTime);

        const barInfo = info.kind === 'range'
            ? `Bar ${ev.bar} → ${ev.endBar || ev.bar}`
            : `Bar ${ev.bar}.${ev.beat || 1}`;
        const barEl       = document.createElement('div');
        barEl.className   = 'event-bar-info';
        barEl.textContent = barInfo;

        const intEl       = document.createElement('div');
        intEl.className   = 'event-intensity';
        intEl.textContent = `I: ${ev.intensity || 0}`;

        const confBadge       = document.createElement('span');
        confBadge.className   = `confidence-badge conf-${ev.confidence || 'mid'}`;
        confBadge.textContent = (ev.confidence || 'mid').toUpperCase();

        const labelInput       = document.createElement('input');
        labelInput.type        = 'text';
        labelInput.className   = 'event-label-input';
        labelInput.placeholder = 'Label (optional)';
        labelInput.value       = ev.label || '';
        labelInput.addEventListener('input', e => {
            this.events[idx].label = e.target.value;
        });

        const jumpBtn       = document.createElement('button');
        jumpBtn.className   = 'event-jump';
        jumpBtn.textContent = '▶';
        jumpBtn.addEventListener('click', () => this.seekTo(ev.startTime));

        const delBtn       = document.createElement('button');
        delBtn.className   = 'event-delete';
        delBtn.textContent = '×';
        delBtn.addEventListener('click', () => {
            this.events.splice(idx, 1);
            this.renderEventsList();
            this.drawEventTimeline();
            this.drawWaveform();
        });

        row.appendChild(dot);
        row.appendChild(typeBadge);
        row.appendChild(typeSelect);
        row.appendChild(timeEl);
        row.appendChild(barEl);
        row.appendChild(intEl);
        row.appendChild(confBadge);
        row.appendChild(labelInput);
        row.appendChild(jumpBtn);
        row.appendChild(delBtn);
        container.appendChild(row);
    }

    addEventManual() {
        const t    = this.currentTime || 0;
        const newEv = {
            type:       'kick',
            startTime:  t,
            endTime:    t,
            bar:        this.timeToBar(t),
            beat:       this.timeToBeat(t),
            endBar:     this.timeToBar(t),
            intensity:  0.8,
            confidence: 'low',
            label:      '',
        };
        this.events.push(newEv);
        this.events.sort((a, b) => a.startTime - b.startTime);
        this.renderEventsList();
        this.drawEventTimeline();
        this.drawWaveform();
    }

    // ═══════════════════════════════════════════════════════
    // PLAYBACK
    // ═══════════════════════════════════════════════════════

    togglePlay() {
        if (this.isPlaying) this.pausePlayback();
        else this.startPlayback();
    }

    startPlayback() {
        if (!this.audioBuffer || !this.audioContext) return;
        if (this.audioContext.state === 'suspended') this.audioContext.resume();

        this.audioSource        = this.audioContext.createBufferSource();
        this.audioSource.buffer = this.audioBuffer;
        const gain              = this.audioContext.createGain();
        gain.gain.value         = 1.0;
        this.audioSource.connect(gain);
        gain.connect(this.audioContext.destination);

        const offset   = this.pausedAt || 0;
        this.audioSource.start(0, offset);
        this.startedAt = this.audioContext.currentTime - offset;
        this.isPlaying = true;

        this.audioSource.onended = () => {
            if (this.isPlaying) {
                this.isPlaying   = false;
                this.pausedAt    = 0;
                this.currentTime = 0;
                this.updatePlaybackUI();
                this.stopAnimationLoop();
                this.updatePlayheads();
                this.updateTimeDisplay();
            }
        };
        this.updatePlaybackUI();
        this.startAnimationLoop();
    }

    pausePlayback() {
        if (!this.audioSource) return;
        this.pausedAt  = this.audioContext.currentTime - this.startedAt;
        this.audioSource.stop();
        this.audioSource = null;
        this.isPlaying   = false;
        this.updatePlaybackUI();
        this.stopAnimationLoop();
    }

    stopPlayback() {
        if (this.audioSource) {
            try { this.audioSource.stop(); } catch(e) {}
            this.audioSource = null;
        }
        this.isPlaying   = false;
        this.pausedAt    = 0;
        this.currentTime = 0;
        this.updatePlaybackUI();
        this.stopAnimationLoop();
        this.updatePlayheads();
        this.updateTimeDisplay();
    }

    seekTo(timeSec) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) this.pausePlayback();
        this.pausedAt    = Math.max(0, Math.min(this.duration, timeSec));
        this.currentTime = this.pausedAt;
        this.updatePlayheads();
        this.updateTimeDisplay();
        if (wasPlaying) this.startPlayback();
    }

    seekFromCanvas(e, canvas) {
        if (!this.audioBuffer) return;
        const rect  = canvas.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        this.seekTo(ratio * this.duration);
    }

    updatePlaybackUI() {
        const btn = document.getElementById('playBtn');
        if (this.isPlaying) {
            btn.textContent = '⏸';
            btn.classList.add('playing');
        } else {
            btn.textContent = '▶';
            btn.classList.remove('playing');
        }
    }

    startAnimationLoop() {
        if (this.animationId !== null) return;
        const loop = () => {
            if (!this.isPlaying) return;
            this.currentTime = this.audioContext.currentTime - this.startedAt;
            if (this.currentTime >= this.duration) {
                this.currentTime = this.duration;
                this.isPlaying   = false;
                this.pausedAt    = 0;
                this.updatePlaybackUI();
                this.animationId = null;
                this.updatePlayheads();
                this.updateTimeDisplay();
                return;
            }
            this.updatePlayheads();
            this.updateTimeDisplay();
            this.animationId = requestAnimationFrame(loop);
        };
        this.animationId = requestAnimationFrame(loop);
    }

    stopAnimationLoop() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    updatePlayheads() {
        if (!this.duration) return;
        const ratio = Math.min(this.currentTime / this.duration, 1);
        const setHead = (canvas, headEl) => {
            const rect = canvas.getBoundingClientRect();
            headEl.style.left = `${ratio * rect.width - 1}px`;
        };
        setHead(this.waveformCanvas, this.playhead);
        setHead(this.sectionCanvas,  this.sectionPlayhead);
        setHead(this.eventCanvas,    this.eventPlayhead);
    }

    updateTimeDisplay() {
        if (!this.duration) return;
        const t       = this.currentTime;
        const barDur  = (60 / this.bpm) * 4;
        const beatDur = 60 / this.bpm;
        const adj     = Math.max(0, t - this.offset);
        const bar     = Math.floor(adj / barDur) + 1;
        const beat    = Math.floor((adj % barDur) / beatDur) + 1;
        document.getElementById('timeDisplay').textContent = this.formatTime(t);
        document.getElementById('barDisplay').textContent  = `Bar ${bar}.${beat}`;
    }

    // ═══════════════════════════════════════════════════════
    // EXPORT
    // ═══════════════════════════════════════════════════════

    exportJSON() {
        if (this.sections.length === 0) return;
        const data = {
            filename:    this.fileName,
            bpm:         this.bpm,
            offset:      this.offset,
            duration:    parseFloat(this.duration.toFixed(3)),
            analyzed_at: new Date().toISOString(),
            sections: this.sections.map(s => ({
                type:          s.type,
                label:         s.label || SECTION_TYPES[s.type].label,
                start_bar:     s.startBar,
                end_bar:       s.endBar,
                start_time:    parseFloat(s.startTime.toFixed(3)),
                end_time:      parseFloat(s.endTime.toFixed(3)),
                start_display: this.formatTime(s.startTime),
                end_display:   this.formatTime(s.endTime),
                energy_level:  s.energyLevel || 0,
                confidence:    s.confidence,
            })),
            events: this.events.map(ev => ({
                type:          ev.type,
                label:         ev.label || '',
                kind:          EVENT_TYPES[ev.type] ? EVENT_TYPES[ev.type].kind : 'point',
                start_time:    parseFloat(ev.startTime.toFixed(3)),
                end_time:      parseFloat((ev.endTime || ev.startTime).toFixed(3)),
                start_display: this.formatTime(ev.startTime),
                bar:           ev.bar,
                beat:          ev.beat || 1,
                end_bar:       ev.endBar || ev.bar,
                intensity:     ev.intensity || 0,
                confidence:    ev.confidence || 'mid',
            })),
        };
        this.triggerDownload(
            JSON.stringify(data, null, 2),
            'application/json',
            `dnb_${this.fileName.replace(/[^a-z0-9]/gi,'_')}.json`
        );
    }

    exportCSV() {
        if (this.sections.length === 0) return;
        const rows = [
            ['kind','type','label','start_bar','end_bar',
             'start_time','end_time','energy_level','confidence']
        ];
        this.sections.forEach(s => {
            rows.push([
                'section', s.type,
                s.label || SECTION_TYPES[s.type].label,
                s.startBar, s.endBar,
                s.startTime.toFixed(3), s.endTime.toFixed(3),
                s.energyLevel || 0, s.confidence,
            ]);
        });
        this.events.forEach(ev => {
            rows.push([
                'event', ev.type, ev.label || '',
                ev.bar, ev.endBar || ev.bar,
                ev.startTime.toFixed(3),
                (ev.endTime || ev.startTime).toFixed(3),
                ev.intensity || 0,
                ev.confidence || 'mid',
            ]);
        });
        const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
        this.triggerDownload(
            csv, 'text/csv',
            `dnb_${this.fileName.replace(/[^a-z0-9]/gi,'_')}.csv`
        );
    }

    triggerDownload(content, mime, filename) {
        const blob = new Blob([content], { type: mime });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

} // ← закрывает класс DnBAnalyzer

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    new DnBAnalyzer();
});