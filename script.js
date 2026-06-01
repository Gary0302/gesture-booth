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
  "brightness(110%) contrast(95%) saturate(90%)",
  "sepia(45%) brightness(105%) contrast(105%)",
  "contrast(125%) saturate(130%)",
  "grayscale(100%) contrast(120%)"
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
  clearResultCanvas();
  statusText.textContent = "已重新開始，請比 1 拍第 1 格";
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

  // 食指
  if (landmarks[8].y < landmarks[6].y) count++;

  // 中指
  if (landmarks[12].y < landmarks[10].y) count++;

  // 無名指
  if (landmarks[16].y < landmarks[14].y) count++;

  // 小指
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

  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);

  ctx.filter = filters[slot - 1];

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();

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

    resultCtx.fillStyle = "rgba(255,255,255,0.8)";
    resultCtx.fillRect(x + 12, y + 12, 72, 34);

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
  resultCtx.fillStyle = "#fff";
  resultCtx.fillRect(0, 0, resultCanvas.width, resultCanvas.height);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const filterOptions = {
  original: {
    name: "原圖",
    filter: "none"
  },
  japaneseSoft: {
    name: "日系清透",
    filter: "brightness(112%) contrast(92%) saturate(88%)"
  },
  koreanClean: {
    name: "韓系奶油",
    filter: "brightness(115%) contrast(95%) saturate(105%)"
  },
  vintage: {
    name: "復古底片",
    filter: "sepia(45%) contrast(108%) brightness(105%) saturate(90%)"
  },
  filmWarm: {
    name: "暖色膠片",
    filter: "sepia(25%) brightness(108%) contrast(110%) saturate(115%)"
  },
  coolBlue: {
    name: "冷色藍調",
    filter: "brightness(105%) contrast(105%) saturate(90%) hue-rotate(185deg)"
  },
  highContrast: {
    name: "高對比",
    filter: "contrast(135%) saturate(120%)"
  },
  blackWhite: {
    name: "黑白經典",
    filter: "grayscale(100%) contrast(120%)"
  },
  faded: {
    name: "低飽和霧感",
    filter: "brightness(108%) contrast(85%) saturate(70%)"
  },
  candy: {
    name: "甜美糖果",
    filter: "brightness(115%) contrast(105%) saturate(145%) hue-rotate(10deg)"
  }
};

clearResultCanvas();
