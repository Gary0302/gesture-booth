import {
  HandLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById("video");
const overlayCanvas = document.getElementById("overlayCanvas");
const overlayCtx = overlayCanvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const downloadBtn = document.getElementById("downloadBtn");
const gestureText = document.getElementById("gestureText");
const loadProgress = document.getElementById("loadProgress");
const countdownText = document.getElementById("countdown");

let handLandmarker;
let cameraStream = null;
let isCameraOn = false;
let isCapturing = false;
let photos = [null, null, null, null];
let detectTimestamp = 0;
let stableFrames = 0;

const detectCanvas = document.createElement("canvas");
const detectCtx = detectCanvas.getContext("2d");

const STABLE_FRAMES_REQUIRED = 10;
const FINGER_PAIRS = [
  [8, 6, 5],
  [12, 10, 9],
  [16, 14, 13],
  [20, 18, 17]
];
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

const filters = ["japaneseSoft", "vintage", "vivid", "blackWhite"];

const MODEL_PATH = new URL("./models/hand_landmarker.task", import.meta.url).href;
const WASM_PATH = new URL("./wasm", import.meta.url).href;
const LOAD_TIMEOUT_MS = 90000;

let landmarkerLoadPromise = null;
let openCvLoadPromise = null;

// iOS Safari: GPU delegate crashes with "null is not an object (evaluating 't.alpha')"
// because WebGL context attributes become null after context loss.
// Also skip background preload on iOS — WebGL init without a user gesture is unreliable.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// ── Status badge ──────────────────────────────────────────────────────────────

function setStatus(text, state = "default") {
  const badge = document.getElementById("status");
  const msg = document.getElementById("statusMsg");
  msg.textContent = text;
  badge.className = "status-badge" + (state !== "default" ? " " + state : "");
}

function setLoadProgress(text) {
  if (!text) {
    loadProgress.hidden = true;
    loadProgress.textContent = "";
    return;
  }
  loadProgress.hidden = false;
  loadProgress.textContent = text;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Button handlers ───────────────────────────────────────────────────────────

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    await setupCamera();
    setLoadProgress("相機已就緒，等待 AI 模型完成載入...");
    await preloadHandLandmarker();
    overlayCanvas.classList.add("active");
    gestureText.textContent = "目前手勢：搜尋手部中...";
    setLoadProgress("");
    setStatus("手勢辨識已就緒，比 1～4 根手指拍對應格子", "ready");
    detectLoop();
  } catch (error) {
    console.error(error);
    setStatus(`啟動失敗：${error.message || "請確認權限與網路"}`, "error");
    gestureText.textContent = "目前手勢：尚未偵測";
    setLoadProgress("");
    startBtn.disabled = false;
  }
});

resetBtn.addEventListener("click", () => {
  photos = [null, null, null, null];
  isCapturing = false;
  stableFrames = 0;
  clearHandOverlay();
  downloadBtn.disabled = true;
  document.querySelectorAll(".result-box").forEach((box, i) => {
    box.innerHTML = `<span class="num-tag">${i + 1}</span><span>待拍攝</span>`;
  });
  setStatus("已重新開始，比手勢拍攝對應格子", "active");
  gestureText.textContent = "目前手勢：尚未偵測";
});

// Delete a single slot via event delegation on the grid
document.getElementById("photoStrip").addEventListener("click", (e) => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  const box = btn.closest(".result-box");
  const slot = parseInt(box.dataset.index);
  photos[slot - 1] = null;
  box.innerHTML = `<span class="num-tag">${slot}</span><span>待拍攝</span>`;
  downloadBtn.disabled = true;
  setStatus(`第 ${slot} 格已刪除，比 ${slot} 根手指重新拍攝`, "active");
});

downloadBtn.addEventListener("click", () => {
  if (photos.some(p => p === null)) return;

  const photoW = 640, photoH = 480, gap = 18, padding = 24;
  const canvas = document.createElement("canvas");
  canvas.width = photoW * 2 + gap + padding * 2;
  canvas.height = photoH * 2 + gap + padding * 2 + 70;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  Promise.all(photos.map((src, i) => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = padding + col * (photoW + gap);
      const y = padding + row * (photoH + gap);
      ctx.drawImage(img, x, y, photoW, photoH);
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.fillRect(x + 12, y + 12, 80, 34);
      ctx.fillStyle = "#111";
      ctx.font = "bold 20px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`No.${i + 1}`, x + 24, y + 36);
      resolve();
    };
    img.src = src;
  }))).then(() => {
    ctx.fillStyle = "#111";
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText("AI Gesture Booth", canvas.width / 2, canvas.height - 30);
    const link = document.createElement("a");
    link.download = "gesture-four-cut.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
});

// ── Camera setup ──────────────────────────────────────────────────────────────

async function setupCamera() {
  if (isCameraOn) return;

  setStatus("正在開啟相機...", "loading");

  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 640, max: 1280 },
      height: { ideal: 480, max: 720 }
    },
    audio: false
  });

  video.srcObject = cameraStream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("相機畫面載入失敗"));
  });

  await ensureVideoPlaying();
  await waitForVideoDimensions();
  isCameraOn = true;
  setStatus("相機已開啟", "loading");
}

async function ensureVideoPlaying() {
  for (let i = 0; i < 5; i++) {
    try {
      await video.play();
      if (!video.paused) return;
    } catch (error) {
      console.warn("video.play() 重試", error);
    }
    await wait(200);
  }
  throw new Error("無法播放相機畫面，請重新整理後再試");
}

async function waitForVideoDimensions() {
  for (let i = 0; i < 100; i++) {
    if (video.videoWidth > 0 && video.videoHeight > 0) return;
    await wait(50);
  }
  throw new Error("無法取得相機畫面，請重新整理後再試");
}

window.addEventListener("resize", () => {
  if (isCameraOn) ensureCanvasSize();
});

// ── Hand landmarker ───────────────────────────────────────────────────────────

function preloadHandLandmarker() {
  if (!landmarkerLoadPromise) {
    landmarkerLoadPromise = setupHandLandmarker({ silent: true });
  }
  return landmarkerLoadPromise;
}

async function setupHandLandmarker({ silent = false } = {}) {
  if (handLandmarker) return;

  if (!silent) setStatus("載入手勢辨識引擎...", "loading");

  const landmarkerOptions = {
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.2,
    minHandPresenceConfidence: 0.2,
    minTrackingConfidence: 0.2
  };

  // Each entry is [wasmPath, modelPath, delegate].
  // iOS: CPU only — GPU delegate also triggers the t.alpha crash.
  // Non-iOS: local GPU first, then local CPU, then CDN as last resort.
  const candidates = IS_IOS
    ? [[WASM_PATH, MODEL_PATH, "CPU"]]
    : [
        [WASM_PATH, MODEL_PATH, "GPU"],
        [WASM_PATH, MODEL_PATH, "CPU"],
        ["https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
         "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
         "CPU"]
      ];

  let lastError;
  for (const [wasmPath, modelPath, delegate] of candidates) {
    const isCdn = wasmPath.includes("jsdelivr");
    setLoadProgress(`載入 AI 引擎${isCdn ? "（線上版）" : ""}中...`);

    try {
      const vision = await withTimeout(
        FilesetResolver.forVisionTasks(wasmPath),
        LOAD_TIMEOUT_MS,
        "手勢引擎載入逾時，請檢查網路後重試"
      );

      setLoadProgress(`載入 AI 模型${isCdn ? "（線上版）" : ""}中（首次約 10–30 秒）...`);

      handLandmarker = await withTimeout(
        HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelPath, delegate },
          ...landmarkerOptions
        }),
        LOAD_TIMEOUT_MS,
        "AI 模型載入逾時，請檢查網路後重試"
      );

      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      console.warn(`[${delegate} / ${isCdn ? "CDN" : "local"}] 失敗:`, err.message);
      handLandmarker = undefined;
    }
  }

  if (lastError) throw lastError;

  setLoadProgress("");
  if (!silent && isCameraOn) {
    setStatus("手勢辨識已就緒，比 1～4 根手指拍對應格子", "ready");
  }
}

// ── Detection loop ────────────────────────────────────────────────────────────

function ensureCanvasSize() {
  if (video.videoWidth === 0 || video.videoHeight === 0) return false;

  if (detectCanvas.width !== video.videoWidth) {
    detectCanvas.width = video.videoWidth;
    detectCanvas.height = video.videoHeight;
    overlayCanvas.width = video.videoWidth;
    overlayCanvas.height = video.videoHeight;
  }

  return true;
}

function detectLoop() {
  if (!handLandmarker || !isCameraOn) return;

  if (video.paused) video.play().catch(() => {});

  if (video.readyState < 2 || !ensureCanvasSize()) {
    requestAnimationFrame(detectLoop);
    return;
  }

  detectCtx.drawImage(video, 0, 0, detectCanvas.width, detectCanvas.height);
  detectTimestamp += 33;

  let results;
  try {
    results = handLandmarker.detectForVideo(detectCanvas, detectTimestamp);
  } catch (error) {
    console.error("手勢偵測錯誤:", error);
    requestAnimationFrame(detectLoop);
    return;
  }

  if (results.landmarks && results.landmarks.length > 0) {
    const landmarks = results.landmarks[0];
    const fingerCount = countFingers(landmarks);

    drawHandOverlay(landmarks, fingerCount);

    const slotAvailable = fingerCount >= 1 && fingerCount <= 4 && photos[fingerCount - 1] === null;

    if (slotAvailable && !isCapturing) {
      stableFrames++;
      gestureText.textContent = `目前手勢：${fingerCount} 根手指（保持 ${stableFrames}/${STABLE_FRAMES_REQUIRED}）`;

      if (stableFrames >= STABLE_FRAMES_REQUIRED) {
        stableFrames = 0;
        captureWithCountdown(fingerCount);
      }
    } else {
      stableFrames = 0;
      if (fingerCount >= 1 && fingerCount <= 4 && photos[fingerCount - 1] !== null) {
        gestureText.textContent = `目前手勢：${fingerCount} 根手指（第 ${fingerCount} 格已拍攝）`;
      } else {
        gestureText.textContent = `目前手勢：${fingerCount} 根手指`;
      }
    }
  } else {
    stableFrames = 0;
    drawScanningIndicator();
    gestureText.textContent = "目前手勢：未偵測到手（請將手掌面向鏡頭）";
  }

  requestAnimationFrame(detectLoop);
}

// ── Finger counting ───────────────────────────────────────────────────────────

function landmarkDistance(a, b) {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

function countFingers(landmarks) {
  const wrist = landmarks[0];
  let count = 0;

  for (const [tip, pip, mcp] of FINGER_PAIRS) {
    const tipDist = landmarkDistance(landmarks[tip], wrist);
    const pipDist = landmarkDistance(landmarks[pip], wrist);
    const mcpDist = landmarkDistance(landmarks[mcp], wrist);

    if (tipDist > pipDist && tipDist > mcpDist * 0.95) count++;
  }

  return count;
}

// ── Overlay drawing ───────────────────────────────────────────────────────────

// x is flipped here (not via CSS) so landmarks align with the mirrored video
// and text drawn on the canvas stays readable (not backwards)
function toCanvasPoint(landmark) {
  return {
    x: (1 - landmark.x) * overlayCanvas.width,
    y: landmark.y * overlayCanvas.height
  };
}

function drawHandOverlay(landmarks, fingerCount) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  overlayCtx.strokeStyle = "rgba(0, 255, 120, 0.85)";
  overlayCtx.lineWidth = 3;
  overlayCtx.lineCap = "round";

  for (const [start, end] of HAND_CONNECTIONS) {
    const from = toCanvasPoint(landmarks[start]);
    const to = toCanvasPoint(landmarks[end]);
    overlayCtx.beginPath();
    overlayCtx.moveTo(from.x, from.y);
    overlayCtx.lineTo(to.x, to.y);
    overlayCtx.stroke();
  }

  landmarks.forEach((landmark, index) => {
    const point = toCanvasPoint(landmark);
    overlayCtx.beginPath();
    overlayCtx.fillStyle = index === 0 ? "#ffcc00" : "#00ff88";
    overlayCtx.arc(point.x, point.y, index === 0 ? 7 : 5, 0, Math.PI * 2);
    overlayCtx.fill();
  });

  overlayCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
  overlayCtx.fillRect(12, 12, 130, 36);
  overlayCtx.fillStyle = "#fff";
  overlayCtx.font = "bold 22px Arial";
  overlayCtx.textAlign = "left";
  overlayCtx.fillText(`${fingerCount} 根手指`, 24, 38);
}

function clearHandOverlay() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function drawScanningIndicator() {
  if (overlayCanvas.width === 0 || overlayCanvas.height === 0) return;

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  overlayCtx.fillStyle = "rgba(0, 0, 0, 0.45)";
  overlayCtx.fillRect(12, overlayCanvas.height - 44, 110, 32);

  overlayCtx.fillStyle = "#00ff88";
  overlayCtx.beginPath();
  overlayCtx.arc(30, overlayCanvas.height - 28, 6, 0, Math.PI * 2);
  overlayCtx.fill();

  overlayCtx.fillStyle = "#fff";
  overlayCtx.font = "14px Arial";
  overlayCtx.textAlign = "left";
  overlayCtx.fillText("掃描中...", 44, overlayCanvas.height - 23);
}

// ── Capture ───────────────────────────────────────────────────────────────────

async function captureWithCountdown(slot) {
  isCapturing = true;

  try {
    setStatus(`偵測到 ${slot}，準備拍第 ${slot} 格`, "active");

    for (let i = 3; i > 0; i--) {
      countdownText.textContent = i;
      await wait(700);
    }

    countdownText.textContent = "拍！";
    await wait(300);

    // Capture the frame synchronously right now, then clear the countdown
    // immediately — don't block on filter loading which can hang on slow networks
    const canvas = captureFrame();
    countdownText.textContent = "";

    // Show raw photo right away
    const rawUrl = canvas.toDataURL("image/png");
    const box = document.querySelector(`.result-box[data-index="${slot}"]`);
    box.innerHTML = `<span class="num-tag">${slot}</span><img src="${rawUrl}" /><button class="delete-btn" title="刪除此格">×</button>`;
    photos[slot - 1] = rawUrl;

    const allDone = photos.every(p => p !== null);
    if (allDone) {
      setStatus("四格拍照完成，可以下載！", "ready");
      downloadBtn.disabled = false;
    } else {
      const remaining = photos.map((p, i) => p === null ? i + 1 : null).filter(Boolean);
      setStatus(`第 ${slot} 格完成，還需拍：第 ${remaining.join("、")} 格`, "active");
    }

    // Apply filter in background — updates preview and stored data when ready
    applyOpenCvFilter(canvas, filters[slot - 1])
      .then(() => {
        const filteredUrl = canvas.toDataURL("image/png");
        photos[slot - 1] = filteredUrl;
        const img = box.querySelector("img");
        if (img) img.src = filteredUrl;
      })
      .catch(console.warn);

  } catch (error) {
    console.error("拍照失敗:", error);
    countdownText.textContent = "";
    setStatus("拍照失敗，請重試", "error");
  }

  await wait(1200);
  isCapturing = false;
}

function captureFrame() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  return canvas;
}

// ── OpenCV filters ────────────────────────────────────────────────────────────

function loadOpenCv() {
  if (openCvLoadPromise) return openCvLoadPromise;

  openCvLoadPromise = new Promise((resolve, reject) => {
    window.isOpenCvReady = false;
    window.onOpenCvReady = function () {
      window.isOpenCvReady = true;
      resolve();
    };

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://docs.opencv.org/4.x/opencv.js";
    script.onload = () => { if (typeof onOpenCvReady === "function") onOpenCvReady(); };
    script.onerror = () => reject(new Error("OpenCV 載入失敗"));
    document.body.appendChild(script);
  });

  return openCvLoadPromise;
}

function isOpenCvReady() {
  return window.isOpenCvReady === true && typeof cv !== "undefined";
}

async function applyOpenCvFilter(canvas, filterName) {
  try {
    await loadOpenCv();
  } catch (error) {
    console.warn("OpenCV.js 尚未載入，先使用原圖", error);
    return;
  }

  if (!isOpenCvReady()) {
    console.warn("OpenCV.js 尚未載入，先使用原圖");
    return;
  }

  let src = cv.imread(canvas);
  let dst;

  if (filterName === "japaneseSoft") {
    dst = applyJapaneseSoft(src);
  } else if (filterName === "vintage") {
    dst = applyVintage(src);
  } else if (filterName === "vivid") {
    dst = applyVivid(src);
  } else if (filterName === "blackWhite") {
    dst = applyBlackWhite(src);
  } else {
    dst = src.clone();
  }

  cv.imshow(canvas, dst);
  src.delete();
  dst.delete();
}

function applyJapaneseSoft(src) {
  let dst = new cv.Mat();
  src.convertTo(dst, -1, 0.85, 35);

  let blurred = new cv.Mat();
  cv.GaussianBlur(dst, blurred, new cv.Size(5, 5), 0);
  cv.addWeighted(dst, 0.75, blurred, 0.25, 0, dst);
  blurred.delete();

  return dst;
}

function applyVintage(src) {
  let dst = src.clone();
  let channels = new cv.MatVector();
  cv.split(dst, channels);

  let r = channels.get(0);
  let g = channels.get(1);
  let b = channels.get(2);
  let a = channels.get(3);

  r.convertTo(r, -1, 1.15, 20);
  g.convertTo(g, -1, 1.02, 8);
  b.convertTo(b, -1, 0.75, 0);

  let merged = new cv.MatVector();
  merged.push_back(r); merged.push_back(g); merged.push_back(b); merged.push_back(a);
  cv.merge(merged, dst);
  dst.convertTo(dst, -1, 1.12, 5);

  channels.delete(); merged.delete();
  r.delete(); g.delete(); b.delete(); a.delete();

  return dst;
}

function applyVivid(src) {
  let dst = new cv.Mat();
  src.convertTo(dst, -1, 1.35, 8);

  let rgb = new cv.Mat();
  let hsv = new cv.Mat();
  cv.cvtColor(dst, rgb, cv.COLOR_RGBA2RGB);
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

  let channels = new cv.MatVector();
  cv.split(hsv, channels);
  let h = channels.get(0);
  let s = channels.get(1);
  let v = channels.get(2);
  s.convertTo(s, -1, 1.45, 0);

  let merged = new cv.MatVector();
  merged.push_back(h); merged.push_back(s); merged.push_back(v);
  cv.merge(merged, hsv);
  cv.cvtColor(hsv, rgb, cv.COLOR_HSV2RGB);
  cv.cvtColor(rgb, dst, cv.COLOR_RGB2RGBA);

  rgb.delete(); hsv.delete(); channels.delete(); merged.delete();
  h.delete(); s.delete(); v.delete();

  return dst;
}

function applyBlackWhite(src) {
  let gray = new cv.Mat();
  let dst = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  gray.convertTo(gray, -1, 1.5, 5);
  cv.cvtColor(gray, dst, cv.COLOR_GRAY2RGBA);
  gray.delete();

  return dst;
}

// ── Init ──────────────────────────────────────────────────────────────────────

if (IS_IOS) {
  // On iOS, skip background preload — WebGL init without a user gesture is
  // unreliable and causes the "t.alpha" context-loss crash. Init on button click instead.
  setStatus("請開啟相機（iOS 裝置）", "default");
} else {
  setStatus("AI 模型載入中...", "loading");

  preloadHandLandmarker()
    .then(() => {
      setLoadProgress("AI 模型已預載完成，可按「開啟相機」");
      setStatus("AI 模型已就緒，請開啟相機", "ready");
    })
    .catch((error) => {
      console.warn("背景預載失敗，將在開啟相機時重試", error);
      landmarkerLoadPromise = null;
      setLoadProgress("AI 模型預載失敗，開啟相機時會再試一次");
      setStatus("AI 模型預載失敗", "error");
    });
}
