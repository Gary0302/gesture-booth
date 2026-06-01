# AI 手勢四格拍貼機

透過手勢比 1～4 根手指，自動拍攝四格照片並套用不同濾鏡的 Web 拍貼機。

## 使用方式

1. 開啟網站（需 HTTPS 才能使用相機）
2. 按下「開啟相機」並允許相機權限
3. 依序比 1、2、3、4 根手指拍攝四格
4. 完成後按「下載四格照」

## 技術

- [MediaPipe Hand Landmarker](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) — 手勢辨識
- [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html) — 照片濾鏡
- 純前端靜態網站，可部署至 Vercel

---

## 修復紀錄（Vercel 部署後手勢偵測失效）

### 問題

部署到 Vercel 後，相機可以開啟，但手勢偵測無法正常運作。

### 原因與修正

#### 1. MediaPipe GPU delegate 在部分裝置失敗

**原因：** 原本固定使用 `delegate: "GPU"`。在 Safari、部分手機或沒有 WebGL 支援的環境，GPU 模式初始化會失敗，導致整個手勢辨識無法啟動。

**修正：** 先嘗試 GPU，失敗時自動 fallback 到 CPU。

```javascript
try {
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { ...baseOptions, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 1
  });
} catch (gpuError) {
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { ...baseOptions, delegate: "CPU" },
    runningMode: "VIDEO",
    numHands: 1
  });
}
```

#### 2. OpenCV 載入時序競態（race condition）

**原因：** OpenCV.js 以 `async` 載入，完成後立刻呼叫 `onOpenCvReady()`，但 callback 原本定義在 ES module 裡，可能尚未執行，造成 `onOpenCvReady is not defined`，濾鏡無法套用。

**修正：** 在 `index.html` 用 inline script 先定義 callback，確保 OpenCV 載入完成時一定找得到。

```html
<script>
  window.isOpenCvReady = false;
  window.onOpenCvReady = function () {
    window.isOpenCvReady = true;
  };
</script>
<script async src="https://docs.opencv.org/4.x/opencv.js" onload="onOpenCvReady();"></script>
```

#### 3. 手勢偵測每幀重複執行，時間戳不正確

**原因：** `detectForVideo()` 需要在「新影片幀」時呼叫，且 timestamp 需遞增。原本每個 animation frame 都偵測，可能導致結果不穩定。

**修正：** 用 `video.currentTime` 判斷是否為新幀，只有新幀才執行偵測。

```javascript
if (video.currentTime !== lastVideoTime) {
  lastVideoTime = video.currentTime;
  const results = handLandmarker.detectForVideo(video, now);
}
```

#### 4. 相機未明確播放

**原因：** 部分瀏覽器即使設了 `autoplay`，仍需要手動呼叫 `video.play()` 才會真正開始送 frame。

**修正：** 在 `setupCamera()` 加入 `await video.play()`。

#### 5. ES module import 位置

**原因：** `import` 語句原本寫在其他程式碼之後，不符合標準 module 寫法。

**修正：** 將 `import` 移至 `script.js` 最上方。

#### 6. 載入狀態提示

**修正：** 新增「載入手勢辨識中...」、「手勢辨識已就緒」等狀態文字，方便確認流程是否正常。

---

## 部署

### Vercel

```bash
vercel --prod
```

在 Vercel Dashboard 連接 GitHub repo：`Gary0302/gesture-booth`

### 本地測試

因相機需要 HTTPS，本地請用：

```bash
npx serve .
```

或使用任何支援 HTTPS 的本地 server。
