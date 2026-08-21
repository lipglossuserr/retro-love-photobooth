# Claude Prompt — Retro Love Photobooth Project

You are working on a complete IntelliJ-friendly photobooth project named **RetroLovePhotoBooth**. Treat the existing project and supplied image assets as the source of truth. Do not redesign away from the user's reference unless explicitly asked.

## Goal

Build and maintain a fully working desktop-browser photobooth with separate frontend and backend source folders. The visual style must match the supplied reference composition:

1. The first supplied image is the full-screen heart-paper background.
2. The second supplied image is a heart-shaped vinyl record placed in a top/right corner in front of the background.
3. The third supplied image is a retro red Nikon camera frame.
4. The live webcam preview must appear **inside the screen area of that Nikon camera image**.
5. After the user takes a photo, the live camera preview must be replaced by the captured photo **inside the exact same camera screen**.
6. The fourth supplied image is only a layout/composition reference showing the approximate rotated camera and vinyl placement.

## Existing architecture

Keep the project easy to open and run in IntelliJ IDEA.

```text
RetroLovePhotoBooth/
├─ pom.xml
├─ README.md
├─ run.bat
├─ run.sh
├─ captured-photos/
├─ backend/
│  ├─ pom.xml
│  └─ src/main/java/com/retrolove/photobooth/
│     └─ PhotoBoothServer.java
└─ frontend/
   ├─ index.html
   ├─ css/styles.css
   ├─ js/app.js
   └─ assets/
      ├─ paper-hearts-bg.jpg
      ├─ heart-vinyl.png
      ├─ nikon-camera-original.png
      ├─ nikon-camera-overlay.png
      └─ reference-layout.png
```

The backend is intentionally dependency-light Java 17+ using `com.sun.net.httpserver.HttpServer`. It serves the separate `frontend/` directory and provides photo-saving API endpoints. Do not replace it with Spring Boot, React, Electron, JavaFX, Node.js, or a database unless the user specifically requests that migration.

## Frontend requirements

Use plain HTML/CSS/JavaScript and preserve the existing visual assets.

The frontend must:

- Use `paper-hearts-bg.jpg` as the full viewport background.
- Place `heart-vinyl.png` in a corner above the background.
- Display the retro Nikon artwork large and slightly rotated, similar to the reference.
- Keep the webcam/video visible only inside the camera's screen opening.
- Use `nikon-camera-overlay.png` as the camera bezel/body overlay with a transparent screen area.
- Remain responsive on common laptop displays and smaller screens.
- Request browser webcam access using `navigator.mediaDevices.getUserMedia()`.
- Prefer 1920×1080 video and around 30 FPS.
- Gracefully fall back if Full HD is not available.
- Allow switching among available `videoinput` devices.
- Display the actual active camera resolution/FPS from `MediaStreamTrack.getSettings()`.
- Mirror the live preview like a normal selfie booth.
- Capture the photo at the highest useful actual source resolution, not at DOM/CSS display size.
- Crop the saved frame to match the visible camera-screen aspect ratio so the saved image matches what the user saw.
- Mirror the captured frame so it matches the mirrored preview.
- Encode captured images as high-quality JPEG, around quality 0.95–0.97.
- Implement a 3-2-1 countdown.
- Implement a short flash effect.
- After capture, hide the live video and show the captured image inside the camera screen.
- Provide Take Photo, Retake, Download, Save to Booth, Restart Camera, and camera-selector controls.
- Support Space for capture, R for retake, and D for download.
- Show useful permission/device errors instead of failing silently.
- Never assume software can force 1080p if the webcam/driver/browser does not provide it.

## Backend requirements

Keep Java 17+ and the current package:

```text
com.retrolove.photobooth
```

The backend must:

- Bind to localhost by default.
- Serve the static frontend from the separate `frontend/` folder.
- Serve the project at `http://localhost:8080` by default.
- Support an environment override named `PHOTOBOOTH_PORT`.
- Support an optional `PHOTOBOOTH_CAPTURE_DIR` override.
- Provide `GET /api/health`.
- Provide `GET /api/photos` to list saved booth photos.
- Provide `POST /api/photos` accepting raw `image/jpeg` request bodies.
- Reject excessively large uploads (current target: 20 MB max).
- Verify basic JPEG signature bytes before saving.
- Generate safe timestamp-based filenames on the server.
- Save approved images under `captured-photos/` by default.
- Serve saved images under `/captured/{filename}`.
- Prevent directory traversal.
- Set sensible content types, cache headers, and `Permissions-Policy: camera=(self)`.
- Keep frontend and backend on the same localhost origin so no CORS setup is necessary.

## Camera security requirements

Modern browsers normally allow webcam access only on a secure context. `http://localhost` is accepted as a secure local-development context. Do not tell the user to open `frontend/index.html` directly using `file://` for the real photobooth flow.

If the project is deployed to a real domain or another machine, explain that HTTPS is required for camera access.

## Asset rules

Do not replace the supplied images with generated substitutes. Preserve these roles:

- `paper-hearts-bg.jpg` = background
- `heart-vinyl.png` = foreground corner decoration
- `nikon-camera-original.png` = untouched original camera artwork
- `nikon-camera-overlay.png` = processed camera artwork with transparent screen opening
- `reference-layout.png` = composition reference only

If screen alignment needs improvement, adjust the CSS geometry of `.screen-window` and/or regenerate only the transparent opening in `nikon-camera-overlay.png`. Keep the original asset untouched.

## UI direction

The look should feel romantic, retro, scrapbook-like, and polished rather than like an admin dashboard. Controls should be clean and secondary to the visual camera composition. Use burgundy/wine, cream, paper, and muted shadow tones. Avoid unrelated neon colors or generic blue SaaS styling.

## Quality checks before declaring success

Always verify:

1. Java backend compiles on JDK 17+.
2. `http://localhost:8080/api/health` returns success.
3. `/` serves the photobooth frontend.
4. All four original/reference assets load correctly.
5. The webcam requests permission once the page loads.
6. Denied permission shows a readable recovery message.
7. A real video frame appears inside the camera screen.
8. The camera selector works after permission is granted.
9. The active resolution badge shows the browser/driver's actual setting.
10. Take Photo triggers the countdown.
11. The captured image is shown inside the same camera screen.
12. Retake returns to live video.
13. Download produces a valid JPEG.
14. Save to Booth creates a JPEG under `captured-photos/`.
15. The server cannot write outside the capture directory through the URL.
16. The page remains usable at laptop and mobile-ish viewport widths.

## When modifying code

Return complete replacement files when a change is substantial. For each file, clearly state its exact project path. Do not provide partial snippets that omit required imports or dependencies. Preserve existing working features unless the requested change conflicts with them.

When debugging, first identify whether the failure is in browser permission, camera hardware/driver, frontend JavaScript, static asset path, server working directory, or backend photo saving. Do not randomly rewrite unrelated files.

The final result should be a reliable romantic retro photobooth that can be opened in IntelliJ, run with one Java main class, accessed at localhost in Chrome/Edge, and used to capture and save high-quality webcam photos inside the supplied Nikon camera design.
