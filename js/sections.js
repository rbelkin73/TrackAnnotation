// ═══════════════════════════════════════════════
// SECTIONS — анализ структуры (STRICT 16-BAR MACRO)
// ═══════════════════════════════════════════════

function extractFeatures() {
    const sr = APP.audioBuffer.sampleRate;
    const ch = APP.audioBuffer.getChannelData(0);
    const total = ch.length;
    
    // ВАЖНО: Анализируем по 1 бару для большей точности
    const barSamples = Math.round(sr * (60 / APP.bpm) * 4);
    const blockSamples = barSamples; // 1 блок = 1 бар
    const numBlocks = Math.floor(total / blockSamples);

    const rms = new Float32Array(numBlocks);
    const sub = new Float32Array(numBlocks);
    const high = new Float32Array(numBlocks);
    const flux = new Float32Array(numBlocks);

    // Псевдо-IIR 2-го порядка для более четкого разделения
    const rcSub = Math.exp(-2 * Math.PI * 90 / sr);
    const rcHigh = Math.exp(-2 * Math.PI * 3000 / sr);

    let ySub1 = 0, ySub2 = 0;
    let yHigh1 = 0, yHigh2 = 0;
    let prevSpectrumSum = 0;

    for (let b = 0; b < numBlocks; b++) {
        const start = b * blockSamples;
        const end = Math.min(start + blockSamples, total);
        const len = end - start;

        let sumRms = 0, sumSub = 0, sumHigh = 0;
        
        for (let i = start; i < end; i++) {
            const x = ch[i];
            
            // Фильтры
            ySub1 = rcSub * ySub1 + (1 - rcSub) * x;
            ySub2 = rcSub * ySub2 + (1 - rcSub) * ySub1;
            
            yHigh1 = rcHigh * yHigh1 + (1 - rcHigh) * x;
            yHigh2 = rcHigh * yHigh2 + (1 - rcHigh) * yHigh1;
            const highSignal = x - yHigh2;

            sumRms += x * x;
            sumSub += ySub2 * ySub2;
            sumHigh += highSignal * highSignal;
        }

        rms[b] = Math.sqrt(sumRms / len);
        sub[b] = Math.sqrt(sumSub / len);
        high[b] = Math.sqrt(sumHigh / len);

        // Упрощенный Flux (разница энергии с предыдущим баром)
        const currentSum = rms[b] + sub[b] + high[b];
        flux[b] = b === 0 ? 0 : Math.max(0, currentSum - prevSpectrumSum);
        prevSpectrumSum = currentSum;
    }

    return { rms, sub, high, flux, numBlocks, blockSamples };
}


function buildSections(features, kickDensity) {
    const { rms, sub, high, numBlocks, blockSamples } = features;
    const sr = APP.audioBuffer.sampleRate;

    const normalize = arr => {
        let max = Math.max(...arr) || 1;
        return Array.from(arr, v => v / max);
    };

    const nRms = normalize(rms);
    const nSub = normalize(sub);

    // 1. Вычисляем глобальные средние по треку
    const avgRms = nRms.reduce((a, b) => a + b, 0) / numBlocks;
    const avgSub = nSub.reduce((a, b) => a + b, 0) / numBlocks;

    const phrases = [];
    const barsPerPhrase = 16;
    const numPhrases = Math.ceil(numBlocks / barsPerPhrase);

    // 2. Группируем бары в 16-тактовые фразы (МАКРО-СТРУКТУРА)
    for (let p = 0; p < numPhrases; p++) {
        const startBarIdx = p * barsPerPhrase;
        const endBarIdx = Math.min(startBarIdx + barsPerPhrase, numBlocks) - 1;
        const phraseLen = endBarIdx - startBarIdx + 1;

        if (phraseLen < 4) continue; // Игнорируем огрызки в конце

        let pSub = 0, pRms = 0, pHigh = 0;
        for (let b = startBarIdx; b <= endBarIdx; b++) {
            pSub += nSub[b];
            pRms += nRms[b];
        }
        pSub /= phraseLen;
        pRms /= phraseLen;

        // Жесткая логика классификации целой фразы
        let type = 'BRIDGE';
        
        // Если саба и энергии сильно больше среднего - это DROP
        if (pSub > avgSub * 1.1 && pRms > avgRms * 1.05) {
            type = 'DROP';
        } 
        // Если саба мало, но общая энергия средняя - BREAKDOWN или BUILDUP
        else if (pSub < avgSub * 0.7) {
            type = pRms > avgRms * 0.8 ? 'BUILDUP' : 'BREAKDOWN';
        } 
        // Интро / Аутро
        else if (p < 2 && pRms < avgRms) {
            type = 'INTRO';
        } 
        else if (p >= numPhrases - 2 && pRms < avgRms) {
            type = 'OUTRO';
        }

        phrases.push({
            type,
            startBar: startBarIdx + 1, // Бары с 1
            endBar: endBarIdx + 1,
            energyLevel: parseFloat(pRms.toFixed(2)),
            subLevel: pSub
        });
    }

    // 3. Сглаживание и объединение (Merge)
    const sections = [];
    let currentSec = null;
    let typeCounter = {};

    for (let i = 0; i < phrases.length; i++) {
        const p = phrases[i];
        
        // Коррекция контекста: BUILDUP обычно идет ПЕРЕД DROP
        if (p.type === 'BREAKDOWN' && phrases[i+1]?.type === 'DROP') {
            p.type = 'BUILDUP';
        }

        if (!currentSec) {
            currentSec = { ...p };
        } else if (currentSec.type === p.type) {
            currentSec.endBar = p.endBar;
            currentSec.energyLevel = parseFloat(((currentSec.energyLevel + p.energyLevel) / 2).toFixed(2));
        } else {
            sections.push(currentSec);
            currentSec = { ...p };
        }
    }
    if (currentSec) sections.push(currentSec);

    // 4. Форматирование результата для UI
    return sections.map((sec, idx) => {
        // Автонумерация
        typeCounter[sec.type] = (typeCounter[sec.type] || 0) + 1;
        const count = typeCounter[sec.type];
        
        const labelBase = SECTION_TYPES[sec.type]?.label || sec.type;
        const label = count > 1 || sections.filter(s => s.type === sec.type).length > 1 
            ? `${labelBase} ${count}` 
            : labelBase;

        const startTime = APP.offset + (sec.startBar - 1) * (60 / APP.bpm) * 4;
        const endTime = APP.offset + sec.endBar * (60 / APP.bpm) * 4;

        return {
            type: sec.type,
            label,
            startBar: sec.startBar,
            endBar: sec.endBar,
            startTime,
            endTime,
            energyLevel: sec.energyLevel,
            confidence: sec.endBar - sec.startBar >= 32 ? 'high' : 'mid',
        };
    });
}