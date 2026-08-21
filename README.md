# Retro Love Photobooth

A complete dependency-light photobooth project designed for IntelliJ IDEA. It uses the supplied heart-paper background, heart vinyl, and Nikon camera artwork. The live webcam appears inside the camera screen; a 3-2-1 countdown captures a photo, and the captured photo then remains inside that same camera screen for review.

> **One asset is still missing.** `frontend/assets/heart-vinyl.png` (the heart-shaped vinyl record) didn't come through with the other three images, so it isn't included in this build. Everything else — background, camera artwork, transparent-screen overlay, layout reference — is in place and working. Drop the real `heart-vinyl.png` into `frontend/assets/` and it will appear automatically in the top-right corner; no code changes needed. Until then, `index.html` will just show a broken-image icon there.

## What is included

- Separate `frontend/` and `backend/` source folders.
- Browser webcam access via `navigator.mediaDevices.getUserMedia()`.
- Preferred Full HD request: 1920×1080, 30 FPS, with graceful fallback to 1280×720 or the best camera/browser setting available.
- Camera-device selector.
- Actual active resolution/FPS display.
- Mirrored live photobooth preview.
- 3-2-1 countdown and flash animation.
- Captured-photo review inside the Nikon screen.
- Retake, download, and server-side save buttons.
- Java backend that saves accepted JPEGs to `captured-photos/`.
- No Java framework dependency is required to run the server; JDK 17+ is enough.
- Maven metadata is included mainly so IntelliJ recognizes the Java source structure automatically.

## Project structure

```text
RetroLovePhotoBooth/
├─ pom.xml
├─ README.md
├─ CLAUDE_PROMPT.md
├─ run.bat
├─ run.sh
├─ captured-photos/
│  └─ .gitkeep
├─ backend/
│  ├─ pom.xml
│  └─ src/main/java/com/retrolove/photobooth/
│     └─ PhotoBoothServer.java
└─ frontend/
   ├─ index.html
   ├─ css/
   │  └─ styles.css
   ├─ js/
   │  └─ app.js
   └─ assets/
      ├─ paper-hearts-bg.jpg
      ├─ heart-vinyl.png        (not yet supplied — see note above)
      ├─ nikon-camera-original.png
      ├─ nikon-camera-overlay.png
      └─ reference-layout.png
```

## IntelliJ IDEA setup

### 1. Requirements

Install:

- IntelliJ IDEA Community or Ultimate.
- JDK 17 or newer. JDK 21 is also fine.
- Chrome or Microsoft Edge is recommended for webcam testing.

You do **not** need Node.js, npm, React, Spring Boot, Tomcat, or a database for this version.

### 2. Open the project

1. Extract the ZIP.
2. Open IntelliJ IDEA.
3. Choose **File → Open**.
4. Select the extracted `RetroLovePhotoBooth` folder, not only the backend folder.
5. If IntelliJ asks whether to trust the project, choose **Trust Project**.
6. IntelliJ should notice the root `pom.xml` and import the Maven module.
7. Open **File → Project Structure → Project** and set **Project SDK** to JDK 17 or newer.

If Maven import does not start automatically, right-click the root `pom.xml` and choose **Add as Maven Project**.

### 3. Run from IntelliJ

Open:

```text
backend/src/main/java/com/retrolove/photobooth/PhotoBoothServer.java
```

Click the green Run triangle beside:

```java
public static void main(String[] args)
```

The Run console should show:

```text
Retro Love Photobooth is running.
Open: http://localhost:8080
```

Then open this exact address in Chrome/Edge:

```text
http://localhost:8080
```

Do not open `frontend/index.html` directly with `file://...`; browsers normally block or limit camera access there. The included Java server gives the frontend a proper localhost origin.

## Quick run without IntelliJ

### Windows

Double-click `run.bat` or run it from Command Prompt.

### macOS/Linux

```bash
./run.sh
```

Both scripts compile only the single Java backend class and start the server on port 8080.

## Camera permission and HD behavior

On first load, the browser should ask for camera permission. Choose **Allow**.

The frontend first requests approximately:

```text
1920 × 1080
30 FPS
```

If a webcam/browser cannot provide that exact level, the code automatically falls back instead of crashing. The resolution badge inside the camera screen shows the **actual** resolution selected by the browser/driver.

Important: software cannot force a webcam to output Full HD if the hardware, USB mode, driver, operating system, or browser does not provide it. A real 1080p/4K webcam plus good lighting is required for genuinely high-quality photos.

For the cleanest result:

- Use a real 1080p or 4K webcam.
- Connect directly to a USB 3.x port where possible.
- Close Zoom, Teams, Google Meet, OBS, Camera, or other apps that may lock the webcam.
- Use good front lighting.
- In Windows camera privacy settings, allow desktop apps/browser camera access.
- In the browser address bar, verify the site camera permission is set to **Allow**.

## How the photo flow works

1. The page requests the webcam.
2. Live video is mirrored and placed inside the Nikon screen.
3. Press **Take Photo** or the Space key.
4. The app displays `3 → 2 → 1`.
5. The current camera frame is cropped to the visible Nikon-screen aspect ratio.
6. The JPEG is rendered at the highest useful source resolution from the camera feed.
7. The live video is replaced by the captured image inside the same camera screen.
8. **Retake** restores live camera mode.
9. **Download** saves the JPEG through the browser.
10. **Save to Booth** POSTs the JPEG to the Java backend and stores it in `captured-photos/`.

## Backend routes

```text
GET  /api/health
GET  /api/photos
POST /api/photos        Content-Type: image/jpeg
GET  /captured/{name}
```

`POST /api/photos` accepts a JPEG body up to 20 MB and creates a timestamped file.

## Saved photos

Server-saved photos appear here:

```text
captured-photos/
```

Example:

```text
captured-photos/retro-love-20260819-004500-123.jpg
```

## Change the design later

The main visual positions are in:

```text
frontend/css/styles.css
```

Important classes:

```text
.booth           heart-paper background
.vinyl           heart record position/size
.camera-shell    camera size/rotation
.screen-window   exact live-photo area inside the camera
.control-panel   user controls
```

The camera artwork has two versions:

```text
nikon-camera-original.png
nikon-camera-overlay.png
```

`nikon-camera-overlay.png` contains a transparent screen opening so the live webcam can sit behind the camera body/bezel. It was generated from `nikon-camera-original.png` by cutting the flat grey screen area to transparent while keeping the flower, lips, heart, and dice stickers opaque, so they still sit on top of the video/photo like stickers on glass. If you ever need to regenerate it, `.screen-window`'s position (`--screen-left`, `--screen-top`, `--screen-width`, `--screen-height` in `styles.css`) must stay in sync with wherever the transparent opening actually sits in the PNG.

## Troubleshooting

### Camera permission blocked

Click the camera/lock icon near the browser address bar, allow Camera, then click **Restart HD Camera**.

### Black screen / camera already in use

Close other apps that use the webcam and restart the camera.

### Only 640×480 or 1280×720 appears

That is the resolution the browser/driver is currently exposing. Check webcam driver/software, USB connection, other apps, and the webcam's real supported modes.

### Port 8080 is busy

Set another port before starting.

Windows PowerShell:

```powershell
$env:PHOTOBOOTH_PORT="8081"
```

macOS/Linux:

```bash
export PHOTOBOOTH_PORT=8081
```

Then use the matching localhost URL.

### IntelliJ cannot locate the frontend

Normally the backend auto-detects the project root. If your Run Configuration uses an unusual working directory, add this VM option:

```text
-Dphotobooth.root=C:\full\path\to\RetroLovePhotoBooth
```

Use the correct path for your machine.

## Production note

`localhost` is considered a secure camera context by modern browsers. If you later host this on another computer/domain, use **HTTPS**; plain HTTP on a non-localhost domain will normally not be allowed to access the webcam.
