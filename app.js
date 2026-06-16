/**
 * Video Motion Curve Analyser
 * Core Application Logic
 */

// Global State
let state = {
  originalFrames: [], // Array of { name, img, blob, file }
  frames: [],         // Active frames being analyzed
  diffs: [],          // Diff values between frames: diffs[i] is difference between frames[i-1] and frames[i]
  artifactScores: [], // Temporal residual scores: scores[i] compares frame[i] against the average of its neighbours
  anomalies: [],      // Detected anomalies: { index, type: 'duplicate'|'jump'|'artifact', severity, description }
  
  // Playback Control
  currentIndex: 0,
  isPlaying: false,
  playbackInterval: null,
  sourceFps: 24,
  playbackFps: 24,
  loop: true,
  
  // Viewer Options
  viewMode: 'normal', // 'normal' | 'onion' | 'diff' | 'artifact'
  timelineVizMode: 'curve', // 'curve' | 'contact-sheet' | 'stack'
  timelineMaximized: false,
  stackScale: 1.25,
  stackSpacing: 1,
  onionOpacity: 0.5,
  anomalyListExpanded: false,
  
  // Analysis Parameters
  dupThreshold: 0.5,   // in % difference
  jumpThreshold: 2.5,  // multiplier of local median for cut/spike review candidates
  artifactThreshold: 2.2, // multiplier of local median temporal residual
  artifactGain: 7,
  artifactBlackPoint: 10,
  
  // File Tracking
  loadedFileName: '',
  loadedFileType: '', // 'video' | 'folder' | 'demo'
  originalVideoFile: null,
  fileIntelligence: null,
  audioElement: null,
  audioObjectUrl: null,
  cadenceReport: null,
  
  // Comparison Tracking
  comparison: {
    fileName: '',
    frames: [],
    diffs: [],
    report: null
  }
};

// Canvas references
let viewportCanvas = null;
let viewportCtx = null;
let timelineCanvas = null;
let timelineCtx = null;
let temporalStackCanvas = null;
let temporalStackCtx = null;
let temporalStackHitboxes = [];

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

  temporalStackCanvas = document.getElementById('temporal-stack-canvas');
  temporalStackCtx = temporalStackCanvas.getContext('2d');
  
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
  
  document.getElementById('select-source-fps').addEventListener('change', (e) => {
    state.sourceFps = parseInt(e.target.value, 10) || 24;
    state.playbackFps = state.sourceFps;
    document.getElementById('select-playback-fps').value = state.playbackFps.toString();
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
    state.playbackFps = parseFloat(e.target.value) || 24;
    if (state.isPlaying) {
      pause();
      play();
    }
  });
  
  // View Mode Selectors
  document.getElementById('btn-view-normal').addEventListener('click', () => setViewMode('normal'));
  document.getElementById('btn-view-onion').addEventListener('click', () => setViewMode('onion'));
  document.getElementById('btn-view-diff').addEventListener('click', () => setViewMode('diff'));
  document.getElementById('btn-view-artifact').addEventListener('click', () => setViewMode('artifact'));
  
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

  const artifactSlider = document.getElementById('input-artifact-thresh');
  const artifactDisplay = document.getElementById('val-artifact-thresh');
  artifactSlider.addEventListener('input', (e) => {
    state.artifactThreshold = parseFloat(e.target.value);
    artifactDisplay.textContent = `${state.artifactThreshold.toFixed(1)}x`;
  });

  const artifactGainSlider = document.getElementById('input-artifact-gain');
  const artifactGainDisplay = document.getElementById('val-artifact-gain');
  artifactGainSlider.addEventListener('input', (e) => {
    state.artifactGain = parseFloat(e.target.value);
    artifactGainDisplay.textContent = `${state.artifactGain.toFixed(1)}x`;
    renderViewport();
  });

  const artifactBlackSlider = document.getElementById('input-artifact-black');
  const artifactBlackDisplay = document.getElementById('val-artifact-black');
  artifactBlackSlider.addEventListener('input', (e) => {
    state.artifactBlackPoint = parseInt(e.target.value, 10);
    artifactBlackDisplay.textContent = state.artifactBlackPoint.toString();
    renderViewport();
  });
  
  document.getElementById('btn-reanalyze').addEventListener('click', () => {
    analyzeSequence();
  });
  
  document.getElementById('btn-toggle-anomaly-list').addEventListener('click', toggleAnomalyList);

  document.getElementById('btn-viz-curve').addEventListener('click', () => setTimelineVizMode('curve'));
  document.getElementById('btn-viz-contact-sheet').addEventListener('click', () => setTimelineVizMode('contact-sheet'));
  document.getElementById('btn-viz-stack').addEventListener('click', () => setTimelineVizMode('stack'));
  document.getElementById('btn-toggle-timeline-max').addEventListener('click', toggleTimelineMaximized);

  const stackScaleSlider = document.getElementById('input-stack-scale');
  const stackScaleValue = document.getElementById('val-stack-scale');
  stackScaleSlider.addEventListener('input', (e) => {
    state.stackScale = parseInt(e.target.value, 10) / 100;
    stackScaleValue.textContent = `${e.target.value}%`;
    if (state.timelineVizMode === 'stack') drawTemporalStack();
  });

  const stackSpacingSlider = document.getElementById('input-stack-spacing');
  const stackSpacingValue = document.getElementById('val-stack-spacing');
  stackSpacingSlider.addEventListener('input', (e) => {
    state.stackSpacing = parseInt(e.target.value, 10) / 100;
    stackSpacingValue.textContent = `${e.target.value}%`;
    if (state.timelineVizMode === 'stack') drawTemporalStack();
  });
  
  const btnCompareVideo = document.getElementById('btn-compare-video');
  const inputCompareVideo = document.getElementById('input-compare-video');
  const btnClearCompare = document.getElementById('btn-clear-compare');
  if (btnCompareVideo && inputCompareVideo) {
    btnCompareVideo.addEventListener('click', () => inputCompareVideo.click());
    inputCompareVideo.addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleComparisonVideoFile(e.target.files[0]);
      e.target.value = '';
    });
  }
  if (btnClearCompare) {
    btnClearCompare.addEventListener('click', clearComparison);
  }
  
  // Analysis marker exporter bindings
  document.getElementById('btn-export-resolve-markers').addEventListener('click', exportResolveMarkers);
  document.getElementById('btn-export-premiere-edl').addEventListener('click', exportPremiereEDL);
  document.getElementById('btn-export-file-report').addEventListener('click', exportFileIntelligenceReport);
  
  // Resize timeline canvas on window resize
  window.addEventListener('resize', () => {
    resizeTimelineCanvas();
    resizeTemporalStackCanvas();
    renderTimelineVisualisation();
  });

  document.addEventListener('keydown', handleKeyboardShortcuts);
}

// Initialize and size Timeline Canvas
function initTimelineCanvas() {
  resizeTimelineCanvas();
  resizeTemporalStackCanvas();
  
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

  temporalStackCanvas.addEventListener('click', (e) => {
    if (state.frames.length === 0 || state.timelineVizMode !== 'stack') return;

    const rect = temporalStackCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = [...temporalStackHitboxes].reverse().find(box =>
      x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h
    );

    if (hit) selectFrame(hit.index);
  });
}

function resizeTimelineCanvas() {
  const container = timelineCanvas.parentElement;
  timelineCanvas.width = container.clientWidth * window.devicePixelRatio;
  timelineCanvas.height = container.clientHeight * window.devicePixelRatio;
  timelineCtx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function resizeTemporalStackCanvas() {
  const container = temporalStackCanvas.parentElement;
  temporalStackCanvas.width = container.clientWidth * window.devicePixelRatio;
  temporalStackCanvas.height = container.clientHeight * window.devicePixelRatio;
  temporalStackCtx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

// Reset UI state to start
function resetApp() {
  pause();
  cleanupPlaybackAudio();
  state.originalFrames = [];
  state.frames = [];
  state.diffs = [];
  state.artifactScores = [];
  state.anomalies = [];
  state.currentIndex = 0;
  state.anomalyListExpanded = false;
  state.timelineVizMode = 'curve';
  state.timelineMaximized = false;
  state.stackScale = 1.25;
  state.stackSpacing = 1;
  state.artifactThreshold = 2.2;
  state.artifactGain = 7;
  state.artifactBlackPoint = 10;
  state.sourceFps = 24;
  state.playbackFps = 24;
  state.loadedFileName = '';
  state.loadedFileType = '';
  state.originalVideoFile = null;
  state.fileIntelligence = null;
  state.cadenceReport = null;
  clearComparison(false);
  document.getElementById('select-source-fps').value = '24';
  document.getElementById('select-playback-fps').value = '24';
  document.getElementById('input-stack-scale').value = '125';
  document.getElementById('val-stack-scale').textContent = '125%';
  document.getElementById('input-stack-spacing').value = '100';
  document.getElementById('val-stack-spacing').textContent = '100%';
  document.getElementById('input-artifact-thresh').value = '2.2';
  document.getElementById('val-artifact-thresh').textContent = '2.2x';
  document.getElementById('input-artifact-gain').value = '7';
  document.getElementById('val-artifact-gain').textContent = '7.0x';
  document.getElementById('input-artifact-black').value = '10';
  document.getElementById('val-artifact-black').textContent = '10';
  document.getElementById('stat-duplicates-count').textContent = '0';
  document.getElementById('stat-jumps-count').textContent = '0';
  document.getElementById('stat-artifacts-count').textContent = '0';
  document.getElementById('stat-card-duplicates').classList.remove('has-issues');
  document.getElementById('stat-card-jumps').classList.remove('has-issues');
  document.getElementById('stat-card-artifacts').classList.remove('has-issues');
  setTimelineVizMode('curve');
  setTimelineMaximized(false);
  document.getElementById('frame-grid-container').innerHTML = '';
  renderFileIntelligence();
  
  // Hide workspace items, show welcome overlay
  document.getElementById('welcome-overlay').classList.remove('hidden');
  document.getElementById('btn-reset-app').style.display = 'none';
  
  // Disable actions
  setWorkspaceActive(false);
  updateAnomalyListToggle();
  updateStatus("No Sequence Loaded", "inactive");
}

function setWorkspaceActive(active) {
  const elements = [
    'btn-reanalyze', 'btn-play-toggle', 'btn-play-first', 'btn-play-last', 
    'btn-play-prev', 'btn-play-next', 'btn-view-normal', 'btn-view-onion',
    'btn-view-diff', 'btn-view-artifact', 'select-playback-fps',
    'input-artifact-thresh', 'input-artifact-gain', 'input-artifact-black',
    'btn-toggle-anomaly-list', 'btn-compare-video',
    'btn-viz-curve', 'btn-viz-contact-sheet', 'btn-viz-stack',
    'btn-toggle-timeline-max', 'input-stack-scale', 'input-stack-spacing',
    'btn-export-resolve-markers', 'btn-export-premiere-edl', 'btn-export-file-report'
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

function setTimelineVizMode(mode) {
  state.timelineVizMode = mode;

  const isGrid = mode === 'contact-sheet';
  const isStack = mode === 'stack';
  const curveButton = document.getElementById('btn-viz-curve');
  const gridButton = document.getElementById('btn-viz-contact-sheet');
  const stackButton = document.getElementById('btn-viz-stack');
  const canvasContainer = document.querySelector('.timeline-canvas-container');
  const gridContainer = document.getElementById('frame-grid-container');
  const stackContainer = document.querySelector('.temporal-stack-container');
  const stackScaleControl = document.getElementById('stack-scale-control');
  const titleLabel = document.getElementById('timeline-title-label');
  const legend = document.querySelector('.timeline-legend');

  if (curveButton) curveButton.classList.toggle('active', mode === 'curve');
  if (gridButton) gridButton.classList.toggle('active', isGrid);
  if (stackButton) stackButton.classList.toggle('active', isStack);
  if (canvasContainer) canvasContainer.classList.toggle('hidden', mode !== 'curve');
  if (gridContainer) gridContainer.classList.toggle('hidden', !isGrid);
  if (stackContainer) stackContainer.classList.toggle('hidden', !isStack);
  if (stackScaleControl) stackScaleControl.classList.toggle('hidden', !isStack);
  if (titleLabel) {
    titleLabel.textContent = isGrid
      ? 'Frame Grid & Duplicate Map'
      : (isStack ? 'Temporal Stack Playback' : '📈 Motion Curve & Cadence Chart');
  }
  if (legend) legend.classList.toggle('hidden', isGrid || isStack);

  if (isGrid) {
    renderFrameGrid();
  } else if (isStack) {
    resizeTemporalStackCanvas();
    drawTemporalStack();
  } else {
    resizeTimelineCanvas();
    renderTimelineVisualisation();
  }
}

function renderFrameGrid() {
  const container = document.getElementById('frame-grid-container');
  if (!container) return;

  container.innerHTML = '';

  if (state.frames.length === 0) return;

  const duplicateIndexes = new Set(state.anomalies.filter(a => a.type === 'duplicate').map(a => a.index));
  const jumpIndexes = new Set(state.anomalies.filter(a => a.type === 'jump').map(a => a.index));
  const artifactIndexes = new Set(state.anomalies.filter(a => a.type === 'artifact').map(a => a.index));
  const grid = document.createElement('div');
  grid.className = 'frame-grid';

  state.frames.forEach((frame, index) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'frame-tile';
    tile.dataset.index = index.toString();

    const isDuplicate = duplicateIndexes.has(index);
    const isJump = jumpIndexes.has(index);
    const isArtifact = artifactIndexes.has(index);
    if (isDuplicate) tile.classList.add('duplicate');
    if (isJump) tile.classList.add('jump');
    if (isArtifact) tile.classList.add('artifact');
    if (index === state.currentIndex) tile.classList.add('active');

    const img = document.createElement('img');
    img.src = frame.img.src;
    img.alt = `Frame ${index}`;
    img.loading = 'lazy';
    tile.appendChild(img);

    const indexLabel = document.createElement('span');
    indexLabel.className = 'frame-tile-index';
    indexLabel.textContent = `#${String(index).padStart(3, '0')}`;
    tile.appendChild(indexLabel);

    if (isDuplicate) {
      const badge = document.createElement('span');
      badge.className = 'frame-tile-badge';
      badge.textContent = classifyLowMotion(state.diffs[index] || 0).badge;
      tile.appendChild(badge);
      tile.title = `Frame ${index}: ${classifyLowMotion(state.diffs[index] || 0).label}`;
    } else if (isJump) {
      tile.title = `Frame ${index}: cut / spike candidate`;
    } else if (isArtifact) {
      tile.title = `Frame ${index}: temporal artifact candidate`;
    } else {
      tile.title = `Frame ${index}`;
    }

    tile.addEventListener('click', () => selectFrame(index));
    grid.appendChild(tile);
  });

  container.appendChild(grid);
}

function updateFrameGridSelection() {
  const container = document.getElementById('frame-grid-container');
  if (!container || container.classList.contains('hidden')) return;

  container.querySelectorAll('.frame-tile.active').forEach(tile => tile.classList.remove('active'));
  const activeTile = container.querySelector(`.frame-tile[data-index="${state.currentIndex}"]`);
  if (activeTile) activeTile.classList.add('active');
}

function renderTimelineVisualisation() {
  if (state.timelineVizMode === 'contact-sheet') {
    updateFrameGridSelection();
    return;
  }

  if (state.timelineVizMode === 'stack') {
    drawTemporalStack();
    return;
  }

  drawTimeline();
}

function toggleTimelineMaximized() {
  setTimelineMaximized(!state.timelineMaximized);
}

function setTimelineMaximized(maximized) {
  state.timelineMaximized = maximized;

  const mainStage = document.querySelector('.main-stage');
  const button = document.getElementById('btn-toggle-timeline-max');

  if (mainStage) mainStage.classList.toggle('timeline-maximized', maximized);
  if (button) {
    button.textContent = maximized ? '↙ Restore' : '⛶ Maximise';
    button.title = maximized ? 'Restore main viewer' : 'Maximise visualisation panel';
  }

  requestAnimationFrame(() => {
    resizeTimelineCanvas();
    resizeTemporalStackCanvas();
    renderTimelineVisualisation();
  });
}

function handleKeyboardShortcuts(e) {
  if (state.frames.length === 0) return;

  const target = e.target;
  const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
  if (['input', 'select', 'textarea'].includes(tagName) || (target && target.isContentEditable)) return;

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    selectFrame(state.currentIndex + (e.key === 'ArrowRight' ? step : -step));
  }
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
  cleanupPlaybackAudio();
  state.originalVideoFile = null;
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
  state.fileIntelligence = buildFolderSequenceIntelligence(files, state.sourceFps || 24);
  renderFileIntelligence();
  
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

async function buildVideoFileIntelligence(file, selectedFps) {
  const metadata = await getBrowserVideoMetadata(file).catch(() => null);
  const binary = await inspectBinaryFile(file).catch(() => ({ sha256: '', containerSignature: null }));
  const duration = metadata && Number.isFinite(metadata.duration) ? metadata.duration : 0;

  return {
    generatedAt: new Date().toISOString(),
    sourceType: 'video',
    confidence: 'browser-triage',
    file: {
      name: file.name,
      mimeType: file.type || 'unknown',
      extension: getFileExtension(file.name),
      containerHint: inferContainerFromFile(file.name, file.type),
      sizeBytes: file.size,
      lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      sha256: binary.sha256,
      hashAlgorithm: binary.sha256 ? 'SHA-256' : 'unavailable',
      containerSignature: binary.containerSignature
    },
    browserVideo: {
      durationSeconds: duration,
      width: metadata ? metadata.width : 0,
      height: metadata ? metadata.height : 0,
      estimatedOverallBitrateBps: duration > 0 ? Math.round((file.size * 8) / duration) : 0,
      selectedDecodeFps: selectedFps,
      nativeFrameRate: 'unavailable in browser',
      codec: 'unavailable in browser',
      audioPresence: 'not exposed reliably by HTMLVideoElement'
    },
    decodedSequence: null,
    checks: [
      'Original file SHA-256 calculated in browser.',
      'Top-level container signature is parsed from the original bytes where possible.',
      'Bitrate is estimated from file size and duration.',
      'Codec, GOP, packet timing, and embedded encoder tags require ffprobe, MediaInfo, or ExifTool.'
    ]
  };
}

function buildFolderSequenceIntelligence(files, selectedFps) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const extensionCounts = {};
  files.forEach(file => {
    const ext = getFileExtension(file.name) || 'unknown';
    extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
  });

  const manifest = files.map(file => ({
    name: file.name,
    sizeBytes: file.size,
    lastModified: file.lastModified || 0
  }));

  return {
    generatedAt: new Date().toISOString(),
    sourceType: 'folder',
    confidence: 'frame-sequence',
    file: {
      name: files[0] ? files[0].name.split('_')[0] || 'sequence' : 'sequence',
      mimeType: 'image sequence',
      extension: Object.keys(extensionCounts).join(', '),
      containerHint: 'folder of still frames',
      sizeBytes: totalBytes,
      lastModified: files.reduce((latest, file) => Math.max(latest, file.lastModified || 0), 0)
        ? new Date(files.reduce((latest, file) => Math.max(latest, file.lastModified || 0), 0)).toISOString()
        : null,
      sha256: hashText(JSON.stringify(manifest)),
      hashAlgorithm: 'FNV-1a manifest fingerprint'
    },
    folderSequence: {
      frameFileCount: files.length,
      firstFrame: files[0] ? files[0].name : null,
      lastFrame: files[files.length - 1] ? files[files.length - 1].name : null,
      extensionCounts,
      selectedFps,
      estimatedDurationSeconds: selectedFps > 0 ? files.length / selectedFps : 0
    },
    decodedSequence: null,
    checks: [
      'Frame sequence order is filename-sorted.',
      'Sequence fingerprint hashes names, sizes, and modification times, not full image bytes.',
      'Image folders are preferred for cadence checks because they avoid browser video seeking ambiguity.'
    ]
  };
}

function buildDemoFileIntelligence() {
  return {
    generatedAt: new Date().toISOString(),
    sourceType: 'demo',
    confidence: 'synthetic',
    file: {
      name: 'SeeDance_Demo_Clip',
      mimeType: 'synthetic frames',
      extension: 'png',
      containerHint: 'in-memory demo',
      sizeBytes: 0,
      lastModified: null,
      sha256: ''
    },
    decodedSequence: null,
    checks: [
      'Synthetic in-memory frames for UI and cadence testing.',
      'Not suitable for source-file metadata or provenance inspection.'
    ]
  };
}

function updateDecodedFileIntelligence() {
  if (!state.fileIntelligence || state.frames.length === 0) return;

  const fps = state.sourceFps || 24;
  const width = state.frames[0].img.width;
  const height = state.frames[0].img.height;
  const durationSeconds = fps > 0 ? state.frames.length / fps : 0;
  const duplicateCount = state.anomalies.filter(a => a.type === 'duplicate').length;
  const jumpCount = state.anomalies.filter(a => a.type === 'jump').length;
  const artifactCount = state.anomalies.filter(a => a.type === 'artifact').length;
  const avgDiff = state.diffs.length > 1
    ? state.diffs.slice(1).reduce((sum, value) => sum + value, 0) / (state.diffs.length - 1)
    : 0;

  state.fileIntelligence.decodedSequence = {
    frameCount: state.frames.length,
    width,
    height,
    selectedFps: fps,
    estimatedDurationSeconds: durationSeconds,
    averageAdjacentMotionPct: avgDiff,
    anomalySummary: {
      lowMotion: duplicateCount,
      cutOrSpike: jumpCount,
      temporalArtifacts: artifactCount
    },
    cadenceReport: state.cadenceReport || null
  };
}

function getBrowserVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
    };

    video.onloadedmetadata = () => {
      const result = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight
      };
      cleanup();
      resolve(result);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Unable to read browser video metadata'));
    };

    video.src = objectUrl;
  });
}

async function inspectBinaryFile(blob) {
  const buffer = await blob.arrayBuffer();
  const sha256 = await hashArrayBuffer(buffer);
  return {
    sha256,
    containerSignature: parseContainerSignature(buffer)
  };
}

async function hashArrayBuffer(buffer) {
  if (!window.crypto || !window.crypto.subtle) return '';
  const digest = await window.crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(digest);
}

function parseContainerSignature(buffer) {
  if (!buffer || buffer.byteLength < 12) return null;

  const view = new DataView(buffer);
  const boxes = [];
  let offset = 0;
  const maxBoxes = 24;

  while (offset + 8 <= view.byteLength && boxes.length < maxBoxes) {
    const size32 = view.getUint32(offset);
    const type = readAscii(view, offset + 4, 4);
    let boxSize = size32;
    let headerSize = 8;

    if (!/^[\x20-\x7e]{4}$/.test(type)) break;
    if (size32 === 1 && offset + 16 <= view.byteLength) {
      boxSize = Number(view.getBigUint64(offset + 8));
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = view.byteLength - offset;
    }

    if (boxSize < headerSize || offset + boxSize > view.byteLength) break;

    boxes.push({ type, size: boxSize });
    offset += boxSize;
  }

  const ftyp = boxes.find(box => box.type === 'ftyp');
  if (ftyp) {
    const majorBrand = readAscii(view, 8, 4);
    const minorVersion = view.byteLength >= 16 ? view.getUint32(12) : 0;
    const compatibleBrands = [];
    const end = Math.min(ftyp.size, view.byteLength);
    for (let pos = 16; pos + 4 <= end; pos += 4) {
      compatibleBrands.push(readAscii(view, pos, 4));
    }

    return {
      family: 'ISO base media / QuickTime-style boxes',
      majorBrand,
      minorVersion,
      compatibleBrands,
      topLevelBoxes: boxes
    };
  }

  return boxes.length > 0 ? { family: 'box-structured media', topLevelBoxes: boxes } : null;
}

function readAscii(view, offset, length) {
  let value = '';
  for (let i = 0; i < length && offset + i < view.byteLength; i++) {
    value += String.fromCharCode(view.getUint8(offset + i));
  }
  return value;
}

function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `manifest-fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function getFileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function inferContainerFromFile(name, mimeType) {
  const ext = getFileExtension(name);
  const map = {
    mp4: 'MPEG-4 / ISO BMFF',
    m4v: 'MPEG-4 / ISO BMFF',
    mov: 'QuickTime / MOV',
    webm: 'WebM / Matroska family',
    mkv: 'Matroska',
    avi: 'AVI',
    mts: 'MPEG transport stream',
    m2ts: 'MPEG transport stream'
  };

  if (map[ext]) return map[ext];
  if (mimeType) return mimeType;
  return 'unknown';
}

// Decode Video frame-by-frame
async function handleVideoFile(file) {
  cleanupPlaybackAudio();
  state.loadedFileName = file.name;
  state.loadedFileType = 'video';
  state.originalVideoFile = file;
  
  try {
    const fps = parseInt(document.getElementById('select-source-fps').value, 10) || 24;
    state.sourceFps = fps;
    state.playbackFps = fps;
    document.getElementById('select-playback-fps').value = fps.toString();
    showLoader("Inspecting File...", "Reading browser metadata and SHA-256");
    state.fileIntelligence = await buildVideoFileIntelligence(file, fps);
    renderFileIntelligence();
    setupPlaybackAudio(file);
    state.originalFrames = await decodeVideoToFrames(file, fps, "Decoding Video File...");
    finishFrameLoading();
  } catch (err) {
    console.error("Video decode error: ", err);
    hideLoader();
    alert("Error loading video file. Please make sure it's a valid MP4, WebM or MOV video.");
  }
}

function decodeVideoToFrames(file, fps, loaderTitle) {
  return new Promise((resolve, reject) => {
    showLoader(loaderTitle, "Initializing decoder");
    
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    
    video.onloadedmetadata = () => {
      setTimeout(() => {
        const duration = video.duration;
        const totalFrames = Math.ceil(duration * fps);
        const frames = [];
        
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        
        let frameIndex = 0;
        
        const extractNextFrame = () => {
          if (frameIndex >= totalFrames) {
            URL.revokeObjectURL(objectUrl);
            resolve(frames);
            return;
          }
          
          const targetTime = Math.min(frameIndex / fps, Math.max(0, duration - 0.001));
          updateLoaderProgress(frameIndex / totalFrames, `Decoding frame ${frameIndex + 1} of ${totalFrames}`, `${targetTime.toFixed(2)}s`);
          video.currentTime = targetTime;
        };
        
        video.onseeked = async () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          try {
            const blob = await new Promise(resolveBlob => canvas.toBlob(resolveBlob, 'image/jpeg', 0.95));
            const imgUrl = URL.createObjectURL(blob);
            const img = new Image();
            await new Promise((resolveImg, rejectImg) => {
              img.onload = resolveImg;
              img.onerror = rejectImg;
              img.src = imgUrl;
            });
            
            frames.push({
              name: `frame_${String(frameIndex + 1).padStart(4, '0')}.jpg`,
              img: img,
              blob: blob
            });
          } catch (err) {
            console.error("Frame seek error: ", err);
          }
          
          frameIndex++;
          extractNextFrame();
        };
        
        extractNextFrame();
      }, 80);
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to decode video"));
    };
  });
}

// Generate an in-memory synthetic animation sequence (DEMO)
async function loadDemoSequence() {
  cleanupPlaybackAudio();
  state.loadedFileName = "SeeDance_Demo_Clip";
  state.loadedFileType = 'demo';
  state.originalVideoFile = null;
  state.fileIntelligence = buildDemoFileIntelligence();
  renderFileIntelligence();
  
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
    
    // 1. INJECT DUPLICATES by reusing the previous rendered frame exactly.
    // Drawing changing labels or overlays would make this a bad duplicate-frame test.
    const isInjectedDuplicate = (i >= 15 && i < 17) || (i >= 42 && i < 44);
    if (isInjectedDuplicate && state.originalFrames.length > 0) {
      const previous = state.originalFrames[state.originalFrames.length - 1];
      state.originalFrames.push({
        name: `demo_frame_${String(i + 1).padStart(4, '0')}.png`,
        img: previous.img,
        blob: previous.blob
      });
      continue;
    }
    
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
    
    // 2. INJECT TEMPORAL SPIKE (DROPPED FRAME EFFECT)
    if (i === 28) {
      // Skip ahead by 3 frames worth of motion. This creates a large transition spike.
      ballX += ballSpeedX * 3.5;
      ballY += ballSpeedY * 3.5;
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
      ctx.fillText("⚠️ TEMPORAL SPIKE INJECTED (DROP)", 180, 240);
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
  state.cadenceReport = null;
  updateDecodedFileIntelligence();
  renderFileIntelligence();
  renderSequenceInfo();
  
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
  setTimelineVizMode('curve');
  
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
  state.diffs = await calculateDiffsForFrames(state.frames, "Analyzing frame differences...");
  state.artifactScores = await calculateArtifactScoresForFrames(state.frames, "Scanning temporal artifacts...");
  
  // Trigger anomaly detection logic
  detectAnomalies();
  updateComparisonReport();
  
  hideLoader();
  selectFrame(0);
  
  // Enable Re-analyze button
  document.getElementById('btn-reanalyze').disabled = false;
}

async function calculateDiffsForFrames(frames, progressTitle) {
  const diffs = [0];
  const total = frames.length;
  
  for (let i = 1; i < total; i++) {
    if (i % 10 === 0) {
      updateLoaderProgress(i / total, progressTitle, `Frame ${i} of ${total}`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    diffs.push(compareFrames(frames[i - 1].img, frames[i].img));
  }
  
  return diffs;
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
  let changedPixels = 0;
  const numPixels = w * h;
  
  // Sum absolute differences in R, G, B channels (ignoring Alpha).
  // Changed-pixel coverage catches small subjects moving across a large frame,
  // where whole-frame MAE alone can make real motion look like a duplicate.
  for (let i = 0; i < data1.length; i += 4) {
    const redDiff = Math.abs(data1[i] - data2[i]);
    const greenDiff = Math.abs(data1[i+1] - data2[i+1]);
    const blueDiff = Math.abs(data1[i+2] - data2[i+2]);
    const pixelDiff = (redDiff + greenDiff + blueDiff) / 3;
    
    absoluteSum += redDiff + greenDiff + blueDiff;
    if (pixelDiff > 8) changedPixels++;
  }
  
  // Convert to average difference percentage (Max absolute diff is 255 * 3 per pixel)
  const mae = absoluteSum / (numPixels * 3);
  const maePercentage = (mae / 255) * 100;
  const changedPixelPercentage = (changedPixels / numPixels) * 100;
  
  return Math.max(maePercentage, changedPixelPercentage * 0.6);
}

async function calculateArtifactScoresForFrames(frames, progressTitle) {
  const total = frames.length;
  const scores = Array.from({ length: total }, () => ({
    score: 0,
    residual: 0,
    coverage: 0,
    baseline: 0
  }));

  if (total < 3) return scores;

  for (let i = 1; i < total - 1; i++) {
    if (i % 10 === 0) {
      updateLoaderProgress(i / total, progressTitle, `Frame ${i} of ${total}`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    scores[i] = compareFrameToNeighbourAverage(frames[i - 1].img, frames[i].img, frames[i + 1].img);
  }

  return scores;
}

function compareFrameToNeighbourAverage(prevImg, currImg, nextImg) {
  const w = analysisCanvas.width;
  const h = analysisCanvas.height;
  const numPixels = w * h;

  analysisCtx.drawImage(prevImg, 0, 0, w, h);
  const prev = analysisCtx.getImageData(0, 0, w, h).data;

  analysisCtx.drawImage(currImg, 0, 0, w, h);
  const curr = analysisCtx.getImageData(0, 0, w, h).data;

  analysisCtx.drawImage(nextImg, 0, 0, w, h);
  const next = analysisCtx.getImageData(0, 0, w, h).data;

  let residualSum = 0;
  let baselineSum = 0;
  let hotPixels = 0;

  for (let i = 0; i < curr.length; i += 4) {
    const expectedR = (prev[i] + next[i]) / 2;
    const expectedG = (prev[i + 1] + next[i + 1]) / 2;
    const expectedB = (prev[i + 2] + next[i + 2]) / 2;

    const residualR = Math.abs(curr[i] - expectedR);
    const residualG = Math.abs(curr[i + 1] - expectedG);
    const residualB = Math.abs(curr[i + 2] - expectedB);
    const residual = (residualR + residualG + residualB) / 3;

    const baseline = (
      Math.abs(prev[i] - next[i]) +
      Math.abs(prev[i + 1] - next[i + 1]) +
      Math.abs(prev[i + 2] - next[i + 2])
    ) / 3;

    residualSum += residual;
    baselineSum += baseline;
    if (residual > 18 && residual > baseline * 0.65) hotPixels++;
  }

  const residualPct = (residualSum / numPixels / 255) * 100;
  const baselinePct = (baselineSum / numPixels / 255) * 100;
  const coveragePct = (hotPixels / numPixels) * 100;
  const score = (residualPct + coveragePct * 0.35) / Math.max(0.25, baselinePct * 0.55);

  return {
    score,
    residual: residualPct,
    coverage: coveragePct,
    baseline: baselinePct
  };
}

function getSourceTrustInfo() {
  if (state.loadedFileType === 'folder') {
    return {
      label: 'TRUSTED FRAME SEQUENCE',
      className: 'trusted',
      description: 'Filename-ordered image frames. Recommended for forensic cadence checks.'
    };
  }

  if (state.loadedFileType === 'video') {
    return {
      label: 'MP4 QUICK PREVIEW',
      className: 'preview',
      description: 'Browser timestamp seeking can repeat or snap frames. For claims about exact frames, extract PNGs with ffmpeg and load the folder.'
    };
  }

  return {
    label: 'DEMO',
    className: 'demo',
    description: 'Synthetic in-memory demo sequence.'
  };
}

function renderFileIntelligence() {
  const panel = document.getElementById('file-intelligence-panel');
  const exportButton = document.getElementById('btn-export-file-report');
  if (!panel) return;

  if (!state.fileIntelligence) {
    panel.className = 'file-intelligence-panel empty';
    panel.textContent = 'Load a video or frame folder to inspect container, bitrate, resolution, timing, and provenance clues.';
    if (exportButton) exportButton.disabled = true;
    return;
  }

  const intel = state.fileIntelligence;
  const file = intel.file || {};
  const video = intel.browserVideo || {};
  const folder = intel.folderSequence || {};
  const decoded = intel.decodedSequence || {};
  const signature = file.containerSignature || {};
  const duration = video.durationSeconds || folder.estimatedDurationSeconds || decoded.estimatedDurationSeconds || 0;
  const bitrate = video.estimatedOverallBitrateBps || 0;
  const resolution = decoded.width && decoded.height
    ? `${decoded.width}x${decoded.height}`
    : (video.width && video.height ? `${video.width}x${video.height}` : 'n/a');
  const fps = decoded.selectedFps || video.selectedDecodeFps || folder.selectedFps || state.sourceFps || 24;

  const flags = [];
  if (file.sha256) flags.push({ label: intel.sourceType === 'folder' ? 'Manifest Hash' : 'SHA-256', kind: 'ok' });
  if (intel.sourceType === 'folder') flags.push({ label: 'Frame Sequence', kind: 'ok' });
  if (intel.sourceType === 'video') flags.push({ label: 'Browser Triage', kind: 'warn' });
  if (decoded.anomalySummary && decoded.anomalySummary.temporalArtifacts > 0) flags.push({ label: 'Artifacts Found', kind: 'warn' });
  if (decoded.cadenceReport) flags.push({ label: 'Cadence Pattern', kind: 'warn' });

  const rows = [
    ['Container', file.containerHint || 'n/a'],
    ['MIME', file.mimeType || 'n/a'],
    ['Size', formatBytes(file.sizeBytes || 0)],
    ['Modified', file.lastModified ? formatDateTime(file.lastModified) : 'n/a'],
    ['Duration', duration ? formatDuration(duration) : 'n/a'],
    ['Resolution', resolution],
    ['FPS Basis', `${formatNumber(fps, 2)} selected`],
    ['Frames', decoded.frameCount || folder.frameFileCount || 'n/a'],
    ['Bitrate', bitrate ? formatBitrate(bitrate) : 'n/a'],
    ['Hash', file.sha256 || 'n/a']
  ];

  if (intel.sourceType === 'video') {
    rows.splice(1, 0, ['Codec', video.codec || 'unavailable in browser']);
    rows.splice(2, 0, ['Native FPS', video.nativeFrameRate || 'unavailable in browser']);
    rows.splice(3, 0, ['Audio', video.audioPresence || 'unknown']);
    if (signature.majorBrand) rows.splice(3, 0, ['Brand', signature.majorBrand]);
    if (signature.topLevelBoxes && signature.topLevelBoxes.length > 0) {
      rows.splice(4, 0, ['Boxes', signature.topLevelBoxes.slice(0, 6).map(box => box.type).join(', ')]);
    }
  }

  panel.className = 'file-intelligence-panel';
  panel.innerHTML = `
    <div class="file-intel-flags">
      ${flags.map(flag => `<span class="file-intel-flag ${flag.kind}">${escapeHtml(flag.label)}</span>`).join('')}
    </div>
    <div class="file-intel-grid">
      ${rows.map(([label, value]) => `
        <span>${escapeHtml(label)}:</span>
        <strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
      `).join('')}
    </div>
    <div class="file-intel-note">
      ${escapeHtml(getFileIntelligenceNote(intel))}
    </div>
  `;

  if (exportButton) exportButton.disabled = false;
}

function getFileIntelligenceNote(intel) {
  if (intel.sourceType === 'folder') {
    return 'Folder checks use filename order and a manifest fingerprint. They are strongest for visual cadence, not original container provenance.';
  }

  if (intel.sourceType === 'video') {
    return 'Browser metadata covers quick triage only. Codec profile, GOP, packet timestamps, encoder tags, and true variable frame timing need ffprobe, MediaInfo, or ExifTool.';
  }

  return 'Demo values describe synthetic in-memory frames, not an original media file.';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${formatNumber(value, value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatBitrate(bitsPerSecond) {
  if (!bitsPerSecond) return 'n/a';
  if (bitsPerSecond >= 1000000) return `${formatNumber(bitsPerSecond / 1000000, 2)} Mb/s`;
  if (bitsPerSecond >= 1000) return `${formatNumber(bitsPerSecond / 1000, 1)} kb/s`;
  return `${Math.round(bitsPerSecond)} b/s`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'n/a';
  const minutes = Math.floor(seconds / 60);
  const secs = seconds - minutes * 60;
  return minutes > 0
    ? `${minutes}m ${formatNumber(secs, 2)}s`
    : `${formatNumber(secs, 3)}s`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString();
}

function formatNumber(value, decimals = 2) {
  if (!Number.isFinite(Number(value))) return 'n/a';
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0
  });
}

function renderSequenceInfo() {
  const sideInfo = document.getElementById('sidebar-sequence-info');
  if (!sideInfo || state.frames.length === 0) {
    if (sideInfo) sideInfo.innerHTML = '<p>Please load a video or folder of frames to begin the analysis.</p>';
    return;
  }

  const trust = getSourceTrustInfo();
  const cadence = state.cadenceReport;
  const firstFrameName = state.frames[0] && state.frames[0].name ? state.frames[0].name : 'n/a';

  sideInfo.innerHTML = `
    <div class="sequence-meta-grid">
      <span>Name:</span>
      <strong>${escapeHtml(state.loadedFileName)}</strong>
      <span>Source:</span>
      <strong>${state.loadedFileType.toUpperCase()}</strong>
      <span>Frames:</span>
      <strong id="meta-frames-count">${state.frames.length}</strong>
      <span>Resolution:</span>
      <strong>${state.frames[0].img.width}x${state.frames[0].img.height}</strong>
      <span>First:</span>
      <strong>${escapeHtml(firstFrameName)}</strong>
    </div>
    <div class="source-trust ${trust.className}">
      <div>${trust.label}</div>
      <p>${trust.description}</p>
    </div>
    ${cadence ? `
      <div class="cadence-summary">
        <div>3-frame cadence probe</div>
        <p>Phase ${cadence.phase + 1}/3 has ${cadence.phaseCount} low-motion pair(s). Confidence: ${cadence.confidenceLabel}.</p>
      </div>
    ` : ''}
  `;
}

function classifyLowMotion(diff) {
  if (diff <= Math.min(0.08, state.dupThreshold * 0.2)) {
    return {
      label: 'Near Duplicate',
      badge: 'DUP',
      description: `Near-identical adjacent frame. Difference of ${diff.toFixed(3)}% is extremely low.`
    };
  }

  if (diff <= state.dupThreshold * 0.5) {
    return {
      label: 'Possible Duplicate',
      badge: 'LOW',
      description: `Very low adjacent-frame motion. Difference of ${diff.toFixed(3)}% is below half the current low-motion threshold.`
    };
  }

  return {
    label: 'Low Motion',
    badge: 'LOW',
    description: `Low adjacent-frame motion. Difference of ${diff.toFixed(3)}% is below the current threshold.`
  };
}

function getFrameSourceLabel(index) {
  const frame = state.frames[index];
  if (!frame) return '';

  if (state.loadedFileType === 'folder') {
    return `Source file: ${frame.name || `frame ${index}`}.`;
  }

  if (state.loadedFileType === 'video') {
    const timestamp = index / (state.sourceFps || 24);
    return `Browser MP4 sample: frame ${index} at ${timestamp.toFixed(3)}s.`;
  }

  return `Demo frame: ${frame.name || index}.`;
}

async function handleComparisonVideoFile(file) {
  if (state.frames.length < 2 || state.diffs.length < 2) {
    alert("Load and analyze a source sequence before comparing another video.");
    return;
  }
  
  try {
    const fps = state.playbackFps || 24;
    const frames = await decodeVideoToFrames(file, fps, "Decoding Comparison Video...");
    
    if (frames.length < 2) {
      throw new Error("Comparison video did not decode enough frames.");
    }
    
    showLoader("Analyzing Comparison Curve...", "Computing comparison video deltas");
    const diffs = await calculateDiffsForFrames(frames, "Analyzing comparison differences...");
    
    state.comparison = {
      fileName: file.name,
      frames,
      diffs,
      report: null
    };
    
    updateComparisonReport();
    hideLoader();
    renderTimelineVisualisation();
    
    const clearBtn = document.getElementById('btn-clear-compare');
    if (clearBtn) {
      clearBtn.style.display = 'block';
      clearBtn.disabled = false;
    }
  } catch (err) {
    console.error("Comparison decode error: ", err);
    hideLoader();
    alert("Could not compare this video. Please make sure it is a valid MP4/WebM/MOV and roughly matches the loaded source.");
  }
}

function clearComparison(redraw = true) {
  state.comparison = {
    fileName: '',
    frames: [],
    diffs: [],
    report: null
  };
  
  const clearBtn = document.getElementById('btn-clear-compare');
  if (clearBtn) {
    clearBtn.style.display = 'none';
    clearBtn.disabled = true;
  }
  
  const report = document.getElementById('compare-report');
  if (report) {
    report.className = 'compare-report empty';
    report.textContent = 'Load another MP4 to overlay its motion curve against this sequence.';
  }
  
  if (redraw) renderTimelineVisualisation();
}

function updateComparisonReport() {
  const reportEl = document.getElementById('compare-report');
  if (!reportEl || !state.comparison || state.comparison.diffs.length < 2 || state.diffs.length < 2) return;
  
  const baseDiffs = state.diffs;
  const compareDiffs = state.comparison.diffs;
  const comparableFrames = Math.min(baseDiffs.length, compareDiffs.length);
  const threshold = state.dupThreshold;
  
  let baseLow = 0;
  let compareLow = 0;
  let fixedLow = 0;
  let stillLow = 0;
  let newLow = 0;
  let improvedMagnitude = 0;
  let worsenedMagnitude = 0;
  
  for (let i = 1; i < comparableFrames; i++) {
    const sourceIsLow = baseDiffs[i] < threshold;
    const compareIsLow = compareDiffs[i] < threshold;
    
    if (sourceIsLow) baseLow++;
    if (compareIsLow) compareLow++;
    if (sourceIsLow && !compareIsLow) fixedLow++;
    if (sourceIsLow && compareIsLow) stillLow++;
    if (!sourceIsLow && compareIsLow) newLow++;
    
    const delta = compareDiffs[i] - baseDiffs[i];
    if (delta > 0.25) improvedMagnitude++;
    if (delta < -0.25) worsenedMagnitude++;
  }
  
  const motionCorrelation = getCorrelation(baseDiffs.slice(1, comparableFrames), compareDiffs.slice(1, comparableFrames));
  const frameDelta = compareDiffs.length - baseDiffs.length;
  const verdictClass = fixedLow > newLow && compareLow < baseLow ? 'good' : (compareLow > baseLow || newLow > fixedLow ? 'bad' : 'warn');
  const verdict = verdictClass === 'good'
    ? 'Lower low-motion cadence detected'
    : verdictClass === 'bad'
      ? 'More low-motion cadence detected'
      : 'Similar motion cadence';
  
  state.comparison.report = {
    comparableFrames,
    baseLow,
    compareLow,
    fixedLow,
    stillLow,
    newLow,
    improvedMagnitude,
    worsenedMagnitude,
    motionCorrelation,
    frameDelta
  };
  
  reportEl.className = 'compare-report';
  reportEl.innerHTML = `
    <div class="compare-summary ${verdictClass}">${verdict}</div>
    <div style="margin-top: 4px; word-break: break-all;">${escapeHtml(state.comparison.fileName)}</div>
    <div class="compare-grid">
      <div class="compare-metric">
        <div class="compare-metric-value">${baseLow} -> ${compareLow}</div>
        <div class="compare-metric-label">Low-motion pairs</div>
      </div>
      <div class="compare-metric">
        <div class="compare-metric-value">${fixedLow}</div>
        <div class="compare-metric-label">Reduced low-motion pairs</div>
      </div>
      <div class="compare-metric">
        <div class="compare-metric-value">${newLow}</div>
        <div class="compare-metric-label">New low-motion pairs</div>
      </div>
      <div class="compare-metric">
        <div class="compare-metric-value">${motionCorrelation.toFixed(3)}</div>
        <div class="compare-metric-label">Curve match</div>
      </div>
    </div>
    ${frameDelta === 0 ? '' : `<div style="margin-top: 8px; color: var(--warning);">Frame count differs by ${frameDelta}.</div>`}
  `;
}

function getCorrelation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 1;
  
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  
  const meanA = sumA / n;
  const meanB = sumB / n;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  
  const denominator = Math.sqrt(denomA * denomB);
  return denominator === 0 ? 1 : numerator / denominator;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Detect low-motion frames and abrupt temporal spikes.
function detectAnomalies() {
  state.anomalies = [];
  
  const dupThresh = state.dupThreshold;
  const jumpThresh = state.jumpThreshold;
  const total = state.frames.length;
  
  let lowMotionCount = 0;
  let spikeCount = 0;
  let artifactCount = 0;
  const lowMotionIndexes = [];
  
  // 1. Identify low-motion adjacent frame pairs.
  for (let i = 1; i < total; i++) {
    const diff = state.diffs[i];
    
    if (diff < dupThresh) {
      // Exclude repaired frames from being flagged as stutters
      if (state.frames[i].repaired || (state.frames[i-1] && state.frames[i-1].repaired)) {
        continue;
      }

      const lowMotion = classifyLowMotion(diff);
      
      state.anomalies.push({
        index: i,
        type: 'duplicate',
        subtype: lowMotion.label,
        severity: (dupThresh - diff) / dupThresh, // higher severity means closer to 0
        description: lowMotion.description
      });
      lowMotionIndexes.push(i);
      lowMotionCount++;
    }
  }
  state.cadenceReport = getCadenceReport(lowMotionIndexes, 3);
  
  // 2. Identify abrupt temporal spikes using a local median rolling filter.
  // These are review candidates: they can be missing frames, intentional cuts, or angle changes.
  const windowRadius = 3;
  for (let i = 1; i < total; i++) {
    // Skip if it's already classified as a duplicate to avoid double flagging
    if (state.diffs[i] < dupThresh) continue;
    
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
          continue; // Suppress false positives on smooth linear intervals.
        }
        
        state.anomalies.push({
          index: i,
          type: 'jump',
          severity: currentDiff / (median || 0.1),
          description: `Abrupt transition candidate. Delta is ${currentDiff.toFixed(2)}% (${(currentDiff / (median || 1)).toFixed(1)}x local median). Review before smoothing; this may be an intentional cut or angle change.`
        });
        spikeCount++;
      }
    }
  }

  // 3. Identify temporal image-integrity artifacts.
  // This compares a frame against the average of its neighbours. Spikes here often reveal
  // single-frame texture pops, warped detail, flashes, or local AI-generation damage.
  for (let i = 1; i < total - 1; i++) {
    const metric = state.artifactScores[i];
    if (!metric) continue;

    const surroundingScores = [];
    for (let w = -windowRadius; w <= windowRadius; w++) {
      const idx = i + w;
      if (idx >= 1 && idx < total - 1 && idx !== i) {
        const neighbourMetric = state.artifactScores[idx];
        if (neighbourMetric && neighbourMetric.residual > 0) {
          surroundingScores.push(neighbourMetric.score);
        }
      }
    }

    if (surroundingScores.length === 0) continue;

    surroundingScores.sort((a, b) => a - b);
    const localMedian = surroundingScores[Math.floor(surroundingScores.length / 2)] || 0.1;
    const relativeScore = metric.score / Math.max(0.1, localMedian);
    const alreadyCadenceFlagged = state.anomalies.some(a => a.index === i && (a.type === 'duplicate' || a.type === 'jump'));
    const enoughSignal = metric.residual > 0.28 && metric.coverage > 0.18;

    if (!alreadyCadenceFlagged && enoughSignal && relativeScore >= state.artifactThreshold) {
      state.anomalies.push({
        index: i,
        type: 'artifact',
        severity: relativeScore,
        description: `Temporal artifact candidate. Residual is ${metric.residual.toFixed(2)}% across ${metric.coverage.toFixed(1)}% of sampled pixels (${relativeScore.toFixed(1)}x local residue). Use Artifact view and adjust reveal gain/black point to inspect the affected area.`
      });
      artifactCount++;
    }
  }
  
  // Sort anomalies by frame index
  state.anomalies.sort((a, b) => a.index - b.index);
  
  // Update UI Stats Cards
  document.getElementById('stat-duplicates-count').textContent = lowMotionCount;
  document.getElementById('stat-jumps-count').textContent = spikeCount;
  document.getElementById('stat-artifacts-count').textContent = artifactCount;
  
  const dupCard = document.getElementById('stat-card-duplicates');
  const jumpCard = document.getElementById('stat-card-jumps');
  const artifactCard = document.getElementById('stat-card-artifacts');
  
  if (lowMotionCount > 0) dupCard.classList.add('has-issues');
  else dupCard.classList.remove('has-issues');
  
  if (spikeCount > 0) jumpCard.classList.add('has-issues');
  else jumpCard.classList.remove('has-issues');

  if (artifactCount > 0) artifactCard.classList.add('has-issues');
  else artifactCard.classList.remove('has-issues');
  
  // Build Sidebar List Panel
  updateDecodedFileIntelligence();
  renderFileIntelligence();
  renderSequenceInfo();
  renderAnomalyList();
  if (state.timelineVizMode === 'contact-sheet') renderFrameGrid();
  
  // Redraw timeline track
  renderTimelineVisualisation();
}

function getCadenceReport(indexes, cadenceLength) {
  if (!indexes || indexes.length < 6) return null;

  const phaseCounts = new Array(cadenceLength).fill(0);
  indexes.forEach(index => {
    phaseCounts[index % cadenceLength]++;
  });

  let phase = 0;
  for (let i = 1; i < phaseCounts.length; i++) {
    if (phaseCounts[i] > phaseCounts[phase]) phase = i;
  }

  const sortedCounts = [...phaseCounts].sort((a, b) => b - a);
  const phaseCount = phaseCounts[phase];
  const ratio = phaseCount / indexes.length;
  const margin = sortedCounts[0] - (sortedCounts[1] || 0);
  const confidence = ratio >= 0.5 && margin >= 3
    ? 'high'
    : (ratio >= 0.4 && margin >= 2 ? 'medium' : 'low');

  return {
    phase,
    phaseCount,
    total: indexes.length,
    phaseCounts,
    confidence,
    confidenceLabel: confidence.toUpperCase()
  };
}

// Render the expandable list of anomalies in sidebar
function toggleAnomalyList() {
  if (state.anomalies.length === 0) return;
  state.anomalyListExpanded = !state.anomalyListExpanded;
  updateAnomalyListToggle();
}

function updateAnomalyListToggle() {
  const sidebar = document.querySelector('.sidebar');
  const button = document.getElementById('btn-toggle-anomaly-list');
  if (!sidebar || !button) return;
  
  const count = state.anomalies.length;
  sidebar.classList.toggle('anomaly-list-expanded', state.anomalyListExpanded && count > 0);
  button.disabled = count === 0;
  button.textContent = state.anomalyListExpanded && count > 0
    ? `Hide Details (${count})`
    : `Show Details (${count})`;
}

function renderAnomalyList() {
  const container = document.getElementById('anomaly-list-container');
  container.innerHTML = '';
  
  if (state.anomalies.length === 0) {
    state.anomalyListExpanded = false;
    container.innerHTML = `
      <div class="empty-reports">
        🎉 No anomalies detected! Motion is smooth.
      </div>
    `;
    updateAnomalyListToggle();
    return;
  }
  
  state.anomalies.forEach(anomaly => {
    const item = document.createElement('div');
    item.className = `report-item ${state.currentIndex === anomaly.index ? 'active' : ''}`;
    item.dataset.index = anomaly.index;
    
    const dotClass = anomaly.type === 'duplicate' ? 'duplicate' : (anomaly.type === 'artifact' ? 'artifact' : 'jump');
    const typeLabel = getAnomalyLabel(anomaly);
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
  
  updateAnomalyListToggle();
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
  renderTimelineVisualisation();
  syncPlaybackAudio(state.isPlaying, false);
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

  else if (state.viewMode === 'artifact') {
    onionSliderContainer.style.display = 'none';

    if (state.currentIndex === 0 || state.currentIndex >= state.frames.length - 1) {
      viewportCtx.drawImage(img, 0, 0);
      return;
    }

    drawArtifactReveal(
      state.frames[state.currentIndex - 1].img,
      img,
      state.frames[state.currentIndex + 1].img,
      viewportCanvas,
      viewportCtx
    );
  }
}

function drawArtifactReveal(prevImg, currImg, nextImg, targetCanvas, targetCtx) {
  const w = targetCanvas.width;
  const h = targetCanvas.height;
  const pCanvas = document.createElement('canvas');
  pCanvas.width = w;
  pCanvas.height = h;
  const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });

  pCtx.drawImage(prevImg, 0, 0, w, h);
  const prev = pCtx.getImageData(0, 0, w, h).data;

  pCtx.drawImage(currImg, 0, 0, w, h);
  const revealData = pCtx.getImageData(0, 0, w, h);
  const curr = revealData.data;

  pCtx.drawImage(nextImg, 0, 0, w, h);
  const next = pCtx.getImageData(0, 0, w, h).data;

  const gain = state.artifactGain;
  const blackPoint = state.artifactBlackPoint;

  for (let i = 0; i < curr.length; i += 4) {
    const expectedR = (prev[i] + next[i]) / 2;
    const expectedG = (prev[i + 1] + next[i + 1]) / 2;
    const expectedB = (prev[i + 2] + next[i + 2]) / 2;

    const residualR = Math.abs(curr[i] - expectedR);
    const residualG = Math.abs(curr[i + 1] - expectedG);
    const residualB = Math.abs(curr[i + 2] - expectedB);
    const residual = Math.max(residualR, residualG, residualB);
    const lifted = Math.max(0, residual - blackPoint) * gain;
    const intensity = Math.min(255, lifted);

    curr[i] = Math.min(255, intensity * 1.15 + residualR * gain * 0.25);
    curr[i + 1] = Math.min(255, intensity * 0.12);
    curr[i + 2] = Math.min(255, intensity * 0.8 + residualB * gain * 0.25);
    curr[i + 3] = 255;
  }

  pCtx.putImageData(revealData, 0, 0);
  targetCtx.drawImage(pCanvas, 0, 0);
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

  const selectedAnomaly = state.anomalies.find(a => a.index === currentIdx);
  const inspectorHeader = document.getElementById('inspector-anomaly-header');
  const inspectorDot = document.getElementById('inspector-anomaly-type-dot');
  const inspectorType = document.getElementById('inspector-anomaly-type');
  const inspectorDesc = document.getElementById('inspector-anomaly-desc');
  const selectedPrevMotion = currentIdx > 0 ? state.diffs[currentIdx] : 0;
  const selectedNextMotion = currentIdx + 1 < state.diffs.length ? state.diffs[currentIdx + 1] : 0;
  const selectedMetricSummary = `Motion from previous: ${selectedPrevMotion.toFixed(3)}%. Motion to next: ${selectedNextMotion.toFixed(3)}%.`;

  if (selectedAnomaly) {
    inspectorHeader.style.display = 'flex';

    if (selectedAnomaly.type === 'duplicate') {
      const lowMotion = classifyLowMotion(selectedPrevMotion);
      inspectorHeader.className = "anomaly-type-title duplicate";
      inspectorDot.className = "report-dot duplicate";
      inspectorType.textContent = lowMotion.label.toUpperCase();
      inspectorDesc.textContent = `${getFrameSourceLabel(currentIdx)} ${selectedMetricSummary} ${lowMotion.description} In MP4 quick-preview mode this may be affected by browser timestamp seeking; confirm exact frame identity with an extracted image sequence.`;
    } else if (selectedAnomaly.type === 'artifact') {
      const metric = state.artifactScores[currentIdx] || { score: 0, residual: 0, coverage: 0 };
      inspectorHeader.className = "anomaly-type-title artifact";
      inspectorDot.className = "report-dot artifact";
      inspectorType.textContent = "TEMPORAL ARTIFACT CANDIDATE";
      inspectorDesc.textContent = `${selectedMetricSummary} Residual: ${metric.residual.toFixed(2)}%, coverage: ${metric.coverage.toFixed(1)}%, score: ${selectedAnomaly.severity.toFixed(1)}x local residue. Use Artifact view, then raise gain or lower black point to reveal small texture pops, flashes, or warped detail.`;
    } else {
      inspectorHeader.className = "anomaly-type-title jump";
      inspectorDot.className = "report-dot jump";
      inspectorType.textContent = "CUT / SPIKE CANDIDATE";
      inspectorDesc.textContent = `${selectedMetricSummary} This abrupt transition may be a real edit, angle change, or dropped-frame spike. Inspect the surrounding frames before treating it as an error.`;
    }
  } else {
    inspectorHeader.className = "anomaly-type-title";
    inspectorHeader.style.display = 'none';
    inspectorType.textContent = "Frame Metrics";
    inspectorDesc.textContent = `Frame #${String(currentIdx).padStart(4, '0')}. ${selectedMetricSummary}`;
  }

  return;
  
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
      infoType.textContent = "CUT / SPIKE CANDIDATE";
      infoDesc.textContent = `This is an abrupt transition, not automatically an error. It may be an intentional smash cut or angle change. Only smooth it if the surrounding frames show the same shot and the motion appears to have skipped.`;
      
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
    renderRepairWorkflow(aiContent, isAnomaly, velocity);
    return;
    
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

function renderRepairWorkflow(container, anomaly, velocity) {
  const velocityLabel = velocity > 2.0
    ? `<span style="color: #ff3366; font-weight: bold;">High Motion (${velocity.toFixed(2)}%)</span>`
    : `<span style="color: #00b4d8; font-weight: bold;">Moderate Motion (${velocity.toFixed(2)}%)</span>`;
  
  if (anomaly.type === 'duplicate') {
    container.innerHTML = `
      <div style="margin-bottom: 8px;">Replacement confidence: ${velocityLabel}</div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px; border-left: 3px solid #9d4edd;">
          <strong>After Effects Pixel Motion plate:</strong> set the source clip to <strong>50% speed</strong>, enable <strong>Frame Blending</strong>, set frame blending to <strong>Pixel Motion</strong>, export the slowed repair plate, re-import it, set it to <strong>200% speed</strong>, then replace only the flagged bad frames.
        </div>
        <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px; border-left: 3px solid #00b4d8;">
          <strong>Why this works:</strong> AE generates plausible in-between frames from the surrounding motion, but you keep editorial control by swapping only the duplicate frames this tool flags.
        </div>
        <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px; border-left: 3px solid #ffb703;">
          <strong>Workflow tip:</strong> export Resolve/Premiere markers from this tool, use them as a frame checklist, then import final repaired stills with <strong>Import AI Repaired Frames</strong>.
        </div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div style="margin-bottom: 8px;">Transition speed: ${velocityLabel}</div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px; border-left: 3px solid #ffb703;">
        <strong>Review first:</strong> this may be an intentional smash cut or camera-angle change. Do not interpolate across a real cut.
      </div>
      <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px; border-left: 3px solid #9d4edd;">
        <strong>If it is a dropped-frame skip:</strong> use the same AE Pixel Motion repair-plate method, but replace only this frame range after visually confirming the shot is continuous.
      </div>
    </div>
  `;
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
  const compareDiffs = state.comparison && state.comparison.diffs ? state.comparison.diffs : [];
  const maxDiff = Math.max(...state.diffs, ...compareDiffs, 1.5);
  
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
    if (diff < state.dupThreshold) {
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
        // Check if cut/spike review candidate
        const isJump = state.anomalies.find(a => a.index === i && a.type === 'jump');
        const isArtifact = state.anomalies.find(a => a.index === i && a.type === 'artifact');
        if (isJump) {
          barColor = 'rgba(245, 158, 11, 0.85)'; // Amber (cut/spike candidate)
        } else if (isArtifact) {
          barColor = 'rgba(236, 72, 153, 0.9)'; // Pink (temporal artifact candidate)
        } else if (diff < state.dupThreshold * 2) {
          barColor = 'rgba(245, 158, 11, 0.5)'; // Yellow (low motion/near freeze)
        }
      }
    }
    
    timelineCtx.fillStyle = barColor;
    timelineCtx.fillRect(x - barWidth / 2, y, barWidth, barHeight);
  }
  
  // 2b. Overlay comparison motion curve if a repaired video has been loaded.
  if (compareDiffs.length > 1) {
    const compareTotal = compareDiffs.length;
    const compareLimit = Math.min(compareTotal, total);
    
    timelineCtx.save();
    timelineCtx.strokeStyle = 'rgba(34, 211, 238, 0.95)';
    timelineCtx.lineWidth = 2;
    timelineCtx.shadowColor = 'rgba(34, 211, 238, 0.45)';
    timelineCtx.shadowBlur = 6;
    timelineCtx.beginPath();
    
    for (let i = 1; i < compareLimit; i++) {
      const x = padding + (trackWidth * i) / Math.max(total - 1, 1);
      const diff = compareDiffs[i];
      const y = h - 12 - (diff / maxDiff) * (h - 24);
      
      if (i === 1) timelineCtx.moveTo(x, y);
      else timelineCtx.lineTo(x, y);
    }
    
    timelineCtx.stroke();
    timelineCtx.restore();
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

function drawTemporalStack() {
  if (!temporalStackCanvas || state.frames.length === 0) return;

  const w = temporalStackCanvas.width / window.devicePixelRatio;
  const h = temporalStackCanvas.height / window.devicePixelRatio;
  temporalStackCtx.clearRect(0, 0, w, h);
  temporalStackCtx.fillStyle = '#000';
  temporalStackCtx.fillRect(0, 0, w, h);

  const duplicateIndexes = new Set(state.anomalies.filter(a => a.type === 'duplicate').map(a => a.index));
  const jumpIndexes = new Set(state.anomalies.filter(a => a.type === 'jump').map(a => a.index));
  const artifactIndexes = new Set(state.anomalies.filter(a => a.type === 'artifact').map(a => a.index));
  const img = state.frames[state.currentIndex].img;
  const aspect = img.width / Math.max(img.height, 1);
  const stackScale = state.stackScale || 1;
  const stackSpacing = state.stackSpacing || 1;
  const maxCardW = w * 0.78;
  const maxCardH = h * 0.84;
  const baseCardH = Math.max(54, Math.min(150 * stackScale, maxCardH, maxCardW / aspect));
  const baseCardW = baseCardH * aspect;
  const scaleSpread = Math.min(stackScale, 2.6);
  const stepX = Math.max(12, Math.min(42, w / 58)) * scaleSpread * stackSpacing;
  const stepY = -Math.max(5, Math.min(20, h / 46)) * scaleSpread * stackSpacing;
  const after = Math.min(Math.max(16, Math.round(32 / stackScale)), state.frames.length - state.currentIndex - 1);
  const start = state.currentIndex;
  const end = state.currentIndex + after;
  const centerX = w * 0.24;
  const centerY = h * 0.56;

  temporalStackHitboxes = [];

  temporalStackCtx.save();
  temporalStackCtx.strokeStyle = 'rgba(139, 92, 246, 0.08)';
  temporalStackCtx.lineWidth = 1;
  for (let x = 0; x < w; x += 32) {
    temporalStackCtx.beginPath();
    temporalStackCtx.moveTo(x, 0);
    temporalStackCtx.lineTo(x, h);
    temporalStackCtx.stroke();
  }
  temporalStackCtx.restore();

  const drawOrder = [];
  for (let i = start; i <= end; i++) drawOrder.push(i);
  drawOrder.sort((a, b) => Math.abs(b - state.currentIndex) - Math.abs(a - state.currentIndex));

  drawOrder.forEach(index => {
    const relative = index - state.currentIndex;
    const distance = Math.abs(relative);
    const scale = Math.max(0.58, 1 - distance * 0.014);
    const cardW = baseCardW * scale;
    const cardH = baseCardH * scale;
    const x = centerX + relative * stepX - cardW / 2;
    const y = centerY + relative * stepY - cardH / 2;
    const isDuplicate = duplicateIndexes.has(index);
    const isJump = jumpIndexes.has(index);
    const isArtifact = artifactIndexes.has(index);
    const isCurrent = index === state.currentIndex;

    if (x > w + 20 || x + cardW < -20 || y > h + 20 || y + cardH < -20) return;

    temporalStackCtx.save();
    temporalStackCtx.globalAlpha = Math.max(0.36, 1 - distance * 0.018);
    temporalStackCtx.fillStyle = 'rgba(5, 6, 12, 0.95)';
    temporalStackCtx.fillRect(x - 3, y - 3, cardW + 6, cardH + 6);

    temporalStackCtx.drawImage(state.frames[index].img, x, y, cardW, cardH);

    let strokeColor = 'rgba(255, 255, 255, 0.18)';
    let lineWidth = 1;
    if (isJump) {
      strokeColor = 'rgba(245, 158, 11, 0.95)';
      lineWidth = 2;
    }
    if (isArtifact) {
      strokeColor = 'rgba(236, 72, 153, 0.95)';
      lineWidth = 3;
    }
    if (isDuplicate) {
      strokeColor = '#8b5cf6';
      lineWidth = 4;
    }
    if (isCurrent) {
      strokeColor = isDuplicate ? '#a78bfa' : (isArtifact ? '#f472b6' : '#22d3ee');
      lineWidth = isDuplicate ? 5 : (isArtifact ? 4 : 3);
      temporalStackCtx.shadowColor = isDuplicate
        ? 'rgba(139, 92, 246, 0.75)'
        : (isArtifact ? 'rgba(236, 72, 153, 0.75)' : 'rgba(34, 211, 238, 0.65)');
      temporalStackCtx.shadowBlur = 14;
    }

    temporalStackCtx.strokeStyle = strokeColor;
    temporalStackCtx.lineWidth = lineWidth;
    temporalStackCtx.strokeRect(x - lineWidth / 2, y - lineWidth / 2, cardW + lineWidth, cardH + lineWidth);
    temporalStackCtx.shadowBlur = 0;

    temporalStackCtx.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
    temporalStackCtx.fillStyle = isDuplicate ? 'rgba(88, 28, 135, 0.92)' : 'rgba(0, 0, 0, 0.68)';
    const label = isDuplicate ? `${classifyLowMotion(state.diffs[index] || 0).badge} #${String(index).padStart(3, '0')}` : `#${String(index).padStart(3, '0')}`;
    const labelW = temporalStackCtx.measureText(label).width + 12;
    temporalStackCtx.fillRect(x + 6, y + 6, labelW, 17);
    temporalStackCtx.fillStyle = '#f8fafc';
    temporalStackCtx.fillText(label, x + 12, y + 18);

    if (isJump) {
      temporalStackCtx.fillStyle = 'rgba(245, 158, 11, 0.92)';
      temporalStackCtx.fillRect(x + 6, y + 27, 42, 17);
      temporalStackCtx.fillStyle = '#111827';
      temporalStackCtx.fillText('SPIKE', x + 12, y + 39);
    }

    if (isArtifact) {
      temporalStackCtx.fillStyle = 'rgba(236, 72, 153, 0.92)';
      temporalStackCtx.fillRect(x + 6, y + 27, 32, 17);
      temporalStackCtx.fillStyle = '#111827';
      temporalStackCtx.fillText('ART', x + 12, y + 39);
    }

    temporalStackCtx.restore();
    temporalStackHitboxes.push({ index, x, y, w: cardW, h: cardH });
  });

  temporalStackCtx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  temporalStackCtx.fillRect(12, h - 34, Math.min(390, w - 24), 22);
  temporalStackCtx.fillStyle = '#cfd4ff';
  temporalStackCtx.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
  temporalStackCtx.fillText(
    `Frame ${String(state.currentIndex).padStart(4, '0')} / ${state.frames.length - 1}  |  Future frames only`,
    22,
    h - 19
  );
}

// -------------------------------------------------------------
// PLAYBACK SYSTEM
// -------------------------------------------------------------

function setupPlaybackAudio(file) {
  cleanupPlaybackAudio();

  const audio = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;
  audio.preload = 'auto';
  audio.playsInline = true;
  audio.style.display = 'none';
  document.body.appendChild(audio);

  state.audioElement = audio;
  state.audioObjectUrl = objectUrl;
}

function cleanupPlaybackAudio() {
  if (state.audioElement) {
    state.audioElement.pause();
    state.audioElement.removeAttribute('src');
    state.audioElement.load();
    state.audioElement.remove();
    state.audioElement = null;
  }

  if (state.audioObjectUrl) {
    URL.revokeObjectURL(state.audioObjectUrl);
    state.audioObjectUrl = null;
  }
}

function syncPlaybackAudio(shouldPlay = false, forceSeek = true) {
  const audio = state.audioElement;
  if (!audio || state.loadedFileType !== 'video') return;

  const sourceFps = state.sourceFps || 24;
  const targetTime = state.currentIndex / sourceFps;
  const playbackRatio = (state.playbackFps || sourceFps) / sourceFps;
  const supportedRate = Math.min(4, Math.max(0.0625, playbackRatio));

  if (forceSeek || Math.abs(audio.currentTime - targetTime) > 0.18) {
    try {
      audio.currentTime = targetTime;
    } catch (err) {
      console.warn('Could not sync playback audio time:', err);
    }
  }

  audio.playbackRate = supportedRate;

  if (shouldPlay && playbackRatio >= 0.0625) {
    if (audio.paused) {
      audio.play().catch(err => console.warn('Audio playback was blocked or unavailable:', err));
    }
  } else {
    audio.pause();
  }
}

function togglePlay() {
  if (state.isPlaying) {
    pause();
  } else {
    play();
  }
}

function play() {
  if (state.frames.length === 0) return;
  if (state.playbackInterval) clearInterval(state.playbackInterval);
  
  state.isPlaying = true;
  const playBtn = document.getElementById('btn-play-toggle');
  playBtn.textContent = "⏸";
  playBtn.classList.add('active');
  
  syncPlaybackAudio(true, true);
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
  syncPlaybackAudio(false, false);
  
  if (state.frames.length > 0) {
    updateStatus("Paused", "success");
  }
}

function setViewMode(mode) {
  state.viewMode = mode;
  
  const buttons = ['btn-view-normal', 'btn-view-onion', 'btn-view-diff', 'btn-view-artifact'];
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

// Interpolate a single duplicate or spike candidate by blending adjacent ones
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
    while (prevIdx > 0 && state.diffs[prevIdx] < state.dupThreshold) {
      prevIdx--;
    }
    
    // Look forward for the closest unique frame
    let nextIdx = idx + 1;
    while (nextIdx < state.frames.length - 1 && state.diffs[nextIdx] < state.dupThreshold) {
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

// Auto-smooth cut/spike candidates by injecting missing frames (video retimer approach).
// This is intentionally conservative in the UI because abrupt changes are often real cuts.
async function autoFixAllJumps() {
  const jumps = state.anomalies.filter(a => a.type === 'jump');
  if (jumps.length === 0) {
    alert("No cut / spike candidates detected under the current threshold.");
    return;
  }
  
  pause();
  
  const confirmFix = confirm(`Smooth ${jumps.length} cut / spike candidate(s) by inserting blended frames? Only continue if these are dropped-frame skips, not intentional smash cuts or angle changes. This will inject new frames and make the sequence slightly longer.`);
  if (!confirmFix) return;
  
  showLoader("Injecting Smoothing Frames...", "Smoothing spike candidates");
  
  // Resolve candidates. Note: as we inject frames, index array offsets shift.
  // To avoid indexing conflicts, we process in reverse order.
  const sortedJumps = [...jumps].sort((a, b) => b.index - a.index);
  const total = sortedJumps.length;
  
  for (let k = 0; k < total; k++) {
    const idx = sortedJumps[k].index;
    
    updateLoaderProgress(k / total, `Smoothing candidate at frame #${idx}...`, `Review item ${k + 1} of ${total}`);
    
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
  alert(`Successfully injected ${total} blended frame(s) for selected spike candidates.`);
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

function getAnomalyLabel(anomaly) {
  if (anomaly.type === 'duplicate') return anomaly.subtype || 'Low Motion';
  if (anomaly.type === 'artifact') return 'Temporal Artifact';
  return 'Cut / Spike Candidate';
}

function getAnomalyMarkerColor(anomaly, format = 'resolve') {
  if (anomaly.type === 'duplicate') return format === 'edl' ? 'BLUE' : 'Blue';
  if (anomaly.type === 'artifact') return format === 'edl' ? 'RED' : 'Red';
  return format === 'edl' ? 'YELLOW' : 'Yellow';
}

function exportFileIntelligenceReport() {
  if (!state.fileIntelligence) {
    alert("Load a sequence before exporting a file report.");
    return;
  }

  updateDecodedFileIntelligence();
  const report = {
    app: {
      name: 'Video Motion Analyser',
      reportType: 'file-intelligence',
      generatedAt: new Date().toISOString()
    },
    source: state.fileIntelligence,
    motionAnalysis: {
      frameCount: state.frames.length,
      sourceFps: state.sourceFps,
      playbackFps: state.playbackFps,
      lowMotionThresholdPct: state.dupThreshold,
      cutSpikeSensitivity: state.jumpThreshold,
      artifactSensitivity: state.artifactThreshold,
      cadenceReport: state.cadenceReport,
      anomalyCounts: {
        lowMotion: state.anomalies.filter(a => a.type === 'duplicate').length,
        cutOrSpike: state.anomalies.filter(a => a.type === 'jump').length,
        temporalArtifacts: state.anomalies.filter(a => a.type === 'artifact').length
      },
      anomalies: state.anomalies.map(anomaly => ({
        index: anomaly.index,
        type: anomaly.type,
        label: getAnomalyLabel(anomaly),
        severity: anomaly.severity,
        description: anomaly.description
      }))
    },
    limitations: [
      'Browser video metadata does not expose codec profile, GOP structure, packet timestamps, encoder tags, or reliable audio stream presence.',
      'Estimated bitrate is calculated from file size divided by browser-reported duration.',
      'For forensic-grade metadata comparison, verify with ffprobe, MediaInfo, and ExifTool against the original file.'
    ]
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const baseName = getReportBaseName();
  link.download = `${baseName}_file_intelligence.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function getReportBaseName() {
  const name = state.loadedFileName || 'sequence';
  const lastDot = name.lastIndexOf('.');
  const base = lastDot > 0 ? name.substring(0, lastDot) : name;
  return base.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'sequence';
}

// Export DaVinci Resolve Markers (CSV format)
function exportResolveMarkers() {
  if (state.frames.length === 0) return;
  
  const fps = state.playbackFps;
  let csvContent = "Title,Description,Timecode,Color,Duration\n";
  
  state.anomalies.forEach(anomaly => {
    const title = getAnomalyLabel(anomaly);
    const desc = anomaly.description.replace(/"/g, '""');
    const tc = frameToTimecode(anomaly.index, fps);
    const color = getAnomalyMarkerColor(anomaly);
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
    const color = getAnomalyMarkerColor(anomaly, 'edl');
    const label = getAnomalyLabel(anomaly).toUpperCase();
    
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
