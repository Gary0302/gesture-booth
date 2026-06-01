# AI 手勢四格拍貼機

透過手勢比 1～4 根手指，自動拍攝四格照片並套用不同濾鏡的 Web 拍貼機。

## 使用方式

1. 開啟網站（需 HTTPS 才能使用相機）
2. 等待頁面底部顯示「AI 模型已預載完成」
3. 按下「開啟相機」並允許相機權限
4. 依序比 1、2、3、4 根手指拍攝四格（保持手勢約 0.5 秒）
5. 完成後按「下載四格照」

## 技術

- [TensorFlow.js hand-pose-detection](https://github.com/tensorflow/tfjs-models/tree/master/hand-pose-detection)（MediaPipeHands 模型，`wasm` 後端）— 手勢辨識，不需 WebGL，相容 iOS Safari
- [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html) — 照片濾鏡
- 純前端靜態網站，可部署至 Vercel

---

## Debug 紀錄：從 original (https://github.com/s113409-boop/gesture-booth) 到現在可用版本的修正清單

以下每一條都對應 original 目錄的實際 bug，若你自己在開發類似功能遇到問題，可以對照排查。

---

### Bug 1：`import` 語句不在 ES module 最上方

**原始碼問題（`original/script.js` 第 1–10 行）：**
```js
let isOpenCvReady = false;
window.onOpenCvReady = function () { ... };
import { HandLandmarker, FilesetResolver } from "...";
```
ES module 規範要求 `import` 必須在最頂層，寫在其他陳述式之後是非法的。部分瀏覽器會報 `SyntaxError: import declarations may only appear at top level`，模組整個不執行。

**修正：** 把 `import` 移到檔案第一行。

---

### Bug 2：OpenCV 載入 race condition，濾鏡永遠套不上

**原始碼問題（`original/index.html` 最後 + `original/script.js`）：**
```html
<!-- HTML 裡：async 代表一載入完就立刻執行 -->
<script async src=".../opencv.js" onload="onOpenCvReady();"></script>
<script type="module" src="script.js"></script>
```
```js
// module 裡定義：
window.onOpenCvReady = function () { isOpenCvReady = true; };
```
`type="module"` 的 script 是 deferred，一定在 HTML parsing 完成後才執行。但 `async` script 載入完就立刻執行，**可能在 module 執行前就觸發 `onOpenCvReady()`**，此時 `window.onOpenCvReady` 還是 `undefined`，呼叫失敗，`isOpenCvReady` 永遠是 `false`，拍出來的照片全是原圖沒有濾鏡。

**修正：** 把 OpenCV 的 `<script>` 標籤從 HTML 移除，改為在 JS 裡動態注入並用 Promise 管理載入狀態：
```js
function loadOpenCv() {
  if (openCvLoadPromise) return openCvLoadPromise;
  openCvLoadPromise = new Promise((resolve, reject) => {
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
```

---

### Bug 3：手指計數只用 Y 軸，手一傾斜就全部誤判

**原始碼問題（`original/script.js`）：**
```js
if (landmarks[8].y < landmarks[6].y) count++;  // 食指
if (landmarks[12].y < landmarks[10].y) count++; // 中指
// ...
```
MediaPipe landmarks 的 x/y 是 normalized（0.0 到 1.0），y 越小表示越靠近螢幕上方。這個邏輯「指尖 y < 關節 y = 手指伸直」只在手**完全垂直朝上**時正確。手一旋轉 45 度、側躺或朝鏡頭（selfie 角度），所有手指的 Y 軸關係都會顛倒，1 根手指可能被判成 4 根。

**修正：** 改用「指尖到手腕的 3D 距離」算法——伸直的手指，指尖離手腕比指關節離手腕更遠：
```js
const FINGER_PAIRS = [
  [8, 6, 5],   // [tip, pip, mcp] 食指
  [12, 10, 9],
  [16, 14, 13],
  [20, 18, 17]
];

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
```

---

### Bug 4：第一幀符合就立刻觸發拍照

**原始碼問題（`original/script.js`）：**
```js
if (fingerCount === currentSlot && !isCapturing && currentSlot <= 4) {
  captureWithCountdown(currentSlot); // 第一幀符合就觸發
}
```
手勢辨識有雜訊，某幀偶然判成 2 根手指就會觸發第 2 格拍照，即使使用者根本沒有比 2。

**修正：** 加入穩定幀計數，連續 10 幀（約 0.3 秒）都是同一手勢才觸發：
```js
const STABLE_FRAMES_REQUIRED = 10;
// ...
if (fingerCount === currentSlot && !isCapturing && currentSlot <= 4) {
  stableFrames++;
  if (stableFrames >= STABLE_FRAMES_REQUIRED) {
    stableFrames = 0;
    captureWithCountdown(currentSlot);
  }
} else {
  stableFrames = 0;
}
```

---

### Bug 5：`performance.now()` 作為 MediaPipe timestamp 造成重複或停止偵測

**原始碼問題（`original/script.js`）：**
```js
const results = handLandmarker.detectForVideo(video, performance.now());
```
MediaPipe `detectForVideo` 要求傳入的 timestamp 必須**嚴格遞增**。`requestAnimationFrame` 的回呼如果被瀏覽器節流（tab 在背景、省電模式），多次呼叫的 `performance.now()` 可能相同或倒退，導致 MediaPipe 拋出錯誤或傳回上一幀的舊結果，偵測看起來「卡住」。

**修正：** 使用手動遞增計數器，保證每次都不同：
```js
let detectTimestamp = 0;
// 在 loop 裡：
detectTimestamp += 33;
results = handLandmarker.detectForVideo(detectCanvas, detectTimestamp);
```

---

### Bug 6：偵測對象是 `<video>` 元素，維度未就緒時會當掉

**原始碼問題（`original/script.js`）：**
```js
const results = handLandmarker.detectForVideo(video, performance.now());
```
直接把 `video` 元素傳給 MediaPipe，如果 `video.videoWidth === 0`（還沒拿到畫面），MediaPipe 會收到空白畫面或拋出例外，整個 `detectLoop` 停止。

**修正：** 先把每幀畫到 `detectCanvas`，並在 loop 開頭檢查維度：
```js
const detectCanvas = document.createElement("canvas");
// ...
if (video.readyState < 2 || !ensureCanvasSize()) {
  requestAnimationFrame(detectLoop);
  return;
}
detectCtx.drawImage(video, 0, 0, detectCanvas.width, detectCanvas.height);
results = handLandmarker.detectForVideo(detectCanvas, detectTimestamp);
```

---

### Bug 7：沒有呼叫 `video.play()`，某些瀏覽器不會送出畫面

**原始碼問題（`original/script.js`）：**
```js
video.srcObject = stream;
await new Promise((resolve) => { video.onloadedmetadata = resolve; });
// 就直接開始用了
```
iOS Safari 和某些 Android 瀏覽器即使有 `autoplay` 屬性，仍需要明確呼叫 `video.play()`，否則 `readyState` 停在 1（`HAVE_METADATA`），永遠沒有畫面。

**修正：**
```js
await ensureVideoPlaying(); // 含 retry 的 video.play()
await waitForVideoDimensions(); // 等 videoWidth > 0
```

---

### Bug 8：GPU delegate 寫死，Safari 與部分手機直接失敗

**原始碼問題（`original/script.js`）：**
```js
handLandmarker = await HandLandmarker.createFromOptions(vision, {
  baseOptions: { modelAssetPath: "...", delegate: "GPU" },
  ...
});
```
沒有 WebGL 支援的環境（Safari 的某些版本、無 GPU 的 VM）初始化 GPU delegate 會拋出例外，整個手勢辨識無法啟動，不會 fallback。

**修正：** try/catch GPU，失敗改用 CPU：
```js
try {
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { ...baseOptions, delegate: "GPU" }, ...
  });
} catch {
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { ...baseOptions, delegate: "CPU" }, ...
  });
}
```

---

### Bug 9 (無法執行的重點，環境因素)：WASM 和模型從外部 CDN 載入，Vercel 部署後掛住

**原始碼問題（`original/script.js`）：**
```js
const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
);
// model: "https://storage.googleapis.com/mediapipe-models/..."
```
本機開發正常，但 Vercel 部署後：
- CDN 請求可能因為 CORS header 設定不同而被擋
- 首次載入需要下載數 MB 的 WASM + 模型，無 timeout 保護，一旦網路慢就卡死沒有錯誤訊息

**修正：** 把 `wasm/` 目錄和 `models/hand_landmarker.task` 放進 repo 一起部署，用相對路徑載入，並加 90 秒 timeout：
```js
const WASM_PATH = new URL("./wasm", import.meta.url).href;
const MODEL_PATH = new URL("./models/hand_landmarker.task", import.meta.url).href;

const vision = await withTimeout(
  FilesetResolver.forVisionTasks(WASM_PATH),
  90000, "WASM 載入逾時"
);
```

---

### Bug 10：`capturePhoto` 沒有 await 濾鏡，照片可能沒有套用

**原始碼問題（`original/script.js`）：**
```js
function capturePhoto(slot) {           // 同步函式
  // ...
  applyOpenCvFilter(canvas, filters[slot - 1]); // 非同步，不等它
  return canvas;                        // 立刻回傳，可能濾鏡還沒跑
}
```
`applyOpenCvFilter` 內部需要先 `await loadOpenCv()`，是非同步操作。原本直接呼叫沒有 `await`，照片在濾鏡套用前就已經被放進 grid，結果是原圖。

**修正：**
```js
async function capturePhoto(slot) {
  // ...
  await applyOpenCvFilter(canvas, filters[slot - 1]);
  return canvas;
}
```

---

### Bug 11：沒有 overlay canvas，骨架完全無法顯示

**原始碼問題（`original/index.html`）：** HTML 裡沒有 `<canvas id="overlayCanvas">`，也沒有繪製手部骨架的任何邏輯。

**修正：** 在 `<video>` 後面疊加一個 canvas，用相同的 `transform: scaleX(-1)` 保持鏡像對齊，並在 CSS 加 `position: absolute; inset: 0`，讓骨架與影像完全重疊。骨架只在手出現時顯示（`overlayCanvas.classList.add("active")`），避免載入前看到閃爍。

---

### Bug 12：模型只在按鈕按下後才開始載入，等待時間長且無進度顯示

**原始碼問題（`original/script.js`）：** 點「開啟相機」之後才呼叫 `setupHandLandmarker()`，首次下載 WASM + 模型需要 10–30 秒，期間畫面完全沒有回饋。

**修正：** 頁面載入時就在背景開始 `preloadHandLandmarker()`，並用 `loadProgress` 元素顯示即時狀態（「背景載入中」→「已預載完成」）。點按鈕時模型通常已經好了，可以立刻使用。

---

### Bug 13：iOS Safari 上手動修補過的 WASM 造成 heap 崩潰，綠色骨架完全不顯示

**問題：** 在 iOS Safari 上，相機畫面正常出現，但綠色手部骨架（甚至「掃描中…」的綠點）完全不顯示，也沒有任何錯誤訊息。

**為什麼一開始查不到原因：** 原本的 `detectLoop` catch 區塊只是 `console.error` 後就 `requestAnimationFrame` 繼續，**把錯誤靜默吞掉**——於是迴圈一直在跑，卻每一幀都在丟錯、什麼都沒畫，外觀上就是「相機有畫面、但什麼 overlay 都沒有」。第一步是先把錯誤顯示在狀態列上，才看到 iOS 真正的錯誤：

```
手勢偵測失敗：Aborted(). Build with -sASSERTIONS for more info.
手勢偵測失敗：Out of bounds memory access (evaluating '_malloc(size)')
```

**真正的根因：** 這是 WASM **heap 崩潰**，不是單純的 WebGL context 遺失。iOS Safari 會在串流過程中弄丟 WebGL context；而先前為了壓掉 `t.alpha` 崩潰，曾**手動修改自架的 Emscripten WASM glue**，在 `getContextAttributes()` 回傳 `null` 時「偽造一組合法的 WebGL 屬性」。這讓 MediaPipe **誤以為一個已死的 GL context 還活著**，後續就用垃圾狀態去計算 buffer 大小 → `_malloc` 存取越界 → `Abort()`。換句話說,那個修補把「乾淨的錯誤」變成了「heap 損毀」,而且每次自動重建都載入同一份壞掉的本機 WASM,重現同樣的崩潰。

**為什麼最後要整個換掉引擎：** 先把那段有害的手改還原成 pristine 官方 WASM、iOS 改用官方 CDN build + CPU 之後,iOS 不再 heap 崩潰,但浮現出**最底層的真相**——

```
null is not an object (evaluating 't.alpha')
```

也就是 WebGL context **一建立就立刻遺失**。MediaPipe Tasks Vision **即使指定 `delegate: "CPU"`,內部仍一定會建立一個 WebGL context** 做影像轉換;在 iOS Safari 上這個 context 一出生就死亡,`getContextAttributes()` 回傳 `null`,然後在 WASM 內部崩潰。這是**MediaPipe WASM 內部的限制,從我們的程式碼無法修掉**(硬改就會變成上面的 heap 損毀)。

**最終修正：整個改用 TensorFlow.js + WASM 後端(全平台)**

唯一能徹底跳脫這整類問題的方法,是改用一個**完全不需要 WebGL**的推論引擎:

1. **偵測引擎換成 [TensorFlow.js hand-pose-detection](https://github.com/tensorflow/tfjs-models/tree/master/hand-pose-detection)**,使用 `runtime: "tfjs"` 的 MediaPipeHands 模型。
2. **後端強制設為 `wasm`**(`tf.setBackend("wasm")`)——純 CPU/WASM 推論,完全不建立 WebGL context,從根本上不會再有 `t.alpha`。
3. **動態載入 TFJS UMD 腳本**(core → converter → cpu/wasm backend → 模型),不用 `import`,讓 wasm 後端能自行從固定 CDN 路徑(`tf.wasm.setWasmPaths(...)`)解析自己的 `.wasm` 檔。
4. **landmark 格式轉換**:`estimateHands()` 回傳 `keypoints`(像素座標,用來畫骨架)與 `keypoints3D`(公尺座標,用來算手指數),都遵循同一套 21 點 MediaPipe 拓樸,`countFingers` / `HAND_CONNECTIONS` 幾乎原封不動。
5. **不再靜默吞錯**:`detectLoop` 的 catch 會把真正的錯誤顯示在狀態列(就是靠這步才依序抓到 `_malloc` 與 `t.alpha`)。

```js
// 動態載入後設定後端
tf.wasm.setWasmPaths("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/");
await tf.setBackend("wasm");
await tf.ready();

detector = await handPoseDetection.createDetector(
  handPoseDetection.SupportedModels.MediaPipeHands,
  { runtime: "tfjs", modelType: "lite", maxHands: 1 }
);

// detectLoop 內(estimateHands 為非同步):
const hands = await detector.estimateHands(detectCanvas, { flipHorizontal: false });
if (hands.length > 0) {
  const keypoints = hands[0].keypoints;                       // 像素 → 畫骨架
  const counting  = hands[0].keypoints3D || keypoints;        // 公尺 → 算手指
  drawHandOverlay(keypoints, countFingers(counting));
}
```

**權衡：** 桌機原本用 MediaPipe GPU,換成 TFJS WASM 後推論會稍慢,但換來「一套程式碼、所有平台(含 iOS Safari)都能跑」的穩定性。自架的 `wasm/`、`models/` 已不再被使用。

```js
let detectErrorCount = 0;
let recoveryAttempts = 0;
let isRecoveringLandmarker = false;
const MAX_RECOVERY_ATTEMPTS = 3;

// detectLoop 內：
try {
  results = handLandmarker.detectForVideo(detectCanvas, detectTimestamp);
  detectErrorCount = 0;
} catch (error) {
  detectErrorCount++;
  if (!isRecoveringLandmarker && detectErrorCount >= 3) {
    if (recoveryAttempts < MAX_RECOVERY_ATTEMPTS) recoverLandmarker();
    else setStatus(`手勢偵測失敗：${error.message || "WebGL 內容遺失，請重新整理"}`, "error");
  }
  requestAnimationFrame(detectLoop);
  return;
}

async function recoverLandmarker() {
  isRecoveringLandmarker = true;
  recoveryAttempts++;
  try { handLandmarker?.close?.(); } catch (_) {}
  handLandmarker = undefined;
  landmarkerLoadPromise = null;
  try { await preloadHandLandmarker(); detectErrorCount = 0; }
  finally { isRecoveringLandmarker = false; }
}
```
