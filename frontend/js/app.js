/**
 * 测谎系统 - 前端路由与页面
 * Hash 路由: #/ #/session #/report/:id #/settings #/history
 */

(function () {
  const root = document.getElementById('app');
  if (!root) return;

  function nav() {
    const base = window.location.href.split('#')[0];
    return `
      <nav class="nav">
        <a class="brand" href="${base}#/">测谎系统</a>
        <a href="${base}#/">设备检测</a>
        <a href="${base}#/history">历史</a>
        <a href="${base}#/settings">设置</a>
      </nav>`;
  }

  // 导航守卫：每次路由切换时递增，用于取消旧页面的挂起异步操作
  let _navEpoch = 0;

  function render(html) {
    root.innerHTML = nav() + '<div id="page">' + html + '</div>';
  }

  function parseHash() {
    const h = (window.location.hash || '#/').slice(1);
    const [path, id] = h.split('/').filter(Boolean);
    return { path: path || 'device', id: id || null };
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
        window.location.hash = 'session';
      } catch (e) {
        errEl.textContent = '创建失败: ' + (e.message || e);
        confirmBtn.disabled = false;
        confirmBtn.textContent = '创建并开始';
      }
    });

    // 自动聚焦名称框
    setTimeout(function () { overlay.querySelector('#task-name-input').focus(); }, 50);
  }

  // ---------- 会话页 ----------
  function pageSession() {
    const sessionId = sessionStorage.getItem('cehuang_session_id');
    const videoId = sessionStorage.getItem('cehuang_video_id') || '';
    const audioId = sessionStorage.getItem('cehuang_audio_id') || '';
    if (!sessionId) {
      window.location.hash = '';
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
    let lastAudioB64 = null;
    // rPPG 绿色通道缓冲（10fps 采样，随 WS 消息携带后清空）
    let greenBuffer = [];
    // 全程视频录制（结束时上传）
    let _fullRecorder = null;
    let _fullChunks = [];
    // 转录条目缓存（{speaker, text, ts}）
    let _transcriptEntries = [];
    let result = { lie_probability: 0, dimensions: { expression: 0, heart_rate: 0, tone: 0, semantic: 0 }, semantic_summary: '' };
    let closeWS = null;

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
      root.innerHTML = nav() + `
        <div id="page">
          <h1 class="page-title" id="session-title">测谎会话 <span style="color:var(--text-muted);font-size:14px;">${sessionId.slice(0,8)}</span></h1>
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
            <div class="card session-video-card">
              <div class="video-wrapper">
                <span class="live-badge">LIVE</span>
                <video id="session-video" autoplay playsinline muted style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;"></video>
                <canvas id="session-canvas" style="display:none;position:absolute;left:0;top:0;width:100%;height:100%;"></canvas>
                <div id="cam-debug" style="position:absolute;bottom:4px;left:4px;right:4px;font-size:10px;color:#aaa;background:rgba(0,0,0,.5);padding:2px 4px;border-radius:2px;z-index:3;display:none;"></div>
              </div>
              <p class="session-cam-prompt" id="cam-prompt">若无画面请点击 <button type="button" class="btn btn-primary" id="session-enable-cam">启用摄像头</button></p>
            </div>
            <div class="dashboard">
              <div class="gauge-wrap">
                <div class="gauge-value">${p.toFixed(0)}%</div>
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
                <span class="label">语调</span>
                <div class="value dim-label" style="color:${toneLabel(d.tone||0).color}">${toneLabel(d.tone||0).text}</div>
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
      document.getElementById('session-enable-cam').onclick = tryStartStream;
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

          // UI 状态：加载中
          btnSemantic.disabled = true;
          btnSemantic.textContent = '⏳ 分析中…（首次需下载模型，约3GB）';
          var panel = document.getElementById('semantic-result-panel');
          if (panel) panel.style.display = 'none';

          try {
            var res = await semanticAnalyze(fullText);
            // 展示结果
            var verdictEl = document.getElementById('semantic-verdict');
            var issuesEl = document.getElementById('semantic-issues');
            var fullTextEl = document.getElementById('semantic-full-text');

            var verdictColor = { '可信': '#27ae60', '存疑': '#e67e22', '高度可疑': '#e74c3c', '无法判断': '#888', '无数据': '#888' };
            if (verdictEl) {
              verdictEl.textContent = res.verdict || '未知';
              verdictEl.style.color = verdictColor[res.verdict] || '#666';
            }

            if (issuesEl) {
              if (res.issues && res.issues.length) {
                issuesEl.innerHTML = '<ul class="semantic-issue-list">' +
                  res.issues.map(function(i) { return '<li>' + i + '</li>'; }).join('') +
                  '</ul>';
              } else {
                issuesEl.innerHTML = '<p class="semantic-no-issues">未发现明显逻辑问题。</p>';
              }
            }

            if (fullTextEl) {
              fullTextEl.innerHTML = '<details><summary>查看完整分析</summary><pre class="semantic-raw">'
                + (res.analysis || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                + '</pre></details>';
            }

            if (panel) panel.style.display = 'block';
            // 滚动到结果
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (err) {
            alert('语义分析失败: ' + (err.message || err));
          } finally {
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
      function startWithStream(s) {
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

        // 1.5 秒后若 <video> 仍无画面，启用 ImageCapture 轨道直接抓帧路径
        setTimeout(function () {
          if (v.videoWidth > 0 && v.readyState >= 2) {
            setDebug('');
            return;
          }
          setDebug('video 无帧，切换 ImageCapture 模式…');
          tryImageCapture(s, v);
        }, 1500);

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
                lastAudioB64 = btoa(bin);
                console.log('[STT] audio base64 就绪，长度:', lastAudioB64.length);
              };
              r.readAsArrayBuffer(blob);
            };
            mr.start();
            mediaRecorder = mr;
            // 2s 后停止（触发 onstop），再立刻开下一个
            setTimeout(() => {
              if (mr.state !== 'inactive') mr.stop();
              _startNextRecorder();
            }, 2000);
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

      showWsStatus(false, '实时连接：未连接（若无法连接请在本机安装 websockets：pip install websockets，并重启后端）');
      if (window.__cehuang_pending_stream) {
        var s = window.__cehuang_pending_stream;
        window.__cehuang_pending_stream = null;
        startWithStream(s);
      } else {
        tryStartStream();
      }

      function startWS() {
        // 注意：音频收集已由 _startNextRecorder 内部的 onstop 回调接管，不再需要额外 setInterval
        closeWS = connectWS(
          sessionId,
          () => lastFrameB64,
          // 消费式取值：取完后置 null，避免同一段音频重复发送
          () => { const a = lastAudioB64; lastAudioB64 = null; return a; },
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
            }
            const d2 = data.dimensions || {};
            function setDimEl(id, info) {
              const el = document.getElementById(id);
              if (!el) return;
              const v = el.querySelector('.dim-label');
              if (v) { v.textContent = info.text; v.style.color = info.color; }
            }
            setDimEl('m-expr',     exprLabel(d2.expression || 0));
            setDimEl('m-tone',     toneLabel(d2.tone || 0));
            // m-semantic 现在是按钮，不再有 .dim-label，无需更新
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

      // 3. 停止摄像头流
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }

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
      const [meta, transcriptData, outlineData] = await Promise.all([
        getSessionMeta(sessionId).catch(() => null),
        getTranscript(sessionId).catch(() => null),
        getOutline(sessionId).catch(() => null),
      ]);
      const m = meta || {};
      const entries = (transcriptData && transcriptData.entries) || [];
      const outline = outlineData || null;
      const videoUrl = m.has_video ? getVideoUrl(sessionId) : null;

      const SPEAKER_COLORS_D = ['#4a9eff', '#2ecc71', '#f39c12', '#e91e63', '#9b59b6', '#1abc9c'];
      const colorMap = {};
      let colorIdx = 0;
      function spColor(sp) {
        if (!colorMap[sp]) { colorMap[sp] = SPEAKER_COLORS_D[colorIdx++ % SPEAKER_COLORS_D.length]; }
        return colorMap[sp];
      }

      const transcriptHtml = entries.length
        ? entries.map(function (e) {
            var c = spColor(e.speaker || '未知');
            var ts = (e.ts || '').slice(11, 19);
            return '<div class="transcript-entry">'
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
          <div class="card" style="margin-bottom:16px;">
            <h2 style="margin-bottom:12px;">🎬 录制视频</h2>
            <video class="detail-video" controls src="${videoUrl}" style="width:100%;max-height:480px;border-radius:8px;background:#000;"></video>
          </div>` : ''}
          <div class="card transcript-panel" style="margin-bottom:16px;">
            <div class="transcript-header">
              <span class="transcript-title">📝 语音转文字记录</span>
              <span class="transcript-hint">${entries.length} 条</span>
            </div>
            <div class="transcript-body" style="max-height:400px;">${transcriptHtml}</div>
          </div>
        </div>
      `;

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
    } catch (e) {
      render('<p class="status-fail">加载失败: ' + e.message + '</p><a href="#/history">返回</a>');
    }
  }

  function route() {
    _navEpoch++;  // 每次路由切换均递增，令旧页面的挂起异步回调失效
    const { path, id } = parseHash();
    if (path === 'device' || path === '') pageDevice();
    else if (path === 'session') pageSession();
    else if (path === 'report') pageReport(id);
    else if (path === 'settings') pageSettings();
    else if (path === 'history') pageHistory();
    else if (path === 'detail') pageDetail(id);
    else pageDevice();
  }

  window.addEventListener('hashchange', route);
  route();
})();
