/**
 * 测谎系统 - 前端路由与页面
 * Hash 路由: #/ 首页 #/device 设备检测 #/session #/session-video #/voice #/voice-detail #/report/:id …
 */

(function () {
  const root = document.getElementById('app');
  if (!root) return;

  function nav() {
    const base = window.location.href.split('#')[0];
    return `
      <nav class="nav">
        <a class="brand" href="${base}#/">测谎系统</a>
        <a href="${base}#/">首页</a>
        <a href="${base}#/device">设备检测</a>
        <a href="${base}#/history">历史</a>
        <a href="${base}#/settings">设置</a>
      </nav>`;
  }

  function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderStreamHtml(raw) {
    return escHtml(raw)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/「(.+?)」/g, '<span style="background:var(--card-bg);padding:1px 4px;border-radius:3px;border:1px solid var(--border-color);">「$1」</span>')
      .replace(/\n/g, '<br>');
  }

  var EMOTION_LABELS = { angry: '愤怒', disgusted: '厌恶', fearful: '恐惧', happy: '开心', neutral: '平静', other: '其他', sad: '悲伤', surprised: '惊讶', unknown: '未知' };
  function renderEmotionScores(scores) {
    if (!scores || typeof scores !== 'object') return '';
    var order = ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'other', 'sad', 'surprised', 'unknown'];
    var html = '';
    order.forEach(function (key) {
      var val = scores[key];
      if (val === undefined) val = 0;
      var pct = Math.round(Number(val) * 100);
      var label = EMOTION_LABELS[key] || key;
      html += '<div class="emotion-row"><span class="emotion-name">' + label + '</span><span class="emotion-bar-wrap"><span class="emotion-bar" style="width:' + pct + '%"></span></span><span class="emotion-pct">' + pct + '%</span></div>';
    });
    return html;
  }

  // 导航守卫：每次路由切换时递增，用于取消旧页面的挂起异步操作
  let _navEpoch = 0;

  function render(html) {
    root.innerHTML = nav() + '<div id="page">' + html + '</div>';
  }

  function parseHash() {
    const h = (window.location.hash || '#/').slice(1);
    const [path, id] = h.split('/').filter(Boolean);
    return { path: path || 'home', id: id || null };
  }

  // ---------- 首页（三种测谎任务）----------
  function pageHome() {
    const base = window.location.href.split('#')[0];
    render(`
      <div class="home-page">
        <h1 class="page-title">选择测谎任务</h1>
        <p style="color:var(--text-muted);margin-bottom:24px;font-size:14px;">请选择一种分析方式进入对应工作区</p>
        <div class="task-grid">
          <a class="task-card task-card-primary" href="${base}#/device">
            <span class="task-card-icon">▶</span>
            <span class="task-card-title">实时测谎</span>
            <span class="task-card-desc">摄像头与麦克风实时采集，表情、情绪、心率、语义多模态分析</span>
          </a>
          <a class="task-card" href="${base}#/session-video-setup">
            <span class="task-card-icon">📁</span>
            <span class="task-card-title">视频测谎</span>
            <span class="task-card-desc">上传本地视频，分析逻辑与实时测谎一致，左侧为视频播放</span>
          </a>
          <a class="task-card" href="${base}#/voice">
            <span class="task-card-icon">🎙</span>
            <span class="task-card-title">语音测谎</span>
            <span class="task-card-desc">上传音频文件，逐段分析情绪分布，可视化情绪时间轴</span>
          </a>
          <a class="task-card" href="${base}#/wechat-voice">
            <span class="task-card-icon">💬</span>
            <span class="task-card-title">微信语音测谎</span>
            <span class="task-card-desc">实时录音，同步语音转文字，并实时标注当前段落情绪</span>
          </a>
        </div>
      </div>
    `);
  }

  // ---------- 语音测谎：创建任务弹窗 ----------
  function showCreateTaskModalForVoice() {
    var overlay = document.createElement('div');
    overlay.id = 'create-task-overlay';
    overlay.innerHTML = `
      <div class="create-task-modal">
        <h2 class="modal-title">创建语音测谎任务</h2>
        <div class="modal-field">
          <label class="modal-label">任务名称 <span style="color:var(--danger)">*</span></label>
          <input type="text" id="task-name-input" class="modal-input" placeholder="例：嫌疑人A 语音分析" maxlength="80" />
        </div>
        <div class="modal-field">
          <label class="modal-label">上传音频 <span style="color:var(--danger)">*</span></label>
          <div class="file-upload-area" id="audio-drop-area">
            <input type="file" id="audio-file-input" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm" multiple style="display:none" />
            <div class="file-upload-hint" id="audio-upload-hint">
              点击选择或拖入音频文件（可多选）<br><span style="font-size:11px;opacity:.6">支持 .wav / .mp3 / .m4a / .ogg / .flac 等</span>
            </div>
          </div>
          <div id="audio-file-list" class="audio-file-list"></div>
        </div>
        <div id="modal-error" style="color:var(--danger);font-size:13px;min-height:20px;"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">取消</button>
          <button class="btn btn-primary" id="modal-confirm">创建并分析</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    var fileInput = overlay.querySelector('#audio-file-input');
    var dropArea = overlay.querySelector('#audio-drop-area');
    var fileListEl = overlay.querySelector('#audio-file-list');
    var selectedFiles = [];

    function renderFileList() {
      if (selectedFiles.length === 0) {
        fileListEl.innerHTML = '';
        return;
      }
      fileListEl.innerHTML = selectedFiles.map(function (f, i) {
        var sizeMB = (f.size / 1024 / 1024).toFixed(1);
        return '<div class="audio-file-item"><span class="audio-file-name">' + escHtml(f.name) + '</span><span class="audio-file-size">' + sizeMB + ' MB</span><button type="button" class="audio-file-remove" data-idx="' + i + '">✕</button></div>';
      }).join('');
      fileListEl.querySelectorAll('.audio-file-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectedFiles.splice(parseInt(btn.dataset.idx), 1);
          renderFileList();
        });
      });
    }

    function addFiles(files) {
      for (var i = 0; i < files.length; i++) selectedFiles.push(files[i]);
      renderFileList();
    }

    dropArea.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { if (fileInput.files.length) addFiles(fileInput.files); fileInput.value = ''; });
    dropArea.addEventListener('dragover', function (e) { e.preventDefault(); dropArea.style.borderColor = 'var(--primary)'; });
    dropArea.addEventListener('dragleave', function () { dropArea.style.borderColor = ''; });
    dropArea.addEventListener('drop', function (e) { e.preventDefault(); dropArea.style.borderColor = ''; if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

    overlay.querySelector('#modal-cancel').addEventListener('click', function () {
      document.body.removeChild(overlay);
      window.location.hash = '#/';
    });

    overlay.querySelector('#modal-confirm').addEventListener('click', async function () {
      var name = (overlay.querySelector('#task-name-input').value || '').trim();
      var errEl = overlay.querySelector('#modal-error');
      if (!name) { errEl.textContent = '请填写任务名称'; return; }
      if (selectedFiles.length === 0) { errEl.textContent = '请至少上传一条音频'; return; }
      errEl.textContent = '';
      var confirmBtn = overlay.querySelector('#modal-confirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = '创建中…';
      try {
        var sessionId = await createSessionWithName(name);
        confirmBtn.textContent = '上传音频…';
        await uploadAudios(sessionId, selectedFiles);
        sessionStorage.setItem('cehuang_session_id', sessionId);
        document.body.removeChild(overlay);
        window.location.hash = '#/voice-detail';
      } catch (e) {
        errEl.textContent = '创建失败: ' + (e.message || e);
        confirmBtn.disabled = false;
        confirmBtn.textContent = '创建并分析';
      }
    });
    setTimeout(function () { overlay.querySelector('#task-name-input').focus(); }, 50);
  }

  function pageVoiceSetup() {
    render('<div><p class="card" style="padding:16px;color:var(--text-muted)">请填写任务信息…</p></div>');
    showCreateTaskModalForVoice();
  }

  // ---------- 语音测谎详情页 ----------
  var EMOTION_COLORS = {
    angry: '#e74c3c', disgusted: '#8e44ad', fearful: '#e67e22', happy: '#2ecc71',
    neutral: '#4a9eff', other: '#95a5a6', sad: '#3498db', surprised: '#f1c40f', unknown: '#666'
  };

  function pageVoiceDetail() {
    var sessionId = sessionStorage.getItem('cehuang_session_id');
    if (!sessionId) { window.location.hash = '#/'; return; }
    var base = window.location.href.split('#')[0];

    render(`
      <div class="voice-detail-page">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
          <h1 class="page-title" style="margin-bottom:0;">语音测谎</h1>
          <a href="${base}#/" class="btn btn-secondary" style="padding:5px 14px;font-size:12px;">返回首页</a>
        </div>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px;">会话 ${sessionId.slice(0, 8)}</p>
        <div id="voice-audio-list">
          <p style="color:var(--text-muted);">正在加载音频列表…</p>
        </div>
      </div>
    `);

    listAudios(sessionId).then(function (data) {
      var container = document.getElementById('voice-audio-list');
      if (!container) return;
      var files = data.files || [];
      if (files.length === 0) {
        container.innerHTML = '<p class="card" style="padding:16px;">未找到音频文件。</p>';
        return;
      }
      container.innerHTML = files.map(function (f, i) {
        return '<div class="card voice-audio-card" id="audio-card-' + i + '">'
          + '<div class="voice-audio-header">'
          + '<span class="voice-audio-name">' + escHtml(f.filename) + '</span>'
          + '<span class="voice-audio-size">' + (f.size / 1024 / 1024).toFixed(1) + ' MB</span>'
          + '<button class="btn btn-primary btn-analyze" data-idx="' + i + '" data-fn="' + escHtml(f.filename) + '" style="padding:4px 14px;font-size:12px;">分析情绪</button>'
          + '</div>'
          + '<div class="voice-audio-player"><audio controls preload="metadata" src="' + getAudioStreamUrl(sessionId, f.filename) + '" style="width:100%;height:36px;"></audio></div>'
          + '<div class="voice-waveform-wrap" id="waveform-wrap-' + i + '"></div>'
          + '<div class="voice-emotion-timeline" id="emotion-tl-' + i + '"></div>'
          + '<div class="voice-transcript" id="transcript-' + i + '"></div>'
          + '</div>';
      }).join('');

      container.querySelectorAll('.btn-analyze').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = parseInt(btn.dataset.idx);
          var fn = btn.dataset.fn;
          btn.disabled = true;
          btn.textContent = '分析中…';
          analyzeAudio(sessionId, fn).then(function (result) {
            btn.textContent = '已完成';
            renderWaveformAndEmotions(idx, result);
          }).catch(function (e) {
            btn.disabled = false;
            btn.textContent = '重试';
            alert('分析失败: ' + (e.message || e));
          });
        });
      });
    }).catch(function (e) {
      var container = document.getElementById('voice-audio-list');
      if (container) container.innerHTML = '<p class="status-fail" style="padding:12px;">加载失败: ' + (e.message || e) + '</p>';
    });
  }

  function renderWaveformAndEmotions(idx, result) {
    var wrapEl = document.getElementById('waveform-wrap-' + idx);
    var tlEl = document.getElementById('emotion-tl-' + idx);
    var trEl = document.getElementById('transcript-' + idx);
    if (!wrapEl || !tlEl) return;
    var duration = result.duration || 0;
    var waveform = result.waveform || [];
    var segments = result.segments || [];

    // 波形 canvas
    var cvs = document.createElement('canvas');
    cvs.className = 'voice-waveform-canvas';
    cvs.width = wrapEl.clientWidth || 800;
    cvs.height = 80;
    wrapEl.innerHTML = '';
    wrapEl.appendChild(cvs);
    drawWaveform(cvs, waveform);

    // 情绪标注条
    if (segments.length === 0) {
      tlEl.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:4px 0;">无分段情绪数据</p>';
      return;
    }
    var totalDur = duration || (segments.length ? segments[segments.length - 1].end : 1);
    var html = '<div class="emotion-bar-track" style="position:relative;height:28px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,0.04);">';
    segments.forEach(function (seg) {
      var left = (seg.start / totalDur * 100).toFixed(2);
      var width = ((seg.end - seg.start) / totalDur * 100).toFixed(2);
      var emo = seg.dominant_emotion || 'unknown';
      var color = EMOTION_COLORS[emo] || '#666';
      var label = EMOTION_LABELS[emo] || emo;
      html += '<div class="emotion-seg" title="' + label + ' (' + (seg.dominant_score * 100).toFixed(0) + '%) ' + seg.start.toFixed(1) + 's–' + seg.end.toFixed(1) + 's" '
        + 'style="position:absolute;left:' + left + '%;width:' + width + '%;height:100%;background:' + color + '88;border-right:1px solid var(--bg-primary);display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;overflow:hidden;white-space:nowrap;cursor:default;">'
        + (parseFloat(width) > 5 ? label : '')
        + '</div>';
    });
    html += '</div>';
    // 图例
    var usedEmotions = {};
    segments.forEach(function (s) { usedEmotions[s.dominant_emotion] = true; });
    html += '<div class="emotion-legend">';
    Object.keys(usedEmotions).forEach(function (emo) {
      var color = EMOTION_COLORS[emo] || '#666';
      var label = EMOTION_LABELS[emo] || emo;
      html += '<span class="emotion-legend-item"><span class="emotion-legend-dot" style="background:' + color + '"></span>' + label + '</span>';
    });
    html += '</div>';
    // 分段详情表
    html += '<div class="emotion-segments-detail"><table class="emotion-seg-table"><thead><tr><th>时段</th><th>主要情绪</th><th>置信度</th><th>9 类分数</th></tr></thead><tbody>';
    segments.forEach(function (seg) {
      var emo = seg.dominant_emotion || 'unknown';
      var color = EMOTION_COLORS[emo] || '#666';
      var label = EMOTION_LABELS[emo] || emo;
      var scoresHtml = '';
      if (seg.emotion_scores) {
        var order = ['angry','disgusted','fearful','happy','neutral','other','sad','surprised','unknown'];
        order.forEach(function (k) {
          var v = seg.emotion_scores[k] || 0;
          var pct = (v * 100).toFixed(0);
          if (v > 0.01) {
            scoresHtml += '<span class="seg-score-chip" style="border-color:' + (EMOTION_COLORS[k] || '#666') + '40">' + (EMOTION_LABELS[k] || k) + ' ' + pct + '%</span> ';
          }
        });
      }
      html += '<tr><td>' + seg.start.toFixed(1) + 's – ' + seg.end.toFixed(1) + 's</td>'
        + '<td style="color:' + color + ';font-weight:600;">' + label + '</td>'
        + '<td>' + (seg.dominant_score * 100).toFixed(0) + '%</td>'
        + '<td class="seg-scores-cell">' + (scoresHtml || '—') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    tlEl.innerHTML = html;

    if (trEl) {
      var transcript = (result.transcript || '').trim();
      if (transcript) {
        trEl.innerHTML = '<div class="transcript-box">'
          + '<div class="transcript-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>语音转文字</div>'
          + '<div class="transcript-text">' + escHtml(transcript) + '</div>'
          + '</div>';
      } else {
        trEl.innerHTML = '<div class="transcript-box transcript-empty">'
          + '<span class="transcript-label" style="color:var(--text-muted);">语音转文字</span>'
          + '<span style="color:var(--text-muted);font-size:12px;margin-left:8px;">未识别到有效语音内容</span>'
          + '</div>';
      }
    }
  }

  function drawWaveform(canvas, data) {
    if (!data || data.length === 0) return;
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var mid = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(74,158,255,0.08)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var step = data.length / w;
    for (var i = 0; i < w; i++) {
      var idx = Math.floor(i * step);
      var val = data[idx] || 0;
      var y = mid - val * mid * 0.9;
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.stroke();
    // 中心线
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();
  }

  // ---------- 微信语音测谎（实时录音 + STT + 情绪）----------
  function pageWechatVoice() {
    var myEpoch = ++_navEpoch;
    var base = window.location.href.split('#')[0];
    render(`
      <div class="wechat-voice-page">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
          <h1 class="page-title" style="margin-bottom:0;">微信语音测谎</h1>
          <a href="${base}#/" class="btn btn-secondary" style="padding:5px 14px;font-size:12px;">返回首页</a>
        </div>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:24px;">实时录音，自动转写文字并标注情绪</p>

        <div class="wv-grid">
          <!-- 左列：录音控制 + 当前情绪 -->
          <div class="wv-left-col">
            <div class="card wv-recorder-card">
              <div class="wv-source-group" id="wv-source-group">
                <div class="wv-source-title">音源</div>
                <label class="wv-source-opt"><input type="radio" name="wv-source" value="mic" checked> 仅麦克风（自己说话）</label>
                <label class="wv-source-opt"><input type="radio" name="wv-source" value="system"> 仅系统声音（对方语音）</label>
                <label class="wv-source-opt"><input type="radio" name="wv-source" value="both"> 混合：麦克风 + 系统声音</label>

                <div class="wv-gain-row" id="wv-sys-gain-row" style="display:none;">
                  <span class="wv-gain-label">系统音频增益</span>
                  <input type="range" id="wv-sys-gain" min="1" max="20" step="0.5" value="6" class="wv-gain-slider">
                  <span class="wv-gain-val" id="wv-sys-gain-val">6.0x</span>
                </div>
                <div class="wv-gain-row" id="wv-mic-gain-row">
                  <span class="wv-gain-label">麦克风增益</span>
                  <input type="range" id="wv-mic-gain" min="0.5" max="8" step="0.5" value="1.5" class="wv-gain-slider">
                  <span class="wv-gain-val" id="wv-mic-gain-val">1.5x</span>
                </div>

                <div class="wv-source-hint" id="wv-source-hint">弹窗会询问要分享的内容，请选择微信所在的窗口/标签页，并勾选「分享音频」。如果录到的对方声音很小，请适当提高「系统音频增益」。</div>
              </div>

              <div class="wv-mic-wrap">
                <button id="wv-mic-btn" class="wv-mic-btn" aria-label="录音">
                  <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
                    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/>
                  </svg>
                </button>
                <div id="wv-mic-status" class="wv-mic-status">点击开始录音</div>
                <div id="wv-mic-timer" class="wv-mic-timer">00:00</div>
              </div>
            </div>

            <div class="card wv-emotion-card">
              <div class="wv-card-title">当前情绪</div>
              <div id="wv-dominant" class="wv-dominant">
                <span class="wv-dominant-label">等待数据…</span>
              </div>
              <div id="wv-emotion-scores" class="wv-emotion-scores">
                <p style="color:var(--text-muted);font-size:12px;margin:8px 0;">开始录音后在此处展示 9 类情绪分布</p>
              </div>
            </div>
          </div>

          <!-- 右列：实时转文字 -->
          <div class="card wv-transcript-card">
            <div class="wv-card-title">
              <span>实时语音转文字</span>
              <span id="wv-ws-status" class="wv-ws-badge wv-ws-idle">未连接</span>
            </div>
            <div id="wv-transcript-list" class="wv-transcript-list">
              <p style="color:var(--text-muted);font-size:13px;text-align:center;padding:40px 0;">开始录音后将在此处实时显示识别结果</p>
            </div>
          </div>
        </div>
      </div>
    `);

    var sessionId = null;
    var micStream = null;          // getUserMedia 麦克风流
    var displayStream = null;      // getDisplayMedia 屏幕/标签页流（含系统音频）
    var mixedStream = null;        // 合成后用于 MediaRecorder 的流
    var audioCtx = null;
    var sysGainNode = null;        // 系统音频增益节点（可运行时调整）
    var micGainNode = null;        // 麦克风增益节点（可运行时调整）
    var audioMime = '';
    var mediaRecorder = null;
    var recorderTimer = null;
    var audioQueue = [];
    var closeWs = null;
    var timerId = null;
    var timerStart = 0;
    var recording = false;

    var micBtn = document.getElementById('wv-mic-btn');
    var micStatus = document.getElementById('wv-mic-status');
    var micTimer = document.getElementById('wv-mic-timer');
    var wsBadge = document.getElementById('wv-ws-status');
    var trList = document.getElementById('wv-transcript-list');
    var scoresEl = document.getElementById('wv-emotion-scores');
    var domEl = document.getElementById('wv-dominant');

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function updateTimer() {
      var sec = Math.floor((Date.now() - timerStart) / 1000);
      micTimer.textContent = pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60);
    }
    function setWsStatus(state, text) {
      wsBadge.className = 'wv-ws-badge wv-ws-' + state;
      wsBadge.textContent = text;
    }

    function _startChunkedRecorder() {
      if (!mixedStream || !recording) return;
      try {
        var mr = new MediaRecorder(mixedStream, audioMime ? { mimeType: audioMime } : {});
        var chunks = [];
        mr.ondataavailable = function (e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
        mr.onstop = function () {
          if (chunks.length === 0) return;
          var blob = new Blob(chunks, { type: audioMime || 'audio/webm' });
          var r = new FileReader();
          r.onloadend = function () {
            var b = new Uint8Array(r.result);
            var bin = '';
            for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
            audioQueue.push(btoa(bin));
          };
          r.readAsArrayBuffer(blob);
        };
        mr.start();
        mediaRecorder = mr;
        recorderTimer = setTimeout(function () {
          if (mr.state !== 'inactive') { try { mr.stop(); } catch (e) {} }
          if (recording) _startChunkedRecorder();
        }, 4000);
      } catch (e) {
        console.error('[WV] MediaRecorder 启动失败:', e);
      }
    }

    function appendTranscript(text) {
      if (trList.firstElementChild && trList.firstElementChild.tagName === 'P') {
        trList.innerHTML = '';
      }
      var bubble = document.createElement('div');
      bubble.className = 'wv-bubble';
      var now = new Date();
      var ts = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
      bubble.innerHTML = '<div class="wv-bubble-time">' + ts + '</div>'
        + '<div class="wv-bubble-text">' + escHtml(text) + '</div>';
      trList.appendChild(bubble);
      trList.scrollTop = trList.scrollHeight;
    }

    function updateEmotions(scores) {
      if (!scores || typeof scores !== 'object') return;
      var order = ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'other', 'sad', 'surprised', 'unknown'];
      var maxEmo = 'neutral', maxVal = -1;
      order.forEach(function (k) {
        var v = Number(scores[k] || 0);
        if (v > maxVal) { maxVal = v; maxEmo = k; }
      });
      var color = EMOTION_COLORS[maxEmo] || '#4a9eff';
      var label = EMOTION_LABELS[maxEmo] || maxEmo;
      domEl.innerHTML = '<span class="wv-dominant-dot" style="background:' + color + '"></span>'
        + '<span class="wv-dominant-label" style="color:' + color + ';">' + label + '</span>'
        + '<span class="wv-dominant-pct">' + Math.round(maxVal * 100) + '%</span>';

      var html = '';
      order.forEach(function (k) {
        var v = Number(scores[k] || 0);
        var pct = Math.round(v * 100);
        var c = EMOTION_COLORS[k] || '#666';
        var lb = EMOTION_LABELS[k] || k;
        html += '<div class="wv-score-row">'
          + '<span class="wv-score-label">' + lb + '</span>'
          + '<span class="wv-score-bar-wrap"><span class="wv-score-bar" style="width:' + pct + '%;background:' + c + '"></span></span>'
          + '<span class="wv-score-pct">' + pct + '%</span>'
          + '</div>';
      });
      scoresEl.innerHTML = html;
    }

    function getSelectedSource() {
      var radios = document.querySelectorAll('input[name="wv-source"]');
      for (var i = 0; i < radios.length; i++) if (radios[i].checked) return radios[i].value;
      return 'mic';
    }

    function getSysGainValue() {
      var el = document.getElementById('wv-sys-gain');
      return el ? Math.max(0.1, parseFloat(el.value) || 1) : 6;
    }
    function getMicGainValue() {
      var el = document.getElementById('wv-mic-gain');
      return el ? Math.max(0.1, parseFloat(el.value) || 1) : 1;
    }

    async function acquireStreams(source) {
      micStream = null;
      displayStream = null;
      mixedStream = null;
      sysGainNode = null;
      micGainNode = null;

      if (source === 'mic' || source === 'both') {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      }
      if (source === 'system' || source === 'both') {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          throw new Error('当前浏览器不支持系统音频捕获，请使用 Chrome / Edge 最新版');
        }
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        var audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length === 0) {
          try { displayStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
          displayStream = null;
          throw new Error('您没有勾选「分享音频」。请重新点击并在弹窗中勾选「分享音频 / Share audio」选项。');
        }
        try {
          displayStream.getVideoTracks().forEach(function (t) { t.stop(); });
        } catch (e) {}

        displayStream.getAudioTracks()[0].addEventListener('ended', function () {
          if (recording) {
            console.warn('[WV] 系统音频流被用户停止共享，自动结束录音');
            stopRecording();
          }
        });
      }

      // 所有分支都走 AudioContext，以便统一应用 gain 放大
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var dest = audioCtx.createMediaStreamDestination();

      if (micStream) {
        var micSrc = audioCtx.createMediaStreamSource(micStream);
        micGainNode = audioCtx.createGain();
        micGainNode.gain.value = getMicGainValue();
        micSrc.connect(micGainNode).connect(dest);
      }
      if (displayStream) {
        var sysSrc = audioCtx.createMediaStreamSource(displayStream);
        sysGainNode = audioCtx.createGain();
        sysGainNode.gain.value = getSysGainValue();
        sysSrc.connect(sysGainNode).connect(dest);
      }
      mixedStream = dest.stream;
    }

    async function startRecording() {
      if (recording) return;
      var source = getSelectedSource();
      micBtn.disabled = true;
      micStatus.textContent = source === 'mic' ? '准备中…' : '请选择要分享的窗口…';
      try {
        if (!sessionId) {
          sessionId = await createSession();
          sessionStorage.setItem('cehuang_session_id', sessionId);
        }
      } catch (e) {
        alert('创建会话失败: ' + (e.message || e));
        micBtn.disabled = false;
        micStatus.textContent = '点击开始录音';
        return;
      }

      try {
        await acquireStreams(source);
      } catch (e) {
        alert('获取音频失败: ' + (e.message || e));
        micBtn.disabled = false;
        micStatus.textContent = '点击开始录音';
        return;
      }
      audioMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');

      recording = true;
      micBtn.classList.add('recording');
      micBtn.disabled = false;
      micStatus.textContent = '正在录音（点击停止）';
      timerStart = Date.now();
      timerId = setInterval(updateTimer, 500);
      setWsStatus('connecting', '连接中…');

      _startChunkedRecorder();

      closeWs = connectWS(
        sessionId,
        function () { return null; },
        function () { return audioQueue.shift() || null; },
        null,
        2000,
        function (data) {
          if (myEpoch !== _navEpoch) return;
          if (data.dimensions && data.dimensions.emotion_scores) {
            updateEmotions(data.dimensions.emotion_scores);
          }
        },
        function (err) {
          if (myEpoch !== _navEpoch) return;
          setWsStatus('fail', '连接失败');
          console.warn('[WV] ws error:', err);
        },
        function () {
          if (myEpoch !== _navEpoch) return;
          setWsStatus('idle', '已断开');
        },
        function (tr) {
          if (myEpoch !== _navEpoch) return;
          if (tr && tr.text) appendTranscript(tr.text);
        },
        function () {
          if (myEpoch !== _navEpoch) return;
          setWsStatus('ok', '已连接');
        },
        null
      );
    }

    function stopRecording() {
      if (!recording) return;
      recording = false;
      micBtn.classList.remove('recording');
      micStatus.textContent = '点击开始录音';
      if (recorderTimer) { clearTimeout(recorderTimer); recorderTimer = null; }
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (e) {}
      }
      mediaRecorder = null;
      if (micStream) {
        micStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        micStream = null;
      }
      if (displayStream) {
        displayStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        displayStream = null;
      }
      if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
      sysGainNode = null;
      micGainNode = null;
      mixedStream = null;
      if (closeWs) { try { closeWs(); } catch (e) {} closeWs = null; }
      if (timerId) { clearInterval(timerId); timerId = null; }
      setWsStatus('idle', '未连接');
    }

    micBtn.addEventListener('click', function () {
      if (recording) stopRecording();
      else startRecording();
    });

    // 音源切换 → 显示/隐藏对应的增益条
    function refreshGainRows() {
      var src = getSelectedSource();
      var sysRow = document.getElementById('wv-sys-gain-row');
      var micRow = document.getElementById('wv-mic-gain-row');
      if (sysRow) sysRow.style.display = (src === 'system' || src === 'both') ? 'flex' : 'none';
      if (micRow) micRow.style.display = (src === 'mic' || src === 'both') ? 'flex' : 'none';
    }
    document.querySelectorAll('input[name="wv-source"]').forEach(function (r) {
      r.addEventListener('change', refreshGainRows);
    });
    refreshGainRows();

    // 增益滑块：运行时直接写入 GainNode（无需重启录音）
    var sysGainEl = document.getElementById('wv-sys-gain');
    var sysGainValEl = document.getElementById('wv-sys-gain-val');
    var micGainEl = document.getElementById('wv-mic-gain');
    var micGainValEl = document.getElementById('wv-mic-gain-val');
    if (sysGainEl) sysGainEl.addEventListener('input', function () {
      var v = parseFloat(sysGainEl.value);
      if (sysGainValEl) sysGainValEl.textContent = v.toFixed(1) + 'x';
      if (sysGainNode && audioCtx) {
        try { sysGainNode.gain.setTargetAtTime(v, audioCtx.currentTime, 0.03); } catch (e) {}
      }
    });
    if (micGainEl) micGainEl.addEventListener('input', function () {
      var v = parseFloat(micGainEl.value);
      if (micGainValEl) micGainValEl.textContent = v.toFixed(1) + 'x';
      if (micGainNode && audioCtx) {
        try { micGainNode.gain.setTargetAtTime(v, audioCtx.currentTime, 0.03); } catch (e) {}
      }
    });

    window.addEventListener('hashchange', function _cleanup() {
      if (myEpoch !== _navEpoch) {
        stopRecording();
        window.removeEventListener('hashchange', _cleanup);
      }
    });
  }

  // ---------- 设备检测页 ----------
  function pageDevice() {
    const myEpoch = ++_navEpoch;  // 捕获本次导航 epoch
    var videoDevices = [];
    var audioDevices = [];
    var videoId = '';
    var audioId = '';
    var stream = null;
    var videoOk = false;
    var audioOk = false;
    var camStatus = {};     // deviceId -> 'testing'|'ok'|'black'|'error'
    var previewDrawId = null;

    // 测试摄像头是否真正出帧（非黑帧）
    function testCameraFrames(deviceId) {
      return new Promise(function (resolve) {
        var constraints = {
          video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } } : { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        };
        navigator.mediaDevices.getUserMedia(constraints).then(function (s) {
          var track = s.getVideoTracks()[0];
          if (!track) { s.getTracks().forEach(function (t) { t.stop(); }); resolve('error'); return; }
          if (typeof ImageCapture === 'undefined') { s.getTracks().forEach(function (t) { t.stop(); }); resolve('ok'); return; }
          var ic;
          try { ic = new ImageCapture(track); } catch (e) { s.getTracks().forEach(function (t) { t.stop(); }); resolve('ok'); return; }
          var tries = 0;
          function grab() {
            tries++;
            ic.grabFrame().then(function (bmp) {
              var w = Math.min(bmp.width, 32), h = Math.min(bmp.height, 32);
              var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
              var cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, w, h);
              bmp.close();
              var d = cx.getImageData(0, 0, w, h).data;
              var sum = 0;
              for (var i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
              s.getTracks().forEach(function (t) { t.stop(); });
              resolve(sum < 30 ? 'black' : 'ok');
            }).catch(function () {
              if (tries < 4) { setTimeout(grab, 300); } else { s.getTracks().forEach(function (t) { t.stop(); }); resolve('error'); }
            });
          }
          setTimeout(grab, 300);
        }).catch(function () { resolve('error'); });
      });
    }

    // 逐个测试所有摄像头，找到可用的自动选中
    function autoSelectBestCamera(devices) {
      var idx = 0;
      function next() {
        if (_navEpoch !== myEpoch) return; // 用户已切页，停止测试
        if (idx >= devices.length) { renderDevice(); return; }
        var d = devices[idx++];
        camStatus[d.deviceId] = 'testing';
        renderDevice();
        testCameraFrames(d.deviceId).then(function (result) {
          if (_navEpoch !== myEpoch) return;
          camStatus[d.deviceId] = result;
          if (result === 'ok' && !videoOk) {
            videoId = d.deviceId;
            videoOk = true;
            renderDevice();
            startPreviewFor(d.deviceId);
          }
          next();
        });
      }
      next();
    }

    // 用指定 deviceId 启动预览（含 canvas 回退）
    function startPreviewFor(devId) {
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
      if (previewDrawId) { clearInterval(previewDrawId); previewDrawId = null; }
      var constraints = {
        video: devId ? { deviceId: { exact: devId }, width: { ideal: 640 }, height: { ideal: 480 } } : { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: audioId ? { deviceId: { exact: audioId } } : true,
      };
      navigator.mediaDevices.getUserMedia(constraints).then(function (s) {
        if (_navEpoch !== myEpoch) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s;
        var track = s.getVideoTracks()[0];
        videoOk = !!track;
        audioOk = s.getAudioTracks().length > 0;
        renderDevice();
        // 先用 <video>
        var v = document.getElementById('preview-video');
        if (!v) return;
        v.muted = true; v.playsInline = true;
        v.srcObject = s;
        v.play().catch(function () {});
        // 1.2s 后若黑帧则用 canvas 回退
        setTimeout(function () {
          if (_navEpoch !== myEpoch) return;
          if (v.videoWidth > 0 && v.readyState >= 2) return;
          if (typeof ImageCapture === 'undefined' || !track) return;
          var ic; try { ic = new ImageCapture(track); } catch (e) { return; }
          var cv = document.getElementById('preview-canvas');
          if (!cv) return;
          cv.style.display = 'block';
          v.style.display = 'none';
          var dctx = cv.getContext('2d');
          previewDrawId = setInterval(function () {
            if (_navEpoch !== myEpoch) { clearInterval(previewDrawId); return; }
            ic.grabFrame().then(function (bmp) {
              cv.width = bmp.width; cv.height = bmp.height;
              dctx.drawImage(bmp, 0, 0); bmp.close();
            }).catch(function () {});
          }, 80);
        }, 1200);
      }).catch(function (e) {
        if (_navEpoch !== myEpoch) return;
        videoOk = false; audioOk = false;
        renderDevice();
      });
    }

    function renderDevice() {
      if (_navEpoch !== myEpoch) return; // 已导航到其他页，放弃渲染
      var canStart = videoOk && audioOk;
      function statusLabel(id) {
        var s = camStatus[id];
        if (!s) return '';
        if (s === 'testing') return ' <span style="color:var(--warning);font-size:11px;">⏳ 检测中…</span>';
        if (s === 'ok') return ' <span style="color:var(--success);font-size:11px;">✓ 可用</span>';
        if (s === 'black') return ' <span style="color:var(--danger);font-size:11px;">✗ 无画面</span>';
        return ' <span style="color:var(--text-muted);font-size:11px;">? 未知</span>';
      }
      render(`
        <h1 class="page-title">设备检测</h1>
        <div id="backend-warn" class="card" style="margin-bottom:16px;display:none;border-color:var(--warning);background:rgba(243,156,18,0.1);"></div>
        <div class="device-grid">
          <div class="card">
            <h2>摄像头</h2>
            <div class="select-row">
              <label>选择设备</label>
              <select id="video-select">${videoDevices.length ? videoDevices.map(function (d) { return '<option value="' + d.deviceId + '"' + (d.deviceId === videoId ? ' selected' : '') + '>' + (d.label || '摄像头 ' + d.deviceId.slice(0, 8)) + (camStatus[d.deviceId] === 'black' ? ' [无画面]' : camStatus[d.deviceId] === 'ok' ? ' [可用]' : '') + '</option>'; }).join('') : '<option value="">请先允许摄像头权限并刷新</option>'}</select>
              ${videoDevices.map(function (d) { return statusLabel(d.deviceId); }).join('')}
            </div>
            <div class="preview-box" style="position:relative;">
              ${videoOk ? '<video id="preview-video" autoplay playsinline muted style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;"></video><canvas id="preview-canvas" style="display:none;position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;"></canvas>' : '<div class="placeholder">' + (videoDevices.length === 0 ? '请允许摄像头权限后刷新' : Object.keys(camStatus).length === 0 ? '自动检测中…' : '摄像头检测完毕，请在下拉框选择「可用」的设备') + '</div>'}
            </div>
            <p id="cam-status-text" class="${videoOk ? 'status-ok' : 'status-fail'}">${videoOk ? '✓ 摄像头就绪' : (videoDevices.length === 0 ? '未检测到摄像头，请允许权限后刷新' : '正在自动检测摄像头…')}</p>
          </div>
          <div class="card">
            <h2>麦克风</h2>
            <div class="select-row">
              <label>选择设备</label>
              <select id="audio-select">${audioDevices.length ? audioDevices.map(function (d) { return '<option value="' + d.deviceId + '"' + (d.deviceId === audioId ? ' selected' : '') + '>' + (d.label || '麦克风 ' + d.deviceId.slice(0, 8)) + '</option>'; }).join('') : '<option value="">请先允许麦克风权限并刷新</option>'}</select>
            </div>
            <p class="${audioOk ? 'status-ok' : 'status-fail'}">${audioOk ? '✓ 麦克风就绪' : (audioDevices.length === 0 ? '未检测到麦克风，请允许权限后刷新' : '✗ 麦克风未就绪')}</p>
          </div>
        </div>
        <div class="card">
          <button class="btn btn-primary" id="btn-start" ${canStart ? '' : 'disabled'}>开始测谎</button>
        </div>
      `);
      document.getElementById('video-select')?.addEventListener('change', function (e) {
        videoId = e.target.value; videoOk = false;
        startPreviewFor(videoId);
      });
      document.getElementById('audio-select')?.addEventListener('change', function (e) { audioId = e.target.value; });
      document.getElementById('btn-start')?.addEventListener('click', function () {
        if (!canStart) return;
        fetch(getRestUrl('/health')).catch(function () { return null; }).then(function (r) {
          if (!r || !r.ok) {
            alert('无法连接后端。请先在本机终端执行：\n\ncd /home/user/下载/cehuang/cehuangxitong\nbash scripts/run_backend.sh\n\n并保持终端打开，再刷新本页重试。');
            return;
          }
          // ── 显示"创建任务"弹窗 ──────────────────────────────────────────
          showCreateTaskModal(stream, videoId, audioId);
        });
      });
      fetch(getRestUrl('/health')).then(function (r) { if (r.ok) return; throw new Error(); }).catch(function () {
        var w = document.getElementById('backend-warn');
        if (w) { w.style.display = 'block'; w.innerHTML = '后端未连接。请先在终端执行：<code style="display:block;margin:8px 0">cd /home/user/下载/cehuang/cehuangxitong && bash scripts/run_backend.sh</code> 并保持终端打开，然后刷新本页。'; }
      });
    }

    // 启动：先请求权限取得设备名称，然后自动测试所有摄像头
    renderDevice();
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(function (s) {
      s.getTracks().forEach(function (t) { t.stop(); });
      if (_navEpoch !== myEpoch) return;
      navigator.mediaDevices.enumerateDevices().then(function (devices) {
        if (_navEpoch !== myEpoch) return;
        videoDevices = devices.filter(function (d) { return d.kind === 'videoinput'; });
        audioDevices = devices.filter(function (d) { return d.kind === 'audioinput'; });
        if (audioDevices.length) audioId = audioDevices[0].deviceId;
        audioOk = audioDevices.length > 0;
        renderDevice();
        autoSelectBestCamera(videoDevices);
      });
    }).catch(function () {
      navigator.mediaDevices.enumerateDevices().then(function (devices) {
        videoDevices = devices.filter(function (d) { return d.kind === 'videoinput'; });
        audioDevices = devices.filter(function (d) { return d.kind === 'audioinput'; });
        renderDevice();
      }).catch(function () { renderDevice(); });
    });
  }

  // ---------- 创建任务弹窗 ----------
  function showCreateTaskModal(pendingStream, videoId, audioId) {
    // 显示全屏弹窗蒙层
    var overlay = document.createElement('div');
    overlay.id = 'create-task-overlay';
    overlay.innerHTML = `
      <div class="create-task-modal">
        <h2 class="modal-title">创建测谎任务</h2>
        <div class="modal-field">
          <label class="modal-label">任务名称 <span style="color:var(--danger)">*</span></label>
          <input type="text" id="task-name-input" class="modal-input" placeholder="例：2026-02-22 张三审讯" maxlength="80" />
        </div>
        <div class="modal-field">
          <label class="modal-label">审讯提纲（可选）</label>
          <div class="file-upload-area" id="file-drop-area">
            <input type="file" id="outline-file-input" accept=".txt,.pdf,.docx,.doc" style="display:none" />
            <div class="file-upload-hint" id="file-upload-hint">
              点击选择或拖入文件<br><span style="font-size:11px;opacity:.6">支持 .txt / .pdf / .docx，最大 20MB</span>
            </div>
          </div>
        </div>
        <div id="modal-error" style="color:var(--danger);font-size:13px;min-height:20px;"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">取消</button>
          <button class="btn btn-primary" id="modal-confirm">创建并开始</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    var fileInput = overlay.querySelector('#outline-file-input');
    var dropArea = overlay.querySelector('#file-drop-area');
    var fileHint = overlay.querySelector('#file-upload-hint');
    var selectedFile = null;

    // 点击上传区 → 打开文件选择
    dropArea.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      if (fileInput.files[0]) {
        selectedFile = fileInput.files[0];
        fileHint.innerHTML = '📄 ' + selectedFile.name + '<br><span style="font-size:11px;opacity:.6">点击更换</span>';
        dropArea.style.borderColor = 'var(--primary)';
      }
    });
    // 拖拽
    dropArea.addEventListener('dragover', function (e) { e.preventDefault(); dropArea.style.borderColor = 'var(--primary)'; });
    dropArea.addEventListener('dragleave', function () { dropArea.style.borderColor = ''; });
    dropArea.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer.files[0];
      if (f) { selectedFile = f; fileHint.innerHTML = '📄 ' + f.name + '<br><span style="font-size:11px;opacity:.6">点击更换</span>'; dropArea.style.borderColor = 'var(--primary)'; }
    });

    // 取消
    overlay.querySelector('#modal-cancel').addEventListener('click', function () {
      document.body.removeChild(overlay);
    });

    // 确认创建
    overlay.querySelector('#modal-confirm').addEventListener('click', async function () {
      var name = (overlay.querySelector('#task-name-input').value || '').trim();
      var errEl = overlay.querySelector('#modal-error');
      if (!name) { errEl.textContent = '请填写任务名称'; return; }
      errEl.textContent = '';
      var confirmBtn = overlay.querySelector('#modal-confirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = '创建中…';

      try {
        // 1. 获取或复用媒体流
        var s = pendingStream;
        if (!s) {
          var constraints = {
            video: videoId ? { deviceId: { exact: videoId }, width: { ideal: 640 }, height: { ideal: 480 } } : { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: audioId ? { deviceId: { exact: audioId } } : true,
          };
          s = await navigator.mediaDevices.getUserMedia(constraints);
        }
        window.__cehuang_pending_stream = s;

        // 2. 创建会话（带名称）
        var sessionId = await createSessionWithName(name);

        // 3. 上传提纲（若有）
        if (selectedFile) {
          confirmBtn.textContent = '上传提纲…';
          try { await uploadOutline(sessionId, selectedFile); } catch (e) { console.warn('提纲上传失败:', e); }
        }

        // 4. 保存并跳转
        sessionStorage.setItem('cehuang_session_id', sessionId);
        sessionStorage.setItem('cehuang_video_id', videoId);
        sessionStorage.setItem('cehuang_audio_id', audioId);
        document.body.removeChild(overlay);
        window.location.hash = '#/session';
      } catch (e) {
        errEl.textContent = '创建失败: ' + (e.message || e);
        confirmBtn.disabled = false;
        confirmBtn.textContent = '创建并开始';
      }
    });

    // 自动聚焦名称框
    setTimeout(function () { overlay.querySelector('#task-name-input').focus(); }, 50);
  }

  /** 视频测谎：仅创建会话（不取摄像头），完成后进入 #/session-video */
  function showCreateTaskModalForVideo() {
    var overlay = document.createElement('div');
    overlay.id = 'create-task-overlay';
    overlay.innerHTML = `
      <div class="create-task-modal">
        <h2 class="modal-title">创建视频测谎任务</h2>
        <div class="modal-field">
          <label class="modal-label">任务名称 <span style="color:var(--danger)">*</span></label>
          <input type="text" id="task-name-input" class="modal-input" placeholder="例：录像回溯分析" maxlength="80" />
        </div>
        <div class="modal-field">
          <label class="modal-label">审讯提纲（可选）</label>
          <div class="file-upload-area" id="file-drop-area">
            <input type="file" id="outline-file-input" accept=".txt,.pdf,.docx,.doc" style="display:none" />
            <div class="file-upload-hint" id="file-upload-hint">
              点击选择或拖入文件<br><span style="font-size:11px;opacity:.6">支持 .txt / .pdf / .docx</span>
            </div>
          </div>
        </div>
        <div id="modal-error" style="color:var(--danger);font-size:13px;min-height:20px;"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">取消</button>
          <button class="btn btn-primary" id="modal-confirm">创建并进入</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    var fileInput = overlay.querySelector('#outline-file-input');
    var dropArea = overlay.querySelector('#file-drop-area');
    var fileHint = overlay.querySelector('#file-upload-hint');
    var selectedFile = null;
    dropArea.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      if (fileInput.files[0]) {
        selectedFile = fileInput.files[0];
        fileHint.innerHTML = '📄 ' + selectedFile.name + '<br><span style="font-size:11px;opacity:.6">点击更换</span>';
        dropArea.style.borderColor = 'var(--primary)';
      }
    });
    dropArea.addEventListener('dragover', function (e) { e.preventDefault(); dropArea.style.borderColor = 'var(--primary)'; });
    dropArea.addEventListener('dragleave', function () { dropArea.style.borderColor = ''; });
    dropArea.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer.files[0];
      if (f) { selectedFile = f; fileHint.innerHTML = '📄 ' + f.name + '<br><span style="font-size:11px;opacity:.6">点击更换</span>'; dropArea.style.borderColor = 'var(--primary)'; }
    });
    overlay.querySelector('#modal-cancel').addEventListener('click', function () {
      document.body.removeChild(overlay);
      window.location.hash = '#/';
    });
    overlay.querySelector('#modal-confirm').addEventListener('click', async function () {
      var name = (overlay.querySelector('#task-name-input').value || '').trim();
      var errEl = overlay.querySelector('#modal-error');
      if (!name) { errEl.textContent = '请填写任务名称'; return; }
      errEl.textContent = '';
      var confirmBtn = overlay.querySelector('#modal-confirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = '创建中…';
      try {
        var sessionId = await createSessionWithName(name);
        if (selectedFile) {
          confirmBtn.textContent = '上传提纲…';
          try { await uploadOutline(sessionId, selectedFile); } catch (e) { console.warn('提纲上传失败:', e); }
        }
        sessionStorage.setItem('cehuang_session_id', sessionId);
        sessionStorage.removeItem('cehuang_video_id');
        sessionStorage.removeItem('cehuang_audio_id');
        document.body.removeChild(overlay);
        window.location.hash = '#/session-video';
      } catch (e) {
        errEl.textContent = '创建失败: ' + (e.message || e);
        confirmBtn.disabled = false;
        confirmBtn.textContent = '创建并进入';
      }
    });
    setTimeout(function () { overlay.querySelector('#task-name-input').focus(); }, 50);
  }

  function pageSessionVideoSetup() {
    render('<div class="session-video-setup-page"><p class="card" style="padding:16px;color:var(--text-muted)">请填写任务信息…</p></div>');
    showCreateTaskModalForVideo();
  }

  // ---------- 会话页 ----------
  function pageSession(sessionOpts) {
    sessionOpts = sessionOpts || {};
    var isVideoFile = sessionOpts.isVideoFile === true;

    const sessionId = sessionStorage.getItem('cehuang_session_id');
    const videoId = sessionStorage.getItem('cehuang_video_id') || '';
    const audioId = sessionStorage.getItem('cehuang_audio_id') || '';
    if (!sessionId) {
      window.location.hash = '#/';
      return;
    }

    let stream = null;
    let videoEl = null;
    let fallbackVideoEl = null;
    let canvas = null;
    let ctx = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let lastFrameB64 = null;
    let audioQueue = [];
    // rPPG 绿色通道缓冲（10fps 采样，随 WS 消息携带后清空）
    let greenBuffer = [];
    // 全程视频录制（结束时上传）
    let _fullRecorder = null;
    let _fullChunks = [];
    // 转录条目缓存（{speaker, text, ts}）
    let _transcriptEntries = [];
    let result = { lie_probability: 0, dimensions: { expression: 0, heart_rate: 0, tone: 0, semantic: 0 }, semantic_summary: '' };
    let closeWS = null;
    let videoBlobUrl = null;
    let pipelineStarted = false;

    // ── 维度标签辅助函数 ────────────────────────────────────────────────────
    function exprLabel(s) {
      if (s < 0.15) return { text: '平静自然', color: 'var(--success)' };
      if (s < 0.35) return { text: '轻微异常', color: '#7ecf8e' };
      if (s < 0.55) return { text: '有些异常', color: 'var(--warning)' };
      if (s < 0.75) return { text: '明显异常', color: '#e07b39' };
      return { text: '高度异常', color: 'var(--danger)' };
    }
    function toneLabel(s) {
      if (s < 0.15) return { text: '语气平稳', color: 'var(--success)' };
      if (s < 0.35) return { text: '略有紧张', color: '#7ecf8e' };
      if (s < 0.55) return { text: '有些紧张', color: 'var(--warning)' };
      if (s < 0.75) return { text: '明显紧张', color: '#e07b39' };
      return { text: '高度紧张', color: 'var(--danger)' };
    }
    function semanticLabel(s) {
      if (s < 0.15) return { text: '陈述一致', color: 'var(--success)' };
      if (s < 0.35) return { text: '轻微矛盾', color: '#7ecf8e' };
      if (s < 0.55) return { text: '存在矛盾', color: 'var(--warning)' };
      if (s < 0.75) return { text: '明显矛盾', color: '#e07b39' };
      return { text: '严重矛盾', color: 'var(--danger)' };
    }
    function bpmDisplay(bpm) {
      if (!bpm) return { text: '采集中…', color: 'var(--text-muted)' };
      var color = bpm < 60 ? 'var(--primary)' : bpm < 100 ? 'var(--success)' : bpm < 120 ? 'var(--warning)' : 'var(--danger)';
      return { text: bpm + ' bpm', color: color };
    }

    // 说话人颜色表（按首次出现顺序循环）
    const SPEAKER_COLORS = ['#4a9eff', '#2ecc71', '#f39c12', '#e91e63', '#9b59b6', '#1abc9c'];
    const speakerColorMap = {};
    let speakerColorIdx = 0;
    function getSpeakerColor(speaker) {
      if (!speaker) return '#aaa';
      if (!speakerColorMap[speaker]) {
        speakerColorMap[speaker] = SPEAKER_COLORS[speakerColorIdx % SPEAKER_COLORS.length];
        speakerColorIdx++;
      }
      return speakerColorMap[speaker];
    }
    function appendTranscript(speaker, text) {
      var body = document.getElementById('transcript-body');
      if (!body) return;
      var placeholder = body.querySelector('.transcript-placeholder');
      if (placeholder) placeholder.remove();

      var now = new Date();
      var tsStr = now.getHours().toString().padStart(2,'0') + ':'
        + now.getMinutes().toString().padStart(2,'0') + ':'
        + now.getSeconds().toString().padStart(2,'0');
      var color = getSpeakerColor(speaker);

      // 同一说话人 8 秒内续接到同一行（避免同一句话被 2s 窗口切成多条）
      var MERGE_MS = 8000;
      var lastEntry = body.lastElementChild;
      if (lastEntry && lastEntry.dataset.speaker === speaker
          && (Date.now() - parseInt(lastEntry.dataset.tsMs || '0', 10)) < MERGE_MS) {
        var textEl = lastEntry.querySelector('.transcript-text');
        if (textEl) {
          textEl.textContent += text;
          lastEntry.dataset.tsMs = Date.now();
          body.scrollTop = body.scrollHeight;
          // 同步更新内存缓存：追加到最后一条记录的 text
          if (_transcriptEntries.length > 0) {
            _transcriptEntries[_transcriptEntries.length - 1].text += text;
          }
          return;
        }
      }

      // 创建新条目
      var entry = document.createElement('div');
      entry.className = 'transcript-entry';
      entry.dataset.speaker = speaker || '';
      entry.dataset.tsMs = Date.now();
      entry.innerHTML = '<span class="transcript-speaker" style="color:' + color + '">'
        + (speaker || '未知') + '</span>'
        + '<span class="transcript-time">' + tsStr + '</span>'
        + '<span class="transcript-text">' + text + '</span>';
      body.appendChild(entry);
      body.scrollTop = body.scrollHeight;

      // 新条目缓存到内存
      _transcriptEntries.push({
        speaker: speaker || '未知',
        text: text,
        ts: new Date().toISOString(),
      });
    }

    function renderSession() {
      const base = window.location.href.split('#')[0];
      const d = result.dimensions || {};
      const p = (result.lie_probability ?? 0) * 100;
      const level = p < 35 ? 'low' : p < 65 ? 'mid' : 'high';
      const videoCol = isVideoFile ? `
            <div class="card session-video-card">
              <div id="video-upload-panel" class="video-upload-panel">
                <input type="file" id="session-video-file" accept="video/*" style="display:none" />
                <div class="video-upload-drop" id="video-upload-drop">
                  <span class="video-upload-icon">📤</span>
                  <span>点击或拖入上传视频</span>
                  <span style="font-size:11px;opacity:.65">支持常见格式，上传后将在此处播放</span>
                </div>
              </div>
              <div class="video-wrapper" id="file-video-wrapper" style="display:none;position:relative;min-height:220px;">
                <span class="live-badge" style="background:#6c5ce7;">视频</span>
                <video id="session-video" playsinline controls style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;background:#000;"></video>
                <canvas id="session-canvas" style="display:none;position:absolute;left:0;top:0;width:100%;height:100%;"></canvas>
                <div id="cam-debug" style="position:absolute;bottom:4px;left:4px;right:4px;font-size:10px;color:#aaa;background:rgba(0,0,0,.5);padding:2px 4px;border-radius:2px;z-index:3;display:none;"></div>
              </div>
              <p class="session-cam-prompt" id="cam-prompt" style="margin:0;padding:10px 12px;">
                <button type="button" class="btn btn-primary" id="btn-start-file-analysis" disabled>开始分析（先上传视频）</button>
              </p>
            </div>` : `
            <div class="card session-video-card">
              <div class="video-wrapper">
                <span class="live-badge">LIVE</span>
                <video id="session-video" autoplay playsinline muted style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;"></video>
                <canvas id="session-canvas" style="display:none;position:absolute;left:0;top:0;width:100%;height:100%;"></canvas>
                <div id="cam-debug" style="position:absolute;bottom:4px;left:4px;right:4px;font-size:10px;color:#aaa;background:rgba(0,0,0,.5);padding:2px 4px;border-radius:2px;z-index:3;display:none;"></div>
              </div>
              <p class="session-cam-prompt" id="cam-prompt">若无画面请点击 <button type="button" class="btn btn-primary" id="session-enable-cam">启用摄像头</button></p>
            </div>`;
      root.innerHTML = nav() + `
        <div id="page">
          <h1 class="page-title" id="session-title">${isVideoFile ? '视频测谎' : '测谎会话'} <span style="color:var(--text-muted);font-size:14px;">${sessionId.slice(0,8)}</span></h1>
          <div id="ws-status" class="card" style="margin-bottom:12px;padding:8px 12px;font-size:13px;"></div>
          <div id="outline-panel" class="card outline-panel" style="display:none;margin-bottom:12px;">
            <div class="outline-header" id="outline-toggle">
              <span class="outline-title">📋 审讯提纲</span>
              <span class="outline-filename" id="outline-filename"></span>
              <span class="outline-chevron">▲</span>
            </div>
            <div class="outline-body" id="outline-body"></div>
          </div>
          <div class="session-layout">
            ${videoCol}
            <div class="dashboard">
              <div class="gauge-wrap">
                <div class="gauge-value" id="gauge-value">${p.toFixed(0)}%</div>
                <div class="gauge-bar"><div class="gauge-fill ${level}" id="gauge-fill" style="width:${p}%"></div></div>
                <div class="metric label" style="margin-top:4px">综合说谎概率</div>
              </div>
              <div class="metric" id="m-expr">
                <span class="label">表情</span>
                <div class="value dim-label" style="color:${exprLabel(d.expression||0).color}">${exprLabel(d.expression||0).text}</div>
              </div>
              <div class="metric" id="m-hr">
                <span class="label">心率</span>
                <div class="value dim-label" style="color:${bpmDisplay(result.bpm).color}">${bpmDisplay(result.bpm).text}</div>
              </div>
              <div class="metric" id="m-tone">
                <span class="label">情绪（9类）</span>
                <div id="emotion-scores-list" class="emotion-scores-list" style="display:block;">${renderEmotionScores(d.emotion_scores || {})}</div>
              </div>
              <div class="metric" id="m-semantic">
                <span class="label">语义逻辑</span>
                <button type="button" class="btn btn-secondary" id="btn-semantic-analyze" style="margin-top:6px;width:100%;font-size:12px;">🔍 分析全文逻辑</button>
              </div>
              <button class="btn btn-danger" id="btn-end">结束会话</button>
            </div>
          </div>
          <div class="card transcript-panel" id="transcript-panel">
            <div class="transcript-header">
              <span class="transcript-title">语音转文字</span>
              <span class="transcript-hint">实时识别 · 多人区分</span>
              <button type="button" class="btn btn-secondary" id="transcript-clear" style="padding:3px 10px;font-size:12px;">清空</button>
            </div>
            <div class="transcript-body" id="transcript-body">
              <div class="transcript-placeholder">等待说话…</div>
            </div>
          </div>
          <div class="card semantic-result-panel" id="semantic-result-panel" style="display:none;">
            <div class="semantic-result-header">
              <span class="semantic-result-title">语义逻辑分析结果</span>
              <span class="semantic-verdict" id="semantic-verdict"></span>
            </div>
            <div class="semantic-issues" id="semantic-issues"></div>
            <div class="semantic-full-text" id="semantic-full-text"></div>
          </div>
        </div>
      `;
      videoEl = document.getElementById('session-video');
      document.getElementById('btn-end').onclick = doEnd;
      var enableCamBtn = document.getElementById('session-enable-cam');
      if (enableCamBtn) enableCamBtn.onclick = tryStartStream;
      var clearBtn = document.getElementById('transcript-clear');
      if (clearBtn) clearBtn.onclick = function() {
        var body = document.getElementById('transcript-body');
        if (body) { body.innerHTML = '<div class="transcript-placeholder">等待说话…</div>'; }
      };

      // 语义全文分析按钮
      var btnSemantic = document.getElementById('btn-semantic-analyze');
      if (btnSemantic) {
        btnSemantic.onclick = async function() {
          // 收集所有转录文本
          var tbody = document.getElementById('transcript-body');
          var entries = tbody ? tbody.querySelectorAll('.transcript-entry') : [];
          if (!entries.length) {
            alert('暂无转录内容，请先进行语音输入。');
            return;
          }
          var lines = [];
          entries.forEach(function(e) {
            var sp = e.querySelector('.transcript-speaker');
            var tx = e.querySelector('.transcript-text');
            if (sp && tx) lines.push((sp.textContent || '').trim() + '：' + (tx.textContent || '').trim());
          });
          var fullText = lines.join('\n');

          btnSemantic.disabled = true;
          btnSemantic.textContent = '⏳ 模型加载中…';
          var panel = document.getElementById('semantic-result-panel');
          var verdictEl = document.getElementById('semantic-verdict');
          var issuesEl = document.getElementById('semantic-issues');
          var fullTextEl = document.getElementById('semantic-full-text');
          var verdictColor = { '可信': '#27ae60', '存疑': '#e67e22', '高度可疑': '#e74c3c', '无法判断': '#888', '无数据': '#888' };
          var thinkText = '';
          var streamedText = '';

          if (panel) panel.style.display = 'block';
          if (verdictEl) { verdictEl.textContent = ''; verdictEl.style.color = ''; }
          if (issuesEl) issuesEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">⏳ 模型加载中，请稍候…</p>';
          if (fullTextEl) fullTextEl.innerHTML = '';
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

          try {
            await semanticAnalyzeStream(fullText, {
              onLoading: function () {
                if (issuesEl) issuesEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">⏳ 连接成功，正在加载模型到 GPU（约20秒）…</p>';
              },
              onThinkingStart: function () {
                btnSemantic.textContent = '🧠 模型思考中…';
              },
              onThinkingToken: function (text) {
                thinkText += text;
                if (issuesEl) {
                  issuesEl.innerHTML = '<details class="thinking-block" open><summary class="thinking-summary">🧠 思考过程</summary>'
                    + '<div class="thinking-content">' + escHtml(thinkText).replace(/\n/g, '<br>') + '<span class="streaming-cursor">|</span></div></details>';
                  var tc = issuesEl.querySelector('.thinking-content');
                  if (tc) tc.scrollTop = tc.scrollHeight;
                }
              },
              onThinkingEnd: function () {
                btnSemantic.textContent = '✍️ 正在输出…';
                if (issuesEl) {
                  var det = issuesEl.querySelector('.thinking-block');
                  if (det) det.removeAttribute('open');
                }
              },
              onToken: function (text) {
                streamedText += text;
                var thinkHtml = '';
                if (thinkText) {
                  thinkHtml = '<details class="thinking-block"><summary class="thinking-summary">🧠 思考过程</summary>'
                    + '<div class="thinking-content">' + escHtml(thinkText).replace(/\n/g, '<br>') + '</div></details>';
                }
                if (issuesEl) {
                  issuesEl.innerHTML = thinkHtml
                    + '<div class="logic-analysis-content" style="line-height:1.8;font-size:13px;">'
                    + renderStreamHtml(streamedText) + '<span class="streaming-cursor">|</span></div>';
                }
              },
              onDone: function (verdict) {
                var thinkHtml = '';
                if (thinkText) {
                  thinkHtml = '<details class="thinking-block"><summary class="thinking-summary">🧠 思考过程</summary>'
                    + '<div class="thinking-content">' + escHtml(thinkText).replace(/\n/g, '<br>') + '</div></details>';
                }
                if (issuesEl && streamedText) {
                  issuesEl.innerHTML = thinkHtml
                    + '<div class="logic-analysis-content" style="line-height:1.8;font-size:13px;">'
                    + renderStreamHtml(streamedText) + '</div>';
                } else if (issuesEl) {
                  issuesEl.innerHTML = thinkHtml + '<p class="semantic-no-issues">未发现明显逻辑问题。</p>';
                }
                if (verdictEl) {
                  verdictEl.textContent = verdict || '未知';
                  verdictEl.style.color = verdictColor[verdict] || '#666';
                }
                btnSemantic.disabled = false;
                btnSemantic.textContent = '🔍 分析全文逻辑';
              },
              onError: function (err) {
                alert('语义分析失败: ' + (err.message || err));
                btnSemantic.disabled = false;
                btnSemantic.textContent = '🔍 分析全文逻辑';
              },
            });
          } catch (err) {
            alert('语义分析失败: ' + (err.message || err));
            btnSemantic.disabled = false;
            btnSemantic.textContent = '🔍 分析全文逻辑';
          }
        };
      }

      function showWsStatus(connected, msg) {
        var el = document.getElementById('ws-status');
        if (!el) return;
        el.style.display = 'block';
        el.style.background = connected ? 'var(--bg-secondary)' : 'rgba(243,156,18,0.15)';
        el.style.borderColor = connected ? 'var(--border)' : 'var(--warning)';
        el.innerHTML = connected ? '实时连接：已连接' : ((msg || '实时连接：未连接') + ' <button type="button" class="btn btn-secondary" style="margin-left:8px;padding:4px 10px" id="ws-retry">重试</button>');
        var retryBtn = document.getElementById('ws-retry');
        if (retryBtn && !connected) retryBtn.onclick = function () { if (closeWS) closeWS(); showWsStatus(false, '正在连接…'); startWS(); };
      }

      var drawLoopId = null;
      function resetCamButton() {
        var btn = document.getElementById('session-enable-cam');
        if (btn) { btn.textContent = '启用摄像头'; btn.disabled = false; }
      }
      function setDebug(msg) {
        var el = document.getElementById('cam-debug');
        if (!el) return;
        el.style.display = 'block';
        el.textContent = msg;
      }
      function startWithStream(s, streamOpts) {
        streamOpts = streamOpts || {};
        var isFileVideo = streamOpts.isFileVideo === true;
        if (closeWS) { closeWS(); closeWS = null; }
        if (drawLoopId) { cancelAnimationFrame(drawLoopId); drawLoopId = null; }
        stream = s;
        fallbackVideoEl = null;
        var v = document.getElementById('session-video');
        if (!v) { resetCamButton(); return; }
        videoEl = v;

        var tracks = s.getVideoTracks();
        var track = tracks[0];
        var settings = track ? track.getSettings() : {};
        setDebug('tracks:' + tracks.length + ' enabled:' + (track ? track.enabled : 'n/a') + ' muted:' + (track ? track.muted : 'n/a') + ' ' + (settings.width || '?') + 'x' + (settings.height || '?'));

        if (isFileVideo) {
          v.playsInline = true;
          v.setAttribute('playsinline', '');
          v.muted = false;
          v.removeAttribute('srcObject');
          setDebug('本地视频 + captureStream 模式');
          resetCamButton();
          setTimeout(function () { setDebug(''); }, 2000);
        } else {
          v.muted = true;
          v.playsInline = true;
          v.setAttribute('autoplay', '');
          v.setAttribute('playsinline', '');
          v.srcObject = s;

          function tryPlay() {
            var p = v.play();
            if (p && p.catch) p.catch(function (e) { setDebug('play err:' + (e && e.message)); });
          }

          v.addEventListener('loadedmetadata', function () {
            setDebug('loadedmetadata ' + v.videoWidth + 'x' + v.videoHeight);
            tryPlay();
          }, { once: true });
          v.addEventListener('playing', function () {
            setDebug('playing OK ' + v.videoWidth + 'x' + v.videoHeight);
            resetCamButton();
            setTimeout(function () { setDebug(''); }, 3000);
          }, { once: true });
          v.addEventListener('error', function () {
            setDebug('video element error ' + (v.error ? v.error.code : ''));
            resetCamButton();
          }, { once: true });

          tryPlay();
          setTimeout(resetCamButton, 800);

          setTimeout(function () {
            if (v.videoWidth > 0 && v.readyState >= 2) {
              setDebug('');
              return;
            }
            setDebug('video 无帧，切换 ImageCapture 模式…');
            tryImageCapture(s, v);
          }, 1500);
        }

        canvas = document.createElement('canvas');
        ctx = canvas.getContext('2d');
        // 每 2s 新建一个独立的 MediaRecorder，保证每个 blob 都是完整 WebM（含 EBML 头）
        var _audioStream = null;
        var _audioMime = '';
        try {
          const audioTracks = s.getAudioTracks();
          if (audioTracks.length > 0) {
            _audioStream = new MediaStream(audioTracks);
            _audioMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
            console.log('[STT] 音频轨道就绪，格式:', _audioMime || '(default)', '音轨数:', audioTracks.length);
          } else {
            console.warn('[STT] 无音频轨道，STT 将不工作');
          }
        } catch (e) { console.error('[STT] 音频初始化失败:', e); }

        // 启动第一个 MediaRecorder
        function _startNextRecorder() {
          if (!_audioStream) return;
          try {
            const mr = new MediaRecorder(_audioStream, _audioMime ? { mimeType: _audioMime } : {});
            const chunks = [];
            mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
            mr.onstop = () => {
              if (chunks.length === 0) return;
              const blob = new Blob(chunks, { type: _audioMime || 'audio/webm' });
              console.log('[STT] 录音完成，大小:', blob.size, 'bytes');
              const r = new FileReader();
              r.onloadend = () => {
                const b = new Uint8Array(r.result);
                let bin = '';
                for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
                const b64 = btoa(bin);
                audioQueue.push(b64);
                console.log('[STT] audio base64 入队，长度:', b64.length, '队列:', audioQueue.length);
              };
              r.readAsArrayBuffer(blob);
            };
            mr.start();
            mediaRecorder = mr;
            // 4s 后停止（触发 onstop），再立刻开下一个（更长分片 → 更完整上下文 → 快语速不遗漏）
            setTimeout(() => {
              if (mr.state !== 'inactive') mr.stop();
              _startNextRecorder();
            }, 4000);
          } catch (e) { console.error('[STT] MediaRecorder 启动失败:', e); }
        }
        _startNextRecorder();

        // ── rPPG 绿色通道采样（100ms = 10fps）──────────────────────────────
        // 从当前可见的 canvas 或 video 中心 50% 区域提取绿色通道均值
        setInterval(function () {
          try {
            var src = null;
            var dc = document.getElementById('session-canvas');
            if (dc && dc.style.display !== 'none' && dc.width > 0) {
              src = dc;  // ImageCapture 模式
            } else {
              var v = document.getElementById('session-video');
              if (v && v.readyState >= 2 && v.videoWidth > 0) src = v;
            }
            if (!src) return;
            var tmpC = document.createElement('canvas');
            var tw = 80, th = 60;  // 小分辨率，性能好
            tmpC.width = tw; tmpC.height = th;
            var tmpCtx = tmpC.getContext('2d');
            // 取中心 50% 区域（人脸大致在这里）
            var sw = (src.videoWidth || src.width);
            var sh = (src.videoHeight || src.height);
            tmpCtx.drawImage(src, sw*0.25, sh*0.25, sw*0.5, sh*0.5, 0, 0, tw, th);
            var px = tmpCtx.getImageData(0, 0, tw, th).data;
            var g = 0;
            for (var i = 0; i < px.length; i += 4) g += px[i + 1];
            greenBuffer.push(g / (tw * th));
            // 最多保留 600 个采样点（60s × 10fps）
            if (greenBuffer.length > 600) greenBuffer.shift();
          } catch (e) {}
        }, 100);

        showWsStatus(false, '正在连接…');
        startWS();

        // 启动全程视频录制（s 即当前媒体流）
        startFullRecording(s);
      }

      function tryImageCapture(s, hiddenVideo) {
        var track = s.getVideoTracks && s.getVideoTracks()[0];
        if (!track) { showHwAccelTip(); return; }
        if (typeof ImageCapture === 'undefined') { showHwAccelTip(); return; }
        var ic;
        try { ic = new ImageCapture(track); } catch (e) { showHwAccelTip(); return; }
        var displayCanvas = document.getElementById('session-canvas');
        if (!displayCanvas) { showHwAccelTip(); return; }

        function isBlackFrame(ctx, w, h) {
          try {
            var sample = ctx.getImageData(0, 0, Math.min(w, 64), Math.min(h, 64)).data;
            var sum = 0;
            for (var i = 0; i < sample.length; i += 4) sum += sample[i] + sample[i+1] + sample[i+2];
            return sum < 20;
          } catch (e) { return true; }
        }

        var dctx = displayCanvas.getContext('2d');
        var tries = 0;
        var MAX_TRIES = 30;  // 最多等 ~3 秒

        function tryGrab() {
          tries++;
          if (tries > MAX_TRIES) {
            setDebug('摄像头持续返回黑帧，请检查驱动或关闭 Chrome 硬件加速');
            showHwAccelTip();
            return;
          }
          ic.grabFrame().then(function (bmp) {
            var w = bmp.width, h = bmp.height;
            displayCanvas.width = w;
            displayCanvas.height = h;
            displayCanvas.style.display = 'block';
            hiddenVideo.style.display = 'none';
            dctx.drawImage(bmp, 0, 0);
            bmp.close();

            if (isBlackFrame(dctx, w, h)) {
              setDebug('第' + tries + '帧仍为黑帧，等待摄像头预热… (' + tries + '/' + MAX_TRIES + ')');
              drawLoopId = setTimeout(tryGrab, 100);
              return;
            }

            setDebug('画面已就绪 ' + w + 'x' + h);
            resetCamButton();

            // 开始持续画帧
            function loop() {
              if (!stream || stream.getVideoTracks().length === 0) return;
              ic.grabFrame().then(function (b) {
                if (b.width && b.height) {
                  displayCanvas.width = b.width;
                  displayCanvas.height = b.height;
                  dctx.drawImage(b, 0, 0);
                  b.close();
                }
                drawLoopId = setTimeout(loop, 66);
              }).catch(function () { drawLoopId = setTimeout(loop, 200); });
            }
            drawLoopId = setTimeout(loop, 66);
            setTimeout(function () { setDebug(''); }, 2000);
          }).catch(function (e) {
            setDebug('grabFrame 失败: ' + (e && e.message));
            showHwAccelTip();
          });
        }

        setDebug('ImageCapture 模式，等待摄像头预热…');
        tryGrab();
      }

      function showHwAccelTip() {
        resetCamButton();
        var prompt = document.getElementById('cam-prompt');
        if (!prompt) return;
        prompt.innerHTML = '摄像头无法在此浏览器渲染画面。请按以下步骤解决：<br>'
          + '<b>1.</b> 打开 <a href="chrome://settings/system" target="_blank" style="color:var(--primary)">Chrome 设置 › 系统</a>，关闭「使用硬件加速模式」，<b>重启 Chrome</b>。<br>'
          + '<b>2.</b> 或在终端用以下命令启动 Chrome：<br>'
          + '<code style="font-size:11px;word-break:break-all">google-chrome --disable-accelerated-video-decode http://localhost:9000</code><br>'
          + '<b>3.</b> 或安装 <b>v4l2loopback</b> 并用 ffmpeg 转码：'
          + '<code style="font-size:11px;word-break:break-all">sudo apt install v4l2loopback-dkms && sudo modprobe v4l2loopback</code>';
        setDebug('');
      }

      function tryStartStream() {
        var btn = document.getElementById('session-enable-cam');
        if (btn) { btn.textContent = '正在请求摄像头…'; btn.disabled = true; }
        var constraints = {
          video: videoId
            ? { deviceId: { exact: videoId }, width: { ideal: 640 }, height: { ideal: 480 } }
            : { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: audioId ? { deviceId: { exact: audioId } } : true,
        };
        var timeout = setTimeout(function () {
          timeout = null;
          if (btn) { btn.textContent = '启用摄像头'; btn.disabled = false; }
          showNoStreamUi('摄像头请求超时。请关闭其他占用摄像头的程序后，点击「启用摄像头」重试。');
          alert('摄像头未在 15 秒内响应。请检查：\n1. 是否有其他程序（如 Zoom、腾讯会议）正在使用摄像头\n2. 关闭后点击「启用摄像头」重试');
        }, 15000);
        navigator.mediaDevices.getUserMedia(constraints).then(function (s) {
          if (!timeout) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
          clearTimeout(timeout);
          startWithStream(s);
        }).catch(function (e) {
          if (timeout) { clearTimeout(timeout); }
          if (btn) { btn.textContent = '启用摄像头'; btn.disabled = false; }
          var msg = (e && (e.message || e.name)) ? (e.message || e.name) : '请允许使用摄像头与麦克风';
          showNoStreamUi('摄像头/麦克风未启用：' + msg + '。请点击下方按钮，在浏览器弹出的权限框中点「允许」。');
          alert('无法使用摄像头/麦克风：' + msg + '\n\n请检查：\n1. 浏览器地址栏左侧是否有被拦截的摄像头图标，点击改为「允许」\n2. 系统设置中是否允许本浏览器使用摄像头');
        });
      }

      function showNoStreamUi(msg) {
        var card = document.querySelector('.session-video-card');
        if (!card) return;
        card.innerHTML = '<div class="video-wrapper"><span class="live-badge">LIVE</span><video id="session-video" autoplay playsinline muted style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;"></video><canvas id="session-canvas" style="display:none;position:absolute;left:0;top:0;width:100%;height:100%;"></canvas><div id="cam-debug" style="position:absolute;bottom:4px;left:4px;right:4px;font-size:10px;color:#aaa;background:rgba(0,0,0,.5);padding:2px 4px;border-radius:2px;z-index:3;display:none;"></div></div><p class="status-fail session-cam-prompt" style="padding:12px;margin:0;border:1px solid var(--border);border-top:none;border-radius:0 0 4px 4px;" id="cam-prompt">' + (msg || '未获取到摄像头') + ' <button type="button" class="btn btn-primary" id="session-enable-cam">启用摄像头</button></p>';
        videoEl = document.getElementById('session-video');
        var btn = document.getElementById('session-enable-cam');
        if (btn) btn.onclick = tryStartStream;
      }

      function setupVideoFileUi() {
        var fIn = document.getElementById('session-video-file');
        var drop = document.getElementById('video-upload-drop');
        var panel = document.getElementById('video-upload-panel');
        var wrap = document.getElementById('file-video-wrapper');
        var v = document.getElementById('session-video');
        var btnStart = document.getElementById('btn-start-file-analysis');
        if (!fIn || !drop || !panel || !wrap || !v || !btnStart) return;

        function loadFile(file) {
          if (!file) return;
          if (pipelineStarted) {
            alert('分析进行中，请先结束会话再更换视频。');
            return;
          }
          if (videoBlobUrl) { try { URL.revokeObjectURL(videoBlobUrl); } catch (e) {} }
          videoBlobUrl = URL.createObjectURL(file);
          v.src = videoBlobUrl;
          v.load();
          panel.style.display = 'none';
          wrap.style.display = 'block';
          btnStart.disabled = false;
          btnStart.textContent = '开始分析';
        }

        drop.addEventListener('click', function () { fIn.click(); });
        drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.style.borderColor = 'var(--primary)'; });
        drop.addEventListener('dragleave', function () { drop.style.borderColor = ''; });
        drop.addEventListener('drop', function (e) {
          e.preventDefault();
          drop.style.borderColor = '';
          var f = e.dataTransfer.files[0];
          if (f) loadFile(f);
        });
        fIn.addEventListener('change', function () {
          if (fIn.files[0]) loadFile(fIn.files[0]);
        });

        btnStart.addEventListener('click', function () {
          if (pipelineStarted) return;
          if (!videoBlobUrl && !v.src) {
            alert('请先上传视频');
            return;
          }
          v.muted = false;
          var pp = v.play();
          if (pp && pp.catch) {
            pp.catch(function (err) {
              alert('无法播放视频：' + (err && err.message ? err.message : err));
            });
          }

          function startPipe() {
            if (pipelineStarted) return;
            var cap = null;
            try {
              cap = v.captureStream ? v.captureStream(30) : v.captureStream();
            } catch (err) {
              try { cap = v.captureStream(); } catch (e2) {
                alert('浏览器不支持 captureStream，请使用 Chrome/Edge 较新版本');
                return;
              }
            }
            if (!cap || cap.getVideoTracks().length === 0) {
              alert('未能从播放画面获取视频轨，请确认视频正在播放');
              return;
            }
            pipelineStarted = true;
            btnStart.disabled = true;
            btnStart.textContent = '分析中…';
            startWithStream(cap, { isFileVideo: true });
          }

          v.addEventListener('playing', function onPl() {
            v.removeEventListener('playing', onPl);
            requestAnimationFrame(startPipe);
          }, { once: true });
          setTimeout(function () {
            if (!pipelineStarted && v.readyState >= 2 && !v.paused) startPipe();
          }, 400);
        });
      }

      showWsStatus(false, '实时连接：未连接（若无法连接请在本机安装 websockets：pip install websockets，并重启后端）');
      if (isVideoFile) {
        setupVideoFileUi();
      } else if (window.__cehuang_pending_stream) {
        var s2 = window.__cehuang_pending_stream;
        window.__cehuang_pending_stream = null;
        startWithStream(s2);
      } else {
        tryStartStream();
      }

      function startWS() {
        // 注意：音频收集已由 _startNextRecorder 内部的 onstop 回调接管，不再需要额外 setInterval
        closeWS = connectWS(
          sessionId,
          () => lastFrameB64,
          () => audioQueue.shift() || null,
          null,
          2000,
          (data) => {
            result = data;
            showWsStatus(true);
            const fill = document.getElementById('gauge-fill');
            if (fill) {
              const p = (data.lie_probability ?? 0) * 100;
              fill.style.width = p + '%';
              fill.className = 'gauge-fill ' + (p < 35 ? 'low' : p < 65 ? 'mid' : 'high');
              const gaugeVal = document.getElementById('gauge-value');
              if (gaugeVal) gaugeVal.textContent = p.toFixed(0) + '%';
            }
            const d2 = data.dimensions || {};
            function setDimEl(id, info) {
              const el = document.getElementById(id);
              if (!el) return;
              const v = el.querySelector('.dim-label');
              if (v) { v.textContent = info.text; v.style.color = info.color; }
            }
            setDimEl('m-expr',     exprLabel(d2.expression || 0));
            var emotionList = document.getElementById('emotion-scores-list');
            if (emotionList) {
              var scores = (d2.emotion_scores && Object.keys(d2.emotion_scores).length > 0) ? d2.emotion_scores : null;
              emotionList.innerHTML = renderEmotionScores(scores || {});
              emotionList.style.display = 'block';
            }
            setDimEl('m-hr',       bpmDisplay(data.bpm || null));
          },
          function (err) {
            showWsStatus(false, '实时连接失败。请启动后端并安装 WebSocket 支持：pip install websockets，然后执行 PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port 9000');
          },
          function () { showWsStatus(false); },
          function (tr) {
            if (tr && tr.text) appendTranscript(tr.speaker, tr.text);
          },
          null,  // onConnected
          // getGreenValues：消费式取出，随本次 WS 消息发送后清空
          function () {
            if (greenBuffer.length < 5) return null;
            var vals = greenBuffer.slice();
            greenBuffer = [];
            return vals;
          }
        );
      }

      const captureFrame = () => {
        if (!ctx || !stream) return;
        // ImageCapture 模式：从展示 canvas 取帧
        var displayCanvas = document.getElementById('session-canvas');
        if (displayCanvas && displayCanvas.style.display !== 'none' && displayCanvas.width > 0) {
          canvas.width = displayCanvas.width;
          canvas.height = displayCanvas.height;
          ctx.drawImage(displayCanvas, 0, 0);
        } else {
          const v = videoEl;
          if (!v || v.readyState < 2 || v.videoWidth === 0) return;
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
        }
        try {
          canvas.toBlob(blob => {
            if (!blob) return;
            const r = new FileReader();
            r.onloadend = () => {
              const b = new Uint8Array(r.result);
              let binary = '';
              for (let i = 0; i < b.length; i++) binary += String.fromCharCode(b[i]);
              lastFrameB64 = btoa(binary);
            };
            r.readAsArrayBuffer(blob);
          }, 'image/jpeg', 0.85);
        } catch (e) {}
      };
      setInterval(captureFrame, 500);
    }

    async function doEnd() {
      // 防止重复点击
      var btnEnd = document.getElementById('btn-end');
      if (btnEnd) { btnEnd.disabled = true; btnEnd.textContent = '停止录制…'; }

      // 1. 关闭 WebSocket 和 STT 录音
      if (closeWS) { closeWS(); closeWS = null; }
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();

      // 2. 停止全程录制，等待最后一个 dataavailable 事件
      let videoBlob = null;
      if (_fullRecorder && _fullRecorder.state !== 'inactive') {
        console.log('[doEnd] 停止全程录制，当前 chunks:', _fullChunks.length);
        await new Promise(function (resolve) {
          _fullRecorder.addEventListener('dataavailable', function onData(e) {
            if (e.data && e.data.size > 0) _fullChunks.push(e.data);
            _fullRecorder.removeEventListener('dataavailable', onData);
          });
          _fullRecorder.onstop = function () { resolve(); };
          _fullRecorder.stop();
          setTimeout(resolve, 3000); // 最多等 3s
        });
        console.log('[doEnd] 录制已停止，总 chunks:', _fullChunks.length);
      }
      if (_fullChunks.length > 0) {
        videoBlob = new Blob(_fullChunks, { type: 'video/webm' });
        console.log('[doEnd] 视频 Blob 大小:', videoBlob.size, 'bytes');
      } else {
        console.warn('[doEnd] 无视频数据（_fullChunks 为空）');
      }

      // 3. 停止摄像头 / 视频采集流
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }

      // 3b. 视频测谎：释放本地 Blob URL 并清空播放器
      if (isVideoFile) {
        var fv = document.getElementById('session-video');
        if (fv) {
          try { fv.pause(); } catch (e) {}
          fv.removeAttribute('src');
          try { fv.load(); } catch (e2) {}
        }
        if (videoBlobUrl) {
          try { URL.revokeObjectURL(videoBlobUrl); } catch (e) {}
          videoBlobUrl = null;
        }
        pipelineStarted = false;
      }

      // 4. 转录使用内存缓存（appendTranscript 已实时维护，含合并后完整文本）
      console.log('[doEnd] 转录条目数:', _transcriptEntries.length);

      // 5. 更新按钮提示
      if (btnEnd) btnEnd.textContent = '保存中…';

      // 6. 并行保存转录 + 上传视频
      const errors = [];
      const saves = [];

      if (_transcriptEntries.length > 0) {
        saves.push(
          saveTranscript(sessionId, _transcriptEntries)
            .then(function () { console.log('[doEnd] 转录保存成功'); })
            .catch(function (e) { console.error('[doEnd] 转录保存失败:', e); errors.push('转录: ' + e.message); })
        );
      }

      if (videoBlob && videoBlob.size > 500) {
        if (btnEnd) btnEnd.textContent = '上传视频…';
        saves.push(
          uploadVideo(sessionId, videoBlob)
            .then(function () { console.log('[doEnd] 视频上传成功'); })
            .catch(function (e) { console.error('[doEnd] 视频上传失败:', e); errors.push('视频: ' + e.message); })
        );
      }

      await Promise.all(saves);

      if (errors.length > 0) {
        console.warn('[doEnd] 部分保存失败:', errors);
        // 不阻断流程，继续结束会话
      }

      // 7. 结束会话
      if (btnEnd) btnEnd.textContent = '结束中…';
      try {
        const reportId = await endSession(sessionId);
        sessionStorage.removeItem('cehuang_session_id');
        sessionStorage.setItem('cehuang_report_id', reportId);
        window.location.hash = 'history';
      } catch (e) {
        if (btnEnd) { btnEnd.disabled = false; btnEnd.textContent = '结束会话'; }
        alert('结束会话失败: ' + e.message);
      }
    }

    // ── 启动全程视频录制 ──────────────────────────────────────────────────
    function startFullRecording(s) {
      if (!s) return;
      var mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
      try {
        _fullRecorder = new MediaRecorder(s, mime ? { mimeType: mime } : {});
        _fullRecorder.ondataavailable = function (e) {
          if (e.data && e.data.size > 0) _fullChunks.push(e.data);
        };
        _fullRecorder.start(5000); // 每 5s 一个 chunk，持续录制
        console.log('[录制] 全程视频录制已启动，格式:', mime || 'default');
      } catch (e) {
        console.warn('[录制] 全程视频录制启动失败:', e);
      }
    }

    renderSession();

    // ── 加载会话元数据（名称 + 提纲） ────────────────────────────────────
    getSessionMeta(sessionId).then(function (meta) {
      if (!meta) return;
      // 更新页面标题
      var titleEl = document.getElementById('session-title');
      if (titleEl && meta.name) {
        titleEl.innerHTML = '测谎：' + meta.name
          + ' <span style="color:var(--text-muted);font-size:13px;">' + sessionId.slice(0, 8) + '</span>';
      }
    }).catch(function () {});

    getOutline(sessionId).then(function (outline) {
      if (!outline || !outline.text) return;
      var panel = document.getElementById('outline-panel');
      var fnEl = document.getElementById('outline-filename');
      var bodyEl = document.getElementById('outline-body');
      var toggle = document.getElementById('outline-toggle');
      if (!panel || !bodyEl) return;
      if (fnEl) fnEl.textContent = outline.filename || '';
      bodyEl.textContent = outline.text;
      panel.style.display = 'block';
      var collapsed = false;
      toggle.addEventListener('click', function () {
        collapsed = !collapsed;
        bodyEl.style.display = collapsed ? 'none' : '';
        toggle.querySelector('.outline-chevron').textContent = collapsed ? '▼' : '▲';
      });
    }).catch(function () {});
  }

  // ---------- 报告页 ----------
  async function pageReport(id) {
    if (!id) { window.location.hash = 'history'; return; }
    try {
      const report = await getReport(id);
      const s = report.summary || {};
      const timeline = report.timeline || [];
      const probs = timeline.map(t => t.lie_probability).filter(x => typeof x === 'number');
      const maxP = probs.length ? Math.max(...probs) * 100 : 0;
      const avgP = probs.length ? (probs.reduce((a, b) => a + b, 0) / probs.length) * 100 : 0;
      const base = window.location.href.split('#')[0];
      root.innerHTML = nav() + `
        <div id="page">
          <h1 class="page-title">报告</h1>
          <div class="report-summary">
            <div class="item"><span class="label">平均说谎概率</span><div class="value">${avgP.toFixed(1)}%</div></div>
            <div class="item"><span class="label">峰值</span><div class="value">${maxP.toFixed(1)}%</div></div>
            <div class="item"><span class="label">等级</span><div class="value">${s.level || '-'}</div></div>
          </div>
          <div class="card">
            <h2>时间线（说谎概率）</h2>
            <div class="timeline-chart" id="timeline-chart"></div>
          </div>
          <div class="card">
            <h2>语义发现</h2>
            <ul class="semantic-list">${(report.semantic_findings || []).map(f => '<li>' + (f.text || '-') + '</li>').join('')}</ul>
          </div>
          <button class="btn btn-secondary" onclick="location.hash='history'">返回列表</button>
          <button class="btn btn-primary" onclick="location.hash=''">新一轮测谎</button>
        </div>
      `;
      const chartEl = document.getElementById('timeline-chart');
      if (chartEl && timeline.length) {
        const w = chartEl.offsetWidth;
        const h = chartEl.offsetHeight - 32;
        const pad = 24;
        const xs = timeline.map((_, i) => pad + (i / Math.max(1, timeline.length - 1)) * (w - 2 * pad));
        const ys = timeline.map(t => h - (t.lie_probability || 0) * h + pad);
        const path = timeline.map((t, i) => (i === 0 ? 'M' : 'L') + xs[i] + ',' + ys[i]).join(' ');
        chartEl.innerHTML = '<svg width="100%" height="100%" viewBox="0 0 ' + w + ' ' + (h + 32) + '" preserveAspectRatio="none"><path d="' + path + '" fill="none" stroke="var(--primary)" stroke-width="2"/></svg>';
      }
    } catch (e) {
      root.innerHTML = nav() + '<div id="page"><p class="status-fail">加载报告失败: ' + e.message + '</p><a href="#">返回</a></div>';
    }
  }

  // ---------- 设置页 ----------
  function pageSettings() {
    const base = window.location.href.split('#')[0];
    const apiBase = localStorage.getItem('cehuang_api_base') || '';
    render(`
      <h1 class="page-title">设置</h1>
      <div class="card settings-form">
        <div class="field">
          <label>API 地址（留空则使用当前站点 :9000）</label>
          <input type="text" id="api-base" value="${apiBase.replace(/"/g, '&quot;')}" placeholder="http://localhost:9000"/>
        </div>
        <button class="btn btn-primary" id="save-settings">保存</button>
        <a href="${base}#/" class="btn btn-secondary" style="margin-left:8px">返回</a>
      </div>
    `);
    document.getElementById('save-settings').onclick = () => {
      const v = document.getElementById('api-base').value.trim();
      localStorage.setItem('cehuang_api_base', v);
      alert('已保存');
    };
  }

  // ---------- 历史列表 ----------
  async function pageHistory() {
    const base = window.location.href.split('#')[0];
    try {
      const sessions = await listSessions();
      const statusMap = { active: '进行中', ended: '已结束' };
      render(`
        <h1 class="page-title">历史会话</h1>
        <div class="card" style="overflow-x:auto;">
          <table class="history-table">
            <thead>
              <tr>
                <th>任务名称</th>
                <th>创建时间</th>
                <th>状态</th>
                <th>视频</th>
                <th>转录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${(sessions || []).map(function (s) {
                var name = s.name || ('<span style="color:var(--text-muted);font-size:12px;">' + s.id.slice(0, 8) + '…</span>');
                var status = statusMap[s.status] || s.status || '-';
                var statusClass = s.status === 'ended' ? 'status-ok' : 'status-warn';
                var videoTag = s.has_video ? '🎬' : '<span style="opacity:.4">—</span>';
                var trTag = s.has_transcript ? '📝' : '<span style="opacity:.4">—</span>';
                var ops = '<a class="btn btn-secondary" style="padding:3px 10px;font-size:12px;" href="' + base + '#/detail/' + s.id + '">详情</a>';
                if (s.report_id) ops += ' <a class="btn btn-secondary" style="padding:3px 10px;font-size:12px;" href="' + base + '#/report/' + s.report_id + '">报告</a>';
                return '<tr>'
                  + '<td>' + name + '</td>'
                  + '<td style="font-size:12px;white-space:nowrap;">' + (s.created_at || '').slice(0, 19).replace('T', ' ') + '</td>'
                  + '<td><span class="' + statusClass + '" style="font-size:12px;">' + status + '</span></td>'
                  + '<td style="text-align:center;">' + videoTag + '</td>'
                  + '<td style="text-align:center;">' + trTag + '</td>'
                  + '<td style="white-space:nowrap;">' + ops + '</td>'
                  + '</tr>';
              }).join('')}
            </tbody>
          </table>
        </div>
        <a href="${base}#/" class="btn btn-primary" style="margin-top:12px;">新建测谎</a>
      `);
    } catch (e) {
      render('<p class="status-fail">加载失败: ' + e.message + '</p><a href="#">返回</a>');
    }
  }

  // ---------- 会话详情页 ----------
  async function pageDetail(sessionId) {
    if (!sessionId) { window.location.hash = 'history'; return; }
    const base = window.location.href.split('#')[0];
    render('<p style="padding:32px;text-align:center;color:var(--text-muted);">加载中…</p>');
    try {
      const [meta, transcriptData, outlineData, reportData] = await Promise.all([
        getSessionMeta(sessionId).catch(() => null),
        getTranscript(sessionId).catch(() => null),
        getOutline(sessionId).catch(() => null),
        getReportBySessionId(sessionId).catch(() => null),
      ]);
      const m = meta || {};
      const entries = (transcriptData && transcriptData.entries) || [];
      const outline = outlineData || null;
      const videoUrl = m.has_video ? getVideoUrl(sessionId) : null;
      const timeline = (reportData && reportData.timeline) || [];

      const SPEAKER_COLORS_D = ['#4a9eff', '#2ecc71', '#f39c12', '#e91e63', '#9b59b6', '#1abc9c'];
      const colorMap = {};
      let colorIdx = 0;
      function spColor(sp) {
        if (!colorMap[sp]) { colorMap[sp] = SPEAKER_COLORS_D[colorIdx++ % SPEAKER_COLORS_D.length]; }
        return colorMap[sp];
      }

      // 计算转录条目相对会话开始的偏移毫秒
      var sessionStartMs = m.created_at ? new Date(m.created_at).getTime() : 0;
      var sessionEndMs   = m.ended_at   ? new Date(m.ended_at).getTime()   : 0;
      const transcriptHtml = entries.length
        ? entries.map(function (e) {
            var c = spColor(e.speaker || '未知');
            var ts = (e.ts || '').slice(11, 19);
            var offsetMs = e.ts ? (new Date(e.ts).getTime() - sessionStartMs) : -1;
            return '<div class="transcript-entry" data-offset-ms="' + offsetMs + '" style="cursor:pointer;" title="点击跳转视频至此处">'
              + '<span class="transcript-speaker" style="color:' + c + '">' + (e.speaker || '未知') + '</span>'
              + '<span class="transcript-time">' + ts + '</span>'
              + '<span class="transcript-text">' + (e.text || '') + '</span>'
              + '</div>';
          }).join('')
        : '<p style="color:var(--text-muted);padding:12px;">无转录记录</p>';

      root.innerHTML = nav() + `
        <div id="page">
          <a href="${base}#/history" class="btn btn-secondary" style="margin-bottom:16px;display:inline-block;">← 返回历史</a>
          <h1 class="page-title">${m.name ? '详情：' + m.name : '会话详情'}</h1>
          <div class="detail-meta card" style="margin-bottom:16px;">
            <div class="detail-meta-row"><span class="label">会话 ID</span><span>${sessionId}</span></div>
            <div class="detail-meta-row"><span class="label">创建时间</span><span>${(m.created_at || '').slice(0,19).replace('T',' ')}</span></div>
            <div class="detail-meta-row"><span class="label">结束时间</span><span>${(m.ended_at || '未结束').slice(0,19).replace('T',' ')}</span></div>
            ${m.report_id ? '<div class="detail-meta-row"><span class="label">报告</span><span><a href="' + base + '#/report/' + m.report_id + '" class="btn btn-secondary" style="padding:3px 10px;font-size:12px;">查看报告</a></span></div>' : ''}
          </div>
          ${outline ? `
          <div class="card outline-panel" style="margin-bottom:16px;">
            <div class="outline-header" id="outline-toggle-d">
              <span class="outline-title">📋 审讯提纲</span>
              <span class="outline-filename">${outline.filename || ''}</span>
              <span class="outline-chevron">▲</span>
            </div>
            <div class="outline-body" id="outline-body-d">${(outline.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
          </div>` : ''}
          ${videoUrl ? `
          <div class="card vp-card" style="margin-bottom:16px;padding:0;overflow:hidden;">
            <div class="vp-title">🎬 录制视频</div>
            <video id="detail-video" src="${videoUrl}" playsinline
              style="width:100%;max-height:480px;background:#000;display:block;"></video>
            <!-- 自定义控件栏：左列(播放)+中列(进度条+时间线)+右列(时间/音量/全屏) -->
            <div class="vp-bar">
              <div class="vp-col-left">
                <button class="vp-btn" id="vp-play" title="播放/暂停">▶</button>
              </div>
              <div class="vp-col-center">
                <div class="vp-progress-row">
                  <div class="vp-track" id="vp-track">
                    <div class="vp-track-buf" id="vp-buf"></div>
                    <div class="vp-track-fill" id="vp-fill"></div>
                    <div class="vp-track-thumb" id="vp-thumb"></div>
                  </div>
                </div>
                ${timeline.length > 1 ? `
                <canvas id="timeline-chart" style="width:100%;height:110px;display:block;cursor:crosshair;"></canvas>
                <div class="vp-tl-legend">
                  <span style="font-size:11px;opacity:.6;">📈</span>
                  <label class="vp-tl-lbl"><input type="checkbox" id="tl-show-expr" checked><span style="color:#f39c12">■</span>表情</label>
                  <label class="vp-tl-lbl"><input type="checkbox" id="tl-show-hr" checked><span style="color:#e74c3c">■</span>心率</label>
                  <label class="vp-tl-lbl"><input type="checkbox" id="tl-show-tone" checked><span style="color:#2ecc71">■</span>语调</label>
                  <span id="tl-cursor-val"></span>
                </div>
                ` : ''}
              </div>
              <div class="vp-col-right">
                <span class="vp-time" id="vp-time">0:00 / --:--</span>
                <button class="vp-btn" id="vp-mute" title="静音">🔊</button>
                <button class="vp-btn" id="vp-fs" title="全屏">⛶</button>
              </div>
            </div>
          </div>` : ''}
          <div class="card transcript-panel" style="margin-bottom:16px;">
            <div class="transcript-header">
              <span class="transcript-title">📝 语音转文字记录</span>
              <span class="transcript-hint">${entries.length} 条</span>
              <div class="transcript-actions">
                <input type="file" id="detail-ref-file" accept=".txt,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none" />
                <button class="btn btn-secondary" id="btn-upload-ref" style="padding:4px 12px;font-size:12px;">📎 上传参考文件</button>
                <span id="ref-file-name" style="font-size:11px;color:var(--text-muted);margin:0 8px;"></span>
                <button class="btn btn-primary" id="btn-check-logic" style="padding:4px 12px;font-size:12px;">🔍 检查逻辑</button>
              </div>
            </div>
            <div class="transcript-body" style="max-height:400px;">${transcriptHtml}</div>
          </div>
          <div class="card logic-result-panel" id="logic-result-panel" style="display:none;margin-bottom:16px;">
            <div class="logic-result-header">
              <span class="logic-result-title">🧠 逻辑检查结果</span>
              <span class="logic-verdict-badge" id="logic-verdict-badge"></span>
            </div>
            <div id="logic-issues-list"></div>
            <div id="logic-full-text"></div>
          </div>
          ${(function(){ var last = timeline.slice().reverse().find(function(p){ return p.emotion_scores && Object.keys(p.emotion_scores).length > 0; }); return last ? '<div class="card" style="margin-bottom:16px;"><div class="card-title" style="padding:12px 16px;font-size:14px;">情绪（9类）· 最近一次分析</div><div class="emotion-scores-list" style="display:block;padding:0 16px 12px;">' + renderEmotionScores(last.emotion_scores) + '</div></div>' : ''; })()}
        </div>
      `;

      // ── 播放器 & 折线图 & 转录同步 ────────────────────────────────────────
      var tlCanvas = document.getElementById('timeline-chart');
      var detailVideo = document.getElementById('detail-video');
      var vpPlay  = document.getElementById('vp-play');
      var vpTrack = document.getElementById('vp-track');
      var vpFill  = document.getElementById('vp-fill');
      var vpThumb = document.getElementById('vp-thumb');
      var vpBuf   = document.getElementById('vp-buf');
      var vpTime  = document.getElementById('vp-time');
      var vpMute  = document.getElementById('vp-mute');
      var vpFs    = document.getElementById('vp-fs');

      // 时间参考基准：以 created_at 为 0 秒，ended_at 为总时长
      var totalSec = sessionEndMs > sessionStartMs
        ? (sessionEndMs - sessionStartMs) / 1000
        : (timeline.length > 1 ? (new Date(timeline[timeline.length-1].t).getTime() - new Date(timeline[0].t).getTime()) / 1000 : 600);

      var videoOffsetSec = 0;
      var tlPoints = timeline.length > 1 ? timeline.map(function(p) {
        return {
          sec: (new Date(p.t).getTime() - sessionStartMs) / 1000,
          lie: p.lie_probability || 0, expr: p.expression || 0,
          hr: p.heart_rate || 0,       tone: p.tone || 0,
        };
      }) : [];
      var showExpr = true, showHr = true, showTone = true;
      var cursorSec = -1;

      // ── 辅助：格式化时间 ──────────────────────────────────────────────────
      function fmtSec(s) {
        s = Math.max(0, s || 0);
        var m = Math.floor(s / 60), sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
      }

      // ── 更新自定义进度条 ──────────────────────────────────────────────────
      function updateProgress() {
        if (!detailVideo) return;
        var dur = detailVideo.duration || 0;
        var pct = dur > 0 ? (detailVideo.currentTime / dur * 100) : 0;
        if (vpFill)  vpFill.style.width  = pct + '%';
        if (vpThumb) vpThumb.style.left  = pct + '%';
        if (vpTime)  vpTime.textContent  = fmtSec(detailVideo.currentTime) + ' / ' + (dur > 0 ? fmtSec(dur) : '--:--');
        if (vpBuf && dur > 0 && detailVideo.buffered.length > 0) {
          vpBuf.style.width = (detailVideo.buffered.end(detailVideo.buffered.length - 1) / dur * 100) + '%';
        }
      }

      // ── 自定义控件事件 ────────────────────────────────────────────────────
      if (detailVideo) {
        // 播放/暂停按钮
        if (vpPlay) vpPlay.addEventListener('click', function() {
          if (detailVideo.paused) detailVideo.play(); else detailVideo.pause();
        });
        detailVideo.addEventListener('play',  function() { if (vpPlay) vpPlay.textContent = '⏸'; });
        detailVideo.addEventListener('pause', function() { if (vpPlay) vpPlay.textContent = '▶'; });
        detailVideo.addEventListener('ended', function() { if (vpPlay) vpPlay.textContent = '▶'; });
        detailVideo.addEventListener('timeupdate', updateProgress);
        detailVideo.addEventListener('progress',   updateProgress);
        detailVideo.addEventListener('loadedmetadata', function() {
          if (sessionEndMs > sessionStartMs && detailVideo.duration > 0) {
            videoOffsetSec = totalSec - detailVideo.duration;
            if (videoOffsetSec < 0) videoOffsetSec = 0;
          }
          updateProgress();
          if (tlCanvas && tlPoints.length > 1) drawTimeline();
        });

        // 拖动进度条 seek
        var _seeking = false;
        function _doSeek(e) {
          if (!vpTrack) return;
          var r = vpTrack.getBoundingClientRect();
          var ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          detailVideo.currentTime = ratio * (detailVideo.duration || 0);
        }
        if (vpTrack) {
          vpTrack.addEventListener('mousedown', function(e) { _seeking = true; _doSeek(e); e.preventDefault(); });
          vpTrack.addEventListener('touchstart', function(e) { _seeking = true; _doSeek(e.touches[0]); }, {passive:true});
        }
        document.addEventListener('mousemove', function(e) { if (_seeking) _doSeek(e); });
        document.addEventListener('mouseup',   function()  { _seeking = false; });
        document.addEventListener('touchend',  function()  { _seeking = false; });

        // 静音
        if (vpMute) vpMute.addEventListener('click', function() {
          detailVideo.muted = !detailVideo.muted;
          vpMute.style.opacity = detailVideo.muted ? '0.35' : '1';
        });

        // 全屏
        if (vpFs) vpFs.addEventListener('click', function() {
          var w = detailVideo.closest('.vp-card') || detailVideo;
          if (document.fullscreenElement) document.exitFullscreen();
          else w.requestFullscreen && w.requestFullscreen();
        });
      }

      // ── 折线图 ────────────────────────────────────────────────────────────
      if (tlCanvas && tlPoints.length > 1) {
        var tlCtx = tlCanvas.getContext('2d');

        function drawTimeline() {
          var W = tlCanvas.width, H = tlCanvas.height;
          // PAD.left=0 使数据区域与进度条完全对齐（Y标签内嵌在图中）
          var PAD = { top: 6, right: 0, bottom: 20, left: 0 };
          var cW = W, cH = H - PAD.top - PAD.bottom;

          tlCtx.clearRect(0, 0, W, H);

          // 背景网格 + 内嵌 Y 标签
          [0.25, 0.5, 0.75, 1.0].forEach(function(y) {
            var py = PAD.top + cH * (1 - y);
            tlCtx.strokeStyle = 'rgba(255,255,255,0.07)';
            tlCtx.lineWidth = 1;
            tlCtx.beginPath(); tlCtx.moveTo(0, py); tlCtx.lineTo(W, py); tlCtx.stroke();
            tlCtx.fillStyle = 'rgba(255,255,255,0.28)';
            tlCtx.font = '9px sans-serif';
            tlCtx.textAlign = 'left';
            tlCtx.fillText((y * 100).toFixed(0) + '%', 3, py - 2);
          });

          // 视频覆盖区域高亮
          if (detailVideo && detailVideo.duration > 0) {
            var vx = (videoOffsetSec / totalSec) * cW;
            tlCtx.fillStyle = 'rgba(74,158,255,0.07)';
            tlCtx.fillRect(vx, PAD.top, cW - vx, cH);
            tlCtx.strokeStyle = 'rgba(74,158,255,0.3)';
            tlCtx.lineWidth = 1; tlCtx.setLineDash([4, 4]);
            tlCtx.beginPath(); tlCtx.moveTo(vx, PAD.top); tlCtx.lineTo(vx, PAD.top + cH); tlCtx.stroke();
            tlCtx.setLineDash([]);
          }

          function drawLine(key, color, alpha) {
            tlCtx.beginPath();
            tlCtx.strokeStyle = color; tlCtx.globalAlpha = alpha;
            tlCtx.lineWidth = key === 'lie' ? 2 : 1;
            tlPoints.forEach(function(p, i) {
              var x = (p.sec / totalSec) * cW;
              var y = PAD.top + cH * (1 - p[key]);
              if (i === 0) tlCtx.moveTo(x, y); else tlCtx.lineTo(x, y);
            });
            tlCtx.stroke(); tlCtx.globalAlpha = 1;
          }
          if (showExpr) drawLine('expr', '#f39c12', 0.55);
          if (showHr)   drawLine('hr',   '#e74c3c', 0.55);
          if (showTone) drawLine('tone', '#2ecc71', 0.55);
          drawLine('lie', '#4a9eff', 1);

          // X 轴时间刻度
          tlCtx.fillStyle = 'rgba(255,255,255,0.35)';
          tlCtx.font = '9px sans-serif'; tlCtx.textAlign = 'center';
          var tickCount = Math.min(10, Math.floor(totalSec / 30) + 1);
          for (var ti = 0; ti <= tickCount; ti++) {
            var tsSec = (totalSec / tickCount) * ti;
            var tx = (tsSec / totalSec) * cW;
            var mm = Math.floor(tsSec / 60), ss = Math.floor(tsSec % 60);
            // 防止首尾标签被截断
            if (ti === 0) tlCtx.textAlign = 'left';
            else if (ti === tickCount) tlCtx.textAlign = 'right';
            else tlCtx.textAlign = 'center';
            tlCtx.fillText(mm + ':' + (ss < 10 ? '0' : '') + ss, tx, H - 4);
          }

          // 游标
          if (cursorSec >= 0) {
            var cx = (cursorSec / totalSec) * cW;
            tlCtx.strokeStyle = 'rgba(255,255,255,0.85)';
            tlCtx.lineWidth = 1.5; tlCtx.setLineDash([3, 3]);
            tlCtx.beginPath(); tlCtx.moveTo(cx, PAD.top); tlCtx.lineTo(cx, PAD.top + cH); tlCtx.stroke();
            tlCtx.setLineDash([]);
            var nearIdx = 0, nearDiff = Infinity;
            tlPoints.forEach(function(p, i) {
              var d = Math.abs(p.sec - cursorSec);
              if (d < nearDiff) { nearDiff = d; nearIdx = i; }
            });
            var np = tlPoints[nearIdx];
            var valEl = document.getElementById('tl-cursor-val');
            if (valEl) valEl.textContent = '综合: ' + (np.lie * 100).toFixed(0) + '% | 表情: ' + (np.expr * 100).toFixed(0) + '% | 心率: ' + (np.hr * 100).toFixed(0) + '% | 语调: ' + (np.tone * 100).toFixed(0) + '%';
          }
        }

        function resizeAndDraw() {
          var rect = tlCanvas.getBoundingClientRect();
          var dpr = window.devicePixelRatio || 1;
          tlCanvas.width  = rect.width  * dpr;
          tlCanvas.height = rect.height * dpr;
          tlCtx.scale(dpr, dpr);
          drawTimeline();
        }
        resizeAndDraw();
        window.addEventListener('resize', resizeAndDraw);

        // 视频时间 -> 更新游标和进度条
        function onVideoTime() {
          if (!detailVideo) return;
          cursorSec = videoOffsetSec + detailVideo.currentTime;
          updateProgress();
          drawTimeline();
          syncTranscriptHighlight(cursorSec);
        }
        if (detailVideo) {
          detailVideo.addEventListener('timeupdate', onVideoTime);
          detailVideo.addEventListener('seeked', onVideoTime);
        }

        // 点击/拖动 timeline -> 跳转视频
        var _tlSeeking = false;
        function _tlSeek(e) {
          var rect = tlCanvas.getBoundingClientRect();
          var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          var targetSessionSec = ratio * totalSec;
          cursorSec = targetSessionSec;
          drawTimeline();
          syncTranscriptHighlight(targetSessionSec);
          if (detailVideo && detailVideo.duration > 0) {
            var vt = targetSessionSec - videoOffsetSec;
            if (vt >= 0 && vt <= detailVideo.duration) detailVideo.currentTime = vt;
          }
        }
        tlCanvas.addEventListener('mousedown', function(e) { _tlSeeking = true; _tlSeek(e); e.preventDefault(); });
        document.addEventListener('mousemove', function(e) { if (_tlSeeking) _tlSeek(e); });
        document.addEventListener('mouseup',   function()  { _tlSeeking = false; });

        // 图例 checkbox
        ['expr', 'hr', 'tone'].forEach(function(key) {
          var cb = document.getElementById('tl-show-' + key);
          if (cb) cb.addEventListener('change', function() {
            if (key === 'expr') showExpr = cb.checked;
            if (key === 'hr')   showHr   = cb.checked;
            if (key === 'tone') showTone = cb.checked;
            drawTimeline();
          });
        });
      } else if (detailVideo) {
        // 无 timeline 时只初始化自定义进度条
        detailVideo.addEventListener('timeupdate', updateProgress);
        detailVideo.addEventListener('loadedmetadata', updateProgress);
        var _seeking2 = false;
        function _doSeek2(e) {
          if (!vpTrack) return;
          var r = vpTrack.getBoundingClientRect();
          var ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          detailVideo.currentTime = ratio * (detailVideo.duration || 0);
        }
        if (vpTrack) {
          vpTrack.addEventListener('mousedown', function(e) { _seeking2 = true; _doSeek2(e); e.preventDefault(); });
        }
        document.addEventListener('mousemove', function(e) { if (_seeking2) _doSeek2(e); });
        document.addEventListener('mouseup',   function()  { _seeking2 = false; });
      }

      // ── 转录条目与视频同步 ──────────────────────────────────────────────────
      function syncTranscriptHighlight(sessionSec) {
        var sessionMs = sessionSec * 1000;
        var allEntries = document.querySelectorAll('.transcript-entry[data-offset-ms]');
        var best = null, bestDiff = Infinity;
        allEntries.forEach(function(el) {
          var off = parseInt(el.getAttribute('data-offset-ms'), 10);
          if (off >= 0 && off <= sessionMs) {
            var diff = sessionMs - off;
            if (diff < bestDiff) { bestDiff = diff; best = el; }
          }
        });
        allEntries.forEach(function(el) { el.classList.remove('active-transcript'); });
        if (best) {
          best.classList.add('active-transcript');
          var body = best.closest('.transcript-body');
          if (body) {
            var elTop = best.offsetTop - body.offsetTop;
            var elBottom = elTop + best.offsetHeight;
            var bodyScroll = body.scrollTop;
            var bodyH = body.clientHeight;
            if (elTop < bodyScroll || elBottom > bodyScroll + bodyH) {
              body.scrollTop = elTop - bodyH / 2;
            }
          }
        }
      }

      // 点击转录条目 -> 跳转视频
      document.querySelectorAll('.transcript-entry[data-offset-ms]').forEach(function(el) {
        el.addEventListener('click', function() {
          var offsetMs = parseInt(el.getAttribute('data-offset-ms'), 10);
          if (offsetMs < 0) return;
          var sessionSec = offsetMs / 1000;
          syncTranscriptHighlight(sessionSec);
          if (detailVideo && detailVideo.duration > 0) {
            var videoTime = sessionSec - videoOffsetSec;
            if (videoTime >= 0 && videoTime <= detailVideo.duration) {
              detailVideo.currentTime = videoTime;
              detailVideo.play();
            }
          }
        });
      });

      // 提纲折叠
      var toggleD = document.getElementById('outline-toggle-d');
      if (toggleD) {
        toggleD.addEventListener('click', function () {
          var bd = document.getElementById('outline-body-d');
          var ch = toggleD.querySelector('.outline-chevron');
          if (!bd) return;
          var collapsed = bd.style.display === 'none';
          bd.style.display = collapsed ? '' : 'none';
          if (ch) ch.textContent = collapsed ? '▲' : '▼';
        });
      }

      // ── 上传参考文件 ────────────────────────────────────────────────────
      var refFileInput = document.getElementById('detail-ref-file');
      var refFileName  = document.getElementById('ref-file-name');
      var btnUploadRef = document.getElementById('btn-upload-ref');
      var refFileContent = '';   // 读取到的 txt 内容

      btnUploadRef.addEventListener('click', function () { refFileInput.click(); });
      refFileInput.addEventListener('change', function () {
        var file = refFileInput.files[0];
        if (!file) return;
        var ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'docx' || ext === 'doc') {
          var reader = new FileReader();
          reader.onload = function (e) {
            if (typeof mammoth === 'undefined') {
              alert('Word 解析库未加载，请检查网络后刷新页面重试。');
              return;
            }
            mammoth.extractRawText({ arrayBuffer: e.target.result })
              .then(function (result) {
                refFileContent = (result.value || '').trim();
                refFileName.textContent = '📄 ' + file.name + '（' + refFileContent.length + ' 字）';
                btnUploadRef.textContent = '📎 重新上传';
              })
              .catch(function (err) {
                console.error('Word 解析失败:', err);
                alert('Word 文件解析失败：' + err.message);
              });
          };
          reader.readAsArrayBuffer(file);
        } else {
          var reader = new FileReader();
          reader.onload = function (e) {
            refFileContent = e.target.result || '';
            refFileName.textContent = '📄 ' + file.name + '（' + refFileContent.length + ' 字）';
            btnUploadRef.textContent = '📎 重新上传';
          };
          reader.readAsText(file, 'utf-8');
        }
      });

      // ── 检查逻辑 ────────────────────────────────────────────────────────
      var btnCheck = document.getElementById('btn-check-logic');
      btnCheck.addEventListener('click', async function () {
        if (!entries.length && !refFileContent) {
          alert('没有转录内容，无法分析。');
          return;
        }

        // 组装发送给模型的文本
        var transcriptText = entries.map(function (e) {
          return (e.speaker || '未知') + '：' + (e.text || '');
        }).join('\n');

        var combinedText = '';
        if (transcriptText) {
          combinedText += '【对话转录内容】\n' + transcriptText;
        }
        if (refFileContent) {
          combinedText += '\n\n【参考材料（用于核对一致性）】\n' + refFileContent;
        }

        btnCheck.disabled = true;
        btnCheck.textContent = '⏳ 模型加载中…';
        var panel = document.getElementById('logic-result-panel');
        var verdictMap = { '可信': '#27ae60', '存疑': '#e67e22', '高度可疑': '#e74c3c', '无法判断': '#888', '无数据': '#888', '错误': '#e74c3c' };
        var badge = document.getElementById('logic-verdict-badge');
        var issuesList = document.getElementById('logic-issues-list');
        var fullText = document.getElementById('logic-full-text');
        var thinkText = '';
        var streamedText = '';

        if (panel) { panel.style.display = 'block'; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        if (badge) { badge.textContent = ''; badge.style.background = ''; }
        if (issuesList) { issuesList.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">⏳ 模型加载中，请稍候…</p>'; }
        if (fullText) { fullText.innerHTML = ''; }

        function buildStreamDom() {
          var html = '';
          if (thinkText) {
            html += '<details class="thinking-block" open><summary class="thinking-summary">🧠 思考过程</summary>'
              + '<div class="thinking-content">' + escHtml(thinkText).replace(/\n/g, '<br>') + '<span class="streaming-cursor">|</span></div></details>';
          }
          if (streamedText) {
            html += '<div class="logic-analysis-content" style="line-height:1.8;font-size:13px;">'
              + renderStreamHtml(streamedText) + '<span class="streaming-cursor">|</span></div>';
          }
          return html;
        }

        try {
          await semanticAnalyzeStream(combinedText, {
            onLoading: function () {
              if (issuesList) issuesList.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">⏳ 连接成功，正在加载模型到 GPU（约20秒）…</p>';
            },
            onThinkingStart: function () {
              btnCheck.textContent = '🧠 模型思考中…';
            },
            onThinkingToken: function (text) {
              thinkText += text;
              if (issuesList) issuesList.innerHTML = buildStreamDom();
              var thinkEl = issuesList && issuesList.querySelector('.thinking-content');
              if (thinkEl) thinkEl.scrollTop = thinkEl.scrollHeight;
            },
            onThinkingEnd: function () {
              btnCheck.textContent = '✍️ 正在输出…';
              if (issuesList && thinkText) {
                var details = issuesList.querySelector('.thinking-block');
                if (details) details.removeAttribute('open');
              }
            },
            onToken: function (text) {
              streamedText += text;
              if (issuesList) {
                var thinkHtml = '';
                if (thinkText) {
                  thinkHtml = '<details class="thinking-block"><summary class="thinking-summary">🧠 思考过程</summary>'
                    + '<div class="thinking-content">' + escHtml(thinkText).replace(/\n/g, '<br>') + '</div></details>';
                }
                issuesList.innerHTML = thinkHtml
                  + '<div class="logic-analysis-content" style="line-height:1.8;font-size:13px;">'
                  + renderStreamHtml(streamedText) + '<span class="streaming-cursor">|</span></div>';
              }
            },
            onDone: function (verdict) {
              var thinkHtml = '';
              if (thinkText) {
                thinkHtml = '<details class="thinking-block"><summary class="thinking-summary">🧠 思考过程</summary>'
                  + '<div class="thinking-content">' + escHtml(thinkText).replace(/\n/g, '<br>') + '</div></details>';
              }
              if (issuesList && streamedText) {
                issuesList.innerHTML = thinkHtml
                  + '<div class="logic-analysis-content" style="line-height:1.8;font-size:13px;">'
                  + renderStreamHtml(streamedText) + '</div>';
              } else if (issuesList) {
                issuesList.innerHTML = thinkHtml + '<p class="logic-no-issues">✅ 未发现明显逻辑问题或矛盾。</p>';
              }
              if (badge) {
                badge.textContent = verdict || '未知';
                badge.style.background = (verdictMap[verdict] || '#666') + '22';
                badge.style.color = verdictMap[verdict] || '#666';
              }
              btnCheck.disabled = false;
              btnCheck.textContent = '🔍 检查逻辑';
            },
            onError: function (err) {
              alert('逻辑检查失败：' + (err.message || err));
              btnCheck.disabled = false;
              btnCheck.textContent = '🔍 检查逻辑';
            },
          });
        } catch (err) {
          alert('逻辑检查失败：' + (err.message || err));
          btnCheck.disabled = false;
          btnCheck.textContent = '🔍 检查逻辑';
        }
      });

      function escHtml(s) {
        return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }

    } catch (e) {
      render('<p class="status-fail">加载失败: ' + e.message + '</p><a href="#/history">返回</a>');
    }
  }

  function route() {
    _navEpoch++;  // 每次路由切换均递增，令旧页面的挂起异步回调失效
    const { path, id } = parseHash();
    if (path === 'home') pageHome();
    else if (path === 'device') pageDevice();
    else if (path === 'session') pageSession();
    else if (path === 'session-video-setup') pageSessionVideoSetup();
    else if (path === 'session-video') pageSession({ isVideoFile: true });
    else if (path === 'voice') pageVoiceSetup();
    else if (path === 'voice-detail') pageVoiceDetail();
    else if (path === 'wechat-voice') pageWechatVoice();
    else if (path === 'report') pageReport(id);
    else if (path === 'settings') pageSettings();
    else if (path === 'history') pageHistory();
    else if (path === 'detail') pageDetail(id);
    else pageHome();
  }

  window.addEventListener('hashchange', route);
  route();
})();
