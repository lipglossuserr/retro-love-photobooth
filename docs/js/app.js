"use strict";

/**
 * Retro Love Photobooth — frontend logic.
 * Plain JS, no build step. Talks to the same-origin Java backend at /api/*.
 */
(() => {
  // Width / height ratio of the visible Nikon screen opening (see styles.css
  // --screen-* custom properties). The LIVE camera feed is cropped to this
  // so what's on screen lines up with the Nikon overlay art. This is
  // unrelated to how the final saved photo is framed (see FRAME_HOLE below).
  const LIVE_SCREEN_ASPECT = 0.7538586515028433; // width / height
  const JPEG_QUALITY = 0.96;

  // Where the transparent photo opening sits inside assets/polaroid.png, in
  // source pixels. Only the SAVED/DOWNLOADED photo gets composited into
  // this frame — the live webcam view always stays the Nikon camera look.
  const FRAME_SRC = "assets/polaroid.png";
  const FRAME_HOLE = { x: 111, y: 402, width: 928, height: 950 };
  const FRAME_HOLE_ASPECT = FRAME_HOLE.width / FRAME_HOLE.height;

  // Many laptops expose a second "camera" that is actually an infrared
  // sensor for Windows Hello face login. Browsers can pick it by default,
  // and it returns real (non-erroring) frames that are just solid black,
  // since only the Windows Hello driver stack can turn on its illuminator.
  const IR_LABEL_PATTERN = /\b(ir|infrared|depth|hello)\b/i;
  const BLACK_FRAME_LUMA_THRESHOLD = 10; // mean 0-255 luma considered "black"
  const BLACK_FRAME_SAMPLES_NEEDED = 3;
  const BLACK_FRAME_SAMPLE_INTERVAL_MS = 500;

  const els = {
    video: document.getElementById("liveVideo"),
    photo: document.getElementById("capturedPhoto"),
    canvas: document.getElementById("captureCanvas"),
    screenMessage: document.getElementById("screenMessage"),
    countdown: document.getElementById("countdown"),
    countdownNumber: document.getElementById("countdownNumber"),
    flash: document.getElementById("flash"),
    resBadge: document.getElementById("resBadge"),
    cameraSelect: document.getElementById("cameraSelect"),
    btnCapture: document.getElementById("btnCapture"),
    btnRetake: document.getElementById("btnRetake"),
    btnDownload: document.getElementById("btnDownload"),
    btnSave: document.getElementById("btnSave"),
    btnRestart: document.getElementById("btnRestart"),
    errorBanner: document.getElementById("errorBanner"),
    saveStatus: document.getElementById("saveStatus"),
  };

  const state = {
    stream: null,
    counting: false,
    hasPhoto: false,
    lastBlob: null,
    frameImage: null,
    frameReady: null,
    devices: [],
    autoSwitchedForBlackFeed: false,
    blackFrameStreak: 0,
    blackFrameTimer: null,
  };

  // ----------------------------------------------------------------------
  // Small UI helpers
  // ----------------------------------------------------------------------

  function showError(message) {
    els.errorBanner.textContent = message;
    els.errorBanner.classList.remove("hidden");
  }

  function clearError() {
    els.errorBanner.classList.add("hidden");
    els.errorBanner.textContent = "";
  }

  function showSaveStatus(message) {
    els.saveStatus.textContent = message;
    els.saveStatus.classList.remove("hidden");
  }

  function clearSaveStatus() {
    els.saveStatus.classList.add("hidden");
    els.saveStatus.textContent = "";
  }

  function showScreenMessage(message) {
    els.screenMessage.textContent = message;
    els.screenMessage.classList.remove("hidden");
  }

  function hideScreenMessage() {
    els.screenMessage.classList.add("hidden");
    els.screenMessage.textContent = "";
  }

  function setBadge(text) {
    els.resBadge.textContent = text;
  }

  // ----------------------------------------------------------------------
  // Frame artwork (assets/polaroid.png) — preloaded once so it's ready
  // in memory the instant a photo is composited for download/save.
  // ----------------------------------------------------------------------

  function preloadFrameImage() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        state.frameImage = img;
        resolve(img);
      };
      img.onerror = () => {
        console.error("Could not load frame artwork at " + FRAME_SRC);
        resolve(null);
      };
      img.src = FRAME_SRC;
    });
  }
  function ensureFrameImage() {
    if (state.frameImage) return Promise.resolve(state.frameImage);
    if (!state.frameReady) {
      state.frameReady = preloadFrameImage();
    }
    return state.frameReady.then((img) => {
      if (!img) state.frameReady = null; // let the next call retry
      return img;
    });
  }

  /**
   * Bakes the captured photo into the polaroid.png artwork: draws the photo
   * into the frame's transparent opening, then draws the frame on top. This
   * is what actually gets downloaded / saved — never the bare rectangle.
   */
  function compositeWithFrame(sourceCanvas) {
    const frame = state.frameImage;
    if (!frame) return sourceCanvas; // defensive fallback only; buildFramedBlob guards against this

    const out = document.createElement("canvas");
    out.width = frame.naturalWidth;
    out.height = frame.naturalHeight;
    const ctx = out.getContext("2d");

    ctx.drawImage(
        sourceCanvas,
        0, 0, sourceCanvas.width, sourceCanvas.height,
        FRAME_HOLE.x, FRAME_HOLE.y, FRAME_HOLE.width, FRAME_HOLE.height
    );
    ctx.drawImage(frame, 0, 0, out.width, out.height);
    return out;
  }

  // ----------------------------------------------------------------------
  // Camera acquisition with graceful Full HD -> fallback chain
  // ----------------------------------------------------------------------

  const CONSTRAINT_CHAIN = (deviceId) => [
    {
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    },
    {
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    },
    {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    },
  ];

  async function acquireStream(deviceId) {
    let lastError = null;
    for (const constraints of CONSTRAINT_CHAIN(deviceId)) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastError = err;
        if (err.name !== "OverconstrainedError" && err.name !== "ConstraintNotSatisfiedError") {
          throw err;
        }
      }
    }
    throw lastError || new Error("Could not start the camera.");
  }

  function stopStream() {
    stopBlackFrameWatcher();
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
    }
  }

  function messageForError(err) {
    switch (err && err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Camera permission was blocked. Click the camera/lock icon near the address bar, choose Allow, then press \u201cRestart HD Camera.\u201d";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No camera device was found. Plug in a webcam and press \u201cRestart HD Camera.\u201d";
      case "NotReadableError":
      case "TrackStartError":
        return "The camera seems to be in use by another app (Zoom, Teams, OBS...). Close it and press \u201cRestart HD Camera.\u201d";
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        return "This camera couldn't meet the requested settings. Try a different camera from the selector.";
      default:
        return "Couldn't start the camera (" + (err && err.message ? err.message : "unknown error") + ").";
    }
  }

  async function startCamera(deviceId, { userInitiated = false } = {}) {
    clearError();
    hideScreenMessage();
    stopStream();
    setBadge("\u2014 \u00d7 \u2014 \u00b7 \u2014fps");

    if (userInitiated) {
      state.autoSwitchedForBlackFeed = false;
      clearBlackFeedWarning();
    }

    try {
      const stream = await acquireStream(deviceId);
      state.stream = stream;
      els.video.srcObject = stream;
      els.video.classList.add("mirrored");

      await new Promise((resolve) => {
        if (els.video.readyState >= 1) return resolve();
        els.video.onloadedmetadata = () => resolve();
      });
      await els.video.play().catch(() => {});

      updateBadgeFromTrack(stream);
      await refreshDeviceList(stream);

      // Fast path: if this device's own label admits it's an IR/Hello
      // sensor and a different camera is available, switch immediately
      // instead of waiting for the frame-brightness check below.
      if (!userInitiated && !state.autoSwitchedForBlackFeed) {
        const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
        const activeDevice = state.devices.find((d) => d.deviceId === activeId);
        if (activeDevice && IR_LABEL_PATTERN.test(activeDevice.label)) {
          const alt = pickAlternateDevice();
          if (alt) {
            state.autoSwitchedForBlackFeed = true;
            await startCamera(alt.deviceId, { userInitiated: false });
            return;
          }
        }
      }

      // Safety net: watch actual frame brightness in case the label gave
      // no hint (some drivers just call it "Camera 2").
      startBlackFrameWatcher();
    } catch (err) {
      showError(messageForError(err));
      showScreenMessage("Camera unavailable.\n" + messageForError(err));
    }
  }

  function pickAlternateDevice() {
    if (state.devices.length < 2) return null;
    const activeId = state.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    const nonIr = state.devices.find(
        (d) => d.deviceId !== activeId && !IR_LABEL_PATTERN.test(d.label)
    );
    if (nonIr) return nonIr;
    return state.devices.find((d) => d.deviceId !== activeId) || null;
  }

  function clearBlackFeedWarning() {
    els.cameraSelect.classList.remove("alert");
  }

  /**
   * Periodically samples the live video at a tiny resolution and checks
   * average brightness. A real webcam pointed at a person is essentially
   * never near-zero for multiple seconds in a row; an IR sensor without an
   * active illuminator (or a physically covered lens) reliably is.
   */
  function startBlackFrameWatcher() {
    stopBlackFrameWatcher();
    state.blackFrameStreak = 0;
    const probe = document.createElement("canvas");
    probe.width = 16;
    probe.height = 16;
    const pctx = probe.getContext("2d", { willReadFrequently: true });

    state.blackFrameTimer = setInterval(() => {
      if (!state.stream || state.hasPhoto || els.video.readyState < 2) return;
      try {
        pctx.drawImage(els.video, 0, 0, 16, 16);
        const data = pctx.getImageData(0, 0, 16, 16).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        const avg = sum / (data.length / 4);

        if (avg < BLACK_FRAME_LUMA_THRESHOLD) {
          state.blackFrameStreak += 1;
        } else {
          state.blackFrameStreak = 0;
          clearBlackFeedWarning();
        }

        if (state.blackFrameStreak >= BLACK_FRAME_SAMPLES_NEEDED) {
          handleSuspectedBlackFeed();
        }
      } catch (e) {
        // Transient failures during device switches are expected; ignore.
      }
    }, BLACK_FRAME_SAMPLE_INTERVAL_MS);
  }

  function stopBlackFrameWatcher() {
    if (state.blackFrameTimer) {
      clearInterval(state.blackFrameTimer);
      state.blackFrameTimer = null;
    }
  }

  function handleSuspectedBlackFeed() {
    stopBlackFrameWatcher();
    const candidate = pickAlternateDevice();

    if (candidate && !state.autoSwitchedForBlackFeed) {
      state.autoSwitchedForBlackFeed = true;
      showError(
          "This camera's feed looks black (common with IR/Windows Hello cameras). Switching to another camera\u2026"
      );
      startCamera(candidate.deviceId, { userInitiated: false });
      return;
    }

    showError(
        "This camera's feed still looks black. Pick your regular color webcam from the dropdown below \u2014 many laptops also expose a separate infrared camera for Windows Hello that browsers can select by mistake."
    );
    els.cameraSelect.classList.add("alert");
  }

  function updateBadgeFromTrack(stream) {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getSettings !== "function") {
      setBadge("\u2014 \u00d7 \u2014 \u00b7 \u2014fps");
      return;
    }
    const settings = track.getSettings();
    const width = settings.width || els.video.videoWidth || "\u2014";
    const height = settings.height || els.video.videoHeight || "\u2014";
    const fps = settings.frameRate ? Math.round(settings.frameRate) : "\u2014";
    setBadge(`${width} \u00d7 ${height} \u00b7 ${fps}fps`);
  }

  // ----------------------------------------------------------------------
  // Device enumeration / selector
  // ----------------------------------------------------------------------

  async function refreshDeviceList(currentStream) {
    if (!navigator.mediaDevices.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const cams = all.filter((d) => d.kind === "videoinput");
    state.devices = cams;

    const activeId = currentStream?.getVideoTracks()[0]?.getSettings().deviceId;

    els.cameraSelect.innerHTML = "";
    if (cams.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No cameras found";
      els.cameraSelect.appendChild(opt);
      return;
    }

    cams.forEach((cam, i) => {
      const opt = document.createElement("option");
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Camera ${i + 1}`;
      if (cam.deviceId === activeId) opt.selected = true;
      els.cameraSelect.appendChild(opt);
    });
  }

  els.cameraSelect.addEventListener("change", () => {
    const id = els.cameraSelect.value;
    if (id) startCamera(id, { userInitiated: true });
  });

  // ----------------------------------------------------------------------
  // Countdown + flash + capture
  // ----------------------------------------------------------------------

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runCountdown() {
    els.countdown.classList.remove("hidden");
    for (const n of [3, 2, 1]) {
      els.countdownNumber.textContent = String(n);
      els.countdownNumber.style.animation = "none";
      els.countdownNumber.offsetHeight;
      els.countdownNumber.style.animation = "";
      await sleep(700);
    }
    els.countdown.classList.add("hidden");
  }

  function fireFlash() {
    els.flash.classList.remove("firing");
    void els.flash.offsetWidth;
    els.flash.classList.add("firing");
  }

  /**
   * Draws the current video frame onto a canvas at the camera's real source
   * resolution, cropped to the given aspect ratio and mirrored so it matches
   * what the user saw in the live preview. Called once per aspect ratio
   * needed (the Nikon live screen and the polaroid save frame differ).
   */
  function captureFrameToCanvas(targetAspect) {
    const video = els.video;
    const sw = video.videoWidth;
    const sh = video.videoHeight;
    if (!sw || !sh) return null;

    const sourceAspect = sw / sh;
    let cropW = sw;
    let cropH = sh;
    if (sourceAspect > targetAspect) {
      cropH = sh;
      cropW = Math.round(sh * targetAspect);
    } else {
      cropW = sw;
      cropH = Math.round(sw / targetAspect);
    }
    const sx = Math.round((sw - cropW) / 2);
    const sy = Math.round((sh - cropH) / 2);

    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");

    ctx.save();
    ctx.translate(cropW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
    ctx.restore();

    return canvas;
  }

  async function takePhoto() {
    if (state.counting || !state.stream) return;
    state.counting = true;
    els.btnCapture.disabled = true;

    await runCountdown();
    fireFlash();

    const liveCanvas = captureFrameToCanvas(LIVE_SCREEN_ASPECT);
    state.counting = false;

    if (!liveCanvas) {
      showError("Couldn't read a frame from the camera. Try Restart HD Camera.");
      els.btnCapture.disabled = false;
      return;
    }

    // Show the raw Nikon-screen shot immediately, exactly as before.
    showCapturedPhoto(liveCanvas);

    // Independently crop the same instant to the polaroid frame's aspect
    // ratio and bake it into assets/polaroid.png in the background. Only
    // this version becomes the download / Save to Booth file.
    const saveCanvas = captureFrameToCanvas(FRAME_HOLE_ASPECT);
    buildFramedBlob(saveCanvas || liveCanvas);
  }

  async function buildFramedBlob(sourceCanvas) {
    const frame = state.frameImage || (await ensureFrameImage());
    if (!frame) {
      showError("Couldn't load the polaroid frame artwork. Check your connection, then press \u201cRetake\u201d to try again.");
      return; // Download/Save stay disabled — an unframed photo is never exported.
    }

    const framedCanvas = compositeWithFrame(sourceCanvas);
    framedCanvas.toBlob(
        (blob) => {
          if (!blob) {
            showError("Couldn't encode the framed photo. Please try again.");
            return;
          }
          state.lastBlob = blob;
          if (state.hasPhoto) {
            els.btnDownload.disabled = false;
            els.btnSave.disabled = false;
          }
        },
        "image/jpeg",
        JPEG_QUALITY
    );
  }

  function showCapturedPhoto(canvas) {
    els.photo.src = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    els.photo.classList.remove("hidden");
    els.video.classList.add("hidden");
    state.hasPhoto = true;

    els.btnCapture.disabled = true;
    els.btnRetake.disabled = false;
    // Download/Save stay disabled until the framed version finishes baking
    // in buildFramedBlob(), so nothing un-framed can ever be exported.
    els.btnDownload.disabled = true;
    els.btnSave.disabled = true;
    clearSaveStatus();
  }

  function retake() {
    state.hasPhoto = false;
    state.lastBlob = null;
    els.photo.classList.add("hidden");
    els.video.classList.remove("hidden");

    els.btnCapture.disabled = !state.stream;
    els.btnRetake.disabled = true;
    els.btnDownload.disabled = true;
    els.btnSave.disabled = true;
    clearSaveStatus();
  }

  function downloadPhoto() {
    if (!state.lastBlob) return;
    const stamp = new Date()
        .toISOString()
        .replace(/[:T]/g, "-")
        .replace(/\..+/, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(state.lastBlob);
    a.download = `photobooth-${stamp}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function saveToBooth() {
    if (!state.lastBlob) return;
    clearSaveStatus();
    els.btnSave.disabled = true;
    try {
      const res = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: state.lastBlob,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Server responded ${res.status}. ${text}`);
      }
      const data = await res.json();
      showSaveStatus(`Saved to the booth as ${data.filename}.`);
    } catch (err) {
      showError("Couldn't save to the booth: " + err.message);
    } finally {
      els.btnSave.disabled = false;
    }
  }

  // ----------------------------------------------------------------------
  // Wiring
  // ----------------------------------------------------------------------

  els.btnCapture.addEventListener("click", takePhoto);
  els.btnRetake.addEventListener("click", retake);
  els.btnDownload.addEventListener("click", downloadPhoto);
  els.btnSave.addEventListener("click", saveToBooth);
  els.btnRestart.addEventListener("click", () =>
      startCamera(els.cameraSelect.value || undefined, { userInitiated: true })
  );

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.code === "Space") {
      e.preventDefault();
      if (!state.hasPhoto) takePhoto();
    } else if (e.key === "r" || e.key === "R") {
      if (state.hasPhoto) retake();
    } else if (e.key === "d" || e.key === "D") {
      if (state.hasPhoto) downloadPhoto();
    }
  });

  window.addEventListener("beforeunload", stopStream);

  // ----------------------------------------------------------------------
  // Boot
  // ----------------------------------------------------------------------

  state.frameReady = preloadFrameImage();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError("This browser doesn't support camera access. Try the latest Chrome or Edge over http://localhost.");
    showScreenMessage("Camera API not available in this browser.");
  } else {
    startCamera(undefined, { userInitiated: false });
  }

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => refreshDeviceList(state.stream));
  }
})();