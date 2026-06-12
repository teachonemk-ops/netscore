// NetScores - Cricket Scorer JavaScript Logic

// -------------------------------------------------------------
// 1. Firebase Initialization & Fail-Safe Offline Mode
// -------------------------------------------------------------
let db = null;
let isOfflineMode = true;
let isScorer = true; // True if this device created the match; False if spectating
let matchCode = "";

// Default Sandbox Firebase Config (Users can replace this with their own config)
const firebaseConfig = {
  apiKey: "AIzaSyDGKRFMvU3jacvcWKiT48TXb05BYystj2c",
  authDomain: "netscorew.firebaseapp.com",
  projectId: "netscorew",
  storageBucket: "netscorew.firebasestorage.app",
  messagingSenderId: "672046348153",
  appId: "1:672046348153:web:b2fde21a992b877a52e1a8",
  measurementId: "G-H0V7TP5YYC"
};

try {
  // If Firestore CDN loaded successfully and config is initialized
  if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    isOfflineMode = false;
    document.getElementById("sync-status").textContent = "Cloud Sync Ready";
    document.getElementById("sync-status").className = "sync-badge online";
  } else {
    console.warn("Firebase SDK not loaded. Operating in offline local-only mode.");
    setOfflineBadge();
  }
} catch (error) {
  console.error("Firebase init failed, switching to local-only mode:", error);
  setOfflineBadge();
}

function setOfflineBadge() {
  isOfflineMode = true;
  const badge = document.getElementById("sync-status");
  if (badge) {
    badge.textContent = "Offline Mode";
    badge.className = "sync-badge offline";
  }
}

// -------------------------------------------------------------
// 2. Core Match State Model
// -------------------------------------------------------------
let matchState = {
  matchCode: "",
  teamA: "Team A",
  teamB: "Team B",
  oversLimit: 5,
  currentInnings: 1, // 1 = First innings, 2 = Second innings
  status: "setup", // 'setup', 'live', 'innings_ended', 'match_completed'
  // Innings Data
  innings1: {
    battingTeam: "teamA",
    runs: 0,
    wickets: 0,
    balls: 0, // legal balls
    wides: 0,
    noballs: 0,
    deliveries: [], // Array of delivery objects
    maxDeliveriesCount: 0
  },
  innings2: {
    battingTeam: "teamB",
    runs: 0,
    wickets: 0,
    balls: 0,
    wides: 0,
    noballs: 0,
    deliveries: [],
    target: 0,
    maxDeliveriesCount: 0
  }
};

// Local storage backup for recent matches
let recentMatches = JSON.parse(localStorage.getItem("netscores_recent") || "[]");

// -------------------------------------------------------------
// 3. UI Elements Cache & Navigation
// -------------------------------------------------------------
const tabs = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    const targetTab = tab.getAttribute("data-tab");
    switchTab(targetTab);
  });
});

function switchTab(tabId) {
  tabs.forEach(t => {
    if (t.getAttribute("data-tab") === tabId) {
      t.classList.add("active");
    } else {
      t.classList.remove("active");
    }
  });

  tabContents.forEach(tc => {
    if (tc.id === tabId) {
      tc.classList.add("active");
    } else {
      tc.classList.remove("active");
    }
  });
}

// Enable/Disable tabs based on match status
function updateTabStates() {
  const btnScorecard = document.getElementById("btn-tab-scorecard");
  const btnHistory = document.getElementById("btn-tab-history");

  if (matchState.status !== "setup") {
    btnScorecard.removeAttribute("disabled");
    btnHistory.removeAttribute("disabled");
  } else {
    btnScorecard.setAttribute("disabled", "true");
    btnHistory.setAttribute("disabled", "true");
  }
}

// -------------------------------------------------------------
// 4. Create / Join Match Logic
// -------------------------------------------------------------
document.getElementById("btn-create-match").addEventListener("click", () => {
  const teamA = document.getElementById("input-team-a").value.trim() || "Team A";
  const teamB = document.getElementById("input-team-b").value.trim() || "Team B";
  const overs = parseInt(document.getElementById("input-overs").value) || 5;

  matchCode = Math.floor(1000 + Math.random() * 9000).toString();
  isScorer = true;

  // Initialize State
  matchState = {
    matchCode: matchCode,
    teamA: teamA,
    teamB: teamB,
    oversLimit: overs,
    currentInnings: 1,
    status: "live",
    innings1: {
      battingTeam: "teamA",
      runs: 0,
      wickets: 0,
      balls: 0,
      wides: 0,
      noballs: 0,
      deliveries: [],
      maxDeliveriesCount: 0
    },
    innings2: {
      battingTeam: "teamB",
      runs: 0,
      wickets: 0,
      balls: 0,
      wides: 0,
      noballs: 0,
      deliveries: [],
      target: 0,
      maxDeliveriesCount: 0
    }
  };

  // Show Scorer Controls
  document.getElementById("scorer-controls").style.display = "grid";
  document.getElementById("history-desc").textContent = "Click any ball below to edit its outcome.";

  updateTabStates();
  saveAndSyncMatch();
  switchTab("tab-scorecard");
  renderScorecard();
});

document.getElementById("btn-join-match").addEventListener("click", () => {
  const code = document.getElementById("input-match-code").value.trim();
  if (code.length !== 4) {
    alert("Please enter a valid 4-digit Match Code.");
    return;
  }

  joinMatch(code);
});

function joinMatch(code) {
  matchCode = code;
  isScorer = false;

  // Hide scoring buttons on spectator screen
  document.getElementById("scorer-controls").style.display = "none";
  document.getElementById("history-desc").textContent = "Viewing mode (read-only live sync).";

  if (isOfflineMode) {
    // If offline, check if match is in recent matches list
    const found = recentMatches.find(m => m.matchCode === code);
    if (found) {
      matchState = found;
      updateTabStates();
      switchTab("tab-scorecard");
      renderScorecard();
    } else {
      alert("Match not found locally. Connect to internet or verify the code.");
    }
  } else {
    // Online Firebase listener
    db.collection("matches").doc(code).onSnapshot(doc => {
      if (doc.exists) {
        matchState = doc.data();
        document.getElementById("sync-status").textContent = "Live Spectator";
        document.getElementById("sync-status").className = "sync-badge live-host";
        updateTabStates();
        renderScorecard();
        renderHistory();
      } else {
        alert("Match not found on server.");
      }
    }, err => {
      console.error("Firestore read error:", err);
      alert("Error joining live match.");
    });
    switchTab("tab-scorecard");
  }
}

// -------------------------------------------------------------
// 5. Database & Local Storage Sync
// -------------------------------------------------------------
function saveAndSyncMatch() {
  // Update recent local matches list
  recentMatches = recentMatches.filter(m => m.matchCode !== matchState.matchCode);
  recentMatches.unshift(matchState);
  if (recentMatches.length > 5) recentMatches.pop(); // Keep last 5
  localStorage.setItem("netscores_recent", JSON.stringify(recentMatches));

  renderRecentMatches();

  if (isScorer) {
    const badge = document.getElementById("sync-status");
    if (isOfflineMode) {
      badge.textContent = "Offline Scorer";
      badge.className = "sync-badge offline";
    } else {
      badge.textContent = "Scorer (Live)";
      badge.className = "sync-badge live-host";

      // Sync to Firestore
      db.collection("matches").doc(matchState.matchCode).set(matchState)
        .catch(err => {
          console.error("Firestore write failed:", err);
          setOfflineBadge();
        });
    }
  }
}

// -------------------------------------------------------------
// 6. Recalculation Core (The Engine)
// -------------------------------------------------------------
function getActiveInnings() {
  return matchState.currentInnings === 1 ? matchState.innings1 : matchState.innings2;
}

function recalculateMatchStats() {
  const innings = getActiveInnings();
  const deliveries = innings.deliveries;

  // Reset counters
  innings.runs = 0;
  innings.wickets = 0;
  innings.balls = 0;
  innings.wides = 0;
  innings.noballs = 0;

  let legalBallInOver = 0;
  let currentOverIndex = 0;

  deliveries.forEach((del) => {
    // Recalculate ball index for visual timeline
    if (del.type === "normal" || del.type === "wicket") {
      legalBallInOver++;
      if (legalBallInOver > 6) {
        legalBallInOver = 1;
        currentOverIndex++;
      }
      del.overNum = currentOverIndex;
      del.ballNum = legalBallInOver;
      innings.balls++;
    } else {
      // Extras (Wide / No Ball) - do not count towards legal balls
      del.overNum = currentOverIndex;
      del.ballNum = legalBallInOver; // keeps current ball count
    }

    // Apply runs and wickets
    if (del.type === "normal") {
      innings.runs += del.runs;
    } else if (del.type === "wide") {
      innings.runs += (1 + del.runs); // 1 wide penalty + additional runs
      innings.wides += (1 + del.runs);
    } else if (del.type === "noball") {
      innings.runs += (1 + del.runs); // 1 noball penalty + bat runs
      innings.noballs += (1 + del.runs);
    } else if (del.type === "wicket") {
      innings.wickets++;
    }
  });

  // Check for End of Innings
  const maxBalls = matchState.oversLimit * 6;
  if (innings.wickets >= 10 || innings.balls >= maxBalls) {
    handleInningsEnd();
  }

  // Second Innings Specific Target Rules
  if (matchState.currentInnings === 2) {
    const target = matchState.innings2.target;
    if (innings.runs >= target) {
      matchState.status = "match_completed";
    } else if (innings.balls >= maxBalls || innings.wickets >= 10) {
      matchState.status = "match_completed";
    }
  }
}

function handleInningsEnd() {
  if (matchState.currentInnings === 1) {
    matchState.status = "innings1_ended";
    matchState.innings2.target = matchState.innings1.runs + 1;
  } else {
    matchState.status = "match_completed";
  }
}

// Helper to convert balls to over string (e.g. 8 balls -> 1.2 overs)
function formatOvers(ballsCount) {
  const overs = Math.floor(ballsCount / 6);
  const remaining = ballsCount % 6;
  return `${overs}.${remaining}`;
}

// -------------------------------------------------------------
// 7. Scorer Button Handlers
// -------------------------------------------------------------
let pendingExtraType = ""; // 'wide' or 'noball'

// Normal run buttons (0, 1, 2, 3, 4, 6)
document.querySelectorAll(".score-btn[data-val]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!isScorer || isMatchOver()) return;
    const runs = parseInt(btn.getAttribute("data-val"));
    addDelivery("normal", runs);
  });
});

// Wicket Button
document.getElementById("btn-wicket").addEventListener("click", () => {
  if (!isScorer || isMatchOver()) return;
  addDelivery("wicket", 0);
});

// Wide / No Ball opens modal
document.getElementById("btn-wide").addEventListener("click", () => {
  if (!isScorer || isMatchOver()) return;
  openExtrasModal("wide");
});

document.getElementById("btn-noball").addEventListener("click", () => {
  if (!isScorer || isMatchOver()) return;
  openExtrasModal("noball");
});

let stepperVal = 1;

function openExtrasModal(type) {
  pendingExtraType = type;
  document.getElementById("modal-title").textContent = type === "wide" ? "Wide Ball Extras" : "No Ball Extras";
  // Reset stepper to 1
  stepperVal = 1;
  updateStepperUI();
  document.getElementById("extras-modal").classList.add("active");
}

// Modal extra runs buttons (0, 4, 6)
document.querySelectorAll(".modal-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const extraRuns = parseInt(btn.getAttribute("data-extra"));
    document.getElementById("extras-modal").classList.remove("active");
    addDelivery(pendingExtraType, extraRuns);
  });
});

// Stepper Handlers for 1, 2, 3 runs
document.getElementById("btn-stepper-minus").addEventListener("click", () => {
  if (stepperVal > 1) {
    stepperVal--;
    updateStepperUI();
  }
});

document.getElementById("btn-stepper-plus").addEventListener("click", () => {
  if (stepperVal < 3) {
    stepperVal++;
    updateStepperUI();
  }
});

document.getElementById("btn-confirm-stepper").addEventListener("click", () => {
  document.getElementById("extras-modal").classList.remove("active");
  addDelivery(pendingExtraType, stepperVal);
});

function updateStepperUI() {
  document.getElementById("btn-confirm-stepper").textContent = stepperVal;
}

document.getElementById("btn-close-modal").addEventListener("click", () => {
  document.getElementById("extras-modal").classList.remove("active");
});

document.getElementById("btn-close-over-modal").addEventListener("click", () => {
  document.getElementById("over-modal").classList.remove("active");
});

function openOverModal(overNum) {
  document.getElementById("over-modal-text").textContent = `Over ${overNum} is complete.`;
  document.getElementById("over-modal").classList.add("active");
}

// Undo Button
document.getElementById("btn-undo").addEventListener("click", () => {
  if (!isScorer) return;
  const innings = getActiveInnings();
  if (innings.deliveries.length === 0) return;

  innings.deliveries.pop();
  
  // If match was completed, bring it back to active live state
  if (matchState.status === "match_completed") {
    matchState.status = "live";
  } else if (matchState.status === "innings1_ended") {
    matchState.status = "live";
    matchState.currentInnings = 1;
  }

  recalculateMatchStats();
  saveAndSyncMatch();
  renderScorecard();
  renderHistory();
});

// Start 2nd Innings
document.getElementById("btn-start-second-innings").addEventListener("click", () => {
  if (!isScorer) return;
  matchState.currentInnings = 2;
  matchState.status = "live";
  saveAndSyncMatch();
  renderScorecard();
  renderHistory();
});

function isMatchOver() {
  return matchState.status === "match_completed" || matchState.status === "innings1_ended";
}

function addDelivery(type, runs) {
  const innings = getActiveInnings();
  const oldLegalBalls = innings.balls;
  
  // Undo Loophole Protection: If we're entering a delivery and current count is less than the max we've recorded, it's flagged as a replacement
  const currentLength = innings.deliveries.length;
  let isReplaced = false;
  if (innings.maxDeliveriesCount && currentLength < innings.maxDeliveriesCount) {
    isReplaced = true;
  }

  const delivery = {
    id: "del-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6),
    type: type,
    runs: runs,
    isEdited: false,
    isReplaced: isReplaced
  };

  innings.deliveries.push(delivery);

  // Update max deliveries reached
  if (innings.deliveries.length > (innings.maxDeliveriesCount || 0)) {
    innings.maxDeliveriesCount = innings.deliveries.length;
  }

  recalculateMatchStats();
  
  // Check if an over was just completed (exclude innings ends, which have separate switch alerts)
  const newLegalBalls = innings.balls;
  if (newLegalBalls > 0 && newLegalBalls % 6 === 0 && newLegalBalls !== oldLegalBalls && matchState.status === "live") {
    const overCompleted = newLegalBalls / 6;
    setTimeout(() => {
      openOverModal(overCompleted);
    }, 100);
  }

  saveAndSyncMatch();
  renderScorecard();
  renderHistory();
}

// -------------------------------------------------------------
// 8. History Editing Logic (Spectator highlights change)
// -------------------------------------------------------------
let editingDeliveryId = null;

function openEditModal(deliveryId) {
  if (!isScorer) return; // Only scorer can edit
  editingDeliveryId = deliveryId;
  const innings = getActiveInnings();
  const delivery = innings.deliveries.find(d => d.id === deliveryId);

  if (!delivery) return;

  const labelText = `Over ${formatOvers(delivery.overNum * 6 + (delivery.ballNum - 1))}`;
  document.getElementById("edit-ball-label").textContent = labelText;
  document.getElementById("edit-modal").classList.add("active");
}

document.querySelectorAll(".edit-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const type = btn.getAttribute("data-type");
    let runs = parseInt(btn.getAttribute("data-val") || "0");

    if (type === "wide" || type === "noball") {
      // Ask how many runs scored off wide/noball
      const res = prompt("Enter additional runs off this extra (0, 1, 2, 3, 4, 6):", "0");
      runs = parseInt(res) || 0;
    }

    applyEdit(type, runs);
  });
});

function applyEdit(type, runs) {
  const innings = getActiveInnings();
  const delivery = innings.deliveries.find(d => d.id === editingDeliveryId);

  if (delivery) {
    // Mark as edited
    delivery.type = type;
    delivery.runs = runs;
    delivery.isEdited = true;

    recalculateMatchStats();
    saveAndSyncMatch();
    renderScorecard();
    renderHistory();
  }

  document.getElementById("edit-modal").classList.remove("active");
}

document.getElementById("btn-close-edit").addEventListener("click", () => {
  document.getElementById("edit-modal").classList.remove("active");
});

// -------------------------------------------------------------
// 9. UI Rendering Functions
// -------------------------------------------------------------
function renderScorecard() {
  const innings = getActiveInnings();
  const battingTeamName = matchState.currentInnings === 1 
    ? (matchState.innings1.battingTeam === "teamA" ? matchState.teamA : matchState.teamB)
    : (matchState.innings2.battingTeam === "teamA" ? matchState.teamA : matchState.teamB);
  
  const bowlingTeamName = matchState.currentInnings === 1
    ? (matchState.innings1.battingTeam === "teamA" ? matchState.teamB : matchState.teamA)
    : (matchState.innings2.battingTeam === "teamA" ? matchState.teamB : matchState.teamA);

  // Update names
  document.getElementById("display-team-a").textContent = battingTeamName;
  document.getElementById("display-team-b").textContent = bowlingTeamName;
  document.getElementById("display-match-code").textContent = matchState.matchCode || "----";

  // Score
  document.getElementById("display-runs").textContent = innings.runs;
  document.getElementById("display-wickets").textContent = innings.wickets;
  document.getElementById("display-overs").textContent = formatOvers(innings.balls);

  // Run Rates
  const oversBowled = innings.balls / 6;
  const crr = oversBowled > 0 ? (innings.runs / oversBowled) : 0;
  document.getElementById("display-crr").textContent = crr.toFixed(2);

  // Extras breakdown
  document.getElementById("display-extras").textContent = innings.wides + innings.noballs;
  document.getElementById("display-extras-breakdown").textContent = `${innings.wides}w, ${innings.noballs}nb`;

  // Innings 2 layout (Target and Required Run Rate)
  const reqRateContainer = document.getElementById("req-rate-container");
  const targetMsg = document.getElementById("display-target-msg");

  if (matchState.currentInnings === 2) {
    reqRateContainer.style.display = "flex";
    targetMsg.style.display = "block";

    const target = matchState.innings2.target;
    const runsNeeded = target - innings.runs;
    const maxBalls = matchState.oversLimit * 6;
    const ballsLeft = Math.max(0, maxBalls - innings.balls);
    
    targetMsg.textContent = runsNeeded > 0 
      ? `Need ${runsNeeded} runs off ${ballsLeft} balls to win` 
      : `${battingTeamName} won by ${10 - innings.wickets} wickets!`;

    const rrr = ballsLeft > 0 ? (runsNeeded / (ballsLeft / 6)) : 0;
    document.getElementById("display-rrr").textContent = Math.max(0, rrr).toFixed(2);
  } else {
    reqRateContainer.style.display = "none";
    targetMsg.style.display = "none";
  }

  // Innings Switch Overlay Control
  const inningSwitchCard = document.getElementById("inning-switch-card");
  const scorerControls = document.getElementById("scorer-controls");

  if (matchState.status === "innings1_ended") {
    inningSwitchCard.style.display = "block";
    document.getElementById("inning-over-text").textContent = `${battingTeamName} scored ${innings.runs} runs. Target is ${innings.runs + 1}.`;
    scorerControls.style.display = "none";
  } else if (matchState.status === "match_completed") {
    inningSwitchCard.style.display = "block";
    scorerControls.style.display = "none";
    if (matchState.currentInnings === 2) {
      const runsNeeded = matchState.innings2.target - innings.runs;
      if (runsNeeded > 0) {
        document.getElementById("inning-over-text").textContent = `Match Completed! ${bowlingTeamName} won by ${runsNeeded - 1} runs.`;
      } else {
        document.getElementById("inning-over-text").textContent = `Match Completed! ${battingTeamName} won by ${10 - innings.wickets} wickets.`;
      }
    }
    // Disable Start 2nd innings button
    document.getElementById("btn-start-second-innings").style.display = "none";
  } else {
    inningSwitchCard.style.display = "none";
    if (isScorer) {
      scorerControls.style.display = "grid";
    }
    document.getElementById("btn-start-second-innings").style.display = "inline-block";
  }
}

function renderHistory() {
  const innings = getActiveInnings();
  const listContainer = document.getElementById("history-overs-list");
  listContainer.innerHTML = "";

  if (innings.deliveries.length === 0) {
    listContainer.innerHTML = '<p class="empty-msg">No deliveries bowled yet.</p>';
    return;
  }

  // Group deliveries by over index
  const overs = {};
  innings.deliveries.forEach(del => {
    if (!overs[del.overNum]) {
      overs[del.overNum] = [];
    }
    overs[del.overNum].push(del);
  });

  // Render group by group
  Object.keys(overs).sort((a,b) => b - a).forEach(overIdx => {
    const overDels = overs[overIdx];
    const overRow = document.createElement("div");
    overRow.className = "over-row";

    const overHeader = document.createElement("div");
    overHeader.className = "over-header";
    
    // Calculate runs in this specific over
    let overRuns = 0;
    overDels.forEach(d => {
      if (d.type === 'normal') overRuns += d.runs;
      else if (d.type === 'wide' || d.type === 'noball') overRuns += (1 + d.runs);
    });

    overHeader.innerHTML = `
      <span>Over ${parseInt(overIdx) + 1}</span>
      <span>${overRuns} Runs</span>
    `;
    overRow.appendChild(overHeader);

    const ballsContainer = document.createElement("div");
    ballsContainer.className = "over-balls";

    overDels.forEach(del => {
      const bubble = document.createElement("div");
      bubble.className = "ball-bubble";
      
      // Setup styling classes
      if (del.type === "normal") {
        bubble.textContent = del.runs;
        bubble.classList.add(`runs-${del.runs}`);
      } else if (del.type === "wide") {
        bubble.textContent = `Wd${del.runs > 0 ? `+${del.runs}` : ""}`;
        bubble.classList.add("extra-wd");
      } else if (del.type === "noball") {
        bubble.textContent = `Nb${del.runs > 0 ? `+${del.runs}` : ""}`;
        bubble.classList.add("extra-nb");
      } else if (del.type === "wicket") {
        bubble.textContent = "W";
        bubble.classList.add("wicket");
      }

      // Highlights for edited/replaced deliveries
      if (del.isEdited) {
        bubble.classList.add("edited-delivery");
        bubble.title = "Outcome edited retrospectively";
      } else if (del.isReplaced) {
        bubble.classList.add("replaced-delivery");
        bubble.title = "Ball replaced after Undo";
      }

      // Action click on ball
      if (isScorer) {
        bubble.addEventListener("click", () => openEditModal(del.id));
      }

      ballsContainer.appendChild(bubble);
    });

    overRow.appendChild(ballsContainer);
    listContainer.appendChild(overRow);
  });
}

function renderRecentMatches() {
  const container = document.getElementById("recent-matches-list");
  container.innerHTML = "";

  if (recentMatches.length === 0) {
    container.innerHTML = '<p class="empty-msg">No active or past matches found.</p>';
    return;
  }

  recentMatches.forEach(match => {
    const item = document.createElement("div");
    item.className = "recent-item";
    
    // Status text
    let statusLabel = "";
    if (match.status === "match_completed") {
      statusLabel = "Completed";
    } else if (match.status === "innings1_ended") {
      statusLabel = "Innings Break";
    } else {
      statusLabel = "Live";
    }

    const currentRuns = match.currentInnings === 1 ? match.innings1.runs : match.innings2.runs;
    const currentWkts = match.currentInnings === 1 ? match.innings1.wickets : match.innings2.wickets;

    item.innerHTML = `
      <div class="recent-teams">${match.teamA} vs ${match.teamB} (${statusLabel})</div>
      <div class="recent-score">Code: ${match.matchCode} - ${currentRuns}/${currentWkts}</div>
    `;

    item.addEventListener("click", () => {
      // Join match
      joinMatch(match.matchCode);
    });

    container.appendChild(item);
  });
}

// -------------------------------------------------------------
// 10. Initialization
// -------------------------------------------------------------
renderRecentMatches();
