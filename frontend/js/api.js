/**
 * 测谎系统 - API 与 WebSocket 封装
 * 与 PRD §7、后端路由一致
 */

function getApiBase() {
  const s = localStorage.getItem('cehuang_api_base');
  return (s && s.trim()) || '';
}

function getWsUrl() {
  const base = getApiBase();
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!base) {
    const host = window.location.hostname;
    const port = window.location.port;
    const use9000 = (port === '9000' || window.location.origin.includes('9000'));
    const hostPort = use9000 ? (host + ':' + (port || '9000')) : (host + ':9000');
    return proto + '//' + hostPort + '/ws';
  }
  const u = new URL(base);
  const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return wsProto + '//' + u.host + '/ws';
}

function getRestUrl(path) {
  const base = getApiBase();
  if (!base) {
    const origin = window.location.origin;
    if (origin.includes('9000')) return origin + path;
    return `${window.location.protocol}//${window.location.hostname}:9000` + path;
  }
  return base.replace(/\/$/, '') + path;
}

async function createSession() {
  const r = await fetch(getRestUrl('/sessions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  return data.session_id;
}

async function endSession(sessionId) {
  const r = await fetch(getRestUrl('/sessions/' + sessionId + '/end'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  return data.report_id;
}

async function getReportBySessionId(sessionId) {
  const r = await fetch(getRestUrl('/sessions/' + sessionId + '/report'));
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function getReport(reportId) {
  const r = await fetch(getRestUrl('/reports/' + reportId));
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function listSessions(limit = 50) {
  const r = await fetch(getRestUrl('/sessions?limit=' + limit));
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function createSessionWithName(name) {
  const r = await fetch(getRestUrl('/sessions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || '' }),
  });
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  return data.session_id;
}

async function uploadOutline(sessionId, file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(getRestUrl('/sessions/' + sessionId + '/outline'), {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function getOutline(sessionId) {
  const r = await fetch(getRestUrl('/sessions/' + sessionId + '/outline'));
  if (!r.ok) return null;
  return r.json();
}

async function uploadVideo(sessionId, blob) {
  const fd = new FormData();
  fd.append('file', blob, 'recording.webm');
  const r = await fetch(getRestUrl('/sessions/' + sessionId + '/video'), {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function getVideoUrl(sessionId) {
  return getRestUrl('/sessions/' + sessionId + '/video');
}

async function saveTranscript(sessionId, entries) {
  const r = await fetch(getRestUrl('/sessions/' + sessionId + '/transcript'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function getTranscript(sessionId) {
  const r = await fetch(getRestUrl('/sessions/' + sessionId + '/transcript'));
  if (!r.ok) return null;
  return r.json();
}

async function getSessionMeta(sessionId) {
  const r = await fetch(getRestUrl('/sessions/' + sessionId + '/meta'));
  if (!r.ok) return null;
  return r.json();
}

/**
 * 语义全文分析（按钮触发）
 * transcript: 完整对话转录文本
 * 返回 { analysis, issues, verdict, source }
 */
async function semanticAnalyze(transcript) {
  const r = await fetch(getRestUrl('/api/semantic-analyze'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error('语义分析请求失败: ' + err);
  }
  return r.json();
}

/**
 * 建立 WebSocket，每 2s 发送一帧+音频（若已采集）
 * onResult(result), onError(err), onClose(), onTranscript(tr), onConnected() 可选
 */
function connectWS(sessionId, getFrameBase64, getAudioBase64, getText, intervalMs, onResult, onError, onClose, onTranscript, onConnected, getGreenValues) {
  const wsUrl = getWsUrl();
  const ws = new WebSocket(wsUrl);
  let ticker = null;
  let closed = false;

  ws.onopen = () => {
    if (onConnected) onConnected();
    ticker = setInterval(() => {
      if (closed) return;
      const frame = getFrameBase64 && getFrameBase64();
      const audio = getAudioBase64 && getAudioBase64();
      const text = getText && getText();
      const greenValues = getGreenValues && getGreenValues();
      if (audio) console.log('[WS] 发送音频 base64 长度:', audio.length);
      if (greenValues && greenValues.length) console.log('[rPPG] 发送绿色通道样本数:', greenValues.length);
      const msg = {
        type: 'frame',
        session_id: sessionId,
        video_base64: frame || undefined,
        audio_base64: audio || undefined,
        text: text || undefined,
        green_values: (greenValues && greenValues.length) ? greenValues : undefined,
      };
      ws.send(JSON.stringify(msg));
    }, intervalMs || 2000);
  };

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'result' && onResult) onResult(data);
      if (data.type === 'transcript' && onTranscript) onTranscript(data);
      if (data.type === 'error' && onError) onError(new Error(data.detail));
    } catch (e) {
      if (onError) onError(e);
    }
  };

  ws.onerror = () => { if (onError) onError(new Error('WebSocket 连接失败')); };
  ws.onclose = () => {
    if (!closed && onError) onError(new Error('后端未连接，请先启动：在项目目录执行 PYTHONPATH=. uvicorn backend.main:app --port 9000'));
    closed = true;
    if (ticker) clearInterval(ticker);
    if (onClose) onClose();
  };

  return () => {
    closed = true;
    if (ticker) clearInterval(ticker);
    ws.close();
  };
}
