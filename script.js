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
const statusText = document.getElementById("status");
const gestureText = document.getElementById("gestureText");
const loadProgress = document.getElementById("loadProgress");
const countdownText = document.getElementById("countdown");
const resultCanvas = document.getElementById("resultCanvas");
const resultCtx = resultCanvas.getContext("2d");

let handLandmarker;
let cameraStream = null;
let isCameraOn = false;
let isCapturing = false;
let currentSlot = 1;
let photos = [];
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

const filters = [
  "japaneseSoft",
  "vintage",
  "vivid",
  "blackWhite"
];

const MODEL_PATH = new URL("./models/hand_landmarker.task", import.meta.url).href;
const WASM_PATH = new URL("./wasm", import.meta.url).href;
const LOAD_TIMEOUT_MS = 90000;

let landmarkerLoadPromise = null;
let openCvLoadPromise = null;

function setLoadProgress(text) {
  if (!text) {
    loadProgress.hidden = true;
    loadProgress.textContent = "";
    return;
  }
  loadProgress.hidden = false;
  loadProgress.textContent = text;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

function preloadHandLandmarker() {
  if (!landmarkerLoadPromise) {
    landmarkerLoadPromise = setupHandLandmarker({ silent: true });
  }
  return landmarkerLoadPromise;
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    await setupCamera();
    setLoadProgress("相機已就緒，等待 AI 模型完成載入...");
    await preloadHandLandmarker();
    overlayCanvas.classList.add("active");
    gestureText.textContent = "目前手勢：搜尋手部中...";
    setLoadProgress("");
    statusText.textContent = "手勢辨識已就緒，請比 1 拍第 1 格（手掌面向鏡頭）";
    detectLoop();
  } catch (error) {
    console.error(error);
    statusText.textContent = `啟動失敗：${error.message || "請確認權限與網路"}`;
    gestureText.textContent = "目前手勢：尚未偵測";
    setLoadProgress("");
    startBtn.disabled = false;
  }
});

resetBtn.addEventListener("click", () => {
  currentSlot = 1;
  photos = [];
  isCapturing = false;
  stableFrames = 0;
  clearResultCanvas();
  clearHandOverlay();
  statusText.textContent = "已重新開始，請比 1 拍第 1 格";
  gestureText.textContent = "目前手勢：尚未偵測";
});

downloadBtn.addEventListener("click", () => {
  if (photos.length < 4) {
    alert("請先完成四格拍照！");
    return;
  }

  const link = document.createElement("a");
  link.download = "gesture-four-cut.png";
  link.href = resultCanvas.toDataURL("image/png");
  link.click();
});

async function setupCamera() {
  if (isCameraOn) return;

  statusText.textContent = "正在開啟相機...";

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
  statusText.textContent = "相機已開啟";
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

async function setupHandLandmarker({ silent = false } = {}) {
  if (handLandmarker) return;

  if (!silent) {
    statusText.textContent = "載入手勢辨識引擎（WASM）...";
  }
  setLoadProgress("背景載入 WASM 引擎中...");

  const vision = await withTimeout(
    FilesetResolver.forVisionTasks(WASM_PATH),
    LOAD_TIMEOUT_MS,
    "手勢引擎載入逾時，請檢查網路後重試"
  );

  setLoadProgress("背景載入 AI 模型中（首次約 10–30 秒）...");

  const baseOptions = {
    modelAssetPath: MODEL_PATH
  };

  const landmarkerOptions = {
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.2,
    minHandPresenceConfidence: 0.2,
    minTrackingConfidence: 0.2
  };

  try {
    handLandmarker = await withTimeout(
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: "GPU" },
        ...landmarkerOptions
      }),
      LOAD_TIMEOUT_MS,
      "AI 模型載入逾時，請檢查網路後重試"
    );
  } catch (gpuError) {
    console.warn("GPU delegate 失敗，改用 CPU", gpuError);
    setLoadProgress("GPU 模式失敗，改用 CPU 載入模型...");
    handLandmarker = await withTimeout(
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: "CPU" },
        ...landmarkerOptions
      }),
      LOAD_TIMEOUT_MS,
      "AI 模型載入逾時，請檢查網路後重試"
    );
  }

  setLoadProgress("");
  if (!silent && isCameraOn) {
    statusText.textContent = "手勢辨識已就緒，請比 1 拍第 1 格（手掌面向鏡頭）";
  }
}

function ensureCanvasSize() {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    return false;
  }

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

  if (video.paused) {
    video.play().catch(() => {});
  }

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

    if (fingerCount === currentSlot && !isCapturing && currentSlot <= 4) {
      stableFrames++;
      gestureText.textContent = `目前手勢：${fingerCount} 根手指（保持 ${stableFrames}/${STABLE_FRAMES_REQUIRED}）`;

      if (stableFrames >= STABLE_FRAMES_REQUIRED) {
        stableFrames = 0;
        captureWithCountdown(currentSlot);
      }
    } else {
      stableFrames = 0;
      gestureText.textContent = `目前手勢：${fingerCount} 根手指`;
    }
  } else {
    stableFrames = 0;
    drawScanningIndicator();
    gestureText.textContent = "目前手勢：未偵測到手（請將手掌面向鏡頭）";
  }

  requestAnimationFrame(detectLoop);
}

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

    if (tipDist > pipDist && tipDist > mcpDist * 0.95) {
      count++;
    }
  }

  return count;
}

function toCanvasPoint(landmark) {
  return {
    x: landmark.x * overlayCanvas.width,
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

async function captureWithCountdown(slot) {
  isCapturing = true;
  statusText.textContent = `偵測到 ${slot}，準備拍第 ${slot} 格`;

  for (let i = 3; i > 0; i--) {
    countdownText.textContent = i;
    await wait(700);
  }

  countdownText.textContent = "拍！";
  await wait(300);

  const photo = capturePhoto(slot);
  photos.push(photo);
  drawFourGrid();

  countdownText.textContent = "";

  if (currentSlot < 4) {
    currentSlot++;
    statusText.textContent = `第 ${slot} 格完成，請比 ${currentSlot} 拍第 ${currentSlot} 格`;
  } else {
    statusText.textContent = "四格拍照完成，可以下載！";
  }

  await wait(1200);
  isCapturing = false;
}

async function capturePhoto(slot) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  await applyOpenCvFilter(canvas, filters[slot - 1]);

  return canvas;
}

function drawFourGrid() {
  const photoW = 360;
  const photoH = 480;
  const gap = 18;
  const padding = 24;

  resultCanvas.width = photoW * 2 + gap + padding * 2;
  resultCanvas.height = photoH * 2 + gap + padding * 2 + 70;

  resultCtx.fillStyle = "#ffffff";
  resultCtx.fillRect(0, 0, resultCanvas.width, resultCanvas.height);

  photos.forEach((photo, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);

    const x = padding + col * (photoW + gap);
    const y = padding + row * (photoH + gap);

    resultCtx.drawImage(photo, x, y, photoW, photoH);

    resultCtx.fillStyle = "rgba(255, 255, 255, 0.85)";
    resultCtx.fillRect(x + 12, y + 12, 80, 34);

    resultCtx.fillStyle = "#111";
    resultCtx.font = "bold 20px Arial";
    resultCtx.textAlign = "left";
    resultCtx.fillText(`No.${index + 1}`, x + 24, y + 36);
  });

  resultCtx.fillStyle = "#111";
  resultCtx.font = "bold 28px Arial";
  resultCtx.textAlign = "center";
  resultCtx.fillText(
    "AI Gesture Booth",
    resultCanvas.width / 2,
    resultCanvas.height - 30
  );
}

function clearResultCanvas() {
  resultCanvas.width = 762;
  resultCanvas.height = 1094;

  resultCtx.fillStyle = "#ffffff";
  resultCtx.fillRect(0, 0, resultCanvas.width, resultCanvas.height);

  resultCtx.fillStyle = "#999";
  resultCtx.font = "24px Arial";
  resultCtx.textAlign = "center";
  resultCtx.fillText(
    "四格照片會顯示在這裡",
    resultCanvas.width / 2,
    resultCanvas.height / 2
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    script.onload = () => {
      if (typeof onOpenCvReady === "function") onOpenCvReady();
    };
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
  let dst = new cv.Mat();

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
  merged.push_back(r);
  merged.push_back(g);
  merged.push_back(b);
  merged.push_back(a);

  cv.merge(merged, dst);
  dst.convertTo(dst, -1, 1.12, 5);

  channels.delete();
  merged.delete();
  r.delete();
  g.delete();
  b.delete();
  a.delete();

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
  merged.push_back(h);
  merged.push_back(s);
  merged.push_back(v);

  cv.merge(merged, hsv);

  cv.cvtColor(hsv, rgb, cv.COLOR_HSV2RGB);
  cv.cvtColor(rgb, dst, cv.COLOR_RGB2RGBA);

  rgb.delete();
  hsv.delete();
  channels.delete();
  merged.delete();
  h.delete();
  s.delete();
  v.delete();

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

clearResultCanvas();

preloadHandLandmarker()
  .then(() => {
    setLoadProgress("AI 模型已預載完成，可按「開啟相機」");
  })
  .catch((error) => {
    console.warn("背景預載失敗，將在開啟相機時重試", error);
    landmarkerLoadPromise = null;
    setLoadProgress("AI 模型預載失敗，開啟相機時會再試一次");
  });
