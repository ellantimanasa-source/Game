const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const leaderboardList = document.getElementById("leaderboardList");

let GROUND_Y = 0;
const BACKDROP_ROAD_GAP = 42;

const state = {
  running: false,
  gameOver: false,
  score: 0,
  highScore: 0,
  speed: 280,
  spawnTimer: 0,
  boneSpawnTimer: 0,
  superFlagSpawnTimer: 0,
  flyTimer: 0,
  graceTimer: 0,
  scoreSubmitted: false,
  time: 0,
  obstacles: [],
  bones: [],
  superFlags: [],
  clouds: []
};

const dog = {
  x: 120,
  y: 0,
  width: 70,
  height: 50,
  vy: 0,
  gravity: 1650,
  jumpPower: -580,
  onGround: true,
  legPhase: 0
};

// Paste your Firebase project config here to enable global leaderboard.
// You can find it in Firebase Console -> Project settings -> Your apps -> SDK setup and configuration.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCduewTnt04yxqYn3nYnpD68lUvNYPTQPA",
  authDomain: "game-95425.firebaseapp.com",
  projectId: "game-95425",
  storageBucket: "game-95425.firebasestorage.app",
  messagingSenderId: "366606072020",
  appId: "1:366606072020:web:df4d17c31e8aee81dd2341"
};

let leaderboardDb = null;
let playerName = localStorage.getItem("yaleRunnerPlayerName") || "";

if (!playerName) {
  const entered = window.prompt("Enter your name for the global leaderboard (max 12 chars):", "");
  playerName = (entered || "Guest").trim().slice(0, 12) || "Guest";
  localStorage.setItem("yaleRunnerPlayerName", playerName);
}

function hasFirebaseConfig() {
  return Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId && window.firebase);
}

function renderLeaderboard(items, message = "") {
  if (!leaderboardList) return;
  if (message) {
    leaderboardList.innerHTML = `<li>${message}</li>`;
    return;
  }
  if (!items.length) {
    leaderboardList.innerHTML = "<li>No scores yet</li>";
    return;
  }
  leaderboardList.innerHTML = items
    .slice(0, 5)
    .map((item, index) => `<li>#${index + 1} ${item.name} - ${item.score}</li>`)
    .join("");
}

function pinLeaderboardTopRight() {
  // Keep function to avoid touching call sites; CSS controls layout.
}

async function initLeaderboard() {
  if (!hasFirebaseConfig()) {
    renderLeaderboard([], "Add Firebase config");
    return;
  }
  try {
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
    leaderboardDb = app.firestore();
    await loadTopScores();
  } catch (error) {
    renderLeaderboard([], "Leaderboard unavailable");
  }
}

async function loadTopScores() {
  if (!leaderboardDb) return;
  try {
    const snapshot = await leaderboardDb
      .collection("scores")
      .orderBy("score", "desc")
      .limit(5)
      .get();
    const items = snapshot.docs.map((doc) => doc.data());
    renderLeaderboard(items);
  } catch (error) {
    renderLeaderboard([], "Read failed");
  }
}

async function submitScore(score) {
  if (!leaderboardDb) return;
  try {
    await leaderboardDb.collection("scores").add({
      name: playerName || "Guest",
      score: Math.floor(score),
      createdAt: Date.now()
    });
    await loadTopScores();
  } catch (error) {
    // Keep gameplay smooth even if submit fails.
  }
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  GROUND_Y = canvas.height - 62;

  if (dog.onGround) {
    dog.y = GROUND_Y - dog.height;
  } else if (dog.y > GROUND_Y - dog.height) {
    dog.y = GROUND_Y - dog.height;
  }
}

function resetGame() {
  state.running = true;
  state.gameOver = false;
  state.score = 0;
  state.speed = 280;
  state.spawnTimer = 0;
  state.boneSpawnTimer = 1.2;
  state.superFlagSpawnTimer = 8 + Math.random() * 5;
  state.flyTimer = 0;
  state.graceTimer = 0;
  state.scoreSubmitted = false;
  state.time = 0;
  state.obstacles = [];
  state.bones = [];
  state.superFlags = [];
  state.clouds = createClouds();
  dog.y = GROUND_Y - dog.height;
  dog.vy = 0;
  dog.onGround = true;
  dog.legPhase = 0;
}

function createClouds() {
  return Array.from({ length: 4 }, (_, i) => ({
    x: 140 + i * 220,
    y: 40 + Math.random() * 70,
    speed: 24 + Math.random() * 22
  }));
}

function jump() {
  if (!state.running) {
    resetGame();
    return;
  }
  if (state.gameOver) {
    resetGame();
    return;
  }
  if (state.flyTimer > 0) {
    dog.vy = -430;
    return;
  }
  if (dog.onGround) {
    dog.vy = dog.jumpPower;
    dog.onGround = false;
  }
}

function spawnObstacle() {
  const harvardChance = 0.32;
  if (Math.random() < harvardChance) {
    const tall = Math.random() < 0.45;
    const width = tall ? 38 : 34;
    const height = tall ? 66 : 58;
    state.obstacles.push({
      x: canvas.width + 24,
      y: GROUND_Y - height,
      width,
      height,
      kind: "harvardMascot",
    tall,
    cleared: false
    });
    return;
  }

  const maxCount = Math.min(4, 2 + Math.floor(state.time / 20));
  const officersCount = 1 + Math.floor(Math.random() * maxCount);
  const officers = [];

  let cursorX = 0;
  let maxHeight = 0;
  for (let i = 0; i < officersCount; i++) {
    const tall = Math.random() < Math.min(0.4, state.time / 140);
    const w = tall ? 34 : 30;
    const h = tall ? 64 : 56;
    const gap = 5 + Math.floor(Math.random() * 10);
    officers.push({
      x: cursorX,
      y: 0,
      width: w,
      height: h,
      tall
    });
    cursorX += w + gap;
    maxHeight = Math.max(maxHeight, h);
  }

  // Align all guards to the same ground baseline.
  for (const officer of officers) {
    officer.y = maxHeight - officer.height;
  }

  const width = Math.max(30, cursorX - (officers.length > 0 ? officers[officers.length - 1].width * 0.15 : 0));
  const height = maxHeight;

  state.obstacles.push({
    x: canvas.width + 24,
    y: GROUND_Y - height,
    width,
    height,
    kind: "securityGuard",
    officers,
    cleared: false
  });
}

function spawnBone() {
  const isFlying = state.flyTimer > 0;
  const minY = isFlying ? 48 : GROUND_Y - 112;
  const maxY = isFlying ? GROUND_Y - 110 : GROUND_Y - 10;
  state.bones.push({
    x: canvas.width + 40,
    y: minY + Math.random() * (maxY - minY),
    width: 26,
    height: 26,
    collected: false,
    spinOffset: Math.random() * Math.PI * 2
  });
}

function spawnSuperFlag() {
  const minY = GROUND_Y - 170;
  const maxY = GROUND_Y - 90;
  state.superFlags.push({
    x: canvas.width + 50,
    y: minY + Math.random() * (maxY - minY),
    width: 46,
    height: 34,
    collected: false
  });
}

function update(dt) {
  if (!state.running || state.gameOver) return;

  state.time += dt;
  state.score += dt * 11;
  state.speed = Math.min(560, 280 + state.time * 7);

  if (state.flyTimer > 0) {
    state.flyTimer -= dt;
    if (state.flyTimer <= 0) {
      state.flyTimer = 0;
      state.graceTimer = Math.max(state.graceTimer, 3);
    }
    dog.vy += 920 * dt;
    if (dog.y > GROUND_Y - 130) {
      dog.vy -= 1500 * dt;
    }
    if (dog.y < 34) {
      dog.y = 34;
      dog.vy = Math.max(0, dog.vy);
    }
  } else {
    dog.vy += dog.gravity * dt;
  }
  if (state.graceTimer > 0) {
    state.graceTimer -= dt;
    if (state.graceTimer < 0) state.graceTimer = 0;
  }
  dog.y += dog.vy * dt;

  if (dog.y >= GROUND_Y - dog.height) {
    dog.y = GROUND_Y - dog.height;
    dog.vy = 0;
    dog.onGround = true;
  }

  dog.legPhase += dt * 18;

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnObstacle();
    const min = 0.75;
    const max = 1.4;
    const speedFactor = (state.speed - 280) / 280;
    state.spawnTimer = max - Math.random() * (max - min) - speedFactor * 0.25;
    state.spawnTimer = Math.max(0.52, state.spawnTimer);
  }

  state.boneSpawnTimer -= dt;
  if (state.boneSpawnTimer <= 0) {
    spawnBone();
    const isFlying = state.flyTimer > 0;
    const min = isFlying ? 0.35 : 1.8;
    const max = isFlying ? 0.85 : 3.7;
    state.boneSpawnTimer = min + Math.random() * (max - min);

    // During fly mode, occasionally spawn a second coin near high altitude.
    if (isFlying && Math.random() < 0.55) {
      spawnBone();
    }
  }

  state.superFlagSpawnTimer -= dt;
  if (state.superFlagSpawnTimer <= 0) {
    spawnSuperFlag();
    const min = 11;
    const max = 18;
    state.superFlagSpawnTimer = min + Math.random() * (max - min);
  }

  for (const obstacle of state.obstacles) {
    obstacle.x -= state.speed * dt;
  }

  // Reward successful clears: Harvard mascot grants more than police.
  for (const obstacle of state.obstacles) {
    if (!obstacle.cleared && obstacle.x + obstacle.width < dog.x - 4) {
      if (obstacle.kind === "harvardMascot") {
        state.score += 45;
      } else if (obstacle.kind === "securityGuard") {
        state.score += 18;
      }
      obstacle.cleared = true;
    }
  }
  state.obstacles = state.obstacles.filter((obstacle) => obstacle.x + obstacle.width > -10);

  for (const bone of state.bones) {
    bone.x -= (state.speed - 25) * dt;
  }
  state.bones = state.bones.filter((bone) => bone.x + bone.width > -10 && !bone.collected);

  for (const flag of state.superFlags) {
    flag.x -= (state.speed - 20) * dt;
  }
  state.superFlags = state.superFlags.filter((flag) => flag.x + flag.width > -10 && !flag.collected);

  for (const cloud of state.clouds) {
    cloud.x -= cloud.speed * dt;
    if (cloud.x < -90) {
      cloud.x = canvas.width + 40 + Math.random() * 180;
      cloud.y = 30 + Math.random() * 90;
    }
  }

  for (const obstacle of state.obstacles) {
    let hit = false;
    const pad = 8;

    if (obstacle.kind === "securityGuard" && Array.isArray(obstacle.officers)) {
      // Use per-officer hitboxes so grouped guards remain fair/jumpable.
      for (const officer of obstacle.officers) {
        const ox = obstacle.x + officer.x;
        const oy = obstacle.y + officer.y;
        const ow = officer.width;
        const oh = officer.height;
        const overlap =
          dog.x + pad < ox + ow &&
          dog.x + dog.width - pad > ox &&
          dog.y + pad < oy + oh &&
          dog.y + dog.height - pad > oy;
        if (overlap) {
          hit = true;
          break;
        }
      }
    } else {
      hit =
        dog.x + pad < obstacle.x + obstacle.width &&
        dog.x + dog.width - pad > obstacle.x &&
        dog.y + pad < obstacle.y + obstacle.height &&
        dog.y + dog.height - pad > obstacle.y;
    }

    if (hit) {
      if (state.graceTimer <= 0 && state.flyTimer <= 0) {
        state.gameOver = true;
        state.highScore = Math.max(state.highScore, Math.floor(state.score));
        if (!state.scoreSubmitted) {
          state.scoreSubmitted = true;
          submitScore(state.score);
        }
        break;
      }
    }
  }

  for (const bone of state.bones) {
    const collected =
      dog.x + 6 < bone.x + bone.width &&
      dog.x + dog.width - 6 > bone.x &&
      dog.y + 6 < bone.y + bone.height &&
      dog.y + dog.height - 6 > bone.y;
    if (collected) {
      bone.collected = true;
      state.score += 30;
    }
  }

  for (const flag of state.superFlags) {
    const collected =
      dog.x + 4 < flag.x + flag.width &&
      dog.x + dog.width - 4 > flag.x &&
      dog.y + 4 < flag.y + flag.height &&
      dog.y + dog.height - 4 > flag.y;
    if (collected) {
      flag.collected = true;
      state.score += 120;
      state.flyTimer = 5;
      state.graceTimer = 0;
      dog.vy = -430;
      dog.onGround = false;

      // Immediate reward burst at fly activation.
      spawnBone();
      spawnBone();
      if (Math.random() < 0.7) {
        spawnBone();
      }
      state.boneSpawnTimer = 0.25;
    }
  }
}

function drawBackground() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawCampusBackdrop();

  // Visual gap band between campus backdrop and the road.
  ctx.fillStyle = "#eef7fd";
  ctx.fillRect(0, GROUND_Y - BACKDROP_ROAD_GAP, canvas.width, BACKDROP_ROAD_GAP);

  for (const cloud of state.clouds) {
    ctx.fillStyle = "#ffffff";
    drawCloud(cloud.x, cloud.y);
  }

  ctx.fillStyle = "#d6ecf8";
  ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

  ctx.strokeStyle = "#7fa7c4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 0.5);
  ctx.lineTo(canvas.width, GROUND_Y + 0.5);
  ctx.stroke();
}

function drawCampusBackdrop() {
  const nearShift = (state.time * 20) % 410;
  const farShift = (state.time * 10) % 520;
  const farBaseY = GROUND_Y - 160 - BACKDROP_ROAD_GAP;
  const nearBaseY = GROUND_Y - 142 - BACKDROP_ROAD_GAP;
  const treeLineY = GROUND_Y - 8 - BACKDROP_ROAD_GAP;
  const parkBandY = GROUND_Y - BACKDROP_ROAD_GAP;

  // Fill open area with a park lawn band to reduce whitespace.
  ctx.fillStyle = "#d7edcf";
  ctx.fillRect(0, parkBandY - 36, canvas.width, 36);

  ctx.fillStyle = "#c9e4bf";
  ctx.fillRect(0, parkBandY - 18, canvas.width, 18);

  // Far stone buildings with varied silhouettes
  for (let i = -1; i < 4; i++) {
    const x = i * 520 - farShift;
    drawFarCampus(x, farBaseY + (i % 2) * 8, i, i + 30);
  }

  // Near gothic buildings + mixed trees/plants
  for (let i = -1; i < 4; i++) {
    const x = i * 410 - nearShift;
    drawNearCampus(x, nearBaseY + (i % 3) * 4, i, i + 80);

    drawCherryTree(x + 38, treeLineY - 10, 0.95);
    drawGreenTree(x + 96, treeLineY - 6, 0.85);
    drawShrubPatch(x + 126, treeLineY + 2, 1);
    drawCherryTree(x + 165, treeLineY - 4, 0.82);
    drawGreenTree(x + 240, treeLineY - 8, 0.92);
    drawFlowerPlant(x + 274, treeLineY + 3, 1);
    drawCherryTree(x + 300, treeLineY - 7, 0.9);
    drawGreenTree(x + 360, treeLineY - 1, 0.78);

    // Park-like grass and flower accents near trees.
    drawGrassTuft(x + 28, treeLineY + 5, 1.05);
    drawGrassTuft(x + 76, treeLineY + 7, 0.9);
    drawFlowerPatch(x + 114, treeLineY + 9, 0.95);
    drawGrassTuft(x + 148, treeLineY + 6, 0.95);
    drawFlowerPatch(x + 188, treeLineY + 8, 1);
    drawGrassTuft(x + 226, treeLineY + 6, 1.1);
    drawFlowerPatch(x + 268, treeLineY + 10, 0.9);
    drawGrassTuft(x + 312, treeLineY + 7, 1);
    drawFlowerPatch(x + 346, treeLineY + 9, 0.95);

    // Extra density so the park looks full.
    drawShrubPatch(x + 58, treeLineY + 12, 0.9);
    drawShrubPatch(x + 206, treeLineY + 12, 0.85);
    drawShrubPatch(x + 334, treeLineY + 12, 0.95);
    drawFlowerPatch(x + 18, treeLineY + 12, 0.8);
    drawFlowerPatch(x + 92, treeLineY + 12, 0.85);
    drawFlowerPatch(x + 154, treeLineY + 12, 0.8);
    drawFlowerPatch(x + 246, treeLineY + 12, 0.85);
    drawFlowerPatch(x + 386, treeLineY + 12, 0.8);

  }
}

function drawFarCampus(x, baseY, variant, tileSeed) {
  ctx.fillStyle = "#cfdeec";
  if (variant % 2 === 0) {
    roundRect(x + 16, baseY, 138, 98, 5, true);
    roundRect(x + 166, baseY + 14, 116, 84, 5, true);
    roundRect(x + 298, baseY + 10, 132, 88, 5, true);
  } else {
    roundRect(x + 18, baseY + 10, 90, 88, 5, true);
    roundRect(x + 112, baseY, 148, 98, 5, true);
    roundRect(x + 268, baseY + 12, 170, 86, 5, true);
  }

  ctx.fillStyle = "#c0d2e5";
  roundRect(x + 58, baseY - 50, 30, 50, 2, true);
  roundRect(x + 334, baseY - 44, 28, 44, 2, true);

  // Castle-like battlements
  ctx.fillStyle = "#b6cadf";
  for (let j = 0; j < 7; j++) {
    roundRect(x + 20 + j * 18, baseY - 8, 10, 8, 1, true);
  }
  for (let j = 0; j < 6; j++) {
    roundRect(x + 172 + j * 19, baseY + 6, 10, 8, 1, true);
  }
  for (let j = 0; j < 7; j++) {
    roundRect(x + 302 + j * 18, baseY + 2, 10, 8, 1, true);
  }

  // Some room windows lit with warm golden lamp light.
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      drawRoomLight(
        x + 28 + col * 24,
        baseY + 20 + row * 20,
        8,
        12,
        tileSeed * 100 + row * 10 + col
      );
    }
  }
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      drawRoomLight(
        x + 184 + col * 22,
        baseY + 30 + row * 20,
        8,
        11,
        tileSeed * 120 + row * 10 + col + 17
      );
      drawRoomLight(
        x + 316 + col * 24,
        baseY + 26 + row * 20,
        8,
        11,
        tileSeed * 140 + row * 10 + col + 41
      );
    }
  }
}

function drawNearCampus(x, baseY, variant, tileSeed) {
  ctx.fillStyle = "#a8bfd6";
  if (variant % 3 === 0) {
    roundRect(x + 10, baseY, 112, 104, 6, true);
    roundRect(x + 128, baseY + 20, 84, 84, 5, true);
    roundRect(x + 220, baseY + 12, 132, 92, 6, true);
    roundRect(x + 356, baseY + 22, 50, 82, 5, true);
  } else if (variant % 3 === 1) {
    roundRect(x + 8, baseY + 16, 76, 88, 6, true);
    roundRect(x + 88, baseY + 8, 142, 96, 6, true);
    roundRect(x + 236, baseY + 22, 92, 82, 6, true);
    roundRect(x + 332, baseY + 2, 72, 102, 6, true);
  } else {
    roundRect(x + 8, baseY + 18, 90, 86, 6, true);
    roundRect(x + 102, baseY + 2, 98, 102, 6, true);
    roundRect(x + 204, baseY + 16, 132, 88, 6, true);
    roundRect(x + 340, baseY + 8, 60, 96, 6, true);
  }

  // Gothic tower silhouettes
  ctx.fillStyle = "#94aec9";
  roundRect(x + 50, baseY - 68, 34, 68, 2, true);
  roundRect(x + 266, baseY - 92, 38, 92, 2, true);

  // Spires
  ctx.fillStyle = "#87a3c0";
  ctx.beginPath();
  ctx.moveTo(x + 67, baseY - 102);
  ctx.lineTo(x + 84, baseY - 68);
  ctx.lineTo(x + 50, baseY - 68);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + 285, baseY - 126);
  ctx.lineTo(x + 304, baseY - 92);
  ctx.lineTo(x + 266, baseY - 92);
  ctx.closePath();
  ctx.fill();

  // Battlements
  ctx.fillStyle = "#7f9dbc";
  for (let j = 0; j < 6; j++) {
    roundRect(x + 16 + j * 17, baseY - 8, 10, 8, 1, true);
  }
  for (let j = 0; j < 7; j++) {
    roundRect(x + 226 + j * 17, baseY + 4, 10, 8, 1, true);
  }

  // Arched windows
  drawRoomLight(x + 30, baseY + 30, 9, 16, tileSeed * 200 + 1, true);
  drawRoomLight(x + 48, baseY + 30, 9, 16, tileSeed * 200 + 2, true);
  drawRoomLight(x + 250, baseY + 28, 9, 16, tileSeed * 200 + 3, true);
  drawRoomLight(x + 270, baseY + 28, 9, 16, tileSeed * 200 + 4, true);
  drawRoomLight(x + 290, baseY + 28, 9, 16, tileSeed * 200 + 5, true);
  drawRoomLight(x + 310, baseY + 28, 9, 16, tileSeed * 200 + 6, true);

  // Extra room windows for a "campus at dusk" feel.
  for (let row = 0; row < 3; row++) {
    drawRoomLight(x + 104, baseY + 24 + row * 20, 8, 12, tileSeed * 210 + row + 10);
    drawRoomLight(x + 120, baseY + 24 + row * 20, 8, 12, tileSeed * 220 + row + 20);
    drawRoomLight(x + 340, baseY + 20 + row * 22, 8, 12, tileSeed * 230 + row + 30);
  }
}

function drawRoomLight(x, y, w, h, seed, arched = false) {
  const cycle = Math.floor(state.time * 1.4);
  const lit = ((seed * 17 + cycle) % 9) < 3;

  if (lit) {
    // Warm golden lamp light.
    ctx.fillStyle = "#f6cf74";
    if (arched) {
      roundRect(x, y, w, h, 3, true);
    } else {
      roundRect(x, y, w, h, 2, true);
    }

    // Inner bright core.
    ctx.fillStyle = "#ffe7ac";
    roundRect(x + 1.5, y + 2, Math.max(2, w - 3), Math.max(3, h - 4), 1.5, true);
  } else {
    // Unlit room.
    ctx.fillStyle = "#c6d7e7";
    if (arched) {
      roundRect(x, y, w, h, 3, true);
    } else {
      roundRect(x, y, w, h, 2, true);
    }
  }
}

function drawCherryTree(x, y, scale) {
  const trunkW = 10 * scale;
  const trunkH = 26 * scale;

  ctx.fillStyle = "#6f4b38";
  roundRect(x - trunkW / 2, y - trunkH, trunkW, trunkH, 3, true);

  ctx.fillStyle = "#f9d0df";
  drawBlossom(x - 9 * scale, y - 31 * scale, 13 * scale);
  drawBlossom(x + 5 * scale, y - 35 * scale, 14 * scale);
  drawBlossom(x + 16 * scale, y - 27 * scale, 11 * scale);
  drawBlossom(x - 19 * scale, y - 24 * scale, 10 * scale);

  ctx.fillStyle = "#f3b8cf";
  drawBlossom(x - 1 * scale, y - 23 * scale, 10 * scale);
  drawBlossom(x + 12 * scale, y - 18 * scale, 8 * scale);
}

function drawBlossom(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawGreenTree(x, y, scale) {
  const trunkW = 9 * scale;
  const trunkH = 24 * scale;
  ctx.fillStyle = "#70513d";
  roundRect(x - trunkW / 2, y - trunkH, trunkW, trunkH, 3, true);

  ctx.fillStyle = "#78b56e";
  drawBlossom(x, y - 30 * scale, 14 * scale);
  drawBlossom(x - 12 * scale, y - 23 * scale, 12 * scale);
  drawBlossom(x + 11 * scale, y - 21 * scale, 11 * scale);
  ctx.fillStyle = "#5e9e57";
  drawBlossom(x - 3 * scale, y - 15 * scale, 10 * scale);
}

function drawShrubPatch(x, y, scale) {
  ctx.fillStyle = "#6fa968";
  drawBlossom(x, y, 10 * scale);
  drawBlossom(x + 11 * scale, y + 2 * scale, 8 * scale);
  drawBlossom(x - 10 * scale, y + 2 * scale, 8 * scale);
}

function drawFlowerPlant(x, y, scale) {
  ctx.fillStyle = "#4f8f47";
  roundRect(x - 2 * scale, y - 14 * scale, 4 * scale, 14 * scale, 2, true);

  ctx.fillStyle = "#f7a2ca";
  drawBlossom(x - 6 * scale, y - 16 * scale, 4 * scale);
  drawBlossom(x + 6 * scale, y - 16 * scale, 4 * scale);
  drawBlossom(x, y - 20 * scale, 5 * scale);
}

function drawGrassTuft(x, y, scale) {
  ctx.strokeStyle = "#6faa63";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - 3 * scale, y - 8 * scale, x - 1 * scale, y - 13 * scale);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + 1 * scale, y - 10 * scale, x + 3 * scale, y - 14 * scale);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + 4 * scale, y - 7 * scale, x + 7 * scale, y - 11 * scale);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - 5 * scale, y - 6 * scale, x - 7 * scale, y - 10 * scale);
  ctx.stroke();
}

function drawFlowerPatch(x, y, scale) {
  drawGrassTuft(x - 5 * scale, y + 1 * scale, 0.8 * scale);
  drawGrassTuft(x + 5 * scale, y + 1 * scale, 0.8 * scale);

  ctx.fillStyle = "#f7a6c8";
  drawBlossom(x - 4 * scale, y - 5 * scale, 2.3 * scale);
  drawBlossom(x + 4 * scale, y - 5 * scale, 2.3 * scale);
  ctx.fillStyle = "#ffd477";
  drawBlossom(x, y - 6 * scale, 2.4 * scale);
  ctx.fillStyle = "#f3f8ff";
  drawBlossom(x - 1 * scale, y - 6 * scale, 1.2 * scale);
}


function drawCloud(x, y) {
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.arc(x + 14, y - 10, 16, 0, Math.PI * 2);
  ctx.arc(x + 32, y - 2, 13, 0, Math.PI * 2);
  ctx.arc(x + 48, y - 8, 11, 0, Math.PI * 2);
  ctx.fill();
}

function drawDog() {
  const x = dog.x;
  const y = dog.y;
  const baseY = y - 11;

  // Red skateboard under the dog.
  ctx.fillStyle = "#c62026";
  roundRect(x + 1, baseY + 46, 68, 8, 4, true);
  ctx.fillStyle = "#97191e";
  roundRect(x + 5, baseY + 49, 60, 3, 2, true);

  // Skateboard wheels.
  ctx.fillStyle = "#242a33";
  drawBlossom(x + 14, baseY + 56, 4.2);
  drawBlossom(x + 58, baseY + 56, 4.2);
  ctx.fillStyle = "#8c98ab";
  drawBlossom(x + 14, baseY + 56, 1.6);
  drawBlossom(x + 58, baseY + 56, 1.6);

  // Golden retriever body (warm golden, high visibility).
  ctx.fillStyle = "#d29b46";
  roundRect(x + 14, baseY + 22, 42, 22, 10, true);
  ctx.fillStyle = "#c58e3a";
  roundRect(x + 13, baseY + 28, 12, 13, 6, true);

  // Chest puff and sitting legs.
  ctx.fillStyle = "#f1d9a7";
  roundRect(x + 44, baseY + 28, 12, 12, 5, true);
  ctx.fillStyle = "#c58e3a";
  roundRect(x + 21, baseY + 36, 10, 10, 4, true);
  roundRect(x + 35, baseY + 36, 10, 10, 4, true);
  roundRect(x + 47, baseY + 35, 9, 10, 4, true);

  // Paws.
  ctx.fillStyle = "#efd4a0";
  roundRect(x + 22, baseY + 44, 9, 3, 2, true);
  roundRect(x + 36, baseY + 44, 9, 3, 2, true);

  // Tail.
  ctx.fillStyle = "#d5a14f";
  roundRect(x + 10, baseY + 25, 5, 11, 2, true);

  // Head (big and cute).
  ctx.fillStyle = "#d6a04d";
  roundRect(x + 38, baseY + 11, 24, 17, 8, true);

  // Floppy ears.
  ctx.fillStyle = "#ae7632";
  roundRect(x + 39, baseY + 13, 5, 11, 3, true);
  roundRect(x + 54, baseY + 13, 5, 11, 3, true);

  // Muzzle.
  ctx.fillStyle = "#f1d9a9";
  roundRect(x + 51, baseY + 18, 10, 8, 3, true);
  ctx.fillStyle = "#0f1319";
  roundRect(x + 57, baseY + 20, 3, 2, 1, true);

  // Eyes with sparkle.
  ctx.fillStyle = "#1f242c";
  roundRect(x + 46, baseY + 17, 2.4, 2.4, 1, true);
  roundRect(x + 51, baseY + 17, 2.4, 2.4, 1, true);
  ctx.fillStyle = "#ffffff";
  roundRect(x + 46.7, baseY + 17.2, 0.8, 0.8, 1, true);
  roundRect(x + 51.7, baseY + 17.2, 0.8, 0.8, 1, true);

  // Smile.
  ctx.strokeStyle = "#5e646d";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + 53, baseY + 24);
  ctx.quadraticCurveTo(x + 56, baseY + 27, x + 59, baseY + 24);
  ctx.stroke();

  // Fur shading patches.
  ctx.fillStyle = "#be8537";
  drawBlossom(x + 24, baseY + 30, 2.2);
  drawBlossom(x + 31, baseY + 26, 1.7);
  drawBlossom(x + 42, baseY + 33, 2);
  drawBlossom(x + 17, baseY + 34, 1.8);

  // Blue cap.
  ctx.fillStyle = "#1e3d94";
  roundRect(x + 38, baseY + 4, 21, 8, 3, true);
  roundRect(x + 55, baseY + 10, 10, 4, 2, true);

  // White Y on cap.
  ctx.fillStyle = "#f5f7fa";
  roundRect(x + 45, baseY + 6, 2.1, 3, 1, true);
  roundRect(x + 48.8, baseY + 6, 2.1, 3, 1, true);
  roundRect(x + 47, baseY + 8.8, 2.2, 4.2, 1, true);
}

function drawObstacles() {
  for (const obstacle of state.obstacles) {
    if (obstacle.kind === "securityGuard") {
      for (const officer of obstacle.officers) {
        drawSecurityGuard(obstacle.x + officer.x, obstacle.y + officer.y, officer.tall);
      }
    } else if (obstacle.kind === "harvardMascot") {
      drawHarvardMascot(obstacle.x, obstacle.y, obstacle.tall);
    }
  }
}

function drawBones() {
  for (const bone of state.bones) {
    const pulse = Math.sin(state.time * 7 + bone.spinOffset) * 0.8;
    const x = bone.x;
    const y = bone.y + pulse;
    const cx = x + bone.width / 2;
    const cy = y + bone.height / 2;
    const r = bone.width / 2 - 1;

    // Big golden coin body.
    ctx.fillStyle = "#f3c745";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner gold face.
    ctx.fillStyle = "#ffd86a";
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
    ctx.fill();

    // Rim.
    ctx.strokeStyle = "#d4a125";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.stroke();

    // Shine.
    ctx.fillStyle = "rgba(255, 252, 230, 0.7)";
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 5, 4, 0, Math.PI * 2);
    ctx.fill();

    // Coin mark.
    ctx.fillStyle = "#cc951b";
    roundRect(cx - 2, cy - 6, 4, 12, 2, true);
  }
}

function drawSuperFlags() {
  for (const flag of state.superFlags) {
    const x = flag.x;
    const y = flag.y + Math.sin(state.time * 5 + x * 0.03) * 1.2;

    // Pole
    ctx.fillStyle = "#c8a164";
    roundRect(x + 4, y + 2, 3, 30, 1, true);

    // Blue flag
    ctx.fillStyle = "#1d3f99";
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 4);
    ctx.lineTo(x + 40, y + 8);
    ctx.lineTo(x + 30, y + 17);
    ctx.lineTo(x + 40, y + 25);
    ctx.lineTo(x + 7, y + 30);
    ctx.closePath();
    ctx.fill();

    // White Y on flag
    ctx.fillStyle = "#f4f7ff";
    roundRect(x + 18, y + 12, 3, 4, 1, true);
    roundRect(x + 23, y + 12, 3, 4, 1, true);
    roundRect(x + 20.5, y + 15.5, 3, 7, 1, true);

  }
}

function drawSecurityGuard(x, y, isTall) {
  const scaleY = isTall ? 1.08 : 1;

  // Shadow under guard
  ctx.fillStyle = "rgba(20, 28, 40, 0.18)";
  roundRect(x + 4, y + 50 * scaleY, 22, 6, 3, true);

  // Legs
  ctx.fillStyle = "#1f2f47";
  roundRect(x + 7, y + 36 * scaleY, 7, 15, 3, true);
  roundRect(x + 17, y + 36 * scaleY, 7, 15, 3, true);

  // Shoes
  ctx.fillStyle = "#141a25";
  roundRect(x + 6, y + 49 * scaleY, 9, 4, 2, true);
  roundRect(x + 16, y + 49 * scaleY, 9, 4, 2, true);

  // Torso uniform
  ctx.fillStyle = "#2d4f7e";
  roundRect(x + 4, y + 18 * scaleY, 22, 21, 5, true);

  // Badge
  ctx.fillStyle = "#f2cd63";
  roundRect(x + 18, y + 24 * scaleY, 4, 4, 1, true);

  // Arms
  ctx.fillStyle = "#2a4a75";
  roundRect(x + 1, y + 22 * scaleY, 5, 13, 3, true);
  roundRect(x + 24, y + 22 * scaleY, 5, 13, 3, true);

  // Head
  ctx.fillStyle = "#f2c7a7";
  roundRect(x + 8, y + 8 * scaleY, 14, 12, 5, true);

  // Hat
  ctx.fillStyle = "#152844";
  roundRect(x + 7, y + 4 * scaleY, 16, 5, 2, true);
  roundRect(x + 10, y + 9 * scaleY, 10, 2, 1, true);

  // Face details
  ctx.fillStyle = "#1a1f2a";
  roundRect(x + 12, y + 12 * scaleY, 2, 2, 1, true);
  roundRect(x + 16, y + 12 * scaleY, 2, 2, 1, true);
  roundRect(x + 14, y + 15 * scaleY, 3, 2, 1, true);
}

function drawHarvardMascot(x, y, isTall) {
  const scaleY = isTall ? 1.1 : 1;

  // Shadow
  ctx.fillStyle = "rgba(30, 20, 24, 0.18)";
  roundRect(x + 6, y + 52 * scaleY, 24, 6, 3, true);

  // Legs
  ctx.fillStyle = "#51372a";
  roundRect(x + 10, y + 38 * scaleY, 8, 15, 3, true);
  roundRect(x + 20, y + 38 * scaleY, 8, 15, 3, true);

  // Shoes
  ctx.fillStyle = "#20171a";
  roundRect(x + 9, y + 51 * scaleY, 10, 4, 2, true);
  roundRect(x + 19, y + 51 * scaleY, 10, 4, 2, true);

  // Crimson shirt
  ctx.fillStyle = "#9e1b32";
  roundRect(x + 7, y + 19 * scaleY, 24, 21, 5, true);

  // White H
  ctx.fillStyle = "#f4f4f6";
  roundRect(x + 15, y + 24 * scaleY, 2.8, 9, 1, true);
  roundRect(x + 21, y + 24 * scaleY, 2.8, 9, 1, true);
  roundRect(x + 17.3, y + 27.5 * scaleY, 3.8, 2.2, 1, true);

  // Arms
  ctx.fillStyle = "#8f162d";
  roundRect(x + 3, y + 23 * scaleY, 5, 13, 3, true);
  roundRect(x + 30, y + 23 * scaleY, 5, 13, 3, true);

  // Head (bear-like mascot)
  ctx.fillStyle = "#6e4a35";
  roundRect(x + 11, y + 8 * scaleY, 16, 13, 5, true);

  // Ears
  ctx.fillStyle = "#5a3b2a";
  drawBlossom(x + 13, y + 9 * scaleY, 2.3);
  drawBlossom(x + 25, y + 9 * scaleY, 2.3);

  // Face
  ctx.fillStyle = "#261c1b";
  roundRect(x + 16, y + 12 * scaleY, 2, 2, 1, true);
  roundRect(x + 21, y + 12 * scaleY, 2, 2, 1, true);
  roundRect(x + 18.5, y + 15 * scaleY, 3, 2, 1, true);
}

function roundRect(x, y, w, h, r, fill = false) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
}

function drawUI() {
  const score = Math.floor(state.score).toString().padStart(5, "0");
  const highScore = state.highScore.toString().padStart(5, "0");

  ctx.fillStyle = "#1f2f47";
  ctx.font = "bold 22px Arial";
  ctx.textAlign = "right";
  ctx.fillText(`HI ${highScore}   ${score}`, canvas.width - 20, 34);

  if (!state.running) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#1f2f47";
    ctx.font = "bold 48px Arial";
    ctx.fillText("FlappyDan", canvas.width / 2, canvas.height * 0.34);
    ctx.font = "20px Arial";
    ctx.fillText("Press Space / Arrow Up or tap to start", canvas.width / 2, canvas.height * 0.34 + 42);
  }

  if (state.gameOver) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#13263f";
    ctx.font = "bold 44px Arial";
    ctx.fillText("Game Over", canvas.width / 2, 130);
    ctx.font = "20px Arial";
    ctx.fillText("Press Space / Arrow Up or tap to restart", canvas.width / 2, 170);
  }

  if (state.flyTimer > 0 && !state.gameOver) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#1d3f99";
    ctx.font = "bold 20px Arial";
    ctx.fillText(`FLY ${state.flyTimer.toFixed(1)}s`, 20, 34);
  }

  if (state.graceTimer > 0 && !state.gameOver) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#2f7a43";
    ctx.font = "bold 18px Arial";
    ctx.fillText(`SAFE ${state.graceTimer.toFixed(1)}s`, 20, 58);
  }
}

function draw() {
  drawBackground();
  drawObstacles();
  drawBones();
  drawSuperFlags();
  drawDog();
  drawUI();
}

let lastTime = 0;
function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min(0.033, (timestamp - lastTime) / 1000);
  lastTime = timestamp;

  update(dt);
  draw();
  requestAnimationFrame(gameLoop);
}

function setupControls() {
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "ArrowUp") {
      event.preventDefault();
      jump();
    }
  });

  canvas.addEventListener("pointerdown", jump);
}

resizeCanvas();
state.clouds = createClouds();
setupControls();
window.addEventListener("resize", resizeCanvas);
initLeaderboard();
requestAnimationFrame(gameLoop);
