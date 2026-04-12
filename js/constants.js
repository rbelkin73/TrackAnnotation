// ═══════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════

const SECTION_TYPES = {
    INTRO:      { label: 'Intro',      color: '#6366f1' },
    BUILDUP:    { label: 'Buildup',    color: '#f97316' },
    DROP:       { label: 'Drop',       color: '#ef4444' },
    BREAKDOWN:  { label: 'Breakdown',  color: '#3b82f6' },
    BRIDGE:     { label: 'Bridge',     color: '#8b5cf6' },
    OUTRO:      { label: 'Outro',      color: '#64748b' },
};
const SECTION_OPTIONS = Object.keys(SECTION_TYPES);

const EVENT_TYPES = {
    impact:      { label: 'Impact',      color: '#ffffff', kind: 'point' },
    riser:       { label: 'Riser',       color: '#a78bfa', kind: 'range' },
    snare_roll:  { label: 'Snare Roll',  color: '#f97316', kind: 'range' },
    drum_fill:   { label: 'Drum Fill',   color: '#34d399', kind: 'range' },
    break:       { label: 'Break',       color: '#38bdf8', kind: 'range' },
    bridge:      { label: 'Bridge',      color: '#8b5cf6', kind: 'range' },
    sub_drop:    { label: 'Sub Drop',    color: '#22c55e', kind: 'point' },
    sub_return:  { label: 'Sub Return',  color: '#f43f5e', kind: 'point' },
};
const EVENT_OPTIONS      = Object.keys(EVENT_TYPES);
const EVENT_POINT_TYPES  = EVENT_OPTIONS.filter(k => EVENT_TYPES[k].kind === 'point');
const EVENT_RANGE_TYPES  = EVENT_OPTIONS.filter(k => EVENT_TYPES[k].kind === 'range');

const APP = {
    audioContext:  null,
    audioBuffer:   null,
    audioSource:   null,
    gainNode:      null,
    bpm:           174,
    offset:        0,
    duration:      0,
    fileName:      '',
    isPlaying:     false,
    startedAt:     0,
    pausedAt:      0,
    currentTime:   0,
    animationId:   null,
    zoom:          1,
    viewStart:     0,
    viewEnd:       0,
    sections:      [],
    events:        [],
    energyData:    null,
    waveformData:  null,
    waveformView:  null,
};