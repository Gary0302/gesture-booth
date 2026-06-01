let isOpenCvReady = false;

window.onOpenCvReady = function () {
  isOpenCvReady = true;
  console.log("OpenCV.js 已載入完成");
};
import {
  HandLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById("video");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const downloadBtn = document.getElementById("downloadBtn");
const statusText = document.getElementById("status");
const gestureText = document.getElementById("gestureText");
const countdownText = document.getElementById("countdown");
const resultCanvas = document.getElementById("resultCanvas");
const resultCtx = resultCanvas.getContext("2d");

let handLandmarker;
let isCameraOn = false;
let isCapturing = false;
let currentSlot = 1;
let photos = [];

const filters = [
  "japaneseSoft",  // 第 1 格：日系清透
  "vintage",       // 第 2 格：復古底片
  "vivid",         // 第 3 格：高對比鮮豔
  "blackWhite"     // 第 4 格：黑白強對比
];
startBtn.addEventListener("click", async () => {
  try {
    await setupCamera();
    await setupHandLandmarker();
    detectLoop();
  } catch (error) {
    console.error(error);
    statusText.textContent = "相機或手勢辨識啟動失敗，請確認權限與網路";
  }
});

resetBtn.addEventListener("click", () => {
  currentSlot = 1;
  photos = [];
  isCapturing = false;
  clearResultCanvas();
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

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user"
    },
    audio: false
  });

  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = resolve;
  });

  isCameraOn = true;
  statusText.textContent = "相機已開啟，請比 1 拍第 1 格";
}

async function setupHandLandmarker() {
  if (handLandmarker) return;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1
  });
}

function detectLoop() {
  if (!handLandmarker || !isCameraOn) return;

  const results = handLandmarker.detectForVideo(video, performance.now());

  if (results.landmarks && results.landmarks.length > 0) {
    const landmarks = results.landmarks[0];
    const fingerCount = countFingers(landmarks);

    gestureText.textContent = `目前手勢：${fingerCount} 根手指`;

    if (
      fingerCount === currentSlot &&
      !isCapturing &&
      currentSlot <= 4
    ) {
      captureWithCountdown(currentSlot);
    }
  } else {
    gestureText.textContent = "目前手勢：未偵測到手";
  }

  requestAnimationFrame(detectLoop);
}

function countFingers(landmarks) {
  let count = 0;

  // 食指：指尖 8，關節 6
  if (landmarks[8].y < landmarks[6].y) count++;

  // 中指：指尖 12，關節 10
  if (landmarks[12].y < landmarks[10].y) count++;

  // 無名指：指尖 16，關節 14
  if (landmarks[16].y < landmarks[14].y) count++;

  // 小指：指尖 20，關節 18
  if (landmarks[20].y < landmarks[18].y) count++;

  return count;
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

function capturePhoto(slot) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  ctx.save();

  // 讓拍出來的照片不要左右相反
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);

  // 先拍下原圖
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  ctx.restore();

  // 用 OpenCV.js 套濾鏡
  applyOpenCvFilter(canvas, filters[slot - 1]);

  return canvas;
}

function applyConvexEffect(canvas) {
  const ctx = canvas.getContext("2d");

  const width = canvas.width;
  const height = canvas.height;

  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;

  const output = ctx.createImageData(width, height);
  const dst = output.data;

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 3;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);

      let sx = x;
      let sy = y;

      if (d <= r) {
        sx = Math.floor((dx * d) / r + cx);
        sy = Math.floor((dy * d) / r + cy);
      }

      sx = Math.max(0, Math.min(width - 1, sx));
      sy = Math.max(0, Math.min(height - 1, sy));

      const srcIndex = (sy * width + sx) * 4;
      const dstIndex = (y * width + x) * 4;

      dst[dstIndex] = src[srcIndex];
      dst[dstIndex + 1] = src[srcIndex + 1];
      dst[dstIndex + 2] = src[srcIndex + 2];
      dst[dstIndex + 3] = src[srcIndex + 3];
    }
  }

  ctx.putImageData(output, 0, 0);
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

clearResultCanvas();
function applyOpenCvFilter(canvas, filterName) {
  if (!isOpenCvReady || typeof cv === "undefined") {
    console.warn("OpenCV.js 尚未載入，先使用原圖");
    return;
  }

  let src = cv.imread(canvas);
  let dst = new cv.Mat();

  if (filterName === "japaneseSoft") {
    // 日系清透：亮、低對比、低飽和、柔一點
    dst = applyJapaneseSoft(src);
  } else if (filterName === "vintage") {
    // 復古底片：偏暖、棕黃、對比略高
    dst = applyVintage(src);
  } else if (filterName === "vivid") {
    // 高對比鮮豔：顏色更重
    dst = applyVivid(src);
  } else if (filterName === "blackWhite") {
    // 黑白強對比
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

  // 亮度 + 對比
  // alpha < 1 對比降低，beta > 0 變亮
  src.convertTo(dst, -1, 0.85, 35);

  // 柔焦一點點
  let blurred = new cv.Mat();
  cv.GaussianBlur(dst, blurred, new cv.Size(5, 5), 0);

  // 混合原圖與模糊圖
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

  // 注意：OpenCV.js 讀 canvas 通常是 RGBA
  // 增加紅色、降低藍色，做復古暖色
  r.convertTo(r, -1, 1.15, 20);
  g.convertTo(g, -1, 1.02, 8);
  b.convertTo(b, -1, 0.75, 0);

  let merged = new cv.MatVector();
  merged.push_back(r);
  merged.push_back(g);
  merged.push_back(b);
  merged.push_back(a);

  cv.merge(merged, dst);

  // 稍微增加對比
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

  // 先提高對比與亮度
  src.convertTo(dst, -1, 1.35, 8);

  // 轉 HSV 增加飽和度
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

  // 黑白強對比
  gray.convertTo(gray, -1, 1.5, 5);

  cv.cvtColor(gray, dst, cv.COLOR_GRAY2RGBA);

  gray.delete();

  return dst;
}
