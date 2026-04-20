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
    return proto + '//' + window.location.host + '/ws';
  }
  const u = new URL(base);
  const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return wsProto + '//' + u.host + '/ws';
}

function getRestUrl(path) {
  const base = getApiBase();
  if (!base) {
    return window.location.origin + path;
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
 * 语义全文分析（按钮触发，非流式，保留兼容）
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
 * 流式语义分析（SSE）
 * onThinkingStart()       — 模型开始思考
 * onThinkingToken(text)   — 思考过程的 token
 * onThinkingEnd()         — 思考结束
 * onToken(text)           — 正文 token
 * onDone(verdict)         — 生成完成
 * onError(err)            — 出错
 */
async function semanticAnalyzeStream(transcript, callbacks) {
  var cb = callbacks || {};
  try {
    var r = await fetch(getRestUrl('/api/semantic-analyze-stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcript }),
    });
    if (!r.ok) {
      var errText = await r.text();
      if (cb.onError) cb.onError(new Error('请求失败: ' + errText));
      return;
    }
    var reader = r.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line.startsWith('data: ')) continue;
        try {
          var evt = JSON.parse(line.slice(6));
          if (evt.type === 'loading' && cb.onLoading) cb.onLoading();
          else if (evt.type === 'thinking_start' && cb.onThinkingStart) cb.onThinkingStart();
          else if (evt.type === 'thinking_token' && cb.onThinkingToken) cb.onThinkingToken(evt.text);
          else if (evt.type === 'thinking_end' && cb.onThinkingEnd) cb.onThinkingEnd();
          else if (evt.type === 'token' && cb.onToken) cb.onToken(evt.text);
          else if (evt.type === 'done' && cb.onDone) cb.onDone(evt.verdict);
          else if (evt.type === 'error' && cb.onError) cb.onError(new Error(evt.text));
        } catch (e) { /* skip malformed line */ }
      }
    }
  } catch (e) {
    if (cb.onError) cb.onError(e);
  }
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

// ── 语音测谎 API ──────────────────────────────────────────────────────────

async function uploadAudios(sessionId, fileList) {
  var fd = new FormData();
  for (var i = 0; i < fileList.length; i++) {
    fd.append('files', fileList[i]);
  }
  var r = await fetch(getRestUrl('/sessions/' + sessionId + '/audios'), {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function listAudios(sessionId) {
  var r = await fetch(getRestUrl('/sessions/' + sessionId + '/audios'));
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function analyzeAudio(sessionId, filename) {
  var r = await fetch(getRestUrl('/sessions/' + sessionId + '/audios/' + encodeURIComponent(filename) + '/analyze'), {
    method: 'POST',
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function getAudioStreamUrl(sessionId, filename) {
  return getRestUrl('/sessions/' + sessionId + '/audios/' + encodeURIComponent(filename) + '/stream');
}
