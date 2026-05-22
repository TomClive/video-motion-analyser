/**
 * SeeDance Frame Fixer
 * Core Application Logic
 */

// Global State
let state = {
  originalFrames: [], // Array of { name, img, blob, file }
  frames: [],         // Active frames being edited/fixed
  diffs: [],          // Diff values between frames: diffs[i] is difference between frames[i-1] and frames[i]
  anomalies: [],      // Detected anomalies: { index, type: 'duplicate'|'jump', severity, description }
  
  // Playback Control
  currentIndex: 0,
  isPlaying: false,
  playbackInterval: null,
  playbackFps: 24,
  loop: true,
  
  // Viewer Options
  viewMode: 'normal', // 'normal' | 'onion' | 'diff'
  onionOpacity: 0.5,
  
  // Analysis Parameters
  dupThreshold: 0.5,   // in % difference
  jumpThreshold: 2.5,  // multiplier of local median
  
  // Advanced Interpolation Configuration
  interpolationMethod: 'linear', // 'linear' | 'shutter' | 'flow'
  shutterSamples: 5,
  flowBlockSize: 16,
  flowSearchRange: 16,
  
  // File Tracking
  loadedFileName: '',
  loadedFileType: '', // 'video' | 'folder' | 'demo'
  originalVideoFile: null
};

// Canvas references
let viewportCanvas = null;
let viewportCtx = null;
let timelineCanvas = null;
let timelineCtx = null;

// Inspector Canvas references
let prevCanvas = null;
let prevCtx = null;
let currentCanvas = null;
let currentCtx = null;

// Tiny offscreen canvas for fast comparison diffing
const analysisCanvas = document.createElement('canvas');
analysisCanvas.width = 80;
analysisCanvas.height = 60;
const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });

// Initial Setup on DOM Content Loaded
document.addEventListener('DOMContentLoaded', () => {
  initElements();
  setupEventListeners();
  initTimelineCanvas();
});

// Initialize DOM References
function initElements() {
  viewportCanvas = document.getElementById('viewport-canvas');
  viewportCtx = viewportCanvas.getContext('2d');
  
  timelineCanvas = document.getElementById('timeline-canvas');
  timelineCtx = timelineCanvas.getContext('2d');
  
  prevCanvas = document.getElementById('inspector-prev-canvas');
  prevCtx = prevCanvas.getContext('2d');
  
  currentCanvas = document.getElementById('inspector-current-canvas');
  currentCtx = currentCanvas.getContext('2d');
}

// Bind Event Listeners
function setupEventListeners() {
  // Drag & Drop
  const dropZone = document.getElementById('drop-zone-welcome');
  const welcomeOverlay = document.getElementById('welcome-overlay');
  
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    }, false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    }, false);
  });
  
  dropZone.addEventListener('drop', handleDrop, false);
  
  // File inputs
  document.getElementById('file-input-welcome').addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleVideoFile(e.target.files[0]);
  });
  
  document.getElementById('folder-input-welcome').addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFolderUpload(e.target.files);
  });
  
  // Reset App
  document.getElementById('btn-reset-app').addEventListener('click', resetApp);
  
  // Demo Loader
  document.getElementById('btn-load-demo').addEventListener('click', loadDemoSequence);
  
  // Playback Buttons
  document.getElementById('btn-play-toggle').addEventListener('click', togglePlay);
  document.getElementById('btn-play-first').addEventListener('click', () => selectFrame(0));
  document.getElementById('btn-play-last').addEventListener('click', () => selectFrame(state.frames.length - 1));
  document.getElementById('btn-play-prev').addEventListener('click', () => selectFrame(state.currentIndex - 1));
  document.getElementById('btn-play-next').addEventListener('click', () => selectFrame(state.currentIndex + 1));
  
  // Playback Settings
  document.getElementById('input-play-loop').addEventListener('change', (e) => {
    state.loop = e.target.checked;
  });
  
  document.getElementById('select-playback-fps').addEventListener('change', (e) => {
    state.playbackFps = parseInt(e.target.value, 10);
    if (state.isPlaying) {
      pause();
      play();
    }
  });
  
  // View Mode Selectors
  document.getElementById('btn-view-normal').addEventListener('click', () => setViewMode('normal'));
  document.getElementById('btn-view-onion').addEventListener('click', () => setViewMode('onion'));
  document.getElementById('btn-view-diff').addEventListener('click', () => setViewMode('diff'));
  
  // Onion Opacity Slider
  const onionSlider = document.getElementById('input-onion-opacity');
  const onionValueDisplay = document.getElementById('val-onion-opacity');
  onionSlider.addEventListener('input', (e) => {
    state.onionOpacity = parseFloat(e.target.value) / 100;
    onionValueDisplay.textContent = `${e.target.value}%`;
    renderViewport();
  });
  
  // Settings Controls
  const dupSlider = document.getElementById('input-dup-thresh');
  const dupDisplay = document.getElementById('val-dup-thresh');
  dupSlider.addEventListener('input', (e) => {
    state.dupThreshold = parseFloat(e.target.value);
    dupDisplay.textContent = `${state.dupThreshold.toFixed(2)}%`;
  });
  
  const jumpSlider = document.getElementById('input-jump-thresh');
  const jumpDisplay = document.getElementById('val-jump-thresh');
  jumpSlider.addEventListener('input', (e) => {
    state.jumpThreshold = parseFloat(e.target.value);
    jumpDisplay.textContent = `${state.jumpThreshold.toFixed(1)}x`;
  });
  
  document.getElementById('btn-reanalyze').addEventListener('click', () => {
    analyzeSequence();
  });
  
  // Fix Suite Buttons
  document.getElementById('btn-autofix-dups').addEventListener('click', autoFixAllDuplicates);
  document.getElementById('btn-export-sequence').addEventListener('click', exportRepairedSequence);
  document.getElementById('btn-export-video').addEventListener('click', exportRepairedVideo);
  
  // NLE Exporter bindings
  document.getElementById('btn-export-resolve-markers').addEventListener('click', exportResolveMarkers);
  document.getElementById('btn-export-premiere-edl').addEventListener('click', exportPremiereEDL);
  document.getElementById('btn-export-damaged-zip').addEventListener('click', exportDamagedZIP);
  
  // Pro NLE integration bindings: Import AI Repaired Frames
  const btnImportRepaired = document.getElementById('btn-import-repaired');
  const inputImportRepaired = document.getElementById('input-import-repaired');
  if (btnImportRepaired && inputImportRepaired) {
    btnImportRepaired.addEventListener('click', () => {
      inputImportRepaired.click();
    });
    inputImportRepaired.addEventListener('change', importRepairedFrames);
  }
  
  // Advanced Interpolation bindings
  const selectMethod = document.getElementById('select-interpolation-method');
  const shutterParams = document.getElementById('shutter-params');
  const flowParams = document.getElementById('flow-params');
  
  selectMethod.addEventListener('change', (e) => {
    state.interpolationMethod = e.target.value;
    shutterParams.style.display = (state.interpolationMethod === 'shutter') ? 'block' : 'none';
    flowParams.style.display = (state.interpolationMethod === 'flow') ? 'flex' : 'none';
  });
  
  const shutterSlider = document.getElementById('input-shutter-samples');
  const shutterDisplay = document.getElementById('val-shutter-samples');
  shutterSlider.addEventListener('input', (e) => {
    state.shutterSamples = parseInt(e.target.value, 10);
    shutterDisplay.textContent = state.shutterSamples;
  });
  
  const blockSizeSlider = document.getElementById('input-flow-block-size');
  const blockSizeDisplay = document.getElementById('val-flow-block-size');
  blockSizeSlider.addEventListener('input', (e) => {
    state.flowBlockSize = parseInt(e.target.value, 10);
    blockSizeDisplay.textContent = `${state.flowBlockSize}px`;
  });
  
  const searchRangeSlider = document.getElementById('input-flow-search-range');
  const searchRangeDisplay = document.getElementById('val-flow-search-range');
  searchRangeSlider.addEventListener('input', (e) => {
    state.flowSearchRange = parseInt(e.target.value, 10);
    searchRangeDisplay.textContent = `${state.flowSearchRange}px`;
  });
  
  // Single Frame Repair Buttons
  document.getElementById('btn-fix-single-interpolate').addEventListener('click', () => {
    interpolateSingleFrame(state.currentIndex);
  });
  document.getElementById('btn-fix-single-delete').addEventListener('click', () => {
    deleteSingleFrame(state.currentIndex);
  });
  
  // Resize timeline canvas on window resize
  window.addEventListener('resize', () => {
    resizeTimelineCanvas();
    drawTimeline();
  });
}

// Initialize and size Timeline Canvas
function initTimelineCanvas() {
  resizeTimelineCanvas();
  
  // Mouse events on timeline for scrubbing
  let isDragging = false;
  
  const getTimelineFrame = (e) => {
    if (state.frames.length === 0) return 0;
    const rect = timelineCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padding = 20;
    const timelineWidth = rect.width - padding * 2;
    
    let ratio = (x - padding) / timelineWidth;
    ratio = Math.max(0, Math.min(1, ratio));
    
    return Math.round(ratio * (state.frames.length - 1));
  };
  
  timelineCanvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    const frameIndex = getTimelineFrame(e);
    selectFrame(frameIndex);
  });
  
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const frameIndex = getTimelineFrame(e);
    selectFrame(frameIndex);
  });
  
  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

function resizeTimelineCanvas() {
  const container = timelineCanvas.parentElement;
  timelineCanvas.width = container.clientWidth * window.devicePixelRatio;
  timelineCanvas.height = container.clientHeight * window.devicePixelRatio;
  timelineCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

// Reset UI state to start
function resetApp() {
  pause();
  state.originalFrames = [];
  state.frames = [];
  state.diffs = [];
  state.anomalies = [];
  state.currentIndex = 0;
  state.loadedFileName = '';
  state.loadedFileType = '';
  state.originalVideoFile = null;
  
  // Hide workspace items, show welcome overlay
  document.getElementById('welcome-overlay').classList.remove('hidden');
  document.getElementById('btn-reset-app').style.display = 'none';
  
  // Disable actions
  setWorkspaceActive(false);
  updateStatus("No Sequence Loaded", "inactive");
}

function setWorkspaceActive(active) {
  const elements = [
    'btn-reanalyze', 'btn-play-toggle', 'btn-play-first', 'btn-play-last', 
    'btn-play-prev', 'btn-play-next', 'btn-view-normal', 'btn-view-onion', 
    'btn-view-diff', 'select-playback-fps', 'btn-autofix-dups', 
    'btn-export-resolve-markers', 'btn-export-premiere-edl', 'btn-export-damaged-zip',
    'btn-export-sequence', 'btn-export-video', 'btn-import-repaired'
  ];
  
  elements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !active;
  });
}

function updateStatus(text, type) {
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');
  
  statusText.textContent = text;
  
  statusDot.className = "status-dot";
  if (type === "active") statusDot.classList.add("active");
  if (type === "success") statusDot.classList.add("success");
  if (type === "processing") statusDot.classList.add("processing");
}

// -------------------------------------------------------------
// LOADING ENGINES
// -------------------------------------------------------------

// Handle Drop Event
function handleDrop(e) {
  const dt = e.dataTransfer;
  
  // Check if dropped folder or files
  if (dt.items && dt.items.length > 0) {
    const item = dt.items[0].webkitGetAsEntry();
    if (item && item.isDirectory) {
      // It's a directory! Unfortunately, standard webkitGetAsEntry requires recursive reading.
      // Easiest is asking the user to use the file selector or standard file drops
      showLoader("Reading folder...", "Processing folders");
      traverseDirectory(item);
      return;
    }
  }
  
  // Fallback to files list
  const files = dt.files;
  if (files.length === 1 && files[0].type.startsWith('video/')) {
    handleVideoFile(files[0]);
  } else {
    // Treat as folder/multiple images
    handleFolderUpload(files);
  }
}

// Directory Traversal helper (webkitEntry)
async function traverseDirectory(directoryEntry) {
  try {
    const files = [];
    const readEntries = (dirReader) => {
      return new Promise((resolve, reject) => {
        dirReader.readEntries(entries => {
          resolve(entries);
        }, reject);
      });
    };
    
    const dirReader = directoryEntry.createReader();
    let entries = await readEntries(dirReader);
    
    // Read all entries (since readEntries might be paged)
    let allEntries = [...entries];
    while (entries.length > 0) {
      entries = await readEntries(dirReader);
      allEntries = allEntries.concat(entries);
    }
    
    const filePromises = allEntries
      .filter(entry => entry.isFile && /\.(png|jpe?g|webp)$/i.test(entry.name))
      .map(entry => {
        return new Promise((resolve) => {
          entry.file(file => {
            resolve(file);
          });
        });
      });
      
    const imageFiles = await Promise.all(filePromises);
    hideLoader();
    
    if (imageFiles.length > 0) {
      handleFolderUpload(imageFiles);
    } else {
      alert("No image files (PNG/JPG/WEBP) found in the dropped folder.");
    }
  } catch (err) {
    hideLoader();
    alert("Error reading dropped folder. Please use the folder selector.");
  }
}

// Handle folder of image frames
function handleFolderUpload(fileList) {
  showLoader("Loading Image Sequence...", "Sorting frames");
  
  // Filter out non-images and sort alphabetically by file name
  const files = Array.from(fileList)
    .filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    
  if (files.length < 2) {
    hideLoader();
    alert("Please select a folder containing at least 2 image frames.");
    return;
  }
  
  state.loadedFileName = files[0].name.split('_')[0] || "sequence";
  state.loadedFileType = 'folder';
  
  loadFramesFromFiles(files);
}

// Load image files in parallel using a concurrency pool
async function loadFramesFromFiles(files) {
  state.originalFrames = [];
  const total = files.length;
  let loadedCount = 0;
  
  // Create an array to hold all results in order
  const results = new Array(total);
  
  // Helper to load a single file and store in results
  const loadWorker = async (index) => {
    const file = files[index];
    try {
      const img = await loadImageFromFile(file);
      results[index] = {
        name: file.name,
        img: img,
        blob: file,
        file: file
      };
    } catch (err) {
      console.warn("Skipping corrupt frame: ", file.name);
      results[index] = null;
    } finally {
      loadedCount++;
      updateLoaderProgress(loadedCount / total, `Loading frames...`, `Loaded ${loadedCount} of ${total} files`);
    }
  };
  
  // We can load them concurrently.
  // To avoid overwhelming browser memory for large sequences (e.g. 500 frames),
  // we can use a rolling pool of maximum 12 concurrent requests.
  const concurrencyLimit = 12;
  const queue = [...Array(total).keys()]; // Array of indices [0, 1, 2, ..., total-1]
  
  const runWorker = async () => {
    while (queue.length > 0) {
      const index = queue.shift();
      await loadWorker(index);
    }
  };
  
  // Start parallel workers
  const workers = [];
  for (let i = 0; i < Math.min(concurrencyLimit, total); i++) {
    workers.push(runWorker());
  }
  
  await Promise.all(workers);
  
  // Filter out any failed null values
  state.originalFrames = results.filter(r => r !== null);
  
  finishFrameLoading();
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Decode Video frame-by-frame
function handleVideoFile(file) {
  state.loadedFileName = file.name;
  state.loadedFileType = 'video';
  state.originalVideoFile = file;
  
  showLoader("Decoding Video File...", "Initializing decoder");
  
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  
  video.onloadedmetadata = () => {
    // Small timeout to allow the browser to paint the loader overlay before the blocking prompt pops up
    setTimeout(async () => {
      // Query FPS
      let fps = 24;
      const userFps = prompt("What is the framerate (FPS) of this video? AI clips are usually 24 or 30.", "24");
      if (userFps) fps = parseInt(userFps, 10) || 24;
      state.playbackFps = fps;
      document.getElementById('select-playback-fps').value = fps.toString();
      
      const duration = video.duration;
      const totalFrames = Math.ceil(duration * fps);
      
      state.originalFrames = [];
      
      // Hidden canvas for extraction
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      
      let frameIndex = 0;
      
      const extractNextFrame = async () => {
        if (frameIndex >= totalFrames) {
          finishFrameLoading();
          return;
        }
        
        const targetTime = frameIndex / fps;
        updateLoaderProgress(frameIndex / totalFrames, `Decoding frame ${frameIndex+1} of ${totalFrames}`, `${targetTime.toFixed(2)}s`);
        
        video.currentTime = targetTime;
      };
      
      video.onseeked = async () => {
        // Draw frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to blob / image
        try {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
          const imgUrl = URL.createObjectURL(blob);
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imgUrl;
          });
          
          state.originalFrames.push({
            name: `frame_${String(frameIndex + 1).padStart(4, '0')}.jpg`,
            img: img,
            blob: blob
          });
          
          frameIndex++;
          extractNextFrame();
        } catch (err) {
          console.error("Frame seek error: ", err);
          frameIndex++;
          extractNextFrame();
        }
      };
      
      // Start Extraction
      extractNextFrame();
    }, 80);
  };
  
  video.onerror = () => {
    hideLoader();
    alert("Error loading video file. Please make sure it's a valid MP4, WebM or MOV video.");
  };
}

// Generate an in-memory synthetic animation sequence (DEMO)
async function loadDemoSequence() {
  state.loadedFileName = "SeeDance_Demo_Clip";
  state.loadedFileType = 'demo';
  
  showLoader("Generating Demo Sequence...", "Initializing shapes");
  
  state.originalFrames = [];
  const totalFrames = 60;
  
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  
  // Dynamic parameters for bouncing ball
  let ballX = 80;
  let ballY = 240;
  let ballSpeedX = 6;
  let ballSpeedY = -3;
  const ballRadius = 24;
  
  for (let i = 0; i < totalFrames; i++) {
    updateLoaderProgress(i / totalFrames, `Rendering Frame ${i+1} of ${totalFrames}`, `frame_${String(i+1).padStart(4, '0')}`);
    
    // DECISION LOGIC FOR DROPS & DUPLICATES
    let frameToDraw = i;
    
    // 1. INJECT DUPLICATES
    if (i >= 15 && i < 17) {
      // Repeat Frame 14! (2 frames of duplicate freeze)
      // We don't advance the physics
    } else if (i >= 42 && i < 44) {
      // Repeat Frame 41! (2 frames of duplicate freeze)
    } else {
      // Normal physics update
      ballX += ballSpeedX;
      ballY += ballSpeedY;
      
      // Wall collisions
      if (ballX + ballRadius > canvas.width || ballX - ballRadius < 0) {
        ballSpeedX = -ballSpeedX;
        ballX += ballSpeedX;
      }
      if (ballY + ballRadius > canvas.height || ballY - ballRadius < 0) {
        ballSpeedY = -ballSpeedY;
        ballY += ballSpeedY;
      }
      
      // 2. INJECT MOTION JUMP (DROPPED FRAME EFFECT)
      if (i === 28) {
        // Skip ahead by 3 frames worth of motion! Creates a huge jump!
        ballX += ballSpeedX * 3.5;
        ballY += ballSpeedY * 3.5;
      }
    }
    
    // Draw Frame Content
    // Background - Dark Grid
    ctx.fillStyle = '#0a0b12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Grid Lines
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.15)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    
    // Decorative moving background rings (slow rotation)
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 140 + Math.sin(i * 0.05) * 10, 0, Math.PI * 2);
    ctx.stroke();
    
    // Smooth trail shadow
    ctx.fillStyle = 'rgba(6, 182, 212, 0.03)';
    ctx.beginPath();
    ctx.arc(ballX - ballSpeedX * 2, ballY - ballSpeedY * 2, ballRadius - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(6, 182, 212, 0.08)';
    ctx.beginPath();
    ctx.arc(ballX - ballSpeedX, ballY - ballSpeedY, ballRadius - 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Bouncing Neon Sphere
    const gradient = ctx.createRadialGradient(
      ballX - 4, ballY - 4, 2,
      ballX, ballY, ballRadius
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.2, '#22d3ee');
    gradient.addColorStop(0.8, '#0891b2');
    gradient.addColorStop(1, '#0e7490');
    
    ctx.shadowColor = 'rgba(6, 182, 212, 0.5)';
    ctx.shadowBlur = 15;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
    ctx.fill();
    
    // Clear shadow state
    ctx.shadowBlur = 0;
    
    // HUD / Frame Indicators
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 16px Outfit, sans-serif';
    ctx.fillText("SeeDance 2 Simulator", 24, 40);
    
    ctx.fillStyle = 'rgba(6, 182, 212, 0.9)';
    ctx.font = '12px monospace';
    ctx.fillText(`FRAME: ${String(i).padStart(4, '0')}`, 24, 60);
    ctx.fillText(`X: ${Math.round(ballX)} Y: ${Math.round(ballY)}`, 24, 76);
    
    // Visual indicators of drop inject zones so the user knows what's happening
    if (i >= 15 && i < 17) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#3b82f6';
      ctx.font = 'bold 18px Outfit, sans-serif';
      ctx.fillText("⚠️ DUPLICATE INJECTED (STUTTER)", 190, 240);
    } else if (i === 28) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 18px Outfit, sans-serif';
      ctx.fillText("⚠️ MOTION JUMP INJECTED (DROP)", 180, 240);
    }
    
    // Convert to Image
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const imgUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imgUrl;
      });
      
      state.originalFrames.push({
        name: `demo_frame_${String(i + 1).padStart(4, '0')}.png`,
        img: img,
        blob: blob
      });
    } catch (err) {
      console.error("Demo render error: ", err);
    }
  }
  
  finishFrameLoading();
}

// Complete sequence loading process
function finishFrameLoading() {
  // Clone original frames into working frames
  state.frames = [...state.originalFrames];
  state.currentIndex = 0;
  
  // Adjust sidebar sequence metadata
  const sideInfo = document.getElementById('sidebar-sequence-info');
  sideInfo.innerHTML = `
    <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; margin-top: 4px;">
      <span style="color: var(--text-muted);">Name:</span>
      <span style="font-weight: 500; word-break: break-all;">${state.loadedFileName}</span>
      <span style="color: var(--text-muted);">Source:</span>
      <span>${state.loadedFileType.toUpperCase()}</span>
      <span style="color: var(--text-muted);">Frames:</span>
      <span id="meta-frames-count" style="font-family: monospace;">${state.frames.length}</span>
      <span style="color: var(--text-muted);">Resolution:</span>
      <span style="font-family: monospace;">${state.frames[0].img.width}x${state.frames[0].img.height}</span>
    </div>
  `;
  
  // Setup sizing
  viewportCanvas.width = state.frames[0].img.width;
  viewportCanvas.height = state.frames[0].img.height;
  
  prevCanvas.width = state.frames[0].img.width;
  prevCanvas.height = state.frames[0].img.height;
  currentCanvas.width = state.frames[0].img.width;
  currentCanvas.height = state.frames[0].img.height;
  
  // Hide Welcome page
  document.getElementById('welcome-overlay').classList.add('hidden');
  document.getElementById('btn-reset-app').style.display = 'block';
  
  // Enable workspace actions
  setWorkspaceActive(true);
  updateStatus("Sequence Loaded", "success");
  
  // Trigger initial analysis
  analyzeSequence();
}

// -------------------------------------------------------------
// ANALYZER ENGINE
// -------------------------------------------------------------

// Calculate Frame-by-frame absolute diffs
async function analyzeSequence() {
  if (state.frames.length < 2) return;
  
  showLoader("Analyzing Motion Curve...", "Computing frame deltas");
  
  state.diffs = [0]; // Frame 0 has 0 diff
  const total = state.frames.length;
  
  for (let i = 1; i < total; i++) {
    if (i % 10 === 0) {
      updateLoaderProgress(i / total, "Analyzing frame differences...", `Frame ${i} of ${total}`);
      // Yield to UI Thread to prevent tab freeze
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    const diff = compareFrames(state.frames[i-1].img, state.frames[i].img);
    state.diffs.push(diff);
  }
  
  // Trigger anomaly detection logic
  detectAnomalies();
  
  hideLoader();
  selectFrame(0);
  
  // Enable Re-analyze button
  document.getElementById('btn-reanalyze').disabled = false;
  document.getElementById('btn-autofix-dups').disabled = false;
  
  // Only show auto-smooth jumps button for video sequences, as it changes timing
  document.getElementById('btn-autofix-jumps').style.display = 'block';
  document.getElementById('btn-autofix-jumps').disabled = false;
}

// Core Image Difference function: downscales and compares Mean Absolute Error (MAE)
function compareFrames(img1, img2) {
  const w = analysisCanvas.width;
  const h = analysisCanvas.height;
  
  // Draw previous frame
  analysisCtx.drawImage(img1, 0, 0, w, h);
  const data1 = analysisCtx.getImageData(0, 0, w, h).data;
  
  // Draw current frame
  analysisCtx.drawImage(img2, 0, 0, w, h);
  const data2 = analysisCtx.getImageData(0, 0, w, h).data;
  
  let absoluteSum = 0;
  const numPixels = w * h;
  
  // Sum absolute differences in R, G, B channels (ignoring Alpha)
  for (let i = 0; i < data1.length; i += 4) {
    absoluteSum += Math.abs(data1[i] - data2[i]);       // Red
    absoluteSum += Math.abs(data1[i+1] - data2[i+1]);   // Green
    absoluteSum += Math.abs(data1[i+2] - data2[i+2]);   // Blue
  }
  
  // Convert to average difference percentage (Max absolute diff is 255 * 3 per pixel)
  const mae = absoluteSum / (numPixels * 3);
  const percentageDiff = (mae / 255) * 100;
  
  return percentageDiff;
}

// Detect Duplicates and Motion Spikes (Jumps)
function detectAnomalies() {
  state.anomalies = [];
  
  const dupThresh = state.dupThreshold;
  const jumpThresh = state.jumpThreshold;
  const total = state.frames.length;
  
  let dupCount = 0;
  let jumpCount = 0;
  
  // 1. Identify Duplicates
  for (let i = 1; i < total; i++) {
    const diff = state.diffs[i];
    
    if (diff <= dupThresh) {
      // Exclude repaired frames from being flagged as stutters
      if (state.frames[i].repaired || (state.frames[i-1] && state.frames[i-1].repaired)) {
        continue;
      }
      
      state.anomalies.push({
        index: i,
        type: 'duplicate',
        severity: (dupThresh - diff) / dupThresh, // higher severity means closer to 0
        description: `Identical frame sequence. Difference of ${diff.toFixed(3)}% is below threshold.`
      });
      dupCount++;
    }
  }
  
  // 2. Identify Motion Jumps using a Local Median rolling filter
  // We compare each diff to the median diff in a local window surrounding the frame
  const windowRadius = 3;
  for (let i = 1; i < total; i++) {
    // Skip if it's already classified as a duplicate to avoid double flagging
    if (state.diffs[i] <= dupThresh) continue;
    
    // Gather surrounding diff values
    const surroundingDiffs = [];
    for (let w = -windowRadius; w <= windowRadius; w++) {
      const idx = i + w;
      if (idx >= 1 && idx < total && idx !== i) {
        // Exclude duplicate frames from the motion median base
        if (state.diffs[idx] > dupThresh) {
          surroundingDiffs.push(state.diffs[idx]);
        }
      }
    }
    
    if (surroundingDiffs.length > 0) {
      // Find median
      surroundingDiffs.sort((a, b) => a - b);
      const median = surroundingDiffs[Math.floor(surroundingDiffs.length / 2)];
      
      // If diff is a spike relative to local median
      const currentDiff = state.diffs[i];
      if (currentDiff > median * jumpThresh && currentDiff > 0.8) { // Min base diff of 0.8% to avoid triggering on static noise spikes
        
        // A: Check if the transition involves an actively repaired (blended/inserted) frame
        const isRepaired = state.frames[i].repaired || (state.frames[i-1] && state.frames[i-1].repaired);
        
        // B: Linearity Check (Jerk Filter) for plateaus:
        // When we interpolate a duplicate, it creates 2 adjacent transitions of almost identical height.
        // If current diff is extremely close to the next diff (within 15% relative difference),
        // it means we have uniform, steady-speed motion rather than an isolated sudden spasm.
        const nextDiff = state.diffs[i+1];
        const isLinearTransition = nextDiff && Math.abs(currentDiff - nextDiff) < 0.15 * (currentDiff + nextDiff);
        
        if (isRepaired || isLinearTransition) {
          continue; // Gracefully suppress false positive motion jump alerts on smooth linear intervals!
        }
        
        state.anomalies.push({
          index: i,
          type: 'jump',
          severity: currentDiff / (median || 0.1),
          description: `Sudden motion leap! Delta is ${currentDiff.toFixed(2)}% (${(currentDiff / (median || 1)).toFixed(1)}x local median).`
        });
        jumpCount++;
      }
    }
  }
  
  // Sort anomalies by frame index
  state.anomalies.sort((a, b) => a.index - b.index);
  
  // Update UI Stats Cards
  document.getElementById('stat-duplicates-count').textContent = dupCount;
  document.getElementById('stat-jumps-count').textContent = jumpCount;
  
  const dupCard = document.getElementById('stat-card-duplicates');
  const jumpCard = document.getElementById('stat-card-jumps');
  
  if (dupCount > 0) dupCard.classList.add('has-issues');
  else dupCard.classList.remove('has-issues');
  
  if (jumpCount > 0) jumpCard.classList.add('has-issues');
  else jumpCard.classList.remove('has-issues');
  
  // Build Sidebar List Panel
  renderAnomalyList();
  
  // Redraw timeline track
  drawTimeline();
}

// Render the scrollable list of anomalies in sidebar
function renderAnomalyList() {
  const container = document.getElementById('anomaly-list-container');
  container.innerHTML = '';
  
  if (state.anomalies.length === 0) {
    container.innerHTML = `
      <div class="empty-reports">
        🎉 No anomalies detected! Motion is smooth.
      </div>
    `;
    return;
  }
  
  state.anomalies.forEach(anomaly => {
    const item = document.createElement('div');
    item.className = `report-item ${state.currentIndex === anomaly.index ? 'active' : ''}`;
    item.dataset.index = anomaly.index;
    
    const dotClass = anomaly.type === 'duplicate' ? 'duplicate' : 'jump';
    const typeLabel = anomaly.type === 'duplicate' ? 'Duplicate Frame' : 'Motion Jump';
    const padIndex = String(anomaly.index).padStart(4, '0');
    
    item.innerHTML = `
      <div class="report-dot ${dotClass}"></div>
      <div class="report-details">
        <div class="report-title">
          <span>${typeLabel}</span>
          <span class="report-frame">#${padIndex}</span>
        </div>
        <div class="report-desc">${anomaly.description}</div>
      </div>
    `;
    
    item.addEventListener('click', () => {
      selectFrame(anomaly.index);
    });
    
    container.appendChild(item);
  });
}

// -------------------------------------------------------------
// VIEWPORT & DRAWING ENGINE
// -------------------------------------------------------------

// Select and sync timeline/preview around a specific frame index
function selectFrame(index) {
  if (state.frames.length === 0) return;
  
  // Boundary check
  if (index < 0) {
    if (state.loop) index = state.frames.length - 1;
    else index = 0;
  } else if (index >= state.frames.length) {
    if (state.loop) index = 0;
    else index = state.frames.length - 1;
  }
  
  state.currentIndex = index;
  
  // Update frame number indicator
  document.getElementById('viewport-frame-indicator').textContent = `FRAME: ${String(index).padStart(4, '0')}`;
  
  // Timecode Math
  const fps = state.playbackFps;
  const currentSeconds = index / fps;
  const totalSeconds = (state.frames.length - 1) / fps;
  
  const formatTimecode = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
  };
  
  document.getElementById('timecode-current').textContent = formatTimecode(currentSeconds);
  document.getElementById('timecode-total').textContent = formatTimecode(totalSeconds);
  
  // Select active anomaly item in sidebar
  const activeItems = document.querySelectorAll('.report-item');
  activeItems.forEach(item => {
    if (parseInt(item.dataset.index, 10) === index) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      item.classList.remove('active');
    }
  });
  
  // Sync Inspectors & Viewport
  renderViewport();
  renderInspector();
  drawTimeline();
}

// Render the main display canvas
function renderViewport() {
  if (state.frames.length === 0) return;
  
  const img = state.frames[state.currentIndex].img;
  viewportCtx.clearRect(0, 0, viewportCanvas.width, viewportCanvas.height);
  
  const onionSliderContainer = document.getElementById('onion-slider-container');
  
  if (state.viewMode === 'normal' || state.currentIndex === 0) {
    onionSliderContainer.style.display = 'none';
    viewportCtx.drawImage(img, 0, 0);
  } 
  
  else if (state.viewMode === 'onion') {
    onionSliderContainer.style.display = 'flex';
    
    // Draw previous frame base at full opacity
    const prevImg = state.frames[state.currentIndex - 1].img;
    viewportCtx.drawImage(prevImg, 0, 0);
    
    // Overlay current frame with transparency mix
    viewportCtx.globalAlpha = state.onionOpacity;
    viewportCtx.drawImage(img, 0, 0);
    viewportCtx.globalAlpha = 1.0; // Reset alpha
  } 
  
  else if (state.viewMode === 'diff') {
    onionSliderContainer.style.display = 'none';
    
    const prevImg = state.frames[state.currentIndex - 1].img;
    
    // Render side-by-side math onto hidden canvases to get imageData
    const w = viewportCanvas.width;
    const h = viewportCanvas.height;
    
    // Create temporary processing canvas
    const pCanvas = document.createElement('canvas');
    pCanvas.width = w;
    pCanvas.height = h;
    const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });
    
    // Previous Frame
    pCtx.drawImage(prevImg, 0, 0);
    const dataPrev = pCtx.getImageData(0, 0, w, h).data;
    
    // Current Frame
    pCtx.drawImage(img, 0, 0);
    const imgDataCurr = pCtx.getImageData(0, 0, w, h);
    const dataCurr = imgDataCurr.data;
    
    // Visual Diff Heatmap calculation
    for (let i = 0; i < dataCurr.length; i += 4) {
      // Delta diffs for Red, Green, Blue
      const dR = Math.abs(dataCurr[i] - dataPrev[i]);
      const dG = Math.abs(dataCurr[i+1] - dataPrev[i+1]);
      const dB = Math.abs(dataCurr[i+2] - dataPrev[i+2]);
      
      // Amplify changes to glow brightly (multiplier factor of 5)
      const amp = 5;
      const intensity = Math.max(dR, dG, dB) * amp;
      
      // Neon heat visualizer color mapping:
      // High motion = glowing hot cyan/magenta, static = black
      dataCurr[i] = Math.min(255, dR * amp + intensity * 0.3);     // Red
      dataCurr[i+1] = Math.min(255, dG * amp + intensity * 0.8);   // Green
      dataCurr[i+2] = Math.min(255, dB * amp + intensity * 1.0);   // Blue
      dataCurr[i+3] = 255;                                         // Solid Alpha
    }
    
    pCtx.putImageData(imgDataCurr, 0, 0);
    viewportCtx.drawImage(pCanvas, 0, 0);
  }
}

// Render the right split panel detail thumbnails
function renderInspector() {
  if (state.frames.length === 0) return;
  
  const currentIdx = state.currentIndex;
  const prevIdx = currentIdx > 0 ? currentIdx - 1 : 0;
  
  // Set index labels
  document.getElementById('inspector-prev-index').textContent = `#${String(prevIdx).padStart(4, '0')}`;
  document.getElementById('inspector-current-index').textContent = `#${String(currentIdx).padStart(4, '0')}`;
  
  // Draw thumbnails
  const prevImg = state.frames[prevIdx].img;
  prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
  prevCtx.drawImage(prevImg, 0, 0, prevCanvas.width, prevCanvas.height);
  
  const currImg = state.frames[currentIdx].img;
  currentCtx.clearRect(0, 0, currentCanvas.width, currentCanvas.height);
  currentCtx.drawImage(currImg, 0, 0, currentCanvas.width, currentCanvas.height);
  
  // Update Anomaly Fix Details
  const isAnomaly = state.anomalies.find(a => a.index === currentIdx);
  const isRepaired = state.frames[currentIdx].repaired;
  
  const infoHeader = document.getElementById('inspector-anomaly-header');
  const infoDot = document.getElementById('inspector-anomaly-type-dot');
  const infoType = document.getElementById('inspector-anomaly-type');
  const infoDesc = document.getElementById('inspector-anomaly-desc');
  
  const btnInterpolate = document.getElementById('btn-fix-single-interpolate');
  const btnDelete = document.getElementById('btn-fix-single-delete');
  
  if (isAnomaly) {
    infoHeader.style.display = 'flex';
    btnDelete.disabled = false;
    
    if (isAnomaly.type === 'duplicate') {
      infoHeader.className = "anomaly-type-title duplicate";
      infoDot.className = "report-dot duplicate";
      infoType.textContent = "DUPLICATE FRAME DETECTED";
      infoDesc.textContent = `This frame is identical to the previous frame. It freezes motion causing stutter. Smooth it out by interpolating (blending previous & next frame) or deleting the duplicate.`;
      
      btnInterpolate.disabled = (currentIdx === 0 || currentIdx === state.frames.length - 1);
    } else {
      infoHeader.className = "anomaly-type-title jump";
      infoDot.className = "report-dot jump";
      infoType.textContent = "MOTION JUMP DETECTED";
      infoDesc.textContent = `A sudden positional leap in motion indicates a potential dropped frame. Smooth this jump by inserting a blended frame to act as the missing frame.`;
      
      btnInterpolate.disabled = false;
    }
  } else if (isRepaired) {
    // Render a gorgeous repaired success notice
    infoHeader.style.display = 'flex';
    infoHeader.className = "anomaly-type-title repaired";
    infoDot.className = "report-dot repaired";
    infoType.textContent = "SMOOTHED / INTERPOLATED FRAME";
    infoDesc.textContent = `This frame has been dynamically blended using linear interpolation to restore motion smoothness. Stutter is resolved!`;
    
    btnInterpolate.disabled = (currentIdx === 0 || currentIdx === state.frames.length - 1);
    btnDelete.disabled = false;
  } else {
    // Normal frame selection
    infoHeader.className = "anomaly-type-title";
    infoHeader.style.display = 'none';
    infoType.textContent = "Smooth Frame";
    infoDesc.textContent = `Frame #${String(currentIdx).padStart(4, '0')} has normal temporal motion. You can still force an interpolation or delete it manually if needed.`;
    
    btnInterpolate.disabled = (currentIdx === 0 || currentIdx === state.frames.length - 1);
    btnDelete.disabled = false;
  }
  
  // Update AI Recommendations Blueprint Card
  const aiCard = document.getElementById('ai-blueprint-card');
  const aiContent = document.getElementById('ai-blueprint-content');
  
  if (isAnomaly && currentIdx > 0 && currentIdx < state.frames.length - 1) {
    // Calculate flanking frame velocity (MAE difference)
    const velocity = compareFrames(state.frames[currentIdx-1].img, state.frames[currentIdx+1].img);
    aiCard.style.display = 'flex';
    
    let modelRec = "";
    let resolveRec = "";
    let aeRec = "";
    let velocityLabel = "";
    
    if (velocity > 2.0) {
      velocityLabel = `<span style="color: #ff3366; font-weight: bold;">High Velocity (${velocity.toFixed(2)}% MAE)</span>`;
      modelRec = `<strong>Topaz Video AI:</strong> Use the <strong>Apollo</strong> or <strong>Apollo-8</strong> model. Highly suited for fast foreground movements and dancing. Set Sensitivity = 75, Tension = 20.`;
      resolveRec = `<strong>DaVinci Resolve:</strong> Apply <strong>Speed Warp</strong> (Neural Network flow). Settings: Motion Estimation = Enhanced, Motion Range = Large.`;
      aeRec = `<strong>After Effects:</strong> Use <strong>Timewarp</strong> (Pixel Motion). Increase Shutter Angle to 180° to add natural motion blur to hide fast morphs.`;
    } else {
      velocityLabel = `<span style="color: #00b4d8; font-weight: bold;">Low/Standard Velocity (${velocity.toFixed(2)}% MAE)</span>`;
      modelRec = `<strong>Topaz Video AI:</strong> Use the <strong>Chronos</strong> or <strong>Chronos Fast</strong> model. Excellent for slow, linear motion and pans. Blend Factor = 1.0.`;
      resolveRec = `<strong>DaVinci Resolve:</strong> Use <strong>Optical Flow (Enhanced Better)</strong>. This avoids Speed Warp rendering times and is cleaner for linear panning.`;
      aeRec = `<strong>After Effects:</strong> Use <strong>Pixel Motion</strong>. Shutter Angle = 90° is perfect for slow-pacing interpolation.`;
    }
    
    aiContent.innerHTML = `
      <div style="margin-bottom: 8px;">Segment Motion Speed: ${velocityLabel}</div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="background: rgba(255,255,255,0.05); padding: 6px; border-radius: 4px; border-left: 3px solid #ffb703;">${modelRec}</div>
        <div style="background: rgba(255,255,255,0.05); padding: 6px; border-radius: 4px; border-left: 3px solid #00b4d8;">${resolveRec}</div>
        <div style="background: rgba(255,255,255,0.05); padding: 6px; border-radius: 4px; border-left: 3px solid #9d4edd;">${aeRec}</div>
      </div>
    `;
  } else {
    aiCard.style.display = 'none';
  }
}

// -------------------------------------------------------------
// TIMELINE DRAWING
// -------------------------------------------------------------

// Draw custom canvas timeline track
function drawTimeline() {
  if (state.frames.length === 0) return;
  
  const w = timelineCanvas.width / window.devicePixelRatio;
  const h = timelineCanvas.height / window.devicePixelRatio;
  
  timelineCtx.clearRect(0, 0, w, h);
  
  const total = state.frames.length;
  const padding = 20;
  const trackWidth = w - padding * 2;
  
  // 1. Draw Background grid / track
  timelineCtx.fillStyle = '#06070a';
  timelineCtx.fillRect(padding, 4, trackWidth, h - 8);
  
  timelineCtx.strokeStyle = 'rgba(255,255,255,0.03)';
  timelineCtx.lineWidth = 1;
  const gridCount = 10;
  for (let g = 0; g <= gridCount; g++) {
    const gx = padding + (trackWidth * g) / gridCount;
    timelineCtx.beginPath();
    timelineCtx.moveTo(gx, 4);
    timelineCtx.lineTo(gx, h - 8);
    timelineCtx.stroke();
  }
  
  // Find max difference to scale the curve nicely
  const maxDiff = Math.max(...state.diffs, 1.5);
  
  // 2. Draw Motion Difference Waveform bars
  const barWidth = Math.max(1, trackWidth / total);
  
  for (let i = 1; i < total; i++) {
    const x = padding + (trackWidth * i) / total;
    const diff = state.diffs[i];
    
    // Scale height (max 80% track height)
    const barHeight = (diff / maxDiff) * (h - 24);
    const y = h - 12 - barHeight;
    
    // Determine bar color color coding
    let barColor = 'rgba(16, 185, 129, 0.4)'; // Emerald Green (normal motion)
    
    // Check if duplicate
    if (diff <= state.dupThreshold) {
      const isRepaired = state.frames[i].repaired || (state.frames[i-1] && state.frames[i-1].repaired);
      if (isRepaired) {
        barColor = 'rgba(139, 92, 246, 0.85)'; // Neon Purple (repaired)
      } else {
        barColor = 'rgba(59, 130, 246, 0.8)'; // Neon Blue (duplicate)
      }
    } else {
      const isRepaired = state.frames[i].repaired || (state.frames[i-1] && state.frames[i-1].repaired);
      if (isRepaired) {
        barColor = 'rgba(139, 92, 246, 0.85)'; // Neon Purple (repaired)
      } else {
        // Check if jump
        const isJump = state.anomalies.find(a => a.index === i && a.type === 'jump');
        if (isJump) {
          barColor = 'rgba(239, 68, 68, 0.8)'; // Red (motion jump)
        } else if (diff < state.dupThreshold * 2) {
          barColor = 'rgba(245, 158, 11, 0.5)'; // Yellow (low motion/near freeze)
        }
      }
    }
    
    timelineCtx.fillStyle = barColor;
    timelineCtx.fillRect(x - barWidth / 2, y, barWidth, barHeight);
  }
  
  // 3. Draw threshold lines
  // Duplicate Threshold line (blue dashes)
  const dupY = h - 12 - (state.dupThreshold / maxDiff) * (h - 24);
  timelineCtx.strokeStyle = 'rgba(59, 130, 246, 0.35)';
  timelineCtx.setLineDash([3, 3]);
  timelineCtx.lineWidth = 1;
  timelineCtx.beginPath();
  timelineCtx.moveTo(padding, dupY);
  timelineCtx.lineTo(padding + trackWidth, dupY);
  timelineCtx.stroke();
  timelineCtx.setLineDash([]); // Reset
  
  // 4. Draw Playhead
  const playheadX = padding + (trackWidth * state.currentIndex) / (total - 1);
  
  // Vertical line
  timelineCtx.strokeStyle = '#8b5cf6';
  timelineCtx.lineWidth = 2;
  timelineCtx.shadowColor = 'rgba(139, 92, 246, 0.5)';
  timelineCtx.shadowBlur = 4;
  timelineCtx.beginPath();
  timelineCtx.moveTo(playheadX, 4);
  timelineCtx.lineTo(playheadX, h - 4);
  timelineCtx.stroke();
  
  // Handle bubble marker
  timelineCtx.fillStyle = '#8b5cf6';
  timelineCtx.beginPath();
  timelineCtx.arc(playheadX, 4, 5, 0, Math.PI * 2);
  timelineCtx.fill();
  
  timelineCtx.fillStyle = '#cfd4ff';
  timelineCtx.font = '9px monospace';
  timelineCtx.fillText(`#${state.currentIndex}`, playheadX - 10, h - 2);
  
  timelineCtx.shadowBlur = 0; // Reset shadow
}

// -------------------------------------------------------------
// PLAYBACK SYSTEM
// -------------------------------------------------------------

function togglePlay() {
  if (state.isPlaying) {
    pause();
  } else {
    play();
  }
}

function play() {
  if (state.frames.length === 0) return;
  
  state.isPlaying = true;
  const playBtn = document.getElementById('btn-play-toggle');
  playBtn.textContent = "⏸";
  playBtn.classList.add('active');
  
  const intervalMs = 1000 / state.playbackFps;
  state.playbackInterval = setInterval(() => {
    selectFrame(state.currentIndex + 1);
  }, intervalMs);
  
  updateStatus("Playing Sequence", "active");
}

function pause() {
  state.isPlaying = false;
  const playBtn = document.getElementById('btn-play-toggle');
  if (playBtn) {
    playBtn.textContent = "▶";
    playBtn.classList.remove('active');
  }
  
  if (state.playbackInterval) {
    clearInterval(state.playbackInterval);
    state.playbackInterval = null;
  }
  
  if (state.frames.length > 0) {
    updateStatus("Paused", "success");
  }
}

function setViewMode(mode) {
  state.viewMode = mode;
  
  const buttons = ['btn-view-normal', 'btn-view-onion', 'btn-view-diff'];
  buttons.forEach(id => {
    const btn = document.getElementById(id);
    if (id === `btn-view-${mode}`) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  
  renderViewport();
}

// -------------------------------------------------------------
// REPAIR ENGINE ACTIONS (FIXES)
// -------------------------------------------------------------

// Delete a single frame completely
function deleteSingleFrame(index) {
  if (state.frames.length <= 2) {
    alert("Cannot delete frame. Sequence must contain at least 2 frames.");
    return;
  }
  
  pause();
  
  const confirmDelete = confirm(`Are you sure you want to delete Frame #${String(index).padStart(4, '0')}? This shifts all subsequent frames and makes the sequence shorter.`);
  if (!confirmDelete) return;
  
  // Remove
  state.frames.splice(index, 1);
  
  // Adjust current index boundaries
  if (state.currentIndex >= state.frames.length) {
    state.currentIndex = state.frames.length - 1;
  }
  
  // Update count metadata display
  document.getElementById('meta-frames-count').textContent = state.frames.length;
  
  // Trigger full re-analysis to refresh timeline
  analyzeSequence();
}

// Interpolate a single duplicate or jump frame by blending adjacent ones
async function interpolateSingleFrame(index) {
  if (index === 0 || index === state.frames.length - 1) {
    alert("Cannot interpolate boundary frames (first or last frame).");
    return;
  }
  
  pause();
  
  showLoader("Generating Interpolated Frame...", `Restoring frame #${index}`);
  
  // Find neighboring frames that are NOT duplicates of the current target frame
  // Linear blending between frame-1 and frame+1 is the golden standard
  const prevFrame = state.frames[index - 1].img;
  const nextFrame = state.frames[index + 1].img;
  
  const blendedImg = await createBlendedImage(prevFrame, nextFrame, 0.5);
  
  // Replace the image reference in the active frames array
  state.frames[index] = {
    name: `repaired_frame_${String(index + 1).padStart(4, '0')}.png`,
    img: blendedImg,
    blob: null, // Will be generated on zip export
    repaired: true
  };
  
  hideLoader();
  
  // Full re-analysis to refresh timeline with new difference metrics
  await analyzeSequence();
  selectFrame(index);
}

// Core drawing helper to blend two images with advanced interpolation algorithms
function createBlendedImage(img1, img2, opacity = 0.5) {
  if (state.interpolationMethod === 'shutter') {
    return createBlendedImageShutter(img1, img2);
  } else if (state.interpolationMethod === 'flow') {
    return createBlendedImageOpticalFlow(img1, img2, opacity);
  } else {
    return createBlendedImageLinear(img1, img2, opacity);
  }
}

// 1. Classic Linear Blending
function createBlendedImageLinear(img1, img2, opacity = 0.5) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = img1.width;
    canvas.height = img1.height;
    const ctx = canvas.getContext('2d');
    
    // Draw base image full opaque
    ctx.drawImage(img1, 0, 0);
    
    // Set opacity context and draw overlay image
    ctx.globalAlpha = opacity;
    ctx.drawImage(img2, 0, 0);
    ctx.globalAlpha = 1.0; // Reset
    
    const blendedImg = new Image();
    blendedImg.onload = () => resolve(blendedImg);
    blendedImg.src = canvas.toDataURL('image/png');
  });
}

// Helper to estimate global motion vector using tiny 80x60 scale
function estimateOverallMotion(img1, img2) {
  return new Promise((resolve) => {
    const w = 80;
    const h = 60;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    
    // Draw and get data for img1
    tempCtx.drawImage(img1, 0, 0, w, h);
    const data1 = tempCtx.getImageData(0, 0, w, h).data;
    
    // Draw and get data for img2
    tempCtx.drawImage(img2, 0, 0, w, h);
    const data2 = tempCtx.getImageData(0, 0, w, h).data;
    
    // Global SAD search
    let minSAD = Infinity;
    let bestDx = 0;
    let bestDy = 0;
    const R = 10; // search range
    
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        let sad = 0;
        for (let y = R; y < h - R; y += 2) {
          for (let x = R; x < w - R; x += 2) {
            const idx1 = (y * w + x) * 4;
            const idx2 = ((y + dy) * w + (x + dx)) * 4;
            
            sad += Math.abs(data1[idx1] - data2[idx2]);
            sad += Math.abs(data1[idx1+1] - data2[idx2+1]);
            sad += Math.abs(data1[idx1+2] - data2[idx2+2]);
          }
        }
        
        if (sad < minSAD) {
          minSAD = sad;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
    
    const scaleX = img1.width / w;
    const scaleY = img1.height / h;
    
    resolve({
      dx: bestDx * scaleX,
      dy: bestDy * scaleY
    });
  });
}

// 2. Cinematic Shutter Multi-Sample Motion Blur Blending
function createBlendedImageShutter(img1, img2) {
  return new Promise(async (resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = img1.width;
    canvas.height = img1.height;
    const ctx = canvas.getContext('2d');
    
    // Calculate global vector
    const mv = await estimateOverallMotion(img1, img2);
    const MV_x = mv.dx;
    const MV_y = mv.dy;
    
    const numSamples = state.shutterSamples;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Accumulate shutter samples
    for (let i = 0; i < numSamples; i++) {
      const t = numSamples > 1 ? (i / (numSamples - 1)) - 0.5 : 0; // range [-0.5, 0.5]
      const offsetX = MV_x * t;
      const offsetY = MV_y * t;
      
      const alpha2 = 0.5 + t; // goes from 0.0 to 1.0
      
      // Accumulate frame 1
      ctx.globalAlpha = (1.0 - alpha2) / numSamples;
      ctx.drawImage(img1, offsetX, offsetY);
      
      // Accumulate frame 2
      ctx.globalAlpha = alpha2 / numSamples;
      ctx.drawImage(img2, offsetX, offsetY);
    }
    ctx.globalAlpha = 1.0; // Reset
    
    const blendedImg = new Image();
    blendedImg.onload = () => resolve(blendedImg);
    blendedImg.src = canvas.toDataURL('image/png');
  });
}

// 3. Optical Flow Lite: Block-Matching Motion-Warped Blending
function createBlendedImageOpticalFlow(img1, img2, t = 0.5) {
  return new Promise((resolve) => {
    const w = 160;
    const h = 120;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    
    tempCtx.drawImage(img1, 0, 0, w, h);
    const data1 = tempCtx.getImageData(0, 0, w, h).data;
    
    tempCtx.drawImage(img2, 0, 0, w, h);
    const data2 = tempCtx.getImageData(0, 0, w, h).data;
    
    const blockSize = Math.max(8, Math.min(32, state.flowBlockSize));
    const searchRange = Math.max(8, Math.min(32, state.flowSearchRange));
    
    const scaleX = img1.width / w;
    const scaleY = img1.height / h;
    
    const b = Math.max(4, Math.round(blockSize / scaleX)); 
    const R = Math.max(4, Math.round(searchRange / scaleX)); 
    
    const cols = Math.floor(w / b);
    const rows = Math.floor(h / b);
    const vectors = [];
    
    for (let r = 0; r < rows; r++) {
      vectors[r] = [];
      const y = r * b;
      
      for (let c = 0; c < cols; c++) {
        const x = c * b;
        let minSAD = Infinity;
        let bestDx = 0;
        let bestDy = 0;
        
        for (let dy = -R; dy <= R; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny + b > h) continue;
          
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx + b > w) continue;
            
            let sad = 0;
            for (let by = 0; by < b; by += 2) {
              for (let bx = 0; bx < b; bx += 2) {
                const idx1 = ((y + by) * w + (x + bx)) * 4;
                const idx2 = ((ny + by) * w + (nx + bx)) * 4;
                
                sad += Math.abs(data1[idx1] - data2[idx2]);
                sad += Math.abs(data1[idx1+1] - data2[idx2+1]);
                sad += Math.abs(data1[idx1+2] - data2[idx2+2]);
              }
            }
            
            if (sad < minSAD) {
              minSAD = sad;
              bestDx = dx;
              bestDy = dy;
            }
          }
        }
        
        vectors[r][c] = {
          dx: bestDx * scaleX,
          dy: bestDy * scaleY
        };
      }
    }
    
    // 1. Vector Field Regularization (3x3 Box Blur spatial smoothing)
    const smoothVectors = [];
    for (let r = 0; r < rows; r++) {
      smoothVectors[r] = [];
      for (let c = 0; c < cols; c++) {
        let sumDx = 0;
        let sumDy = 0;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
              sumDx += vectors[nr][nc].dx;
              sumDy += vectors[nr][nc].dy;
              count++;
            }
          }
        }
        smoothVectors[r][c] = {
          dx: sumDx / count,
          dy: sumDy / count
        };
      }
    }
    
    // Create high-res canvas
    const canvas = document.createElement('canvas');
    canvas.width = img1.width;
    canvas.height = img1.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 2. Bilinear Sub-Grid Warping
    const subBlockSize = 8; // small sub-blocks for beautiful fluid warping
    const subCols = Math.ceil(img1.width / subBlockSize);
    const subRows = Math.ceil(img1.height / subBlockSize);
    
    const fullBlockW = img1.width / cols;
    const fullBlockH = img1.height / rows;
    const pad = 0.5; // sub-pixel overlap to completely prevent hairline seams
    
    for (let r_sub = 0; r_sub < subRows; r_sub++) {
      const sy = r_sub * subBlockSize;
      const sh = Math.min(subBlockSize, img1.height - sy);
      
      for (let c_sub = 0; c_sub < subCols; c_sub++) {
        const sx = c_sub * subBlockSize;
        const sw = Math.min(subBlockSize, img1.width - sx);
        
        // Center of sub-block in original coordinate space
        const px = sx + sw / 2;
        const py = sy + sh / 2;
        
        // Map center to fractional main grid coordinates
        const fc = px / fullBlockW - 0.5;
        const fr = py / fullBlockH - 0.5;
        
        let c0 = Math.floor(fc);
        let c1 = c0 + 1;
        let r0 = Math.floor(fr);
        let r1 = r0 + 1;
        
        // Clamp main grid coordinates
        c0 = Math.max(0, Math.min(cols - 1, c0));
        c1 = Math.max(0, Math.min(cols - 1, c1));
        r0 = Math.max(0, Math.min(rows - 1, r0));
        r1 = Math.max(0, Math.min(rows - 1, r1));
        
        // Bilinear interpolation weights
        let tx = fc - c0;
        let ty = fr - r0;
        tx = Math.max(0, Math.min(1, tx));
        ty = Math.max(0, Math.min(1, ty));
        
        // Four surrounding vectors
        const v00 = smoothVectors[r0][c0];
        const v10 = smoothVectors[r0][c1];
        const v01 = smoothVectors[r1][c0];
        const v11 = smoothVectors[r1][c1];
        
        // Interpolate vector dx, dy
        const mvX = v00.dx * (1 - tx) * (1 - ty) +
                    v10.dx * tx * (1 - ty) +
                    v01.dx * (1 - tx) * ty +
                    v11.dx * tx * ty;
                    
        const mvY = v00.dy * (1 - tx) * (1 - ty) +
                    v10.dy * tx * (1 - ty) +
                    v01.dy * (1 - tx) * ty +
                    v11.dy * tx * ty;
                    
        // Draw frame 1 slice shifted forward by mv * t
        ctx.globalAlpha = 1.0 - t;
        const dx1 = sx + mvX * t;
        const dy1 = sy + mvY * t;
        ctx.drawImage(img1, sx, sy, sw, sh, dx1 - pad, dy1 - pad, sw + pad * 2, sh + pad * 2);
        
        // Draw frame 2 slice shifted backward by -mv * (1 - t)
        ctx.globalAlpha = t;
        const dx2 = sx - mvX * (1.0 - t);
        const dy2 = sy - mvY * (1.0 - t);
        ctx.drawImage(img2, sx, sy, sw, sh, dx2 - pad, dy2 - pad, sw + pad * 2, sh + pad * 2);
      }
    }
    
    ctx.globalAlpha = 1.0;
    
    const blendedImg = new Image();
    blendedImg.onload = () => resolve(blendedImg);
    blendedImg.src = canvas.toDataURL('image/png');
  });
}

// Batch Repair duplicate frames automatically
async function autoFixAllDuplicates() {
  const duplicates = state.anomalies.filter(a => a.type === 'duplicate');
  if (duplicates.length === 0) {
    alert("No duplicate frames detected under the current threshold.");
    return;
  }
  
  pause();
  
  const confirmFix = confirm(`Auto-fix will replace all ${duplicates.length} detected duplicate frames with smooth 50% linear blended interpolations between adjacent unique frames. Proceed?`);
  if (!confirmFix) return;
  
  showLoader("Batch Repairing Duplicates...", "Processing linear blending");
  
  // Solve duplicates.
  // Note: If multiple consecutive duplicates occur, we need to interpolate progressively!
  // To keep it highly performant, we resolve them in a loop.
  const total = duplicates.length;
  
  for (let k = 0; k < total; k++) {
    const idx = duplicates[k].index;
    
    // Skip boundary frames
    if (idx === 0 || idx === state.frames.length - 1) continue;
    
    updateLoaderProgress(k / total, `Interpolating frame #${idx}...`, `Frame ${k+1} of ${total}`);
    
    // Look backward for the closest unique frame
    let prevIdx = idx - 1;
    while (prevIdx > 0 && state.diffs[prevIdx] <= state.dupThreshold) {
      prevIdx--;
    }
    
    // Look forward for the closest unique frame
    let nextIdx = idx + 1;
    while (nextIdx < state.frames.length - 1 && state.diffs[nextIdx] <= state.dupThreshold) {
      nextIdx++;
    }
    
    const prevFrame = state.frames[prevIdx].img;
    const nextFrame = state.frames[nextIdx].img;
    
    // Blending ratio depends on how far between the unique frames we are
    const gap = nextIdx - prevIdx;
    const step = idx - prevIdx;
    const ratio = step / gap;
    
    const blended = await createBlendedImage(prevFrame, nextFrame, ratio);
    
    state.frames[idx] = {
      name: `repaired_dup_${String(idx + 1).padStart(4, '0')}.png`,
      img: blended,
      blob: null,
      repaired: true
    };
  }
  
  // Full re-analyze to clear timeline anomalies
  await analyzeSequence();
  selectFrame(0);
  alert(`Successfully repaired ${duplicates.length} duplicate frames! Check the timeline now.`);
}

// Auto-smooth motion jumps by injecting missing frames (Video retimer approach)
async function autoFixAllJumps() {
  const jumps = state.anomalies.filter(a => a.type === 'jump');
  if (jumps.length === 0) {
    alert("No motion jumps detected under the current threshold.");
    return;
  }
  
  pause();
  
  const confirmFix = confirm(`Smooth motion jumps by inserting blended frames between the sudden leaps? This will inject new frames and make the sequence slightly longer (retaining original motion speed).`);
  if (!confirmFix) return;
  
  showLoader("Injecting Smoothing Frames...", "Smoothing jumps");
  
  // Resolve jumps. Note: as we inject frames, index array offsets shift!
  // To avoid indexing conflicts, we process jumps in REVERSE order (from end of timeline to start!)
  const sortedJumps = [...jumps].sort((a, b) => b.index - a.index);
  const total = sortedJumps.length;
  
  for (let k = 0; k < total; k++) {
    const idx = sortedJumps[k].index;
    
    updateLoaderProgress(k / total, `Smoothing jump at frame #${idx}...`, `Resolving leap`);
    
    // Blend frame-1 and frame to create an in-between frame
    const prevFrame = state.frames[idx - 1].img;
    const currFrame = state.frames[idx].img;
    
    const blendedImg = await createBlendedImage(prevFrame, currFrame, 0.5);
    
    // Insert into frames array
    state.frames.splice(idx, 0, {
      name: `inserted_smooth_${String(idx).padStart(4, '0')}.png`,
      img: blendedImg,
      blob: null,
      repaired: true
    });
  }
  
  // Update count metadata display
  document.getElementById('meta-frames-count').textContent = state.frames.length;
  
  // Re-analyze
  await analyzeSequence();
  selectFrame(0);
  alert(`Successfully injected ${total} blended frames to smooth out large motion jumps!`);
}

// -------------------------------------------------------------
// ZIP EXPORT SYSTEM
// -------------------------------------------------------------

async function exportRepairedSequence() {
  if (state.frames.length === 0) return;
  
  pause();
  showLoader("Packaging Repaired Sequence...", "Generating final ZIP archive");
  
  const zip = new JSZip();
  const total = state.frames.length;
  
  // Helper to convert Image to ArrayBuffer
  const getImageBuffer = (img) => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result);
        };
        reader.readAsArrayBuffer(blob);
      }, 'image/png');
    });
  };
  
  for (let i = 0; i < total; i++) {
    if (i % 5 === 0) {
      updateLoaderProgress(i / total, "Zipping repaired frames...", `Saving frame_${String(i+1).padStart(4, '0')}.png`);
      await new Promise(resolve => setTimeout(resolve, 0)); // Yield to prevent freeze
    }
    
    const frame = state.frames[i];
    
    // Format zero-padded filename: e.g. fixed_0001.png
    const paddedNum = String(i + 1).padStart(4, '0');
    const filename = `fixed_${paddedNum}.png`;
    
    let buffer;
    if (frame.file) {
      // If we loaded a local file and didn't modify it, reuse its arrayBuffer directly!
      buffer = await frame.file.arrayBuffer();
    } else {
      // Generated canvas frame (repaired or video extracted)
      buffer = await getImageBuffer(frame.img);
    }
    
    zip.file(filename, buffer);
  }
  
  updateLoaderProgress(0.98, "Generating zip file...", "Almost done");
  
  try {
    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      updateLoaderProgress(0.98, "Compressing archive...", `${Math.round(metadata.percent)}%`);
    });
    
    // Download trigger
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `${state.loadedFileName.replace(/\s+/g, '_')}_fixed_sequence.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    hideLoader();
    updateStatus("Repaired sequence exported!", "success");
    alert("Repaired sequence has been packaged and downloaded successfully!");
  } catch (err) {
    console.error("Zipping failed: ", err);
    hideLoader();
    alert("Export failed while building zip archive. Please try again.");
  }
}

// Export Repaired Video with Web Audio mixed silent capture (real-time canvas + audio tracking)
async function exportRepairedVideo() {
  if (state.frames.length === 0) return;
  
  pause();
  showLoader("Preparing Video Export...", "Initializing recording engine");
  
  const width = state.frames[0].img.width;
  const height = state.frames[0].img.height;
  const fps = state.playbackFps;
  const totalFrames = state.frames.length;
  
  // Create export canvas
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  const exportCtx = exportCanvas.getContext('2d');
  
  // Determine if we have an original video file to extract audio from
  const hasAudio = state.loadedFileType === 'video' && state.originalVideoFile;
  
  let mediaStream;
  let exportVideo = null;
  let audioCtx = null;
  let gainNode = null;
  let sourceNode = null;
  let destNode = null;
  
  try {
    const canvasStream = exportCanvas.captureStream(fps);
    const videoTrack = canvasStream.getVideoTracks()[0];
    let audioTrack = null;
    
    if (hasAudio) {
      updateLoaderProgress(0.05, "Extracting audio track...", "Routing audio pathways");
      
      // Create offscreen video element for real-time audio playback
      exportVideo = document.createElement('video');
      exportVideo.src = URL.createObjectURL(state.originalVideoFile);
      exportVideo.muted = false;
      exportVideo.playsInline = true;
      exportVideo.volume = 1.0;
      
      // Wait for metadata to be fully loaded before Web Audio setup
      await new Promise((resolve) => {
        exportVideo.onloadedmetadata = resolve;
        exportVideo.onerror = resolve;
      });
      
      // Setup Web Audio API to route audio silently
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaElementSource(exportVideo);
      
      // Silenced on physical speakers!
      gainNode = audioCtx.createGain();
      gainNode.gain.value = 0;
      sourceNode.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      // Request audio stream from Web Audio destination node instead of the video element directly.
      // This provides 100% support for Safari/macOS and other strict browsers!
      destNode = audioCtx.createMediaStreamDestination();
      sourceNode.connect(destNode);
      
      // Wait a small bit for stream tracks to initialize
      await new Promise(resolve => setTimeout(resolve, 200));
      audioTrack = destNode.stream.getAudioTracks()[0];
    }
    
    // Mix streams
    if (audioTrack) {
      mediaStream = new MediaStream([videoTrack, audioTrack]);
      console.log("Exporting video WITH audio track via Web Audio");
    } else {
      mediaStream = new MediaStream([videoTrack]);
      console.log("Exporting video WITHOUT audio track (silent)");
    }
    
    // Select MIME Type: aggressively prioritize MP4 containers over WebM
    const candidateMimes = [
      'video/mp4;codecs=h264,aac',
      'video/mp4;codecs=h264,mp3',
      'video/mp4;codecs=h264',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    let mimeType = '';
    for (const mime of candidateMimes) {
      if (MediaRecorder.isTypeSupported(mime)) {
        mimeType = mime;
        break;
      }
    }
    
    const isMp4 = mimeType && mimeType.includes('mp4');
    if (!isMp4) {
      alert("WARNING: Your current browser engine does not support native H.264 MP4 encoding in MediaRecorder. Falling back to WebM format. For high-quality native H.264 MP4 exports, please use a browser that supports MP4 recording (such as Safari, or Chrome on macOS).");
    }
    
    const options = mimeType ? { mimeType } : {};
    const mediaRecorder = new MediaRecorder(mediaStream, options);
    const chunks = [];
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };
    
    // Determine file extension
    const extension = (mimeType && mimeType.includes('mp4')) ? 'mp4' : 'webm';
    
    mediaRecorder.onstop = () => {
      updateLoaderProgress(0.99, "Finalizing file...", "Saving to downloads");
      
      const blob = new Blob(chunks, { type: mimeType || (isMp4 ? 'video/mp4' : 'video/webm') });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      const originalName = state.loadedFileName ? state.loadedFileName.substring(0, state.loadedFileName.lastIndexOf('.')) : 'fixed_sequence';
      link.download = `${originalName.replace(/\s+/g, '_')}_fixed.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Cleanup audio context & DOM elements
      if (audioCtx) {
        audioCtx.close();
      }
      if (exportVideo) {
        exportVideo.pause();
        exportVideo.src = "";
        exportVideo.load();
      }
      
      hideLoader();
      updateStatus("Repaired video exported!", "success");
      if (extension === 'mp4') {
        alert("Repaired video exported successfully as native MP4!");
      } else {
        alert("Repaired video exported successfully as WEBM! (Note: Your browser does not support native MP4 recording. For MP4 container exports, please use Safari or a supported modern browser.)");
      }
    };
    
    // Render/Recording Loop Pacing
    let currentFrame = 0;
    
    if (hasAudio && exportVideo) {
      // Audio-Synced Real-time Playback Loop
      await audioCtx.resume();
      mediaRecorder.start();
      await exportVideo.play().catch(e => console.warn("Auto-play blocked or failed on export video:", e));
      
      let isTimerMode = false;
      let timerFrame = 0;
      let timerInterval = null;
      
      const renderLoop = () => {
        if (currentFrame >= totalFrames) {
          mediaRecorder.stop();
          exportVideo.pause();
          return;
        }
        
        if (!isTimerMode) {
          // Transition to silent interval pacing if original video ends before we finish rendering all frames
          if (exportVideo.ended || exportVideo.currentTime >= exportVideo.duration - 0.05) {
            isTimerMode = true;
            timerFrame = currentFrame + 1;
            exportVideo.pause();
            
            const intervalMs = 1000 / fps;
            timerInterval = setInterval(() => {
              if (timerFrame < totalFrames) {
                exportCtx.drawImage(state.frames[timerFrame].img, 0, 0);
                updateLoaderProgress(timerFrame / totalFrames, "Recording Outro (Silent)...", `Rendering frame ${timerFrame + 1} of ${totalFrames}`);
                timerFrame++;
              } else {
                clearInterval(timerInterval);
                mediaRecorder.stop();
              }
            }, intervalMs);
            return;
          }
          
          // Pace drawing based on actual video playback position
          const playbackTime = exportVideo.currentTime;
          currentFrame = Math.min(totalFrames - 1, Math.floor(playbackTime * fps));
          
          if (currentFrame < totalFrames) {
            exportCtx.drawImage(state.frames[currentFrame].img, 0, 0);
            updateLoaderProgress(currentFrame / totalFrames, "Recording Video with Audio...", `Rendering frame ${currentFrame + 1} of ${totalFrames}`);
          }
          
          requestAnimationFrame(renderLoop);
        }
      };
      
      // Start loop
      requestAnimationFrame(renderLoop);
      
    } else {
      // Silent Interval-based Recording Loop (for folders or demo sequences)
      mediaRecorder.start();
      const intervalMs = 1000 / fps;
      
      const timer = setInterval(() => {
        if (currentFrame < totalFrames) {
          exportCtx.drawImage(state.frames[currentFrame].img, 0, 0);
          updateLoaderProgress(currentFrame / totalFrames, "Recording Video (Silent)...", `Rendering frame ${currentFrame + 1} of ${totalFrames}`);
          currentFrame++;
        } else {
          clearInterval(timer);
          mediaRecorder.stop();
        }
      }, intervalMs);
    }
    
  } catch (err) {
    console.error("Video export failed: ", err);
    hideLoader();
    alert("Video export failed. Your browser may have blocked real-time canvas stream capture or MediaRecorder. Please try 'Export Lossless Frames (ZIP)' instead.");
  }
}

// -------------------------------------------------------------
// UI LOAD OVERLAY HELPERS
// -------------------------------------------------------------

function showLoader(titleText, subtitleText = "") {
  const overlay = document.getElementById('loader-overlay');
  const title = document.getElementById('loader-text');
  const subtitle = document.getElementById('loader-subtext');
  const bar = document.getElementById('loader-progress');
  
  title.textContent = titleText;
  subtitle.textContent = subtitleText;
  bar.style.width = "0%";
  
  overlay.classList.add('active');
}

function updateLoaderProgress(ratio, titleText, subtitleText = "") {
  const bar = document.getElementById('loader-progress');
  const title = document.getElementById('loader-text');
  const subtitle = document.getElementById('loader-subtext');
  
  if (bar) bar.style.width = `${Math.round(ratio * 100)}%`;
  if (titleText && title) title.textContent = titleText;
  if (subtitleText && subtitle) subtitle.textContent = subtitleText;
}

function hideLoader() {
  const overlay = document.getElementById('loader-overlay');
  if (overlay) overlay.classList.remove('active');
}

// -------------------------------------------------------------
// NLE & PRO INTEGRATION EXPORTERS
// -------------------------------------------------------------

// Helper to convert frame index to standard HH:MM:SS:FF timecode format
function frameToTimecode(frameIndex, fps) {
  const totalFrames = Math.max(0, frameIndex);
  const f = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  
  const pad = (num, len = 2) => String(num).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

// Export DaVinci Resolve Markers (CSV format)
function exportResolveMarkers() {
  if (state.frames.length === 0) return;
  
  const fps = state.playbackFps;
  let csvContent = "Title,Description,Timecode,Color,Duration\n";
  
  state.anomalies.forEach(anomaly => {
    const title = anomaly.type === 'duplicate' ? 'Duplicate Frame' : 'Motion Jump';
    const desc = anomaly.description.replace(/"/g, '""');
    const tc = frameToTimecode(anomaly.index, fps);
    const color = anomaly.type === 'duplicate' ? 'Blue' : 'Red';
    const duration = "00:00:00:01";
    
    csvContent += `"${title}","${desc}",${tc},${color},${duration}\n`;
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const baseName = state.loadedFileName ? state.loadedFileName.substring(0, state.loadedFileName.lastIndexOf('.')) : 'fixed_sequence';
  link.download = `${baseName.replace(/\s+/g, '_')}_resolve_markers.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Export CMX 3600 EDL for Premiere Pro / After Effects locator markers
function exportPremiereEDL() {
  if (state.frames.length === 0) return;
  
  const fps = state.playbackFps;
  const baseName = state.loadedFileName ? state.loadedFileName.substring(0, state.loadedFileName.lastIndexOf('.')) : 'fixed_sequence';
  let edlContent = `TITLE: ${baseName.replace(/\s+/g, '_')}\nFCM: NON-DROP FRAME\n\n`;
  
  state.anomalies.forEach((anomaly, i) => {
    const eventNum = String(i + 1).padStart(3, '0');
    const tc = frameToTimecode(anomaly.index, fps);
    const tcNext = frameToTimecode(anomaly.index + 1, fps);
    const color = anomaly.type === 'duplicate' ? 'BLUE' : 'RED';
    const label = anomaly.type === 'duplicate' ? 'DUPLICATE' : 'MOTION JUMP';
    
    edlContent += `${eventNum}  AX       V     C        ${tc} ${tcNext} ${tc} ${tcNext}\n`;
    edlContent += `* FROM CLIP:  DUMMY_CLIP\n`;
    edlContent += `* LOC: ${tc} ${color} ${label}\n\n`;
  });
  
  const blob = new Blob([edlContent], { type: 'text/plain;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${baseName.replace(/\s+/g, '_')}_markers.edl`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Export damaged frame ranges only (the anomaly frame plus adjacent flanking frames) to save space/render time
async function exportDamagedZIP() {
  if (state.frames.length === 0) return;
  
  const indicesToExport = new Set();
  state.anomalies.forEach(anomaly => {
    const idx = anomaly.index;
    if (idx - 1 >= 0) indicesToExport.add(idx - 1);
    indicesToExport.add(idx);
    if (idx + 1 < state.frames.length) indicesToExport.add(idx + 1);
  });
  
  if (indicesToExport.size === 0) {
    alert("No anomalies detected to export!");
    return;
  }
  
  pause();
  showLoader("Packaging Damaged Ranges...", "Generating ZIP with stutter-adjacent frames");
  
  const zip = new JSZip();
  const sortedIndices = Array.from(indicesToExport).sort((a, b) => a - b);
  const total = sortedIndices.length;
  
  // Helper to convert Image to ArrayBuffer
  const getImageBuffer = (img) => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result);
        };
        reader.readAsArrayBuffer(blob);
      }, 'image/png');
    });
  };
  
  for (let k = 0; k < total; k++) {
    const idx = sortedIndices[k];
    updateLoaderProgress(k / total, "Zipping damaged ranges...", `Saving frame_${String(idx+1).padStart(4, '0')}.png`);
    await new Promise(resolve => setTimeout(resolve, 0)); // Yield to prevent UI freeze
    
    const frame = state.frames[idx];
    const paddedNum = String(idx + 1).padStart(4, '0');
    const filename = `damaged_frame_${paddedNum}.png`;
    
    let buffer;
    if (frame.file) {
      buffer = await frame.file.arrayBuffer();
    } else {
      buffer = await getImageBuffer(frame.img);
    }
    
    zip.file(filename, buffer);
  }
  
  updateLoaderProgress(0.98, "Generating zip file...", "Almost done");
  
  try {
    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      updateLoaderProgress(0.98, "Compressing archive...", `${Math.round(metadata.percent)}%`);
    });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    const baseName = state.loadedFileName ? state.loadedFileName.substring(0, state.loadedFileName.lastIndexOf('.')) : 'fixed_sequence';
    link.download = `${baseName.replace(/\s+/g, '_')}_damaged_ranges.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    hideLoader();
    updateStatus("Damaged ranges exported!", "success");
    alert(`Successfully packaged ${total} stutter-adjacent frames into ZIP!`);
  } catch (err) {
    console.error("Zipping failed: ", err);
    hideLoader();
    alert("Export failed while building zip archive. Please try again.");
  }
}

// Import AI Repaired Frames from offline suite (Topaz / Magnific)
async function importRepairedFrames(e) {
  const files = Array.from(e.target.files);
  if (!files || files.length === 0) return;
  
  showLoader("Importing AI Repaired Frames...", "Parsing frame numbers");
  
  let replacedCount = 0;
  for (const file of files) {
    const match = file.name.match(/(\d+)/);
    if (!match) {
      console.warn(`File skipped (no frame number found): ${file.name}`);
      continue;
    }
    const frameNum = parseInt(match[1], 10);
    const frameIndex = frameNum - 1;
    
    if (frameIndex < 0 || frameIndex >= state.frames.length) {
      console.warn(`File skipped (index ${frameIndex} out of bounds for sequence of size ${state.frames.length}): ${file.name}`);
      continue;
    }
    
    // Load image from file
    try {
      const imgUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imgUrl;
      });
      
      // Update state.frames
      state.frames[frameIndex] = {
        name: file.name,
        img: img,
        blob: file,
        file: file,
        repaired: true
      };
      replacedCount++;
    } catch (err) {
      console.error(`Error loading image ${file.name}:`, err);
    }
  }
  
  if (replacedCount > 0) {
    updateStatus("AI Frames Imported", "success");
    await analyzeSequence();
    selectFrame(state.currentIndex);
    alert(`Successfully imported and replaced ${replacedCount} AI repaired frame(s)!`);
  } else {
    alert("No valid frames were imported. Make sure filenames contain the 1-based frame digit index (e.g. frame_0015.png).");
  }
  
  // Reset file input target value so the same files can be uploaded again if needed
  e.target.value = '';
  hideLoader();
}
