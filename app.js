// ── Firebase config (REPLACE with your project's config) ────────────────────
// See setup instructions — paste your firebaseConfig object here.
const firebaseConfig = {
    apiKey: "AIzaSyAw_Tb_dmfVXRGy7L11-DkmVB7SbTjTG7w",
    authDomain: "thermo-c25ac.firebaseapp.com",
    projectId: "thermo-c25ac",
    storageBucket: "thermo-c25ac.firebasestorage.app",
    messagingSenderId: "318766288262",
    appId: "1:318766288262:web:dd1c0818d1b601f04db007",
};

// ── State ───────────────────────────────────────────────────────────────────

let sessionId = null;
let trialQueue = [];
let currentTrial = null;
let trialStartTime = null;
let completedCount = 0;
let sliderTouched = false;
let sliderMin = 0;
let sliderMax = 100;
let db = null;

// ── Firebase init ───────────────────────────────────────────────────────────

function initFirebase() {
    // Firebase SDK loaded via CDN in index.html footer
    if (typeof firebase === "undefined") {
        console.warn("Firebase SDK not loaded — running in offline mode");
        return;
    }
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
}

// ── Session ID ──────────────────────────────────────────────────────────────

function getSessionId() {
    let id = localStorage.getItem("thermo_session_id");
    if (!id) {
        id = "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
        localStorage.setItem("thermo_session_id", id);
    }
    return id;
}

// ── Trial queue ─────────────────────────────────────────────────────────────

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function buildQueue() {
    // Copy and shuffle all trials
    trialQueue = shuffleArray([...TRIALS]);
}

function nextTrial() {
    if (trialQueue.length === 0) {
        buildQueue(); // Reshuffle if they've done them all
    }
    return trialQueue.pop();
}

// ── Scale rendering ─────────────────────────────────────────────────────────

function renderScale(x, y, z, unit) {
    const sym = unit === "C" ? "\u00b0C" : "\u00b0F";
    const vals = [x, y, z];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const range = hi - lo;

    // Scale padding: 10% on each side (or at least 2 degrees)
    const pad = Math.max(range * 0.1, 2);
    const scaleLo = lo - pad;
    const scaleHi = hi + pad;
    const scaleRange = scaleHi - scaleLo;

    const container = document.getElementById("scale-container");

    // Remove old markers
    container.querySelectorAll(".scale-marker").forEach(el => el.remove());

    // Add markers for x, y, z
    const markers = [
        { val: x, label: `${x}${sym}`, cls: "marker-x" },
        { val: y, label: `${y}${sym}`, cls: "marker-y" },
        { val: z, label: `${z}${sym}`, cls: "marker-z" },
    ];

    markers.forEach(m => {
        const pct = ((m.val - scaleLo) / scaleRange) * 100;
        const div = document.createElement("div");
        div.className = `scale-marker ${m.cls}`;
        div.style.left = `${pct}%`;
        div.innerHTML = `<div class="marker-dot"></div><div class="marker-label">${m.label}</div>`;
        container.appendChild(div);
    });

    // Tick marks
    const ticksEl = document.getElementById("scale-ticks");
    ticksEl.innerHTML = "";
    const step = niceStep(scaleRange);
    let tickVal = Math.ceil(scaleLo / step) * step;
    while (tickVal <= scaleHi) {
        const pct = ((tickVal - scaleLo) / scaleRange) * 100;
        if (pct >= 0 && pct <= 100) {
            const tick = document.createElement("div");
            tick.className = "tick";
            tick.style.left = `${pct}%`;
            ticksEl.appendChild(tick);

            const label = document.createElement("div");
            label.className = "tick-label";
            label.style.left = `${pct}%`;
            label.textContent = tickVal;
            ticksEl.appendChild(label);
        }
        tickVal += step;
    }

    // Set slider range
    // Slider covers from below x to above z (generous range)
    const sliderPad = Math.max(range * 0.3, 4);
    sliderMin = Math.round((lo - sliderPad) * 2) / 2;
    sliderMax = Math.round((hi + sliderPad) * 2) / 2;

    const slider = document.getElementById("slider");
    slider.min = sliderMin;
    slider.max = sliderMax;
    slider.step = 0.5;
    // Start at midpoint of x and y
    slider.value = (x + y) / 2;

    document.getElementById("slider-min").textContent = `${sliderMin}${sym}`;
    document.getElementById("slider-max").textContent = `${sliderMax}${sym}`;
}

function niceStep(range) {
    if (range <= 10) return 2;
    if (range <= 30) return 5;
    if (range <= 80) return 10;
    if (range <= 200) return 20;
    return 50;
}

// ── UI updates ──────────────────────────────────────────────────────────────

function updateEstimate(val) {
    const sym = currentTrial.unit === "C" ? "\u00b0C" : "\u00b0F";
    document.getElementById("estimate-display").textContent =
        `${parseFloat(val).toFixed(1)}${sym}`;
    if (!sliderTouched) {
        sliderTouched = true;
        document.getElementById("submit-btn").disabled = false;
    }
}

function showTrial(trial) {
    currentTrial = trial;
    trialStartTime = Date.now();
    sliderTouched = false;

    const sym = trial.unit === "C" ? "\u00b0C" : "\u00b0F";

    document.getElementById("prompt-text").innerHTML =
        `Three thermometers in the same pot of water read
         <strong>${trial.x}${sym}</strong>,
         <strong>${trial.y}${sym}</strong>, and
         <strong>${trial.z}${sym}</strong>.
         What is the actual water temperature?`;

    renderScale(trial.x, trial.y, trial.z, trial.unit);

    document.getElementById("estimate-display").textContent = "--";
    document.getElementById("submit-btn").disabled = true;
    document.getElementById("feedback").textContent = "";

    document.getElementById("progress").textContent =
        `Completed: ${completedCount}`;
}

// ── Submit ───────────────────────────────────────────────────────────────────

function submitAnswer() {
    const estimate = parseFloat(document.getElementById("slider").value);
    const responseMs = Date.now() - trialStartTime;

    const record = {
        session_id: sessionId,
        x: currentTrial.x,
        y: currentTrial.y,
        z: currentTrial.z,
        unit: currentTrial.unit,
        estimate: estimate,
        response_ms: responseMs,
        timestamp: new Date().toISOString(),
    };

    // Save to Firebase
    if (db) {
        db.collection("responses").add(record).catch(err => {
            console.error("Firebase write error:", err);
        });
    } else {
        console.log("Response (offline):", record);
    }

    completedCount++;

    // Flash feedback
    document.getElementById("feedback").textContent = "Saved!";

    // Load next after brief pause
    setTimeout(() => {
        showTrial(nextTrial());
    }, 400);
}

// ── Flow control ────────────────────────────────────────────────────────────

function startTask() {
    sessionId = getSessionId();
    buildQueue();

    document.getElementById("welcome").style.display = "none";
    document.getElementById("task").style.display = "block";

    showTrial(nextTrial());
}

function continueTask() {
    document.getElementById("done").style.display = "none";
    document.getElementById("task").style.display = "block";
    buildQueue();
    showTrial(nextTrial());
}

// ── Init ────────────────────────────────────────────────────────────────────

initFirebase();
