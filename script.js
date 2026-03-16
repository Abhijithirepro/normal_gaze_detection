// ═══════════════════════════════════════════════════════════
//  DOM References
// ═══════════════════════════════════════════════════════════
const videoElement       = document.getElementById('input_video');
const canvasElement      = document.getElementById('output_canvas');
const canvasCtx          = canvasElement.getContext('2d');
const fileInput          = document.getElementById('video_upload');
const timelineElement    = document.getElementById('timeline');
const timelineCount      = document.getElementById('timeline_count');
const statusOverlay      = document.getElementById('status_overlay');
const loadingOverlay     = document.getElementById('loading_overlay');
const activeEventBanner  = document.getElementById('active_event_banner');
const controlsCard       = document.getElementById('controls_card');
const uploadSection      = document.getElementById('upload_section');

// Video controls
const btnStart       = document.getElementById('btn_start');
const btnStop        = document.getElementById('btn_stop');
const seekBar        = document.getElementById('seek_bar');
const timeCurrentEle = document.getElementById('time_current');
const timeTotalEle   = document.getElementById('time_total');
const speedSelect    = document.getElementById('speed_select');
const videoControls  = document.getElementById('video_controls');

// Webcam controls
const btnModeVideo    = document.getElementById('btn_mode_video');
const btnModeWebcam   = document.getElementById('btn_mode_webcam');
const webcamControls  = document.getElementById('webcam_controls');
const btnStartWebcam  = document.getElementById('btn_start_webcam');
const btnStopWebcam   = document.getElementById('btn_stop_webcam');

// ═══════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════
let mode         = 'video';   // 'video' | 'webcam'
let isProcessing = false;
let webcamStream = null;

// Per-frame counters
let stats = { total: 0, center: 0, left: 0, right: 0, down: 0, missed: 0 };

// Event-based tracking (a single "look-away" that may span many frames)
let gazeEvents  = [];         // Completed events: { direction, startTime, endTime, duration }
let activeEvent = null;       // Currently open event: { direction, startTime }

// Gaze smoothing — require GAZE_CONFIRM_FRAMES consecutive frames before accepting a change
const GAZE_CONFIRM_FRAMES = 4;
let candidateGaze  = null;
let candidateCount = 0;
let confirmedGaze  = null;

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════
function formatTime(s) {
    if (isNaN(s) || s < 0) return '00:00';
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatDuration(s) {
    if (s < 1) return `${Math.round(s * 1000)} ms`;
    return `${s.toFixed(1)} s`;
}

function getCurrentTime() {
    return videoElement.currentTime;
}

// ═══════════════════════════════════════════════════════════
//  Mode Toggle
// ═══════════════════════════════════════════════════════════
btnModeVideo.addEventListener('click', () => {
    if (mode === 'video') return;
    stopWebcam();
    mode = 'video';
    btnModeVideo.classList.add('active');
    btnModeWebcam.classList.remove('active');

    uploadSection.style.display    = '';
    videoControls.style.display    = '';
    webcamControls.style.display   = 'none';
    controlsCard.style.display     = 'none';

    statusOverlay.style.display    = 'block';
    statusOverlay.innerText        = 'Upload a video to begin';
    statusOverlay.className        = 'status-overlay';
    resetAll();
});

btnModeWebcam.addEventListener('click', () => {
    if (mode === 'webcam') return;
    mode = 'webcam';
    btnModeWebcam.classList.add('active');
    btnModeVideo.classList.remove('active');

    uploadSection.style.display    = 'none';
    videoControls.style.display    = 'none';
    webcamControls.style.display   = '';
    controlsCard.style.display     = 'flex';

    statusOverlay.style.display    = 'block';
    statusOverlay.innerText        = 'Click "Start Camera" to begin';
    statusOverlay.className        = 'status-overlay';
    resetAll();
});

// ═══════════════════════════════════════════════════════════
//  Webcam
// ═══════════════════════════════════════════════════════════
btnStartWebcam.addEventListener('click', async () => {
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
        });
        videoElement.srcObject = webcamStream;
        await videoElement.play();

        btnStartWebcam.disabled = true;
        btnStopWebcam.disabled  = false;

        statusOverlay.style.display = 'block';
        statusOverlay.innerText     = '🎥 Camera Active — Analysing…';
        statusOverlay.className     = 'status-overlay';

        resetAll();
        isProcessing = true;
        processFrames();
    } catch (err) {
        statusOverlay.style.display = 'block';
        statusOverlay.innerText     = '❌ Camera error: ' + err.message;
        statusOverlay.className     = 'status-overlay suspicious';
    }
});

btnStopWebcam.addEventListener('click', () => {
    isProcessing = false;
    stopWebcam();
    finalizeActiveEvent();
    renderTimeline();

    statusOverlay.style.display = 'block';
    statusOverlay.innerText     = '⏹ Stopped — See timeline for results';
    statusOverlay.className     = 'status-overlay';
});

function stopWebcam() {
    isProcessing = false;
    if (webcamStream) {
        webcamStream.getTracks().forEach(t => t.stop());
        webcamStream = null;
    }
    if (videoElement.srcObject) videoElement.srcObject = null;
    btnStartWebcam.disabled = false;
    btnStopWebcam.disabled  = true;
    activeEventBanner.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
//  Video Upload
// ═══════════════════════════════════════════════════════════
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    resetAll();
    btnStart.disabled = true;
    btnStop.disabled  = true;
    controlsCard.style.display = 'none';

    statusOverlay.style.display = 'block';
    statusOverlay.innerText     = 'Loading video…';
    statusOverlay.className     = 'status-overlay';
    loadingOverlay.classList.add('active');

    videoElement.src = URL.createObjectURL(file);
});

videoElement.addEventListener('loadeddata', () => {
    if (mode !== 'video') return;
    loadingOverlay.classList.remove('active');

    statusOverlay.innerText = '✅ Ready — Press Start Analysis';
    statusOverlay.className = 'status-overlay';

    controlsCard.style.display = 'flex';
    btnStart.disabled = false;
    btnStop.disabled  = true;

    seekBar.max = videoElement.duration;
    seekBar.value = 0;
    timeTotalEle.innerText    = formatTime(videoElement.duration);
    timeCurrentEle.innerText  = formatTime(0);
});

btnStart.addEventListener('click', () => {
    videoElement.play();
    btnStart.disabled = true;
    btnStop.disabled  = false;
});

btnStop.addEventListener('click', () => {
    videoElement.pause();
    isProcessing  = false;
    btnStart.disabled = false;
    btnStop.disabled  = true;
    finalizeActiveEvent();
    renderTimeline();

    statusOverlay.innerText = '⏹ Stopped — See timeline for results';
    statusOverlay.className = 'status-overlay';
});

videoElement.addEventListener('play', () => {
    if (mode === 'video' && !isProcessing) {
        isProcessing = true;
        processFrames();
    }
});

videoElement.addEventListener('pause', () => {
    if (mode === 'video') isProcessing = false;
});

videoElement.addEventListener('ended', () => {
    if (mode !== 'video') return;
    isProcessing = false;
    btnStart.disabled = false;
    btnStop.disabled  = true;
    finalizeActiveEvent();
    renderTimeline();

    statusOverlay.innerText = '✅ Analysis Complete';
    statusOverlay.className = 'status-overlay';
    activeEventBanner.style.display = 'none';
});

videoElement.addEventListener('timeupdate', () => {
    if (mode !== 'video') return;
    if (!seekBar.max || seekBar.max == 0) seekBar.max = videoElement.duration;
    seekBar.value            = videoElement.currentTime;
    timeCurrentEle.innerText = formatTime(videoElement.currentTime);
});

seekBar.addEventListener('input', () => {
    videoElement.currentTime = parseFloat(seekBar.value);
});

speedSelect.addEventListener('change', () => {
    videoElement.playbackRate = parseFloat(speedSelect.value);
});

// ═══════════════════════════════════════════════════════════
//  MediaPipe FaceMesh
// ═══════════════════════════════════════════════════════════
const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});

faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

faceMesh.onResults(onFaceMeshResults);

// ═══════════════════════════════════════════════════════════
//  Frame Processing Loop
// ═══════════════════════════════════════════════════════════
async function processFrames() {
    if (!isProcessing) return;

    if (mode === 'video' && (videoElement.paused || videoElement.ended)) return;

    if (videoElement.videoWidth > 0 && canvasElement.width !== videoElement.videoWidth) {
        canvasElement.width  = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    }

    if (videoElement.readyState >= 2) {
        try {
            await faceMesh.send({ image: videoElement });
        } catch (e) {
            console.warn('Frame skip:', e.message);
        }
    }

    if ('requestVideoFrameCallback' in videoElement && mode === 'video') {
        videoElement.requestVideoFrameCallback(processFrames);
    } else {
        requestAnimationFrame(processFrames);
    }
}

// ═══════════════════════════════════════════════════════════
//  Gaze Detection Math — Two-signal approach
//    Signal 1: Head yaw (face rotation via nose-to-face-edge ratio)
//    Signal 2: Iris position (eye glance within the eye socket)
//  Either signal alone can trigger left/right detection.
// ═══════════════════════════════════════════════════════════

function pointDist(p1, p2, w, h) {
    const dx = (p1.x - p2.x) * w;
    const dy = (p1.y - p2.y) * h;
    return Math.sqrt(dx * dx + dy * dy);
}

function avgDist(center, indices, lm, w, h) {
    let sum = 0;
    for (const i of indices) sum += pointDist(center, lm[i], w, h);
    return sum / indices.length;
}

// ── Signal 1: Head Pose (yaw) ───────────────────────────
// Uses the nose tip relative to the left/right face edges.
// noseTip = landmark 1, leftEdge = 234, rightEdge = 454
// Ratio = distToLeft / (distToLeft + distToRight)
//   ~0.50 = facing camera,  <0.38 = turned right,  >0.62 = turned left
const HEAD_YAW_LEFT_THRESH  = 0.60;
const HEAD_YAW_RIGHT_THRESH = 0.40;

function detectHeadYaw(lm, w, h) {
    const nose      = lm[1];
    const leftEdge  = lm[234];
    const rightEdge = lm[454];

    const dL = pointDist(nose, leftEdge,  w, h);
    const dR = pointDist(nose, rightEdge, w, h);
    const total = dL + dR;
    if (total < 1) return 'center';

    const ratio = dL / total;

    if (ratio > HEAD_YAW_LEFT_THRESH)  return 'lookingLeft';
    if (ratio < HEAD_YAW_RIGHT_THRESH) return 'lookingRight';
    return 'center';
}

// ── Signal 2: Iris Position (eye glance) ────────────────
const IRIS_THRESHOLD = 4;   // pixel delta

function detectIrisGaze(lm, w, h) {
    const leftIris  = lm[468];
    const rightIris = lm[473];

    const leftInner  = [133, 173, 154, 155];
    const leftOuter  = [33,  7,   161, 246];
    const rightInner = [263, 249, 466, 388];
    const rightOuter = [382, 362, 398, 381];

    const leftDelta  = avgDist(leftIris,  leftOuter,  lm, w, h) - avgDist(leftIris,  leftInner,  lm, w, h);
    const rightDelta = avgDist(rightIris, rightOuter, lm, w, h) - avgDist(rightIris, rightInner, lm, w, h);

    if (leftDelta > IRIS_THRESHOLD && rightDelta > IRIS_THRESHOLD) return 'lookingLeft';
    if (leftDelta < -IRIS_THRESHOLD && rightDelta < -IRIS_THRESHOLD) return 'lookingRight';
    return 'center';
}

// ── Combined: head-turn OR eye-glance triggers detection ──
function detectGaze(lm, w, h) {
    const headResult = detectHeadYaw(lm, w, h);
    const irisResult = detectIrisGaze(lm, w, h);

    // If head is turned, that's the strongest signal — use it
    if (headResult !== 'center') return headResult;
    // Otherwise fall back to iris-only glance
    return irisResult;
}

// ── Eye Aspect Ratio (closed / looking down) ────────────
function detectEyeStatus(lm) {
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function ear(idxs) {
        const h = dist(lm[idxs[0]], lm[idxs[1]]);
        const v = dist(lm[idxs[2]], lm[idxs[3]]);
        return h > 0 ? v / h : 1;
    }
    const avgEAR = (ear([33, 133, 159, 145]) + ear([362, 263, 386, 374])) / 2;
    return avgEAR < 0.25 ? 'lookingDown' : 'center';
}

// ═══════════════════════════════════════════════════════════
//  FaceMesh Callback
// ═══════════════════════════════════════════════════════════
function onFaceMeshResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    stats.total++;

    let rawGaze = 'missedFrames';

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const lm = results.multiFaceLandmarks[0];

        // Draw eye / iris mesh
        if (window.drawConnectors) {
            drawConnectors(canvasCtx, lm, FACEMESH_LEFT_EYE,   { color: 'rgba(0,240,255,0.7)', lineWidth: 1 });
            drawConnectors(canvasCtx, lm, FACEMESH_RIGHT_EYE,  { color: 'rgba(0,240,255,0.7)', lineWidth: 1 });
            drawConnectors(canvasCtx, lm, FACEMESH_LEFT_IRIS,  { color: 'rgba(255,0,255,0.9)', lineWidth: 1.5 });
            drawConnectors(canvasCtx, lm, FACEMESH_RIGHT_IRIS, { color: 'rgba(255,0,255,0.9)', lineWidth: 1.5 });
        }

        const headSignal = detectHeadYaw(lm, canvasElement.width, canvasElement.height);
        const irisSignal = detectIrisGaze(lm, canvasElement.width, canvasElement.height);
        rawGaze = detectGaze(lm, canvasElement.width, canvasElement.height);
        if (rawGaze === 'center') {
            rawGaze = detectEyeStatus(lm);
        }

        drawDebugSignals(headSignal, irisSignal);
    }

    // Frame count
    switch (rawGaze) {
        case 'lookingLeft':  stats.left++;   break;
        case 'lookingRight': stats.right++;  break;
        case 'lookingDown':  stats.down++;   break;
        case 'missedFrames': stats.missed++; break;
        default:             stats.center++; break;
    }

    // ── Gaze smoothing ──────────────────────────────────────
    if (rawGaze === candidateGaze) {
        candidateCount++;
    } else {
        candidateGaze  = rawGaze;
        candidateCount = 1;
    }

    if (candidateCount >= GAZE_CONFIRM_FRAMES && rawGaze !== confirmedGaze) {
        handleGazeTransition(confirmedGaze, rawGaze, getCurrentTime());
        confirmedGaze = rawGaze;
    }

    updateStatsUI();
    drawCanvasOverlay(rawGaze);
    updateStatusOverlay(rawGaze);
    canvasCtx.restore();
}

// ═══════════════════════════════════════════════════════════
//  Gaze Event Lifecycle
// ═══════════════════════════════════════════════════════════
const OFF_SCREEN = new Set(['lookingLeft', 'lookingRight']);

function handleGazeTransition(oldGaze, newGaze, t) {
    const wasOff = OFF_SCREEN.has(oldGaze);
    const isOff  = OFF_SCREEN.has(newGaze);

    if (wasOff) finalizeActiveEvent(t);   // always close whatever was open

    if (isOff) {
        activeEvent = { direction: newGaze, startTime: t };
    }
}

function finalizeActiveEvent(endTime = null) {
    if (!activeEvent) return;
    const t        = endTime !== null ? endTime : getCurrentTime();
    const duration = Math.max(0, t - activeEvent.startTime);

    if (duration >= 0.1) {   // ignore sub-100 ms noise
        gazeEvents.push({ direction: activeEvent.direction, startTime: activeEvent.startTime, endTime: t, duration });
        renderTimeline();
        updateSummaryStats();
    }
    activeEvent = null;
    activeEventBanner.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
//  Canvas Overlay — direction banner drawn on video frame
// ═══════════════════════════════════════════════════════════
function drawCanvasOverlay(gaze) {
    if (gaze !== 'lookingLeft' && gaze !== 'lookingRight') return;

    const w = canvasElement.width;
    const h = canvasElement.height;
    const isLeft = gaze === 'lookingLeft';
    const color  = isLeft ? '#fbbf24' : '#f97316';   // amber | orange

    // Tinted top strip
    const stripH = Math.max(60, h * 0.13);
    const gradient = canvasCtx.createLinearGradient(0, 0, 0, stripH);
    gradient.addColorStop(0, isLeft ? 'rgba(251,191,36,0.35)' : 'rgba(249,115,22,0.35)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    canvasCtx.fillStyle = gradient;
    canvasCtx.fillRect(0, 0, w, stripH);

    // Direction text
    const fontSize = Math.max(20, Math.floor(stripH * 0.52));
    canvasCtx.font         = `bold ${fontSize}px Inter, sans-serif`;
    canvasCtx.fillStyle    = color;
    canvasCtx.textAlign    = 'center';
    canvasCtx.textBaseline = 'middle';
    canvasCtx.shadowColor  = 'rgba(0,0,0,0.8)';
    canvasCtx.shadowBlur   = 6;
    canvasCtx.fillText(isLeft ? '← LOOKING LEFT' : 'LOOKING RIGHT →', w / 2, stripH / 2);
    canvasCtx.shadowBlur   = 0;
}

// ═══════════════════════════════════════════════════════════
//  Debug: show which signal is firing (bottom-left of canvas)
// ═══════════════════════════════════════════════════════════
function drawDebugSignals(head, iris) {
    const w = canvasElement.width;
    const h = canvasElement.height;
    const y = h - 14;
    const fs = Math.max(13, Math.floor(h * 0.028));

    canvasCtx.font         = `600 ${fs}px Inter, monospace`;
    canvasCtx.textAlign    = 'left';
    canvasCtx.textBaseline = 'bottom';
    canvasCtx.shadowColor  = 'rgba(0,0,0,0.9)';
    canvasCtx.shadowBlur   = 4;

    const headColor = head !== 'center' ? '#ff5555' : '#66ffaa';
    const irisColor = iris !== 'center' ? '#ff5555' : '#66ffaa';

    canvasCtx.fillStyle = headColor;
    canvasCtx.fillText(`HEAD: ${head}`, 10, y - fs - 4);

    canvasCtx.fillStyle = irisColor;
    canvasCtx.fillText(`IRIS: ${iris}`, 10, y);

    canvasCtx.shadowBlur = 0;
}

// ═══════════════════════════════════════════════════════════
//  Status Overlay & Active-Event Banner
// ═══════════════════════════════════════════════════════════
function updateStatusOverlay(gaze) {
    let text, cls;
    switch (gaze) {
        case 'lookingLeft':
            text = '⬅ Looking LEFT';
            cls  = 'status-overlay suspicious left-gaze';
            showActiveEventBanner('left');
            break;
        case 'lookingRight':
            text = 'Looking RIGHT ➡';
            cls  = 'status-overlay suspicious right-gaze';
            showActiveEventBanner('right');
            break;
        case 'lookingDown':
            text = '👇 Eyes Down / Closed';
            cls  = 'status-overlay warning';
            activeEventBanner.style.display = 'none';
            break;
        case 'missedFrames':
            text = '❌ No Face Detected';
            cls  = 'status-overlay warning';
            activeEventBanner.style.display = 'none';
            break;
        default:
            text = '✅ Looking at Screen';
            cls  = 'status-overlay';
            activeEventBanner.style.display = 'none';
    }
    statusOverlay.innerText   = text;
    statusOverlay.className   = cls;
    statusOverlay.style.display = 'block';
}

function showActiveEventBanner(dir) {
    activeEventBanner.style.display = 'flex';
    activeEventBanner.className     = `active-event-banner banner-${dir}`;
    if (activeEvent) {
        const elapsed = getCurrentTime() - activeEvent.startTime;
        activeEventBanner.innerText = dir === 'left'
            ? `← Looking LEFT   ${formatDuration(elapsed)}`
            : `Looking RIGHT →   ${formatDuration(elapsed)}`;
    }
}

// ═══════════════════════════════════════════════════════════
//  Stats UI
// ═══════════════════════════════════════════════════════════
function updateStatsUI() {
    document.getElementById('val_total').innerText  = stats.total;
    document.getElementById('val_center').innerText = stats.center;
    document.getElementById('val_down').innerText   = stats.down;
    document.getElementById('val_missed').innerText = stats.missed;
    updateSummaryStats();
}

function updateSummaryStats() {
    const leftCompleted  = gazeEvents.filter(e => e.direction === 'lookingLeft');
    const rightCompleted = gazeEvents.filter(e => e.direction === 'lookingRight');

    // Add active event to count if ongoing
    const activeLeft  = (activeEvent?.direction === 'lookingLeft')  ? 1 : 0;
    const activeRight = (activeEvent?.direction === 'lookingRight') ? 1 : 0;

    const leftCount  = leftCompleted.length  + activeLeft;
    const rightCount = rightCompleted.length + activeRight;

    const leftTotalS  = leftCompleted.reduce((s, e) => s + e.duration, 0);
    const rightTotalS = rightCompleted.reduce((s, e) => s + e.duration, 0);

    document.getElementById('val_left_events').innerText  = leftCount;
    document.getElementById('val_right_events').innerText = rightCount;
    document.getElementById('val_left_time').innerText    = leftCount  > 0 ? `${leftCount} time${leftCount  !== 1 ? 's' : ''} · ${formatDuration(leftTotalS)}` : '0 times';
    document.getElementById('val_right_time').innerText   = rightCount > 0 ? `${rightCount} time${rightCount !== 1 ? 's' : ''} · ${formatDuration(rightTotalS)}` : '0 times';
}

// ═══════════════════════════════════════════════════════════
//  Timeline Render
// ═══════════════════════════════════════════════════════════
function renderTimeline() {
    const total = gazeEvents.length;
    timelineCount.innerText = `${total} event${total !== 1 ? 's' : ''}`;

    if (total === 0) {
        timelineElement.innerHTML = '<div class="empty-state" id="timeline_placeholder">No off-screen gaze events recorded yet.</div>';
        return;
    }

    timelineElement.innerHTML = '';

    // Show newest first so latest events are easy to see
    [...gazeEvents].reverse().forEach((evt, idx) => {
        const isLeft   = evt.direction === 'lookingLeft';
        const div      = document.createElement('div');
        div.className  = `timeline-event ${isLeft ? 'event-left' : 'event-right'}`;

        const eventNum    = total - idx;
        const timeRange   = `${formatTime(evt.startTime)} → ${formatTime(evt.endTime)}`;
        const label       = isLeft ? '← Looked LEFT' : 'Looked RIGHT →';
        const durStr      = formatDuration(evt.duration);

        div.innerHTML = `
            <div class="event-header">
                <span class="event-badge">#${eventNum}</span>
                <span class="event-direction">${label}</span>
                <span class="event-duration">${durStr}</span>
            </div>
            <div class="event-time">${timeRange}</div>
        `;

        div.addEventListener('click', () => {
            if (mode === 'video') videoElement.currentTime = evt.startTime;
        });
        div.title = mode === 'video' ? 'Click to seek to this moment' : '';

        timelineElement.appendChild(div);
    });
}

// ═══════════════════════════════════════════════════════════
//  Reset
// ═══════════════════════════════════════════════════════════
function resetAll() {
    stats          = { total: 0, center: 0, left: 0, right: 0, down: 0, missed: 0 };
    gazeEvents     = [];
    activeEvent    = null;
    confirmedGaze  = null;
    candidateGaze  = null;
    candidateCount = 0;

    activeEventBanner.style.display = 'none';
    timelineElement.innerHTML = '<div class="empty-state" id="timeline_placeholder">Upload a video or start your webcam.<br>Left &amp; right gaze events will appear here.</div>';
    timelineCount.innerText = '0 events';

    updateStatsUI();
}

// Default to Live Webcam mode on load
btnModeWebcam.click();
