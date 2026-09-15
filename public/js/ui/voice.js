/**
 * Ovoz funksiyalari:
 *  - Speech-to-Text: Web Speech API (SpeechRecognition)
 *  - Text-to-Speech: SpeechSynthesis
 *
 * Mikrofon foydalanuvchi tugmani bosmaguncha ISHGA TUSHMAYDI va
 * to'xtatilganda oqim darhol yopiladi.
 */
import { $, el } from '../core/dom.js';
import { t, getLanguage } from '../core/i18n.js';
import { toast } from './toast.js';

const LOCALE = { uz: 'uz-UZ', ru: 'ru-RU', en: 'en-US' };

let recognition = null;
let recording = false;
let timerId = null;
let waveId = null;
let startedAt = 0;
let mediaStream = null;
let analyser = null;
let audioCtx = null;

export const isVoiceSupported = () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

/**
 * Ovoz yozishni boshlaydi.
 * @param {(text:string, isFinal:boolean)=>void} onText
 */
export async function startRecording(onText) {
  if (recording) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { toast(t('voice.notSupported'), 'warn', 6000); return; }

  // Mikrofonga ruxsat: brauzer so'raydi, biz majburlamaymiz
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? t('voice.denied') : t('voice.error'), 'error');
    return;
  }

  recognition = new Recognition();
  recognition.lang = LOCALE[getLanguage()] || 'uz-UZ';
  recognition.continuous = true;
  recognition.interimResults = true;

  let finalText = '';

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += chunk + ' ';
      else interim += chunk;
    }
    onText((finalText + interim).trim(), false);
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech') toast(t('voice.noSpeech'), 'warn');
    else if (event.error === 'not-allowed') toast(t('voice.denied'), 'error');
    else if (event.error !== 'aborted') toast(t('voice.error'), 'error');
    stopRecording();
  };

  recognition.onend = () => {
    if (recording) { onText(finalText.trim(), true); stopRecording(); }
  };

  try {
    recognition.start();
  } catch {
    toast(t('voice.error'), 'error');
    releaseMic();
    return;
  }

  recording = true;
  startedAt = Date.now();
  showPanel(true);
  startTimer();
  startWave();
}

export function stopRecording() {
  if (!recording) return;
  recording = false;

  try { recognition?.stop(); } catch { /* allaqachon to'xtagan */ }
  recognition = null;

  clearInterval(timerId);
  cancelAnimationFrame(waveId);
  releaseMic();
  showPanel(false);
}

export const isRecording = () => recording;

/** Mikrofon oqimini to'liq yopamiz — indikator o'chishi uchun muhim. */
function releaseMic() {
  for (const track of mediaStream?.getTracks() || []) track.stop();
  mediaStream = null;
  try { audioCtx?.close(); } catch { /* yopilgan */ }
  audioCtx = null;
  analyser = null;
}

/* ── Panel ── */
function showPanel(visible) {
  const panel = $('#recorder');
  const mic = $('#btn-mic');
  if (panel) panel.hidden = !visible;
  if (mic) mic.classList.toggle('is-recording', visible);
  if (visible) buildWave();
}

function startTimer() {
  const timeNode = $('#rec-time');
  const tick = () => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    if (timeNode) timeNode.textContent = `${mm}:${ss}`;
    if (seconds >= 120) stopRecording();          // xavfsizlik chegarasi: 2 daqiqa
  };
  tick();
  timerId = setInterval(tick, 500);
}

/* ── Jonli to'lqin ── */
const BARS = 28;

function buildWave() {
  const wave = $('#rec-wave');
  if (!wave || wave.children.length) return;
  for (let i = 0; i < BARS; i++) wave.append(el('b'));
}

function startWave() {
  const wave = $('#rec-wave');
  if (!wave || !mediaStream) return;

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
  } catch { return; }

  const data = new Uint8Array(analyser.frequencyBinCount);
  const bars = [...wave.children];

  const draw = () => {
    if (!recording || !analyser) return;
    analyser.getByteFrequencyData(data);
    bars.forEach((bar, i) => {
      const value = data[i % data.length] / 255;
      bar.style.height = `${Math.max(15, value * 100)}%`;
      bar.style.opacity = String(0.4 + value * 0.6);
    });
    waveId = requestAnimationFrame(draw);
  };
  draw();
}

/* ── Matnni ovozda o'qish ── */
let currentUtterance = null;

export function speak(text, lang = 'uz', onEnd) {
  if (!window.speechSynthesis) { toast(t('voice.ttsNotSupported'), 'warn'); onEnd?.(); return; }

  stopSpeaking();

  // Markdown belgilari va kod bloklari ovozda o'qilmasin
  const clean = String(text)
    .replace(/```[\s\S]*?```/g, '. ')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 4000)
    .trim();
  if (!clean) { onEnd?.(); return; }

  currentUtterance = new SpeechSynthesisUtterance(clean);
  currentUtterance.lang = LOCALE[lang] || LOCALE.uz;
  currentUtterance.rate = 1.02;
  currentUtterance.pitch = 1;

  // Mos ovozni tanlaymiz (mavjud bo'lsa)
  const voices = speechSynthesis.getVoices();
  const match = voices.find((v) => v.lang === currentUtterance.lang)
    || voices.find((v) => v.lang?.startsWith(currentUtterance.lang.slice(0, 2)));
  if (match) currentUtterance.voice = match;

  currentUtterance.onend = () => { currentUtterance = null; onEnd?.(); };
  currentUtterance.onerror = () => { currentUtterance = null; onEnd?.(); };

  speechSynthesis.speak(currentUtterance);
}

export function stopSpeaking() {
  if (window.speechSynthesis?.speaking) speechSynthesis.cancel();
  currentUtterance = null;
}

export const isSpeaking = () => Boolean(window.speechSynthesis?.speaking);

// Ovozlar ro'yxati kech yuklanadi — oldindan qo'zg'atamiz
if (window.speechSynthesis) speechSynthesis.getVoices();
