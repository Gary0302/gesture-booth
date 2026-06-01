style_css = r'''
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Arial, "Noto Sans TC", sans-serif;
  background: #f7f1e8;
  color: #222;
}

.app {
  width: min(92vw, 520px);
  margin: 0 auto;
  padding: 24px 0 40px;
  text-align: center;
}

h1 {
  margin-bottom: 8px;
  font-size: 28px;
}

.subtitle {
  margin-top: 0;
  color: #666;
  font-size: 14px;
}

.camera-card {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  background: #111;
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
}

video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
}

.countdown {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 90px;
  font-weight: bold;
  color: white;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

#status,
#gestureText {
  margin: 12px 0;
  font-size: 16px;
}

.buttons {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
  margin: 16px 0 24px;
}

button {
  border: none;
  border-radius: 999px;
  padding: 12px 18px;
  background: #111;
  color: white;
  font-size: 15px;
  cursor: pointer;
}

button:hover {
  opacity: 0.85;
}

#resultCanvas {
  width: 100%;
  max-width: 420px;
  background: white;
  border-radius: 18px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
}
'''

with open("gesture-booth/style.css", "w", encoding="utf-8") as f:
    f.write(style_css)

print("style.css 建立完成")
