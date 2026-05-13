/**
 * Tank Battle Game
 * Pure HTML5 Canvas + vanilla JavaScript — no build step required.
 * Open index.html directly in a browser or serve with:
 *   python3 -m http.server 8080
 */

// ---------------------------------------------------------------------------
// InputHandler
// ---------------------------------------------------------------------------

export class InputHandler {
  constructor() {
    /** @type {Set<string>} */
    this.keys = new Set();
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
  }

  /** Returns true while the given key is held down. */
  isDown(key) {
    return this.keys.has(key);
  }

  /** Register keydown/keyup listeners on window. */
  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  /** Remove keydown/keyup listeners from window. */
  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  _onKeyDown(e) {
    this.keys.add(e.key);
    // Prevent default browser behavior for game keys while playing
    if (state && state.phase === 'playing') {
      const gameKeys = ['w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'ArrowLeft', 'ArrowRight', ' ', 'h', 'H', 'q', 'Q'];
      if (gameKeys.includes(e.key)) {
        e.preventDefault();
      }
    }
  }

  _onKeyUp(e) {
    this.keys.delete(e.key);
  }
}

// ---------------------------------------------------------------------------
// GameState factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns the initial game state plain object.
 * @returns {object}
 */
export function createGameState() {
  return {
    /** @type {'instructions'|'start'|'tankselect'|'playing'|'gameover'|'victory'} */
    phase: 'instructions',
    score: 0,
    playerTank: null,
    enemyTanks: [],
    projectiles: [],
    map: null,
    /** Seconds until next enemy spawn attempt. */
    spawnTimer: 5,
    /** Per-spawn-point retry countdowns (one entry per spawn point). */
    spawnRetryTimers: [0, 0, 0],
    /** Active power-ups on the map. */
    powerups: [],
    /** Active explosion animations. */
    explosions: [],
    /** Active homing missiles. */
    missiles: [],
    /** Difficulty: 'easy' (2 spawns), 'hard' (3 spawns), 'crazy' (4 spawns) */
    difficulty: 'hard',
    /** Whether player has an airstrike available */
    hasAirstrike: false,
    /** Airstrike animation state (null if not active) */
    airstrike: null,
    /** Player tank type: 'normal' or 'heavy' */
    playerTankType: 'normal',
    /** Allied tanks (blue, AI-controlled, fight enemies) */
    allyTanks: [],
    /** Timer for ally spawning */
    allySpawnTimer: 7,
  };
}

// ---------------------------------------------------------------------------
// Map data
// ---------------------------------------------------------------------------

/**
 * Returns the fixed MapData object describing the 1200×800 map.
 * @param {string} difficulty - 'easy' (2 spawns), 'hard' (3 spawns), 'crazy' (4 spawns)
 * @returns {object}
 */
export function createMapData(difficulty = 'hard') {
  const mapW = 1200;
  const mapH = 800;
  const allSpawnPoints = [
    { x: 150,  y: 100, health: 20, maxHealth: 20, panicSpawned: false },
    { x: 450,  y: 100, health: 20, maxHealth: 20, panicSpawned: false },
    { x: 750,  y: 100, health: 20, maxHealth: 20, panicSpawned: false },
    { x: 1050, y: 100, health: 20, maxHealth: 20, panicSpawned: false },
  ];
  let spawnPoints;
  let allyFactory = null;
  if (difficulty === 'supereasy') {
    spawnPoints = allSpawnPoints.slice(0, 4); // 4 enemy factories
    allyFactory = [
      { x: 400, y: 700, health: 40, maxHealth: 40, panicSpawned: false },
      { x: 800, y: 700, health: 40, maxHealth: 40, panicSpawned: false },
    ];
  } else if (difficulty === 'easy') spawnPoints = allSpawnPoints.slice(0, 2);
  else if (difficulty === 'crazy') spawnPoints = allSpawnPoints.slice(0, 4);
  else spawnPoints = allSpawnPoints.slice(0, 3); // hard (default)

  // Minimum gap between any two obstacles (must fit a tank ~45px)
  const MIN_GAP = 55;
  // Player start zone to keep clear (center of map)
  const playerZone = { x: 520, y: 320, width: 160, height: 160 };

  // Collect all placed rects (factories count as obstacles)
  const placed = [];
  for (const sp of spawnPoints) {
    placed.push({ x: sp.x - 25, y: sp.y - 20, width: 50, height: 40 });
  }
  if (allyFactory) {
    const afs = Array.isArray(allyFactory) ? allyFactory : [allyFactory];
    for (const af of afs) {
      placed.push({ x: af.x - 25, y: af.y - 20, width: 50, height: 40 });
    }
  }
  // Player zone is reserved
  placed.push(playerZone);

  /**
   * Check if a candidate rect has enough clearance from all placed rects.
   * Returns true if it can be placed.
   */
  function canPlace(rect) {
    // Must be inside map with margin
    if (rect.x < 50 || rect.y < 50 || rect.x + rect.width > mapW - 50 || rect.y + rect.height > mapH - 50) return false;
    for (const p of placed) {
      // Check if rects are too close (overlap with expanded bounds)
      const expanded = { x: p.x - MIN_GAP, y: p.y - MIN_GAP, width: p.width + MIN_GAP * 2, height: p.height + MIN_GAP * 2 };
      if (rect.x < expanded.x + expanded.width && rect.x + rect.width > expanded.x &&
          rect.y < expanded.y + expanded.height && rect.y + rect.height > expanded.y) {
        return false;
      }
    }
    return true;
  }

  function randomRect(minW, maxW, minH, maxH) {
    const w = minW + Math.floor(Math.random() * (maxW - minW));
    const h = minH + Math.floor(Math.random() * (maxH - minH));
    const x = 60 + Math.floor(Math.random() * (mapW - 120 - w));
    const y = 60 + Math.floor(Math.random() * (mapH - 120 - h));
    return { x, y, width: w, height: h };
  }

  // Generate 2 rivers (tall and narrow)
  const rivers = [];
  let attempts = 0;
  while (rivers.length < 2 && attempts < 100) {
    const r = randomRect(60, 90, 200, 350);
    if (canPlace(r)) {
      rivers.push(r);
      placed.push(r);
    }
    attempts++;
  }

  // Add a bridge across each river (horizontal strip that tanks can cross)
  const bridges = [];
  for (const river of rivers) {
    // Place bridge roughly in the middle of the river
    const bridgeY = river.y + Math.floor(river.height * 0.4 + Math.random() * river.height * 0.2);
    const bridge = {
      x: river.x - 10,
      y: bridgeY,
      width: river.width + 20,
      height: 55, // wide enough for a tank with margin
    };
    bridges.push(bridge);
    placed.push(bridge); // prevent other obstacles from blocking the bridge
  }

  // Generate 4 rocks (medium squares)
  const rocks = [];
  attempts = 0;
  while (rocks.length < 4 && attempts < 100) {
    const r = randomRect(60, 100, 50, 80);
    if (canPlace(r)) {
      rocks.push(r);
      placed.push(r);
    }
    attempts++;
  }

  // Generate 3-4 brick clusters (each cluster is 2-3 bricks in a row)
  const bricks = [];
  const numClusters = 3 + Math.floor(Math.random() * 2); // 3 or 4
  attempts = 0;
  while (bricks.length / 3 < numClusters && attempts < 100) {
    const brickSize = 30;
    const clusterLen = 2 + Math.floor(Math.random() * 2); // 2 or 3 bricks
    const horizontal = Math.random() < 0.5;
    const clusterW = horizontal ? brickSize * clusterLen : brickSize;
    const clusterH = horizontal ? brickSize : brickSize * clusterLen;
    const baseX = 60 + Math.floor(Math.random() * (mapW - 120 - clusterW));
    const baseY = 60 + Math.floor(Math.random() * (mapH - 120 - clusterH));
    const clusterRect = { x: baseX, y: baseY, width: clusterW, height: clusterH };
    if (canPlace(clusterRect)) {
      for (let i = 0; i < clusterLen; i++) {
        const bx = horizontal ? baseX + i * brickSize : baseX;
        const by = horizontal ? baseY : baseY + i * brickSize;
        bricks.push({ x: bx, y: by, width: brickSize, height: brickSize, health: 1 });
      }
      placed.push(clusterRect);
    }
    attempts++;
  }

  return {
    width: mapW,
    height: mapH,
    rivers,
    bridges,
    rocks,
    spawnPoints,
    bricks,
    allyFactory,
  };
}

// ---------------------------------------------------------------------------
// Tank factories
// ---------------------------------------------------------------------------

/**
 * Creates and returns the player tank at its starting position.
 * @returns {object}
 */
export function createPlayerTank() {
  return {
    id: 'player',
    x: 600,
    y: 400,
    bodyAngle: 0,
    turretAngle: 0,
    speed: 150,
    reverseSpeed: 75,
    rotationRate: 2.094,       // ~120°/s in radians
    turretRotationRate: 2.618, // ~150°/s in radians
    health: 100,
    maxHealth: 100,
    fireCooldown: 0,
    fireRate: 0.5,
    width: 40,
    height: 40,
    isPlayer: true,
    spawnPointIndex: null,
    powerGunTimer: 0,
    doubleShotTimer: 0,
    speedBoostTimer: 0,
    tankType: 'normal',
    dualGun: false,
    shieldTimer: 0,
    shieldHits: 0,
  };
}

/**
 * Creates a heavy player tank: slower, dual guns, same health.
 * @returns {object}
 */
export function createPlayerTankHeavy() {
  return {
    id: 'player',
    x: 600,
    y: 400,
    bodyAngle: 0,
    turretAngle: 0,
    speed: 51,                 // 80% of previous (64 * 0.8)
    reverseSpeed: 26,
    rotationRate: 1.571,       // ~90°/s
    turretRotationRate: 2.094, // ~120°/s
    health: 150,               // 150% of standard
    maxHealth: 150,
    fireCooldown: 0,
    fireRate: 1.0,             // 1 second between shots
    width: 44,                 // bigger
    height: 44,
    isPlayer: true,
    spawnPointIndex: null,
    powerGunTimer: 0,
    doubleShotTimer: 0,
    speedBoostTimer: 0,
    tankType: 'heavy',
    dualGun: true,
    shieldTimer: 0,
    shieldHits: 0,
  };
}

/**
 * Creates and returns an enemy tank at the given spawn point.
 * @param {{x: number, y: number}} spawnPoint
 * @param {number} spawnPointIndex
 * @returns {object}
 */
export function createEnemyTank(spawnPoint, spawnPointIndex) {
  return {
    id: `enemy_${Date.now()}_${Math.random()}`,
    x: spawnPoint.x,
    y: spawnPoint.y,
    bodyAngle: 0,
    turretAngle: 0,
    speed: 80,
    reverseSpeed: 40,
    rotationRate: 1.571,      // ~90°/s in radians
    turretRotationRate: 3.14, // ~180°/s in radians
    health: 100,
    maxHealth: 100,
    fireCooldown: 0,
    fireRate: 2.0,
    width: 36,
    height: 36,
    isPlayer: false,
    spawnPointIndex: spawnPointIndex,
    tankType: 'normal',       // 'normal' or 'heavy'
    scoreValue: 100,
    dualGun: false,
  };
}

/**
 * Creates and returns a heavy enemy tank (double guns, slower, tougher).
 * @param {{x: number, y: number}} spawnPoint
 * @param {number} spawnPointIndex
 * @returns {object}
 */
export function createHeavyEnemyTank(spawnPoint, spawnPointIndex) {
  return {
    id: `heavy_${Date.now()}_${Math.random()}`,
    x: spawnPoint.x,
    y: spawnPoint.y,
    bodyAngle: 0,
    turretAngle: 0,
    speed: 60,                 // slower (75% of 80)
    reverseSpeed: 30,
    rotationRate: 1.178,       // ~75% of normal (67.5°/s)
    turretRotationRate: 2.355, // ~75% of normal (135°/s)
    health: 150,               // 3 normal shots to kill (3×50=150)
    maxHealth: 150,
    fireCooldown: 0,
    fireRate: 2.5,             // slightly slower fire rate
    width: 42,                 // bigger
    height: 42,
    isPlayer: false,
    spawnPointIndex: spawnPointIndex,
    tankType: 'heavy',
    scoreValue: 150,
    dualGun: true,
  };
}

/**
 * Creates and returns a missile launcher enemy.
 * @param {{x: number, y: number}} spawnPoint
 * @param {number} spawnPointIndex
 * @returns {object}
 */
export function createMissileLauncher(spawnPoint, spawnPointIndex) {
  return {
    id: `launcher_${Date.now()}_${Math.random()}`,
    x: spawnPoint.x,
    y: spawnPoint.y,
    bodyAngle: 0,
    turretAngle: 0,
    speed: 50,                 // very slow
    reverseSpeed: 25,
    rotationRate: 1.0,
    turretRotationRate: 2.0,
    health: 50,                // one hit kill (50 damage from player)
    maxHealth: 50,
    fireCooldown: 0,           // fires immediately on spawn
    fireRate: 5.0,             // slow reload after first shot
    width: 34,
    height: 34,
    isPlayer: false,
    spawnPointIndex: spawnPointIndex,
    tankType: 'launcher',
    scoreValue: 75,
    dualGun: false,
    hasMissileOut: false,      // only one missile at a time
  };
}

/**
 * Creates a light speedy enemy tank: fast, small, fragile (one hit kill).
 * @param {{x: number, y: number}} spawnPoint
 * @param {number} spawnPointIndex
 * @returns {object}
 */
export function createLightEnemyTank(spawnPoint, spawnPointIndex) {
  return {
    id: `light_${Date.now()}_${Math.random()}`,
    x: spawnPoint.x,
    y: spawnPoint.y,
    bodyAngle: 0,
    turretAngle: 0,
    speed: 180,                // 1.2× player speed (150 * 1.2)
    reverseSpeed: 90,
    rotationRate: 2.5,         // very agile
    turretRotationRate: 4.0,
    health: 50,                // one normal bullet kills it (50 damage)
    maxHealth: 50,
    fireCooldown: 0,
    fireRate: 1.5,             // fires faster than normal
    width: 28,                 // smaller
    height: 28,
    isPlayer: false,
    spawnPointIndex: spawnPointIndex,
    tankType: 'light',
    scoreValue: 60,
    dualGun: false,
  };
}

/**
 * Creates an allied (blue) tank that fights enemies.
 * @param {{x: number, y: number}} spawnPoint
 * @returns {object}
 */
export function createAllyTank(spawnPoint) {
  return {
    id: `ally_${Date.now()}_${Math.random()}`,
    x: spawnPoint.x,
    y: spawnPoint.y + 40,
    bodyAngle: Math.PI, // face downward initially
    turretAngle: Math.PI,
    speed: 80,
    reverseSpeed: 40,
    rotationRate: 1.571,
    turretRotationRate: 3.14,
    health: 100,
    maxHealth: 100,
    fireCooldown: 0,
    fireRate: 2.0,
    width: 36,
    height: 36,
    isPlayer: false,
    isAlly: true,
    tankType: 'ally',
    dualGun: false,
  };
}

/**
 * Creates an engineering tank that moves to repair a damaged factory.
 * @param {{x: number, y: number}} spawnPoint - where it spawns from
 * @param {number} spawnPointIndex
 * @param {number} targetFactoryIndex - index of the factory to repair
 * @returns {object}
 */
export function createEngineerTank(spawnPoint, spawnPointIndex, targetFactoryIndex) {
  return {
    id: `engineer_${Date.now()}_${Math.random()}`,
    x: spawnPoint.x,
    y: spawnPoint.y + 40, // offset from factory
    bodyAngle: 0,
    turretAngle: 0,
    speed: 100,                // 1.25× normal speed (80 * 1.25)
    reverseSpeed: 50,
    rotationRate: 1.571,
    turretRotationRate: 0,     // no turret rotation needed
    health: 250,               // 5 hits to kill (5 × 50 damage)
    maxHealth: 250,
    fireCooldown: 999,         // doesn't fire
    fireRate: 999,
    width: 34,
    height: 34,
    isPlayer: false,
    spawnPointIndex: spawnPointIndex,
    tankType: 'engineer',
    scoreValue: 125,
    dualGun: false,
    targetFactoryIndex: targetFactoryIndex,
  };
}

// ---------------------------------------------------------------------------
// Projectile factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a new projectile fired by the given tank.
 * @param {object} tank
 * @returns {object}
 */
export function createProjectile(tank) {
  const powered = tank.isPlayer && tank.powerGunTimer > 0;
  return {
    id: `proj_${Date.now()}_${Math.random()}`,
    x: tank.x + Math.cos(tank.turretAngle) * (tank.height / 2 + 8),
    y: tank.y + Math.sin(tank.turretAngle) * (tank.height / 2 + 8),
    angle: tank.turretAngle,
    speed: 300,
    ownerId: tank.id,
    isPlayerProjectile: tank.isPlayer,
    damage: powered ? 100 : (tank.isPlayer ? 50 : 20),
    radius: powered ? 8 : 4,
    powered: powered,
  };
}

// ---------------------------------------------------------------------------
// Update functions
// ---------------------------------------------------------------------------

/**
 * Fires a projectile from the given tank if the cooldown has expired.
 * @param {object} state
 * @param {object} tank
 */
export function fireProjectile(state, tank) {
  if (tank.fireCooldown > 0) return;
  const hasDoubleShot = tank.isPlayer && tank.doubleShotTimer > 0;

  if (tank.dualGun) {
    // Fire two projectiles offset to left and right of turret center
    const offset = tank.height * 0.25;
    const perpAngle = tank.turretAngle + Math.PI / 2;
    for (const sign of [-1, 1]) {
      const proj = createProjectile(tank);
      proj.x += Math.cos(perpAngle) * offset * sign;
      proj.y += Math.sin(perpAngle) * offset * sign;
      proj.id = `proj_${Date.now()}_${Math.random()}`;
      state.projectiles.push(proj);
    }
    // Double shot on dual gun: fire a second volley slightly behind
    if (hasDoubleShot) {
      for (const sign of [-1, 1]) {
        const proj = createProjectile(tank);
        proj.x += Math.cos(perpAngle) * offset * sign;
        proj.y += Math.sin(perpAngle) * offset * sign;
        proj.x -= Math.cos(tank.turretAngle) * 12;
        proj.y -= Math.sin(tank.turretAngle) * 12;
        proj.id = `proj_${Date.now()}_${Math.random()}`;
        state.projectiles.push(proj);
      }
    }
  } else if (hasDoubleShot) {
    // Double shot: two bullets in a line (one slightly behind the other)
    const proj1 = createProjectile(tank);
    state.projectiles.push(proj1);
    const proj2 = createProjectile(tank);
    proj2.id = `proj_${Date.now()}_${Math.random()}`;
    proj2.x -= Math.cos(tank.turretAngle) * 12;
    proj2.y -= Math.sin(tank.turretAngle) * 12;
    state.projectiles.push(proj2);
  } else {
    const projectile = createProjectile(tank);
    state.projectiles.push(projectile);
  }
  tank.fireCooldown = tank.fireRate;
  if (tank.isPlayer) playShotSound();
}

/**
 * Reads input and updates the player tank for one frame.
 * @param {object} state
 * @param {InputHandler} input
 * @param {number} delta  seconds since last frame
 */
export function updatePlayer(state, input, delta) {
  if (!state.playerTank) return;
  const tank = state.playerTank;

  // Decrement fire cooldown, clamp to 0
  tank.fireCooldown = Math.max(0, tank.fireCooldown - delta);

  // Decrement power gun timer
  if (tank.powerGunTimer > 0) {
    tank.powerGunTimer = Math.max(0, tank.powerGunTimer - delta);
  }

  // Decrement double shot timer
  if (tank.doubleShotTimer > 0) {
    tank.doubleShotTimer = Math.max(0, tank.doubleShotTimer - delta);
  }

  // Decrement speed boost timer
  if (tank.speedBoostTimer > 0) {
    tank.speedBoostTimer = Math.max(0, tank.speedBoostTimer - delta);
  }

  // Decrement shield timer (shield expires by time or hits)
  if (tank.shieldTimer > 0) {
    tank.shieldTimer = Math.max(0, tank.shieldTimer - delta);
    if (tank.shieldTimer <= 0) tank.shieldHits = 0;
  }

  // Apply speed boost
  const speedMult = tank.speedBoostTimer > 0 ? 1.25 : 1.0;

  // Body movement
  if (input.isDown('w') || input.isDown('W')) {
    tank.x += Math.cos(tank.bodyAngle) * tank.speed * speedMult * delta;
    tank.y += Math.sin(tank.bodyAngle) * tank.speed * speedMult * delta;
  }
  if (input.isDown('s') || input.isDown('S')) {
    tank.x -= Math.cos(tank.bodyAngle) * tank.reverseSpeed * speedMult * delta;
    tank.y -= Math.sin(tank.bodyAngle) * tank.reverseSpeed * speedMult * delta;
  }

  // Body rotation — turret follows body unless arrow keys are held
  let bodyDelta = 0;
  if (input.isDown('a') || input.isDown('A')) bodyDelta -= tank.rotationRate * delta;
  if (input.isDown('d') || input.isDown('D')) bodyDelta += tank.rotationRate * delta;
  tank.bodyAngle += bodyDelta;

  // Turret: arrow keys rotate it independently; otherwise it follows the body
  const turretArrowLeft  = input.isDown('ArrowLeft');
  const turretArrowRight = input.isDown('ArrowRight');
  if (turretArrowLeft || turretArrowRight) {
    // Independent turret rotation — body rotation does NOT carry over
    if (turretArrowLeft)  tank.turretAngle -= tank.turretRotationRate * delta;
    if (turretArrowRight) tank.turretAngle += tank.turretRotationRate * delta;
  } else {
    // No arrow key held — turret follows body
    tank.turretAngle += bodyDelta;
  }

  // Normalize angles to [0, 2π)
  const TWO_PI = 2 * Math.PI;
  tank.bodyAngle   = ((tank.bodyAngle   % TWO_PI) + TWO_PI) % TWO_PI;
  tank.turretAngle = ((tank.turretAngle % TWO_PI) + TWO_PI) % TWO_PI;

  // Fire
  if (input.isDown(' ')) {
    fireProjectile(state, tank);
  }

  // Airstrike
  if (input.isDown('h') || input.isDown('H')) {
    triggerAirstrike(state);
  }
}

/**
 * Normalizes an angle to the range [-π, π].
 * @param {number} angle
 * @returns {number}
 */
export function normalizeAngle(angle) {
  const TWO_PI = 2 * Math.PI;
  angle = angle % TWO_PI;
  if (angle > Math.PI)  angle -= TWO_PI;
  if (angle < -Math.PI) angle += TWO_PI;
  return angle;
}

/**
 * Rotates `current` angle toward `target` by at most `maxStep` radians,
 * taking the shortest path (handles wrap-around).
 * @param {number} current
 * @param {number} target
 * @param {number} maxStep  must be >= 0
 * @returns {number}  new angle (not normalized to any range)
 */
export function rotateToward(current, target, maxStep) {
  let diff = normalizeAngle(target - current);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

/**
 * Updates all enemy tanks (movement, turret, firing) for one frame.
 * @param {object} state
 * @param {number} delta
 */
export function updateEnemies(state, delta) {
  if (!state.playerTank) return;
  const player = state.playerTank;

  for (const enemy of state.enemyTanks) {
    // --- Engineer tank: moves to target factory, repairs it, then disappears ---
    if (enemy.tankType === 'engineer') {
      enemy.fireCooldown = 999; // never fires
      const targetSp = state.map.spawnPoints[enemy.targetFactoryIndex];
      if (!targetSp || targetSp.health <= 0) {
        // Target factory already destroyed — engineer self-destructs
        enemy.health = -1;
        state.explosions.push({
          x: enemy.x, y: enemy.y,
          timer: 0.4, maxTimer: 0.4, radius: enemy.width * 0.6,
        });
        continue;
      } else {
        const angleToFactory = Math.atan2(targetSp.y - enemy.y, targetSp.x - enemy.x);

        // Stuck detection: if barely moved, steer sideways to go around obstacles
        if (!enemy._stuckTimer) enemy._stuckTimer = 0;
        if (!enemy._lastX) { enemy._lastX = enemy.x; enemy._lastY = enemy.y; }
        if (!enemy._steerOffset) enemy._steerOffset = 0;
        enemy._stuckTimer += delta;

        if (enemy._stuckTimer > 0.4) {
          const moved = Math.hypot(enemy.x - enemy._lastX, enemy.y - enemy._lastY);
          if (moved < 3) {
            // Stuck — increase steering offset to turn around the obstacle
            enemy._steerOffset += Math.PI * 0.3;
            if (enemy._steerOffset > Math.PI) enemy._steerOffset = -Math.PI * 0.5; // try other side
          } else {
            // Moving fine — gradually reduce steering offset back to 0
            enemy._steerOffset *= 0.8;
            if (Math.abs(enemy._steerOffset) < 0.05) enemy._steerOffset = 0;
          }
          enemy._lastX = enemy.x;
          enemy._lastY = enemy.y;
          enemy._stuckTimer = 0;
        }

        const targetAngle = angleToFactory + enemy._steerOffset;
        enemy.bodyAngle = rotateToward(enemy.bodyAngle, targetAngle, enemy.rotationRate * delta);
        enemy.x += Math.cos(enemy.bodyAngle) * enemy.speed * delta;
        enemy.y += Math.sin(enemy.bodyAngle) * enemy.speed * delta;

        // Check if arrived at factory (within 45px)
        const distToFactory = Math.hypot(targetSp.x - enemy.x, targetSp.y - enemy.y);
        if (distToFactory < 45) {
          // Repair factory to 60% health and remove engineer
          targetSp.health = Math.ceil(targetSp.maxHealth * 0.60);
          targetSp.panicSpawned = false;
          enemy.health = -1; // mark for removal
        }
        continue; // skip normal AI
      }
    }

    // Decrement fire cooldown, clamp to 0
    enemy.fireCooldown = Math.max(0, enemy.fireCooldown - delta);

    // Find nearest target: player, ally tank, or ally factory (whichever is closer)
    const distToPlayer = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    let targetX = player.x;
    let targetY = player.y;
    let targetDist = distToPlayer;

    if (state.allyTanks) {
      for (const ally of state.allyTanks) {
        const d = Math.hypot(ally.x - enemy.x, ally.y - enemy.y);
        if (d < targetDist) {
          targetDist = d;
          targetX = ally.x;
          targetY = ally.y;
        }
      }
    }

    // Also consider ally factories as targets
    if (state.map && state.map.allyFactory) {
      const factories = Array.isArray(state.map.allyFactory) ? state.map.allyFactory : [state.map.allyFactory];
      for (const af of factories) {
        if (af.health <= 0) continue;
        const d = Math.hypot(af.x - enemy.x, af.y - enemy.y);
        if (d < targetDist) {
          targetDist = d;
          targetX = af.x;
          targetY = af.y;
        }
      }
    }

    const angleToTarget = Math.atan2(targetY - enemy.y, targetX - enemy.x);

    // Stuck detection for all enemy tanks
    if (!enemy._stuckTimer) enemy._stuckTimer = 0;
    if (!enemy._lastX) { enemy._lastX = enemy.x; enemy._lastY = enemy.y; }
    if (!enemy._steerOffset) enemy._steerOffset = 0;
    enemy._stuckTimer += delta;
    if (enemy._stuckTimer > 0.5) {
      const moved = Math.hypot(enemy.x - enemy._lastX, enemy.y - enemy._lastY);
      if (moved < 3) {
        // Stuck — steer sideways to go around
        enemy._steerOffset += Math.PI * 0.35;
        if (enemy._steerOffset > Math.PI) enemy._steerOffset = -Math.PI * 0.5;
      } else {
        // Moving fine — fade offset back to 0
        enemy._steerOffset *= 0.7;
        if (Math.abs(enemy._steerOffset) < 0.05) enemy._steerOffset = 0;
      }
      enemy._lastX = enemy.x;
      enemy._lastY = enemy.y;
      enemy._stuckTimer = 0;
    }

    // Rotate body toward target (with steering offset if stuck)
    const targetAngle = angleToTarget + enemy._steerOffset;
    enemy.bodyAngle = rotateToward(enemy.bodyAngle, targetAngle, enemy.rotationRate * delta);

    // Move forward in body direction
    enemy.x += Math.cos(enemy.bodyAngle) * enemy.speed * delta;
    enemy.y += Math.sin(enemy.bodyAngle) * enemy.speed * delta;

    // Distance to target
    const dist = targetDist;

    // Rotate turret toward target when within 300px
    if (dist <= 300) {
      enemy.turretAngle = rotateToward(enemy.turretAngle, angleToTarget, enemy.turretRotationRate * delta);
    }

    // Fire if aimed within 10° and cooldown expired
    const angleDiff = Math.abs(normalizeAngle(enemy.turretAngle - angleToTarget));
    if (enemy.tankType === 'launcher') {
      // Missile launcher fires as soon as cooldown is ready (no aim requirement — missile homes)
      if (enemy.fireCooldown <= 0 && !enemy.hasMissileOut) {
        const mx = enemy.x + Math.cos(enemy.bodyAngle) * (enemy.height / 2 + 8);
        const my = enemy.y + Math.sin(enemy.bodyAngle) * (enemy.height / 2 + 8);
        state.missiles.push({
          id: `missile_${Date.now()}_${Math.random()}`,
          x: mx,
          y: my,
          angle: enemy.bodyAngle,
          speed: 135, // 90% of player speed (150 * 0.9)
          ownerId: enemy.id,
          damage: 30,
          radius: 6,
          range: 1800, // 1.5 × map width (1200)
          distanceTraveled: 0,
        });
        enemy.hasMissileOut = true;
        enemy.fireCooldown = enemy.fireRate;
      }
    } else if (angleDiff <= 0.1745 && enemy.fireCooldown <= 0) {
      fireProjectile(state, enemy);
    }
  }
}

/**
 * Manages enemy spawn timers and spawns new enemies as needed.
 * @param {object} state
 * @param {number} delta
 */
export function updateSpawns(state, delta) {
  if (!state.map) return;

  // Handle per-spawn-point retry timers
  for (let i = 0; i < state.map.spawnPoints.length; i++) {
    if (state.map.spawnPoints[i].health <= 0) continue; // factory destroyed
    if (state.spawnRetryTimers[i] > 0) {
      state.spawnRetryTimers[i] -= delta;
      if (state.spawnRetryTimers[i] <= 0) {
        state.spawnRetryTimers[i] = 0;
        // Retry spawn at this point if cap not reached and point not occupied
        const maxEnemies = state.difficulty === 'supereasy' ? 6 : state.difficulty === 'easy' ? 5 : state.difficulty === 'hard' ? 7 : 10;
        if (state.enemyTanks.length < maxEnemies) {
          const sp = state.map.spawnPoints[i];
          const retryX = sp.x;
          const retryY = sp.y + 45;
          const occupied = state.enemyTanks.some(
            e => Math.hypot(e.x - retryX, e.y - retryY) < 36
          );
          if (!occupied) {
            const spawnPos = { x: retryX, y: retryY };
            const roll = Math.random();
            let newEnemy;
            if (roll < 0.15) newEnemy = createMissileLauncher(spawnPos, i);
            else if (roll < 0.30) newEnemy = createHeavyEnemyTank(spawnPos, i);
            else if (roll < 0.50) newEnemy = createLightEnemyTank(spawnPos, i);
            else newEnemy = createEnemyTank(spawnPos, i);
            state.enemyTanks.push(newEnemy);
          }
        }
      }
    }
  }

  // Enforce enemy cap (varies by difficulty)
  const maxEnemies = state.difficulty === 'supereasy' ? 6 : state.difficulty === 'easy' ? 5 : state.difficulty === 'hard' ? 7 : 10;
  if (state.enemyTanks.length >= maxEnemies) return;

  // Decrement main spawn timer
  state.spawnTimer -= delta;
  if (state.spawnTimer > 0) return;

  // Reset spawn timer (varies by difficulty)
  const spawnInterval = state.difficulty === 'supereasy' ? 3 : state.difficulty === 'easy' ? 8 : state.difficulty === 'hard' ? 6 : 5;
  state.spawnTimer = spawnInterval;

  // Find spawn point with fewest active enemies (skip destroyed factories)
  const counts = state.map.spawnPoints.map((sp, i) =>
    sp.health <= 0 ? Infinity : state.enemyTanks.filter(e => e.spawnPointIndex === i).length
  );
  let selectedIndex = -1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] === Infinity) continue;
    if (selectedIndex === -1 || counts[i] < counts[selectedIndex]) selectedIndex = i;
  }
  // If all factories destroyed, no more spawning
  if (selectedIndex === -1) return;

  // Check if selected spawn point is occupied (check area below factory where tanks actually spawn)
  const sp = state.map.spawnPoints[selectedIndex];
  const spawnX = sp.x;
  const spawnY = sp.y + 45; // spawn below the factory
  const occupied = state.enemyTanks.some(
    e => Math.hypot(e.x - spawnX, e.y - spawnY) < 36
  );
  if (occupied) {
    state.spawnRetryTimers[selectedIndex] = 1;
    return;
  }

  // Spawn new enemy (type varies by difficulty) — offset below factory
  const spawnPos = { x: sp.x, y: sp.y + 45 };
  let newEnemy;
  if (state.difficulty === 'supereasy') {
    // Super easy: only standard tanks
    newEnemy = createEnemyTank(spawnPos, selectedIndex);
  } else {
    const roll = Math.random();
    if (roll < 0.15) newEnemy = createMissileLauncher(spawnPos, selectedIndex);
    else if (roll < 0.30) newEnemy = createHeavyEnemyTank(spawnPos, selectedIndex);
    else if (roll < 0.50) newEnemy = createLightEnemyTank(spawnPos, selectedIndex);
    else newEnemy = createEnemyTank(spawnPos, selectedIndex);
  }
  state.enemyTanks.push(newEnemy);
}

/**
 * Spawns allied tanks from the ally factory (super easy mode only).
 * @param {object} state
 * @param {number} delta
 */
export function updateAllySpawns(state, delta) {
  if (!state.map || !state.map.allyFactory) return;
  const factories = Array.isArray(state.map.allyFactory) ? state.map.allyFactory : [state.map.allyFactory];
  const aliveFactories = factories.filter(af => af.health > 0);
  if (aliveFactories.length === 0) return;

  // Max 5 ally tanks at a time (more factories = more allies)
  if (state.allyTanks.length >= 5) return;

  state.allySpawnTimer -= delta;
  if (state.allySpawnTimer > 0) return;
  state.allySpawnTimer = 3; // every 3 seconds

  // Pick a random alive ally factory to spawn from
  const af = aliveFactories[Math.floor(Math.random() * aliveFactories.length)];
  state.allyTanks.push(createAllyTank(af));
}

/**
 * Updates allied tank AI: move toward nearest enemy, fire at them.
 * @param {object} state
 * @param {number} delta
 */
export function updateAllyTanks(state, delta) {
  for (const ally of state.allyTanks) {
    ally.fireCooldown = Math.max(0, ally.fireCooldown - delta);

    // Find nearest target: enemy tank or enemy factory
    let targetX = null;
    let targetY = null;
    let nearestDist = Infinity;

    for (const enemy of state.enemyTanks) {
      const d = Math.hypot(enemy.x - ally.x, enemy.y - ally.y);
      if (d < nearestDist) { nearestDist = d; targetX = enemy.x; targetY = enemy.y; }
    }

    // Also consider enemy factories as targets
    if (state.map) {
      for (const sp of state.map.spawnPoints) {
        if (sp.health <= 0) continue;
        const d = Math.hypot(sp.x - ally.x, sp.y - ally.y);
        if (d < nearestDist) { nearestDist = d; targetX = sp.x; targetY = sp.y; }
      }
    }

    if (targetX === null) continue; // nothing to attack

    const angleToEnemy = Math.atan2(targetY - ally.y, targetX - ally.x);

    // Stuck detection
    if (!ally._stuckTimer) ally._stuckTimer = 0;
    if (!ally._lastX) { ally._lastX = ally.x; ally._lastY = ally.y; }
    if (!ally._steerOffset) ally._steerOffset = 0;
    ally._stuckTimer += delta;
    if (ally._stuckTimer > 0.5) {
      const moved = Math.hypot(ally.x - ally._lastX, ally.y - ally._lastY);
      if (moved < 3) {
        ally._steerOffset += Math.PI * 0.35;
        if (ally._steerOffset > Math.PI) ally._steerOffset = -Math.PI * 0.5;
      } else {
        ally._steerOffset *= 0.7;
        if (Math.abs(ally._steerOffset) < 0.05) ally._steerOffset = 0;
      }
      ally._lastX = ally.x;
      ally._lastY = ally.y;
      ally._stuckTimer = 0;
    }

    // Move toward nearest enemy
    const targetAngle = angleToEnemy + ally._steerOffset;
    ally.bodyAngle = rotateToward(ally.bodyAngle, targetAngle, ally.rotationRate * delta);
    ally.x += Math.cos(ally.bodyAngle) * ally.speed * delta;
    ally.y += Math.sin(ally.bodyAngle) * ally.speed * delta;

    // Rotate turret toward enemy when within 300px
    if (nearestDist <= 300) {
      ally.turretAngle = rotateToward(ally.turretAngle, angleToEnemy, ally.turretRotationRate * delta);
    }

    // Fire at enemy when aimed within 10°
    const angleDiff = Math.abs(normalizeAngle(ally.turretAngle - angleToEnemy));
    if (angleDiff <= 0.1745 && ally.fireCooldown <= 0) {
      // Fire ally projectile (damages enemies)
      const proj = createProjectile(ally);
      proj.isPlayerProjectile = true; // ally bullets damage enemies
      proj.isAllyProjectile = true;
      state.projectiles.push(proj);
      ally.fireCooldown = ally.fireRate;
    }
  }
}

/**
 * Advances all projectiles along their trajectories for one frame.
 * @param {object} state
 * @param {number} delta
 */
export function updateProjectiles(state, delta) {
  for (const p of state.projectiles) {
    p.x += Math.cos(p.angle) * p.speed * delta;
    p.y += Math.sin(p.angle) * p.speed * delta;
  }
}

/**
 * Updates homing missiles: track player, check range, check collisions.
 * @param {object} state
 * @param {number} delta
 */
export function updateMissiles(state, delta) {
  if (!state.playerTank) return;
  const player = state.playerTank;

  const toRemove = new Set();

  for (const m of state.missiles) {
    // Home toward player
    const angleToPlayer = Math.atan2(player.y - m.y, player.x - m.x);
    const turnRate = 3.0; // radians/s — fairly agile
    m.angle = rotateToward(m.angle, angleToPlayer, turnRate * delta);

    // Move
    const dx = Math.cos(m.angle) * m.speed * delta;
    const dy = Math.sin(m.angle) * m.speed * delta;
    m.x += dx;
    m.y += dy;
    m.distanceTraveled += Math.hypot(dx, dy);

    // Check range limit
    if (m.distanceTraveled >= m.range) {
      toRemove.add(m.id);
      continue;
    }

    // Check if out of map bounds
    if (m.x < 0 || m.x > state.map.width || m.y < 0 || m.y > state.map.height) {
      toRemove.add(m.id);
      continue;
    }

    // Check collision with rocks (missile destroyed)
    for (const rock of state.map.rocks) {
      if (m.x >= rock.x && m.x <= rock.x + rock.width &&
          m.y >= rock.y && m.y <= rock.y + rock.height) {
        toRemove.add(m.id);
        break;
      }
    }
    if (toRemove.has(m.id)) continue;

    // Check collision with player
    const pr = tankRect(player);
    if (m.x >= pr.x && m.x <= pr.x + pr.width &&
        m.y >= pr.y && m.y <= pr.y + pr.height) {
      if (player.shieldTimer > 0 && player.shieldHits > 0) {
        player.shieldHits -= 1;
        if (player.shieldHits <= 0) player.shieldTimer = 0;
      } else {
        player.health = Math.max(0, player.health - m.damage);
      }
      toRemove.add(m.id);
      if (player.health <= 0) {
        triggerGameOver(state);
      }
      continue;
    }

    // Check collision with player projectiles (player can shoot down missiles)
    for (const p of state.projectiles) {
      if (!p.isPlayerProjectile) continue;
      const dist = Math.hypot(p.x - m.x, p.y - m.y);
      if (dist <= p.radius + m.radius) {
        toRemove.add(m.id);
        // Also remove the projectile
        state.projectiles = state.projectiles.filter(pp => pp.id !== p.id);
        break;
      }
    }
  }

  // Remove destroyed missiles and reset launcher state
  for (const m of state.missiles) {
    if (toRemove.has(m.id)) {
      // Find the launcher that owns this missile and allow it to fire again
      const launcher = state.enemyTanks.find(e => e.id === m.ownerId);
      if (launcher) launcher.hasMissileOut = false;
    }
  }
  state.missiles = state.missiles.filter(m => !toRemove.has(m.id));
}

/**
 * Handles start-screen input: transitions to 'playing' when Enter is pressed.
 * Full implementation in Task 12.
 * @param {object} state
 * @param {InputHandler} input
 */
export function updateStartScreen(state, input) {
  if (input.isDown('0')) { state.difficulty = 'supereasy'; }
  if (input.isDown('1')) { state.difficulty = 'easy'; }
  if (input.isDown('2')) { state.difficulty = 'hard'; }
  if (input.isDown('3')) { state.difficulty = 'crazy'; }
  if (input.isDown('Enter')) {
    startGame(state);
  }
}

/**
 * Handles game-over screen input: restarts the game when R is pressed.
 * Full implementation in Task 12.
 * @param {object} state
 * @param {InputHandler} input
 */
export function updateGameOver(state, input) {
  // Allow difficulty re-selection on game over screen
  if (input.isDown('0')) { state.difficulty = 'supereasy'; }
  if (input.isDown('1')) { state.difficulty = 'easy'; }
  if (input.isDown('2')) { state.difficulty = 'hard'; }
  if (input.isDown('3')) { state.difficulty = 'crazy'; }
  if (input.isDown('r') || input.isDown('R')) {
    restartGame(state);
  }
}

// ---------------------------------------------------------------------------
// Collision detection and resolution
// ---------------------------------------------------------------------------

/**
 * Returns the axis-aligned bounding box of a tank as {x, y, width, height}
 * where x,y is the top-left corner.
 * @param {object} tank
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function tankRect(tank) {
  return {
    x: tank.x - tank.width / 2,
    y: tank.y - tank.height / 2,
    width: tank.width,
    height: tank.height,
  };
}

/**
 * Returns true if two axis-aligned rectangles overlap (touching counts as overlap).
 * @param {{x: number, y: number, width: number, height: number}} a
 * @param {{x: number, y: number, width: number, height: number}} b
 * @returns {boolean}
 */
export function rectsOverlap(a, b) {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/**
 * Clamps the tank's position so its bounding box stays fully inside the map rect.
 * @param {object} tank
 * @param {object} map
 */
export function clampTankToBounds(tank, map) {
  const hw = tank.width / 2;
  const hh = tank.height / 2;
  tank.x = Math.max(hw, Math.min(map.width - hw, tank.x));
  tank.y = Math.max(hh, Math.min(map.height - hh, tank.y));
}

/**
 * Pushes the tank out of overlap with the given rect along the minimum-penetration axis.
 * @param {object} tank
 * @param {{x: number, y: number, width: number, height: number}} rect
 */
export function pushTankOutOfRect(tank, rect) {
  const tr = tankRect(tank);
  if (!rectsOverlap(tr, rect)) return;

  // Calculate overlap on each axis
  const overlapLeft   = (tr.x + tr.width)  - rect.x;
  const overlapRight  = (rect.x + rect.width) - tr.x;
  const overlapTop    = (tr.y + tr.height) - rect.y;
  const overlapBottom = (rect.y + rect.height) - tr.y;

  // Find minimum penetration axis
  const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

  if (minOverlap === overlapLeft)        tank.x -= overlapLeft;
  else if (minOverlap === overlapRight)  tank.x += overlapRight;
  else if (minOverlap === overlapTop)    tank.y -= overlapTop;
  else                                   tank.y += overlapBottom;
}

/**
 * Resolves a collision between two tanks by pushing each half the overlap distance
 * along the minimum-penetration axis.
 * @param {object} tankA
 * @param {object} tankB
 */
export function resolveTankTankCollision(tankA, tankB) {
  const ra = tankRect(tankA);
  const rb = tankRect(tankB);
  if (!rectsOverlap(ra, rb)) return;

  const overlapLeft   = (ra.x + ra.width)  - rb.x;
  const overlapRight  = (rb.x + rb.width)  - ra.x;
  const overlapTop    = (ra.y + ra.height) - rb.y;
  const overlapBottom = (rb.y + rb.height) - ra.y;

  const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
  const half = minOverlap / 2;

  if (minOverlap === overlapLeft) {
    tankA.x -= half; tankB.x += half;
  } else if (minOverlap === overlapRight) {
    tankA.x += half; tankB.x -= half;
  } else if (minOverlap === overlapTop) {
    tankA.y -= half; tankB.y += half;
  } else {
    tankA.y += half; tankB.y -= half;
  }
}

/**
 * Detects and resolves all collisions for one frame.
 * @param {object} state
 */
export function resolveCollisions(state) {
  if (!state.map) return;
  const map = state.map;
  const player = state.playerTank;

  // --- 1. Clamp all tanks to map boundaries ---
  if (player) clampTankToBounds(player, map);
  for (const enemy of state.enemyTanks) clampTankToBounds(enemy, map);
  for (const ally of (state.allyTanks || [])) clampTankToBounds(ally, map);

  // --- 2. Push tanks out of Rivers, Rocks, Bricks, and Factories ---
  const allyTanks = state.allyTanks || [];
  const allTanks = player ? [player, ...state.enemyTanks, ...allyTanks] : [...state.enemyTanks, ...allyTanks];
  for (const tank of allTanks) {
    // Rivers: block tanks using river segments (above and below bridge)
    for (let ri = 0; ri < map.rivers.length; ri++) {
      const river = map.rivers[ri];
      const bridge = map.bridges && map.bridges[ri];
      if (bridge) {
        // Split river into top segment (above bridge) and bottom segment (below bridge)
        const topSeg = { x: river.x, y: river.y, width: river.width, height: bridge.y - river.y };
        const botSeg = { x: river.x, y: bridge.y + bridge.height, width: river.width, height: (river.y + river.height) - (bridge.y + bridge.height) };
        if (topSeg.height > 0) pushTankOutOfRect(tank, topSeg);
        if (botSeg.height > 0) pushTankOutOfRect(tank, botSeg);
      } else {
        pushTankOutOfRect(tank, river);
      }
    }
    for (const rock of map.rocks)   pushTankOutOfRect(tank, rock);
    if (map.bricks) {
      for (const brick of map.bricks) {
        if (brick.health > 0) pushTankOutOfRect(tank, brick);
      }
    }
    // Factories (spawn points) block tanks — alive or as ruins
    for (const sp of map.spawnPoints) {
      const factoryRect = { x: sp.x - 25, y: sp.y - 20, width: 50, height: 40 };
      pushTankOutOfRect(tank, factoryRect);
    }
    // Ally factories also block
    if (map.allyFactory) {
      const factories = Array.isArray(map.allyFactory) ? map.allyFactory : [map.allyFactory];
      for (const af of factories) {
        if (af.health > 0) {
          pushTankOutOfRect(tank, { x: af.x - 25, y: af.y - 20, width: 50, height: 40 });
        }
      }
    }
  }

  // --- 3. Resolve tank ↔ tank collisions ---
  if (player) {
    for (const enemy of state.enemyTanks) {
      resolveTankTankCollision(player, enemy);
    }
    // Player ↔ ally
    for (const ally of allyTanks) {
      resolveTankTankCollision(player, ally);
    }
  }
  // Enemy ↔ enemy (prevents stacking)
  for (let i = 0; i < state.enemyTanks.length; i++) {
    for (let j = i + 1; j < state.enemyTanks.length; j++) {
      resolveTankTankCollision(state.enemyTanks[i], state.enemyTanks[j]);
    }
  }
  // Ally ↔ ally (prevents stacking)
  for (let i = 0; i < allyTanks.length; i++) {
    for (let j = i + 1; j < allyTanks.length; j++) {
      resolveTankTankCollision(allyTanks[i], allyTanks[j]);
    }
  }
  // Ally ↔ enemy
  for (const ally of allyTanks) {
    for (const enemy of state.enemyTanks) {
      resolveTankTankCollision(ally, enemy);
    }
  }

  // --- 4. Projectile collision resolution ---
  // Collect IDs of projectiles to remove
  const toRemove = new Set();

  // 4a. Opposing projectile cancellation (player vs enemy)
  const playerProjs = state.projectiles.filter(p => p.isPlayerProjectile);
  const enemyProjs  = state.projectiles.filter(p => !p.isPlayerProjectile);

  for (const pp of playerProjs) {
    for (const ep of enemyProjs) {
      const dist = Math.hypot(pp.x - ep.x, pp.y - ep.y);
      if (dist <= pp.radius + ep.radius) {
        toRemove.add(pp.id);
        toRemove.add(ep.id);
      }
    }
  }

  // 4b. Projectile ↔ map boundary removal
  for (const p of state.projectiles) {
    if (p.x < 0 || p.x > map.width || p.y < 0 || p.y > map.height) {
      toRemove.add(p.id);
    }
  }

  // 4c. Projectile ↔ Rock removal (Rivers are pass-through — not checked)
  for (const p of state.projectiles) {
    if (toRemove.has(p.id)) continue;
    for (const rock of map.rocks) {
      if (
        p.x >= rock.x && p.x <= rock.x + rock.width &&
        p.y >= rock.y && p.y <= rock.y + rock.height
      ) {
        toRemove.add(p.id);
        break;
      }
    }
  }

  // 4c2. Projectile ↔ Brick (destroy brick and remove projectile)
  if (map.bricks) {
    for (const p of state.projectiles) {
      if (toRemove.has(p.id)) continue;
      for (const brick of map.bricks) {
        if (brick.health <= 0) continue;
        if (
          p.x >= brick.x && p.x <= brick.x + brick.width &&
          p.y >= brick.y && p.y <= brick.y + brick.height
        ) {
          brick.health -= 1;
          toRemove.add(p.id);
          break;
        }
      }
    }
  }

  // 4c3. Player projectile ↔ Factory (damage factory, explode when destroyed)
  // Also: all projectiles are blocked by ruins (destroyed factories act as rocks)
  for (const p of state.projectiles) {
    if (toRemove.has(p.id)) continue;
    for (const sp of map.spawnPoints) {
      const fr = { x: sp.x - 25, y: sp.y - 20, width: 50, height: 40 };
      if (
        p.x >= fr.x && p.x <= fr.x + fr.width &&
        p.y >= fr.y && p.y <= fr.y + fr.height
      ) {
        if (sp.health > 0 && p.isPlayerProjectile) {
          // Damage the factory (only player shots)
          sp.health -= 1;

          // Emergency spawn: when health drops to 40% or below, spawn 2 tanks immediately (once)
          if (!sp.panicSpawned && sp.health > 0 && sp.health <= Math.ceil(sp.maxHealth * 0.40)) {
            sp.panicSpawned = true;
            const spIdx = map.spawnPoints.indexOf(sp);
            // Spawn 2 tanks offset from factory
            for (let es = 0; es < 2; es++) {
              const offsetX = (es === 0 ? -40 : 40);
              const spawnPos = { x: sp.x + offsetX, y: sp.y + 40 };
              const newEnemy = createEnemyTank(spawnPos, spIdx);
              state.enemyTanks.push(newEnemy);
            }
            // Spawn an engineering tank from another alive factory to repair this one
            const otherFactories = map.spawnPoints.filter((other, idx) => idx !== spIdx && other.health > 0);
            if (otherFactories.length > 0) {
              const source = otherFactories[Math.floor(Math.random() * otherFactories.length)];
              const sourceIdx = map.spawnPoints.indexOf(source);
              const engineer = createEngineerTank(source, sourceIdx, spIdx);
              state.enemyTanks.push(engineer);
            }
          }

          if (sp.health <= 0) {
            state.explosions.push({
              x: sp.x,
              y: sp.y,
              timer: 1.0,
              maxTimer: 1.0,
              radius: 40,
            });
            state.score += 200;
          }
        }
        // All projectiles are absorbed (alive factory or ruin)
        toRemove.add(p.id);
        break;
      }
    }
  }

  // 4d. Player projectile ↔ enemy tank damage
  for (const p of playerProjs) {
    if (toRemove.has(p.id)) continue;
    for (const enemy of state.enemyTanks) {
      const er = tankRect(enemy);
      if (
        p.x >= er.x && p.x <= er.x + er.width &&
        p.y >= er.y && p.y <= er.y + er.height
      ) {
        enemy.health -= p.damage; // 50 damage
        toRemove.add(p.id);
        break;
      }
    }
  }

  // 4e. Enemy projectile ↔ player tank damage
  if (player) {
    for (const p of enemyProjs) {
      if (toRemove.has(p.id)) continue;
      const pr = tankRect(player);
      if (
        p.x >= pr.x && p.x <= pr.x + pr.width &&
        p.y >= pr.y && p.y <= pr.y + pr.height
      ) {
        // Shield absorbs hit
        if (player.shieldTimer > 0 && player.shieldHits > 0) {
          player.shieldHits -= 1;
          if (player.shieldHits <= 0) player.shieldTimer = 0;
        } else {
          player.health = Math.max(0, player.health - p.damage); // 20 damage, clamped
        }
        toRemove.add(p.id);
        if (player.health <= 0) {
          triggerGameOver(state);
        }
      }
    }
  }

  // Remove all flagged projectiles
  state.projectiles = state.projectiles.filter(p => !toRemove.has(p.id));

  // 4f. Enemy projectile ↔ ally tank damage
  if (state.allyTanks && state.allyTanks.length > 0) {
    const remainingEnemyProjs = state.projectiles.filter(p => !p.isPlayerProjectile);
    const allyToRemove = new Set();
    for (const p of remainingEnemyProjs) {
      for (const ally of state.allyTanks) {
        const ar = tankRect(ally);
        if (p.x >= ar.x && p.x <= ar.x + ar.width &&
            p.y >= ar.y && p.y <= ar.y + ar.height) {
          ally.health -= p.damage;
          allyToRemove.add(p.id);
          break;
        }
      }
    }
    state.projectiles = state.projectiles.filter(p => !allyToRemove.has(p.id));
    // Remove dead allies with explosion
    state.allyTanks = state.allyTanks.filter(a => {
      if (a.health <= 0) {
        state.explosions.push({ x: a.x, y: a.y, timer: 0.4, maxTimer: 0.4, radius: a.width * 0.6 });
        return false;
      }
      return true;
    });
  }

  // 4g. Enemy projectile ↔ ally factory damage
  if (state.map && state.map.allyFactory) {
    const factories = Array.isArray(state.map.allyFactory) ? state.map.allyFactory : [state.map.allyFactory];
    for (const af of factories) {
      if (af.health <= 0) continue;
      const afRect = { x: af.x - 25, y: af.y - 20, width: 50, height: 40 };
      const enemyBullets = state.projectiles.filter(p => !p.isPlayerProjectile);
      const afToRemove = new Set();
      for (const p of enemyBullets) {
        if (p.x >= afRect.x && p.x <= afRect.x + afRect.width &&
            p.y >= afRect.y && p.y <= afRect.y + afRect.height) {
          af.health -= 1;
          afToRemove.add(p.id);
          if (af.health <= 0) {
            state.explosions.push({ x: af.x, y: af.y, timer: 1.0, maxTimer: 1.0, radius: 40 });
          }
        }
      }
      state.projectiles = state.projectiles.filter(p => !afToRemove.has(p.id));
    }
  }

  // Remove dead enemies and award score, spawn power-ups, create explosions
  const deadEnemies = state.enemyTanks.filter(e => e.health <= 0);
  for (const dead of deadEnemies) {
    state.score += dead.scoreValue || 100;
    // Spawn explosion
    playExplosionSound();
    state.explosions.push({
      x: dead.x,
      y: dead.y,
      timer: 0.5, // 0.5 seconds
      maxTimer: 0.5,
      radius: dead.width * 0.8,
    });
    // 10% each: health, power gun, airstrike, double shot, speed boost, shield; 40% nothing
    const roll = Math.random();
    if (roll < 0.10) {
      state.powerups.push({
        id: `pu_${Date.now()}_${Math.random()}`,
        x: dead.x, y: dead.y,
        type: 'health', radius: 14, timer: 10,
      });
    } else if (roll < 0.20) {
      state.powerups.push({
        id: `pu_${Date.now()}_${Math.random()}`,
        x: dead.x, y: dead.y,
        type: 'powergun', radius: 14, timer: 10,
      });
    } else if (roll < 0.30) {
      state.powerups.push({
        id: `pu_${Date.now()}_${Math.random()}`,
        x: dead.x, y: dead.y,
        type: 'airstrike', radius: 14, timer: 10,
      });
    } else if (roll < 0.40) {
      state.powerups.push({
        id: `pu_${Date.now()}_${Math.random()}`,
        x: dead.x, y: dead.y,
        type: 'doubleshot', radius: 14, timer: 10,
      });
    } else if (roll < 0.50) {
      state.powerups.push({
        id: `pu_${Date.now()}_${Math.random()}`,
        x: dead.x, y: dead.y,
        type: 'speedboost', radius: 14, timer: 10,
      });
    } else if (roll < 0.60) {
      state.powerups.push({
        id: `pu_${Date.now()}_${Math.random()}`,
        x: dead.x, y: dead.y,
        type: 'shield', radius: 14, timer: 10,
      });
    }
  }
  state.enemyTanks = state.enemyTanks.filter(e => e.health > 0);
}

// ---------------------------------------------------------------------------
// Rendering functions
// ---------------------------------------------------------------------------

/**
 * Draws the map background, rivers, rocks, and spawn markers.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} map
 */
export function renderMap(ctx, map) {
  // Background: dark green grass
  ctx.fillStyle = '#4a5e3a';
  ctx.fillRect(0, 0, map.width, map.height);

  // Rivers: blue fill with lighter border
  for (const river of map.rivers) {
    ctx.fillStyle = '#4488cc';
    ctx.fillRect(river.x, river.y, river.width, river.height);
    ctx.strokeStyle = '#66aaee';
    ctx.lineWidth = 2;
    ctx.strokeRect(river.x, river.y, river.width, river.height);
  }

  // Bridges: brown wooden planks across rivers
  if (map.bridges) {
    for (const b of map.bridges) {
      ctx.fillStyle = '#8B6914';
      ctx.fillRect(b.x, b.y, b.width, b.height);
      ctx.strokeStyle = '#5C4400';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.width, b.height);
      // Plank lines
      ctx.strokeStyle = '#6B5510';
      ctx.lineWidth = 1;
      for (let py = b.y + 8; py < b.y + b.height; py += 12) {
        ctx.beginPath();
        ctx.moveTo(b.x, py);
        ctx.lineTo(b.x + b.width, py);
        ctx.stroke();
      }
      // Railings
      ctx.fillStyle = '#5C4400';
      ctx.fillRect(b.x, b.y, b.width, 3);
      ctx.fillRect(b.x, b.y + b.height - 3, b.width, 3);
    }
  }

  // Rocks: gray fill with darker border
  for (const rock of map.rocks) {
    ctx.fillStyle = '#888888';
    ctx.fillRect(rock.x, rock.y, rock.width, rock.height);
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 2;
    ctx.strokeRect(rock.x, rock.y, rock.width, rock.height);
  }

  // Bricks: brown/orange destructible blocks
  if (map.bricks) {
    for (const brick of map.bricks) {
      if (brick.health <= 0) continue;
      ctx.fillStyle = '#aa6633';
      ctx.fillRect(brick.x, brick.y, brick.width, brick.height);
      ctx.strokeStyle = '#774422';
      ctx.lineWidth = 1;
      ctx.strokeRect(brick.x, brick.y, brick.width, brick.height);
      // Mortar lines
      ctx.strokeStyle = '#553311';
      ctx.beginPath();
      ctx.moveTo(brick.x + brick.width / 2, brick.y);
      ctx.lineTo(brick.x + brick.width / 2, brick.y + brick.height);
      ctx.moveTo(brick.x, brick.y + brick.height / 2);
      ctx.lineTo(brick.x + brick.width, brick.y + brick.height / 2);
      ctx.stroke();
    }
  }

  // Ally factories (blue, super easy mode)
  if (map.allyFactory) {
    const factories = Array.isArray(map.allyFactory) ? map.allyFactory : [map.allyFactory];
    for (const af of factories) {
      if (af.health <= 0) continue;
      ctx.save();
      ctx.translate(af.x, af.y);
      const factoryW = 50;
      const factoryH = 40;
      ctx.fillStyle = '#224466';
      ctx.fillRect(-factoryW / 2, -factoryH / 2, factoryW, factoryH);
      ctx.strokeStyle = '#3366aa';
      ctx.lineWidth = 2;
      ctx.strokeRect(-factoryW / 2, -factoryH / 2, factoryW, factoryH);
      // Blue flag
      ctx.fillStyle = '#4488ff';
      ctx.fillRect(factoryW / 2 - 8, -factoryH / 2 - 12, 2, 12);
      ctx.fillRect(factoryW / 2 - 6, -factoryH / 2 - 12, 10, 7);
      // Door
      ctx.fillStyle = '#113344';
      ctx.fillRect(-6, 2, 12, factoryH / 2 - 2);
      // Label
      ctx.fillStyle = '#4488ff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('ALLY', 0, -factoryH / 2 - 2);
      // Health bar
      const hpRatio = af.health / af.maxHealth;
      const barW = 40;
      const barH = 4;
      ctx.fillStyle = '#001133';
      ctx.fillRect(-barW / 2, -factoryH / 2 - 22, barW, barH);
      ctx.fillStyle = hpRatio > 0.5 ? '#4488ff' : '#ff4444';
      ctx.fillRect(-barW / 2, -factoryH / 2 - 22, barW * hpRatio, barH);
      ctx.restore();
    }
  }

  // Spawn point factories (or ruins if destroyed)
  for (const sp of map.spawnPoints) {
    ctx.save();
    ctx.translate(sp.x, sp.y);

    const factoryW = 50;
    const factoryH = 40;

    if (sp.health <= 0) {
      // Destroyed — draw ruins (functions as rock)
      ctx.fillStyle = '#3a3030';
      ctx.fillRect(-factoryW / 2, -factoryH / 2, factoryW, factoryH);
      // Rubble chunks
      ctx.fillStyle = '#554040';
      ctx.fillRect(-18, -12, 14, 10);
      ctx.fillRect(4, -8, 12, 14);
      ctx.fillRect(-10, 5, 16, 10);
      // Cracks
      ctx.strokeStyle = '#221515';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-20, -15);
      ctx.lineTo(5, 5);
      ctx.lineTo(20, -5);
      ctx.moveTo(-15, 10);
      ctx.lineTo(10, 15);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    // Active factory
    // Main building
    ctx.fillStyle = '#554444';
    ctx.fillRect(-factoryW / 2, -factoryH / 2, factoryW, factoryH);
    ctx.strokeStyle = '#332222';
    ctx.lineWidth = 2;
    ctx.strokeRect(-factoryW / 2, -factoryH / 2, factoryW, factoryH);

    // Chimney
    ctx.fillStyle = '#443333';
    ctx.fillRect(factoryW / 2 - 12, -factoryH / 2 - 14, 10, 14);

    // Smoke from chimney (small circles)
    ctx.fillStyle = 'rgba(100,100,100,0.4)';
    ctx.beginPath();
    ctx.arc(factoryW / 2 - 7, -factoryH / 2 - 18, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(factoryW / 2 - 4, -factoryH / 2 - 26, 4, 0, 2 * Math.PI);
    ctx.fill();

    // Door
    ctx.fillStyle = '#332222';
    ctx.fillRect(-6, 2, 12, factoryH / 2 - 2);

    // Health bar above factory
    const hpRatio = sp.health / sp.maxHealth;
    const barW = 40;
    const barH = 4;
    ctx.fillStyle = '#330000';
    ctx.fillRect(-barW / 2, -factoryH / 2 - 8, barW, barH);
    ctx.fillStyle = hpRatio > 0.5 ? '#cc4444' : '#ff2222';
    ctx.fillRect(-barW / 2, -factoryH / 2 - 8, barW * hpRatio, barH);

    ctx.restore();
  }
}

/**
 * Draws a single tank (body + turret barrel) at its current position.
 * The body is a trapezoid: wide at the back, narrow at the front, making direction obvious.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} tank
 */
export function renderTank(ctx, tank) {
  const isPlayer  = tank.isPlayer;
  const size = isPlayer ? 40 : (tank.tankType === 'heavy' ? 42 : 36);
  const half = size / 2;

  // Color fading for enemies: starts dark red, gets lighter as health drops
  let bodyColor, darkColor, trackColor;
  if (isPlayer) {
    bodyColor = '#44aa44';
    darkColor = '#2d7a2d';
    trackColor = '#1a4d1a';
  } else if (tank.tankType === 'ally') {
    // Allied tank: blue
    bodyColor = '#3388cc';
    darkColor = '#225588';
    trackColor = '#113355';
  } else if (tank.tankType === 'launcher') {
    // Missile launcher: purple/maroon tint
    const healthRatio = tank.health / tank.maxHealth;
    const r = Math.round(150 + 80 * (1 - healthRatio));
    const g = Math.round(50 * (1 - healthRatio));
    const b = Math.round(150 + 80 * (1 - healthRatio));
    bodyColor = `rgb(${r}, ${g + 30}, ${b})`;
    darkColor = `rgb(${Math.round(r * 0.6)}, ${Math.round((g + 30) * 0.4)}, ${Math.round(b * 0.6)})`;
    trackColor = `rgb(${Math.round(r * 0.35)}, ${Math.round((g + 30) * 0.2)}, ${Math.round(b * 0.35)})`;
  } else if (tank.tankType === 'light') {
    // Light tank: orange/yellow, small
    const healthRatio = tank.health / tank.maxHealth;
    bodyColor = `rgb(${Math.round(220 + 35 * (1 - healthRatio))}, ${Math.round(160 + 60 * (1 - healthRatio))}, 50)`;
    darkColor = '#996600';
    trackColor = '#664400';
  } else if (tank.tankType === 'engineer') {
    // Engineer tank: dark red, no turret
    bodyColor = '#882222';
    darkColor = '#551111';
    trackColor = '#330808';
  } else {
    // Interpolate from dark red (full HP) to light pink (low HP)
    const healthRatio = tank.health / tank.maxHealth;
    const r = Math.round(204 + (255 - 204) * (1 - healthRatio)); // 204 → 255
    const g = Math.round(51 * (1 - healthRatio));                  // 51 → 0 → lighter
    const b = Math.round(51 * (1 - healthRatio));
    bodyColor = `rgb(${r}, ${g + 50}, ${b + 50})`;
    darkColor = `rgb(${Math.round(r * 0.7)}, ${Math.round((g + 50) * 0.5)}, ${Math.round((b + 50) * 0.5)})`;
    trackColor = `rgb(${Math.round(r * 0.4)}, ${Math.round((g + 50) * 0.3)}, ${Math.round((b + 50) * 0.3)})`;
  }

  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.rotate(tank.bodyAngle);

  // --- Tracks (left and right rectangles) ---
  ctx.fillStyle = trackColor;
  ctx.fillRect(-half, -half, size, size * 0.22);          // top track
  ctx.fillRect(-half, half - size * 0.22, size, size * 0.22); // bottom track

  // --- Main hull: trapezoid (wide at back, narrow at front) ---
  // Points: back-left, back-right, front-right, front-left
  const backW = half * 0.9;   // half-width at back
  const frontW = half * 0.5;  // half-width at front (narrower)
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(-half,  -backW);   // back top-left
  ctx.lineTo( half,  -frontW);  // front top-right
  ctx.lineTo( half,   frontW);  // front bottom-right
  ctx.lineTo(-half,   backW);   // back bottom-left
  ctx.closePath();
  ctx.fill();

  // --- Front accent (darker tip) ---
  ctx.fillStyle = darkColor;
  ctx.beginPath();
  ctx.moveTo(half, -frontW);
  ctx.lineTo(half + 4, 0);       // pointed tip extends slightly
  ctx.lineTo(half, frontW);
  ctx.closePath();
  ctx.fill();

  // --- Back plate (flat darker stripe) ---
  ctx.fillStyle = darkColor;
  ctx.fillRect(-half, -backW, 5, backW * 2);

  // --- Track detail lines ---
  ctx.strokeStyle = darkColor;
  ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    const tx = i * (size / 7);
    // Top track
    ctx.beginPath();
    ctx.moveTo(tx, -half);
    ctx.lineTo(tx, -half + size * 0.22);
    ctx.stroke();
    // Bottom track
    ctx.beginPath();
    ctx.moveTo(tx, half - size * 0.22);
    ctx.lineTo(tx, half);
    ctx.stroke();
  }

  ctx.restore();

  // --- Turret base circle ---
  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.22, 0, 2 * Math.PI);
  ctx.fillStyle = darkColor;
  ctx.fill();
  ctx.restore();

  // --- Turret barrel (bigger if player has power gun active, dual for heavy) ---
  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.rotate(tank.turretAngle);
  const powered = isPlayer && tank.powerGunTimer > 0;

  if (tank.tankType === 'engineer') {
    // Turretless — just draw a small repair symbol on top
    ctx.restore(); // undo turret rotation
    ctx.save();
    ctx.translate(tank.x, tank.y);
    // Small white cross (repair symbol)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-2, -7, 4, 14);
    ctx.fillRect(-7, -2, 14, 4);
    ctx.restore();
  } else if (tank.tankType === 'launcher') {
    // No turret barrel — draw a big white missile on the body instead
    ctx.restore(); // undo turret rotation
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.bodyAngle);

    if (!tank.hasMissileOut) {
      // Full missile sitting on the vehicle
      const mLen = size * 1.0;
      const mW = size * 0.2;
      const startX = -mLen * 0.35;
      // Missile body (white cylinder)
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(startX, -mW / 2, mLen * 0.75, mW);
      // Pointy nose cone (long triangle)
      ctx.fillStyle = '#dd3333';
      ctx.beginPath();
      ctx.moveTo(startX + mLen, 0);           // sharp tip
      ctx.lineTo(startX + mLen * 0.75, -mW / 2);
      ctx.lineTo(startX + mLen * 0.75, mW / 2);
      ctx.closePath();
      ctx.fill();
      // Tail fins (4 fins)
      ctx.fillStyle = '#999999';
      ctx.fillRect(startX, -mW * 1.3, 5, mW * 0.6);   // top-left fin
      ctx.fillRect(startX, mW * 0.7, 5, mW * 0.6);    // bottom-left fin
      // Exhaust nozzle at back
      ctx.fillStyle = '#555555';
      ctx.beginPath();
      ctx.arc(startX, 0, mW * 0.5, 0, 2 * Math.PI);
      ctx.fill();
    } else {
      // Missile has been fired — show empty launch rail
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(-size * 0.35, 0);
      ctx.lineTo(size * 0.5, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  } else if (tank.dualGun) {
    ctx.fillStyle = powered ? '#ff6600' : '#222222';
    const barrelLen = powered ? size * 0.85 : size * 0.65;
    const barrelW   = powered ? size * 0.18 : size * 0.12;
    // Two barrels offset vertically
    const offset = size * 0.2;
    ctx.fillRect(0, -offset - barrelW / 2, barrelLen, barrelW);
    ctx.fillRect(0,  offset - barrelW / 2, barrelLen, barrelW);
    // Tips
    ctx.fillStyle = '#444444';
    ctx.fillRect(barrelLen - 4, -offset - barrelW / 2, 4, barrelW);
    ctx.fillRect(barrelLen - 4,  offset - barrelW / 2, 4, barrelW);
    ctx.restore();
  } else {
    ctx.fillStyle = powered ? '#ff6600' : '#222222';
    const barrelLen = powered ? size * 0.85 : size * 0.65;
    const barrelW   = powered ? size * 0.18 : size * 0.12;
    ctx.fillRect(0, -barrelW / 2, barrelLen, barrelW);
    // Barrel tip
    ctx.fillStyle = powered ? '#ffaa00' : '#444444';
    ctx.fillRect(barrelLen - 4, -barrelW / 2, 4, barrelW);
    ctx.restore();
  }

  // --- Shield visual (cyan ring around player) ---
  if (isPlayer && tank.shieldTimer > 0) {
    ctx.beginPath();
    ctx.arc(tank.x, tank.y, size * 0.75, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(0, 204, 255, ${0.4 + Math.sin(Date.now() * 0.008) * 0.2})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // --- Smoke effect for damaged player tank (health < 50) ---
  if (isPlayer && tank.health < 50 && tank.health > 0) {
    const smokeIntensity = 1 - (tank.health / 50); // 0 at 50hp, 1 at 0hp
    const numPuffs = Math.ceil(smokeIntensity * 4) + 1;
    const time = Date.now() * 0.003; // animate over time
    for (let i = 0; i < numPuffs; i++) {
      const offsetX = Math.sin(time + i * 2.1) * 8;
      const offsetY = -10 - i * 8 + Math.cos(time + i * 1.7) * 3;
      const puffSize = 4 + i * 2 + smokeIntensity * 3;
      const alpha = (0.3 + smokeIntensity * 0.3) * (1 - i / (numPuffs + 1));
      ctx.beginPath();
      ctx.arc(tank.x + offsetX, tank.y + offsetY, puffSize, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(80, 80, 80, ${alpha})`;
      ctx.fill();
    }
  }
}

/**
 * Draws all active projectiles.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} projectiles
 */
export function renderProjectiles(ctx, projectiles) {
  for (const p of projectiles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
    if (p.powered) {
      // Power gun bullet: larger, orange with glow
      ctx.fillStyle = '#ff6600';
      ctx.fill();
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = p.isPlayerProjectile ? '#ffdd00' : '#ff8800';
      ctx.fill();
    }
  }
}

/**
 * Renders homing missiles as small pointed shapes with a trail.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} missiles
 */
export function renderMissiles(ctx, missiles) {
  for (const m of missiles) {
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);

    // Full white missile body with red pointy nose
    const mLen = 22;
    const mW = 5;

    // White body cylinder
    ctx.fillStyle = '#eeeeee';
    ctx.fillRect(-mLen * 0.5, -mW / 2, mLen * 0.7, mW);

    // Red pointy nose cone
    ctx.fillStyle = '#dd2222';
    ctx.beginPath();
    ctx.moveTo(mLen * 0.5, 0);                    // sharp tip
    ctx.lineTo(mLen * 0.2, -mW / 2);
    ctx.lineTo(mLen * 0.2, mW / 2);
    ctx.closePath();
    ctx.fill();

    // Tail fins
    ctx.fillStyle = '#999999';
    ctx.fillRect(-mLen * 0.5, -mW * 1.4, 4, mW * 0.7);
    ctx.fillRect(-mLen * 0.5, mW * 0.7, 4, mW * 0.7);

    // Exhaust flame
    ctx.fillStyle = 'rgba(255, 180, 0, 0.7)';
    ctx.beginPath();
    ctx.moveTo(-mLen * 0.5, 0);
    ctx.lineTo(-mLen * 0.5 - 8, -3);
    ctx.lineTo(-mLen * 0.5 - 6, 0);
    ctx.lineTo(-mLen * 0.5 - 8, 3);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}

/**
 * Updates explosion timers and removes expired ones.
 * @param {object} state
 * @param {number} delta
 */
export function updateExplosions(state, delta) {
  for (const exp of state.explosions) {
    exp.timer -= delta;
  }
  state.explosions = state.explosions.filter(e => e.timer > 0);
}

/**
 * Renders explosion animations.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} explosions
 */
export function renderExplosions(ctx, explosions) {
  for (const exp of explosions) {
    const progress = 1 - (exp.timer / exp.maxTimer); // 0 → 1
    const radius = exp.radius * (0.5 + progress * 1.2);
    const alpha = 1 - progress;

    // Outer orange glow
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(255, 140, 0, ${alpha * 0.4})`;
    ctx.fill();

    // Inner yellow-white core
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, radius * 0.5, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(255, 255, 100, ${alpha * 0.8})`;
    ctx.fill();

    // Red ring
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, radius * 0.75, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(255, 50, 0, ${alpha * 0.6})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

/**
 * Checks if the player tank picks up any power-ups.
 * @param {object} state
 */
export function checkPowerupPickups(state) {
  if (!state.playerTank) return;
  const player = state.playerTank;

  state.powerups = state.powerups.filter(pu => {
    // Check if player overlaps the power-up
    const dx = player.x - pu.x;
    const dy = player.y - pu.y;
    const dist = Math.hypot(dx, dy);
    if (dist < player.width / 2 + pu.radius) {
      // Apply power-up effect
      playPowerupSound();
      if (pu.type === 'health') {
        player.health = Math.min(player.maxHealth, player.health + Math.round(player.maxHealth * 0.2));
      } else if (pu.type === 'powergun') {
        player.powerGunTimer = 10; // 10 seconds
      } else if (pu.type === 'airstrike') {
        state.hasAirstrike = true;
      } else if (pu.type === 'doubleshot') {
        player.doubleShotTimer = player.dualGun ? 5 : 10; // 5s for heavy, 10s for standard
      } else if (pu.type === 'speedboost') {
        player.speedBoostTimer = 10; // 10 seconds
      } else if (pu.type === 'shield') {
        player.shieldTimer = 10; // 10 seconds
        player.shieldHits = 5;   // absorbs 5 hits
      }
      return false; // remove from map
    }
    return true; // keep on map
  });
}

/**
 * Updates power-up timers and removes expired ones.
 * @param {object} state
 * @param {number} delta
 */
export function updatePowerupTimers(state, delta) {
  state.powerups = state.powerups.filter(pu => {
    pu.timer -= delta;
    return pu.timer > 0;
  });
}

/**
 * Triggers an airstrike: a plane flies across and destroys all enemies.
 * @param {object} state
 */
export function triggerAirstrike(state) {
  if (!state.hasAirstrike) return;
  state.hasAirstrike = false;
  // Start airstrike animation
  state.airstrike = {
    x: -60,
    y: 200 + Math.random() * 400, // random altitude
    speed: 800, // px/s
    timer: 0,
    triggered: false,
  };
}

/**
 * Updates the airstrike animation.
 * @param {object} state
 * @param {number} delta
 */
export function updateAirstrike(state, delta) {
  if (!state.airstrike) return;
  const as = state.airstrike;
  as.x += as.speed * delta;

  // When plane reaches center of map, destroy all enemies
  if (!as.triggered && as.x >= 600) {
    as.triggered = true;
    // Kill all enemies with explosions
    for (const enemy of state.enemyTanks) {
      state.explosions.push({
        x: enemy.x,
        y: enemy.y,
        timer: 0.6,
        maxTimer: 0.6,
        radius: enemy.width,
      });
      state.score += enemy.scoreValue || 100;
    }
    state.enemyTanks = [];
  }

  // Remove airstrike when plane exits map
  if (as.x > 1300) {
    state.airstrike = null;
  }
}

/**
 * Renders the airstrike plane.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} airstrike
 */
export function renderAirstrike(ctx, airstrike) {
  if (!airstrike) return;
  const x = airstrike.x;
  const y = airstrike.y;

  ctx.save();
  ctx.translate(x, y);

  // Plane body
  ctx.fillStyle = '#556677';
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 8, 0, 0, 2 * Math.PI);
  ctx.fill();

  // Wings
  ctx.fillStyle = '#445566';
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(-15, -20);
  ctx.lineTo(10, -20);
  ctx.lineTo(5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(-15, 20);
  ctx.lineTo(10, 20);
  ctx.lineTo(5, 0);
  ctx.closePath();
  ctx.fill();

  // Tail
  ctx.fillStyle = '#445566';
  ctx.beginPath();
  ctx.moveTo(-25, 0);
  ctx.lineTo(-35, -10);
  ctx.lineTo(-30, 0);
  ctx.closePath();
  ctx.fill();

  // Nose
  ctx.fillStyle = '#778899';
  ctx.beginPath();
  ctx.moveTo(30, 0);
  ctx.lineTo(25, -4);
  ctx.lineTo(25, 4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  // Shadow on ground
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y + 60, 25, 6, 0, 0, 2 * Math.PI);
  ctx.fill();
}

/**
 * Renders all power-ups on the map.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} powerups
 */
export function renderPowerups(ctx, powerups) {
  for (const pu of powerups) {
    // Blinking: after 7 seconds (timer < 3), blink by skipping render on alternate frames
    if (pu.timer < 3) {
      const blinkRate = Math.floor(pu.timer * 6); // faster blink as time runs out
      if (blinkRate % 2 === 0) continue; // skip rendering (blink off)
    }

    ctx.save();
    ctx.translate(pu.x, pu.y);

    if (pu.type === 'health') {
      // White circle background
      ctx.beginPath();
      ctx.arc(0, 0, pu.radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#cc0000';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Red cross
      ctx.fillStyle = '#cc0000';
      ctx.fillRect(-3, -9, 6, 18);
      ctx.fillRect(-9, -3, 18, 6);
    } else if (pu.type === 'powergun') {
      // Orange circle background
      ctx.beginPath();
      ctx.arc(0, 0, pu.radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#332200';
      ctx.fill();
      ctx.strokeStyle = '#ff8800';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Bullet icon
      ctx.fillStyle = '#ff8800';
      ctx.fillRect(-3, -8, 6, 12);
      ctx.beginPath();
      ctx.arc(0, -8, 3, 0, Math.PI, true);
      ctx.fill();
    } else if (pu.type === 'airstrike') {
      // Blue circle background with plane icon
      ctx.beginPath();
      ctx.arc(0, 0, pu.radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#112244';
      ctx.fill();
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Small plane icon
      ctx.fillStyle = '#4488ff';
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-6, -4);
      ctx.lineTo(-6, 4);
      ctx.closePath();
      ctx.fill();
      // Wings
      ctx.fillRect(-4, -8, 6, 2);
      ctx.fillRect(-4, 6, 6, 2);
    } else if (pu.type === 'doubleshot') {
      // Green circle with two dots
      ctx.beginPath();
      ctx.arc(0, 0, pu.radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#113311';
      ctx.fill();
      ctx.strokeStyle = '#44cc44';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Two dots (bullets in a line)
      ctx.fillStyle = '#44cc44';
      ctx.beginPath();
      ctx.arc(-4, 0, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(5, 0, 3, 0, 2 * Math.PI);
      ctx.fill();
    } else if (pu.type === 'speedboost') {
      // Yellow circle with lightning zap
      ctx.beginPath();
      ctx.arc(0, 0, pu.radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#332200';
      ctx.fill();
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Lightning bolt
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.moveTo(2, -9);
      ctx.lineTo(-4, -1);
      ctx.lineTo(0, -1);
      ctx.lineTo(-2, 9);
      ctx.lineTo(4, 1);
      ctx.lineTo(0, 1);
      ctx.closePath();
      ctx.fill();
    } else if (pu.type === 'shield') {
      // Cyan circle with shield icon
      ctx.beginPath();
      ctx.arc(0, 0, pu.radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#002233';
      ctx.fill();
      ctx.strokeStyle = '#00ccff';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Shield shape (rounded triangle/badge)
      ctx.fillStyle = '#00ccff';
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(-7, -3);
      ctx.lineTo(-5, 6);
      ctx.lineTo(0, 9);
      ctx.lineTo(5, 6);
      ctx.lineTo(7, -3);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

/**
 * Draws the HUD overlay (score, health bar, numeric health).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 */
export function renderHUD(ctx, state) {
  if (!state.playerTank) return;
  const tank = state.playerTank;

  // Save current transform (map-space) and reset to screen space
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // --- Score (top-left) ---
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(10, 10, 160, 36);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Score: ${state.score}`, 20, 28);

  // --- Health bar (top-right area, or bottom-left) ---
  const barX = 10;
  const barY = 54;
  const barW = 200;
  const barH = 18;
  const ratio = computeHealthBarRatio(tank.health, tank.maxHealth);

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(barX - 2, barY - 2, barW + 4 + 70, barH + 4);

  // Bar background (dark red)
  ctx.fillStyle = '#550000';
  ctx.fillRect(barX, barY, barW, barH);

  // Bar fill — green normally, red when health < 25%
  ctx.fillStyle = ratio < 0.25 ? '#ff2222' : '#44cc44';
  ctx.fillRect(barX, barY, Math.round(barW * ratio), barH);

  // Bar border
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  // Numeric health label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`HP: ${tank.health}`, barX + barW + 8, barY + barH / 2);

  // --- Power-up timers ---
  let nextTimerY = barY + barH + 12;

  if (tank.powerGunTimer > 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX - 2, nextTimerY - 2, 180, 22);
    ctx.fillStyle = '#ff8800';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`⚡ POWER GUN: ${Math.ceil(tank.powerGunTimer)}s`, barX + 4, nextTimerY + 9);
    nextTimerY += 26;
  }

  if (tank.doubleShotTimer > 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX - 2, nextTimerY - 2, 180, 22);
    ctx.fillStyle = '#44cc44';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`●● DOUBLE: ${Math.ceil(tank.doubleShotTimer)}s`, barX + 4, nextTimerY + 9);
    nextTimerY += 26;
  }

  if (tank.speedBoostTimer > 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX - 2, nextTimerY - 2, 180, 22);
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`⚡ SPEED: ${Math.ceil(tank.speedBoostTimer)}s`, barX + 4, nextTimerY + 9);
    nextTimerY += 26;
  }

  if (tank.shieldTimer > 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX - 2, nextTimerY - 2, 180, 22);
    ctx.fillStyle = '#00ccff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`🛡 SHIELD: ${Math.ceil(tank.shieldTimer)}s (${tank.shieldHits} hits)`, barX + 4, nextTimerY + 9);
    nextTimerY += 26;
  }

  // --- Airstrike indicator (if available) ---
  if (state.hasAirstrike) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX - 2, nextTimerY - 2, 180, 22);
    ctx.fillStyle = '#4488ff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('✈ AIRSTRIKE [H]', barX + 4, nextTimerY + 9);
  }

  // --- Back to menu hint (top-right) ---
  const canvasW = ctx.canvas.width;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(canvasW - 130, 10, 120, 24);
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('Q — Menu', canvasW - 18, 22);

  ctx.restore();
}

/**
 * Computes the health bar fill ratio.
 * @param {number} health
 * @param {number} maxHealth
 * @returns {number}
 */
export function computeHealthBarRatio(health, maxHealth) {
  return health / maxHealth;
}

/**
/**
 * Draws the instructions/objective page.
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderInstructions(ctx) {
  const mapW = 1200;
  const mapH = 800;

  // Dark background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillRect(0, 0, mapW, mapH);

  // Title
  ctx.fillStyle = '#ffdd00';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TANK BATTLE', mapW / 2, 80);

  // Mission objective
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('MISSION OBJECTIVE', mapW / 2, 160);

  ctx.font = '22px sans-serif';
  ctx.fillStyle = '#cccccc';
  const objectives = [
    'Destroy all enemy factories to win!',
    'Factories spawn enemy tanks — take them out to stop reinforcements.',
    'Collect power-ups dropped by destroyed enemies.',
    'Watch out for missile launchers and heavy tanks!',
  ];
  objectives.forEach((line, i) => {
    ctx.fillText(line, mapW / 2, 210 + i * 34);
  });

  // Controls
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('CONTROLS', mapW / 2, 380);

  ctx.font = '20px monospace';
  ctx.fillStyle = '#aaaaaa';
  const controls = [
    'W / S         — Move forward / backward',
    'A / D         — Rotate tank (gun follows)',
    '← / →         — Aim gun independently',
    'SPACE         — Fire',
    'H             — Call airstrike (when available)',
    'Q             — Back to menu',
  ];
  controls.forEach((line, i) => {
    ctx.fillText(line, mapW / 2, 420 + i * 30);
  });

  // Power-ups legend
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('POWER-UPS', mapW / 2, 600);

  ctx.font = '18px monospace';
  ctx.fillStyle = '#aaaaaa';
  const powerups = [
    '❤ Health (+20%)    ⚡ Power Gun (1-shot kill)    ✈ Airstrike',
    '●● Double Shot     ⚡ Speed Boost (1.25×)',
  ];
  powerups.forEach((line, i) => {
    ctx.fillText(line, mapW / 2, 636 + i * 28);
  });

  // Press Enter prompt
  ctx.fillStyle = '#44ff44';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('Press ENTER to continue', mapW / 2, 740);
}

/**
 * Draws the start screen overlay with title and control instructions.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 */
export function renderStartScreen(ctx, canvas) {
  const mapW = 1200;
  const mapH = 800;

  // Semi-transparent dark overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(0, 0, mapW, mapH);

  // Title
  ctx.fillStyle = '#ffdd00';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TANK BATTLE', mapW / 2, mapH / 2 - 120);

  // Difficulty selection
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Select Difficulty (0/1/2/3):', mapW / 2, mapH / 2 - 30);

  // Get current difficulty from state (accessed via closure)
  const diff = state.difficulty || 'hard';
  const options = [
    { key: '0', label: 'SUPER EASY', desc: 'Ally factory + 2 enemy', value: 'supereasy' },
    { key: '1', label: 'EASY', desc: '2 factories, 8s spawn', value: 'easy' },
    { key: '2', label: 'HARD', desc: '3 factories, 6s spawn', value: 'hard' },
    { key: '3', label: 'CRAZY', desc: '4 factories, 5s spawn', value: 'crazy' },
  ];
  ctx.font = '20px monospace';
  options.forEach((opt, i) => {
    const x = mapW / 2 - 280 + i * 180;
    const selected = diff === opt.value;
    ctx.fillStyle = selected ? '#ffdd00' : '#888888';
    ctx.fillText(`[${opt.key}] ${opt.label}`, x, mapH / 2 + 30);
    ctx.font = '14px monospace';
    ctx.fillStyle = selected ? '#ccaa00' : '#666666';
    ctx.fillText(opt.desc, x, mapH / 2 + 52);
    ctx.font = '20px monospace';
  });

  // Press Enter prompt
  ctx.fillStyle = '#44ff44';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('Press ENTER to Continue', mapW / 2, mapH / 2 + 140);
}

/**
 * Draws the tank selection screen.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 */
export function renderTankSelect(ctx, state) {
  const mapW = 1200;
  const mapH = 800;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillRect(0, 0, mapW, mapH);

  // Title
  ctx.fillStyle = '#ffdd00';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SELECT YOUR TANK', mapW / 2, 100);

  // Option 1: Normal tank
  const sel = state.playerTankType;
  const leftX = mapW / 2 - 200;
  const rightX = mapW / 2 + 200;

  // Normal tank box
  ctx.strokeStyle = sel === 'normal' ? '#44ff44' : '#555555';
  ctx.lineWidth = sel === 'normal' ? 3 : 1;
  ctx.strokeRect(leftX - 120, 180, 240, 380);
  ctx.fillStyle = sel === 'normal' ? 'rgba(68, 255, 68, 0.05)' : 'transparent';
  ctx.fillRect(leftX - 120, 180, 240, 380);

  ctx.fillStyle = sel === 'normal' ? '#44ff44' : '#aaaaaa';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('[1] STANDARD', leftX, 220);
  ctx.font = '18px monospace';
  ctx.fillStyle = '#cccccc';
  ctx.fillText('Speed: ██████████', leftX, 280);
  ctx.fillText('Fire Rate: ██████████', leftX, 310);
  ctx.fillText('Rotation: ██████████', leftX, 340);
  ctx.fillText('Guns: Single', leftX, 370);
  ctx.fillText('Size: Normal (40)', leftX, 400);
  ctx.fillStyle = '#888888';
  ctx.font = '14px monospace';
  ctx.fillText('150 px/s | 0.5s cd', leftX, 425);

  // Draw a mini tank preview
  ctx.save();
  ctx.translate(leftX, 480);
  ctx.fillStyle = '#44aa44';
  ctx.fillRect(-20, -20, 40, 40);
  ctx.fillStyle = '#222222';
  ctx.fillRect(0, -2, 26, 4);
  ctx.restore();

  // Heavy tank box
  ctx.strokeStyle = sel === 'heavy' ? '#44ff44' : '#555555';
  ctx.lineWidth = sel === 'heavy' ? 3 : 1;
  ctx.strokeRect(rightX - 120, 180, 240, 380);
  ctx.fillStyle = sel === 'heavy' ? 'rgba(68, 255, 68, 0.05)' : 'transparent';
  ctx.fillRect(rightX - 120, 180, 240, 380);

  ctx.fillStyle = sel === 'heavy' ? '#44ff44' : '#aaaaaa';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('[2] HEAVY', rightX, 220);
  ctx.font = '18px monospace';
  ctx.fillStyle = '#cccccc';
  ctx.fillText('Speed: █████░░░░░', rightX, 280);
  ctx.fillText('Fire Rate: █████████░', rightX, 310);
  ctx.fillText('Rotation: ██████░░░░', rightX, 340);
  ctx.fillText('Guns: Dual', rightX, 370);
  ctx.fillText('Size: Large', rightX, 400);

  // Draw a mini heavy tank preview
  ctx.save();
  ctx.translate(rightX, 480);
  ctx.fillStyle = '#44aa44';
  ctx.fillRect(-22, -22, 44, 44);
  ctx.fillStyle = '#222222';
  ctx.fillRect(0, -8, 28, 4);
  ctx.fillRect(0, 4, 28, 4);
  ctx.restore();

  // Health note
  ctx.fillStyle = '#ff8888';
  ctx.font = '20px sans-serif';
  ctx.fillText('Both tanks have 100 HP', mapW / 2, 620);

  // Enter prompt
  ctx.fillStyle = '#44ff44';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('Press ENTER to Deploy', mapW / 2, 700);
}

/**
 * Draws the game-over screen overlay with final score and restart prompt.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 * @param {HTMLCanvasElement} canvas
 */
export function renderGameOver(ctx, state, canvas) {
  const mapW = 1200;
  const mapH = 800;

  // Semi-transparent dark overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(0, 0, mapW, mapH);

  // GAME OVER title
  ctx.fillStyle = '#ff4444';
  ctx.font = 'bold 80px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GAME OVER', mapW / 2, mapH / 2 - 80);

  // Final score
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText(`Final Score: ${state.score}`, mapW / 2, mapH / 2 + 10);

  // Restart prompt
  ctx.fillStyle = '#44ff44';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('Press R to Restart', mapW / 2, mapH / 2 + 70);

  // Difficulty re-selection
  ctx.fillStyle = '#ffffff';
  ctx.font = '18px sans-serif';
  ctx.fillText('[0] Super Easy  [1] Easy  [2] Hard  [3] Crazy', mapW / 2, mapH / 2 + 120);
  ctx.fillStyle = '#ffdd00';
  ctx.font = '18px monospace';
  const diffLabel = state.difficulty === 'supereasy' ? 'SUPER EASY' : state.difficulty === 'easy' ? 'EASY' : state.difficulty === 'crazy' ? 'CRAZY' : 'HARD';
  ctx.fillText(`Current: ${diffLabel}`, mapW / 2, mapH / 2 + 150);
}

/**
 * Draws the victory screen overlay.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 * @param {HTMLCanvasElement} canvas
 */
export function renderVictory(ctx, state, canvas) {
  const mapW = 1200;
  const mapH = 800;

  // Semi-transparent dark overlay with green tint
  ctx.fillStyle = 'rgba(0, 30, 0, 0.8)';
  ctx.fillRect(0, 0, mapW, mapH);

  // Victory title
  ctx.fillStyle = '#44ff44';
  ctx.font = 'bold 80px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VICTORY!', mapW / 2, mapH / 2 - 100);

  // Subtitle
  ctx.fillStyle = '#ffffff';
  ctx.font = '32px sans-serif';
  ctx.fillText('All enemy factories destroyed!', mapW / 2, mapH / 2 - 30);

  // Final score
  ctx.fillStyle = '#ffdd00';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(`Score: ${state.score}`, mapW / 2, mapH / 2 + 40);

  // Restart prompt
  ctx.fillStyle = '#44ff44';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('Press R to Play Again', mapW / 2, mapH / 2 + 110);

  // Difficulty re-selection
  ctx.fillStyle = '#ffffff';
  ctx.font = '18px sans-serif';
  ctx.fillText('[0] Super Easy  [1] Easy  [2] Hard  [3] Crazy', mapW / 2, mapH / 2 + 155);
  ctx.fillStyle = '#ffdd00';
  ctx.font = '18px monospace';
  const diffLabel = state.difficulty === 'supereasy' ? 'SUPER EASY' : state.difficulty === 'easy' ? 'EASY' : state.difficulty === 'crazy' ? 'CRAZY' : 'HARD';
  ctx.fillText(`Current: ${diffLabel}`, mapW / 2, mapH / 2 + 180);
}

// ---------------------------------------------------------------------------
// Phase-transition helpers
// ---------------------------------------------------------------------------

/**
 * Transitions from start screen to playing phase.
 * Idempotent: no-op if already past 'start'.
 * @param {object} state
 */
export function startGame(state) {
  if (state.phase !== 'start') return;
  state.phase = 'tankselect';
}

/**
 * Actually begins gameplay after tank selection.
 * @param {object} state
 */
export function beginPlaying(state) {
  if (state.phase !== 'tankselect') return;
  playStartJingle();
  state.phase = 'playing';
  state.map = createMapData(state.difficulty);
  // Create player tank based on selection
  if (state.playerTankType === 'heavy') {
    state.playerTank = createPlayerTankHeavy();
  } else {
    state.playerTank = createPlayerTank();
  }
  state.enemyTanks = [];
  state.projectiles = [];
  state.powerups = [];
  state.explosions = [];
  state.missiles = [];
  state.allyTanks = [];
  state.allySpawnTimer = 7;
  state.hasAirstrike = false;
  state.airstrike = null;
  state.score = 0;
  state.spawnTimer = 5;
  state.spawnRetryTimers = state.map.spawnPoints.map(() => 0);
}

/**
 * Transitions from playing to game-over phase.
 * Idempotent: no-op if not currently 'playing'.
 * @param {object} state
 */
export function triggerGameOver(state) {
  if (state.phase !== 'playing') return;
  state.phase = 'gameover';
}

/**
 * Resets all game state and restarts the game loop from the initial state.
 * Transitions directly to 'playing' regardless of current phase.
 * @param {object} state
 */
export function restartGame(state) {
  playStartJingle();
  state.phase = 'playing';
  state.map = createMapData(state.difficulty);
  if (state.playerTankType === 'heavy') {
    state.playerTank = createPlayerTankHeavy();
  } else {
    state.playerTank = createPlayerTank();
  }
  state.enemyTanks = [];
  state.projectiles = [];
  state.powerups = [];
  state.explosions = [];
  state.missiles = [];
  state.allyTanks = [];
  state.allySpawnTimer = 7;
  state.hasAirstrike = false;
  state.airstrike = null;
  state.score = 0;
  state.spawnTimer = 5;
  state.spawnRetryTimers = state.map.spawnPoints.map(() => 0);
}

// ---------------------------------------------------------------------------
// Audio — procedural chiptune using Web Audio API
// ---------------------------------------------------------------------------

let audioCtx = null;

/**
 * Plays a retro 8-bit military march jingle (~4.5 seconds).
 * Uses square wave oscillators for that classic NES feel.
 */
export function playStartJingle() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = audioCtx;
  const now = ctx.currentTime;

  // Master gain
  const master = ctx.createGain();
  master.gain.value = 0.15;
  master.connect(ctx.destination);

  // Note frequencies (C4=262, D4=294, E4=330, F4=349, G4=392, A4=440, B4=494, C5=523)
  const notes = [
    // Military march melody (square wave)
    { freq: 392, start: 0.0, dur: 0.15 },   // G4
    { freq: 392, start: 0.18, dur: 0.15 },  // G4
    { freq: 392, start: 0.36, dur: 0.15 },  // G4
    { freq: 330, start: 0.54, dur: 0.3 },   // E4
    { freq: 392, start: 0.9, dur: 0.15 },   // G4
    { freq: 494, start: 1.08, dur: 0.3 },   // B4
    { freq: 392, start: 1.44, dur: 0.4 },   // G4
    // Second phrase
    { freq: 523, start: 2.0, dur: 0.15 },   // C5
    { freq: 523, start: 2.18, dur: 0.15 },  // C5
    { freq: 523, start: 2.36, dur: 0.15 },  // C5
    { freq: 440, start: 2.54, dur: 0.3 },   // A4
    { freq: 523, start: 2.9, dur: 0.15 },   // C5
    { freq: 587, start: 3.08, dur: 0.3 },   // D5
    { freq: 523, start: 3.44, dur: 0.5 },   // C5
    // Final note
    { freq: 392, start: 4.0, dur: 0.5 },    // G4
  ];

  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = note.freq;
    gain.gain.setValueAtTime(0.3, now + note.start);
    gain.gain.exponentialRampToValueAtTime(0.01, now + note.start + note.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + note.start);
    osc.stop(now + note.start + note.dur + 0.05);
  }

  // Bass line (triangle wave, lower octave)
  const bassNotes = [
    { freq: 196, start: 0.0, dur: 0.4 },    // G3
    { freq: 165, start: 0.54, dur: 0.4 },   // E3
    { freq: 196, start: 1.08, dur: 0.4 },   // G3
    { freq: 262, start: 2.0, dur: 0.4 },    // C4
    { freq: 220, start: 2.54, dur: 0.4 },   // A3
    { freq: 294, start: 3.08, dur: 0.4 },   // D4
    { freq: 262, start: 3.44, dur: 0.5 },   // C4
    { freq: 196, start: 4.0, dur: 0.5 },    // G3
  ];

  for (const note of bassNotes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = note.freq;
    gain.gain.setValueAtTime(0.2, now + note.start);
    gain.gain.exponentialRampToValueAtTime(0.01, now + note.start + note.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + note.start);
    osc.stop(now + note.start + note.dur + 0.05);
  }

  // Drum hits (noise bursts via oscillator detuning)
  const drumHits = [0.0, 0.36, 0.9, 1.44, 2.0, 2.36, 2.9, 3.44, 4.0];
  for (const t of drumHits) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 80;
    gain.gain.setValueAtTime(0.15, now + t);
    gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.08);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + t);
    osc.stop(now + t + 0.1);
  }
}

/**
 * Plays a short shooting sound effect.
 */
export function playShotSound() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const ctx = audioCtx;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

/**
 * Plays a short explosion sound effect.
 */
export function playExplosionSound() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const ctx = audioCtx;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(30, now + 0.3);
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.35);
}

/**
 * Plays a power-up pickup sound.
 */
export function playPowerupSound() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const ctx = audioCtx;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.22);
}

// ---------------------------------------------------------------------------
// Main game loop
// ---------------------------------------------------------------------------

const canvas = document.getElementById('gameCanvas');
const errorMsg = document.getElementById('error-msg');

// Verify canvas 2D context is available; halt with error message if not.
const ctx = canvas.getContext('2d');
if (!ctx) {
  canvas.style.display = 'none';
  errorMsg.style.display = 'block';
  throw new Error('canvas.getContext("2d") returned null — 2D canvas is not supported in this browser.');
}

/** @type {object} Central game state */
let state = createGameState();

/** @type {InputHandler} */
const input = new InputHandler();
input.attach();

// Back button — clickable HTML button to go to previous screen
const backBtn = document.getElementById('back-btn');
if (backBtn) {
  backBtn.addEventListener('click', () => {
    if (state.phase !== 'instructions') {
      state.phase = 'instructions';
    }
  });
  // Show/hide based on phase
  setInterval(() => {
    backBtn.style.display = state.phase === 'instructions' ? 'none' : 'block';
  }, 100);
}

/** @type {number|null} Timestamp of the previous frame (ms) */
let lastTimestamp = null;

/** Maximum delta time cap to prevent large jumps after tab switches (ms). */
const MAX_DELTA_MS = 100;

/**
 * Main requestAnimationFrame loop.
 * @param {number} timestamp  DOMHighResTimeStamp provided by the browser
 */
function gameLoop(timestamp) {
  // Calculate delta time in seconds, capped at MAX_DELTA_MS.
  if (lastTimestamp === null) lastTimestamp = timestamp;
  const rawDelta = timestamp - lastTimestamp;
  const delta = Math.min(rawDelta, MAX_DELTA_MS) / 1000;
  lastTimestamp = timestamp;

  // Compute viewport scale to fit the logical map inside the browser window.
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const mapW = state.map ? state.map.width : 1200;
  const mapH = state.map ? state.map.height : 800;
  const scale = Math.min(viewportW / mapW, viewportH / mapH);

  // Resize the canvas element to match the scaled dimensions.
  canvas.width = Math.floor(mapW * scale);
  canvas.height = Math.floor(mapH * scale);

  // Apply the scale transform so all drawing uses logical (map) coordinates.
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // Clear the canvas.
  ctx.clearRect(0, 0, mapW, mapH);

  // Q key — back to main menu from any screen (except instructions itself)
  if ((input.isDown('q') || input.isDown('Q')) && state.phase !== 'instructions') {
    state.phase = 'instructions';
    input.keys.delete('q');
    input.keys.delete('Q');
  }

  // Dispatch update and render based on current game phase.
  switch (state.phase) {
    case 'instructions':
      if (input.isDown('Enter')) {
        state.phase = 'start';
        input.keys.delete('Enter'); // prevent immediate start
      }
      renderInstructions(ctx);
      break;

    case 'start':
      updateStartScreen(state, input);
      renderStartScreen(ctx, canvas);
      break;

    case 'tankselect':
      if (input.isDown('1')) state.playerTankType = 'normal';
      if (input.isDown('2')) state.playerTankType = 'heavy';
      // Wait for Enter to be released first (from previous screen), then accept it
      if (!state._tankSelectReady) {
        if (!input.isDown('Enter')) state._tankSelectReady = true;
      } else if (input.isDown('Enter')) {
        state._tankSelectReady = false;
        beginPlaying(state);
      }
      renderTankSelect(ctx, state);
      break;

    case 'playing':
      updatePlayer(state, input, delta);
      updateEnemies(state, delta);
      updateSpawns(state, delta);
      updateProjectiles(state, delta);
      updateMissiles(state, delta);
      updateAllySpawns(state, delta);
      updateAllyTanks(state, delta);
      resolveCollisions(state);
      checkPowerupPickups(state);
      updatePowerupTimers(state, delta);
      updateExplosions(state, delta);
      updateAirstrike(state, delta);

      // Check victory: all factories destroyed and no enemies left
      if (state.map) {
        const allFactoriesDestroyed = state.map.spawnPoints.every(sp => sp.health <= 0);
        if (allFactoriesDestroyed && state.enemyTanks.length === 0 && state.missiles.length === 0) {
          state.phase = 'victory';
        }
      }

      if (state.map) renderMap(ctx, state.map);
      state.enemyTanks.forEach(enemy => renderTank(ctx, enemy));
      state.allyTanks.forEach(ally => renderTank(ctx, ally));
      if (state.playerTank) renderTank(ctx, state.playerTank);
      renderProjectiles(ctx, state.projectiles);
      renderMissiles(ctx, state.missiles);
      renderPowerups(ctx, state.powerups);
      renderExplosions(ctx, state.explosions);
      renderAirstrike(ctx, state.airstrike);
      renderHUD(ctx, state);
      break;

    case 'gameover':
      updateGameOver(state, input);
      renderGameOver(ctx, state, canvas);
      break;

    case 'victory':
      updateGameOver(state, input); // same controls: 1/2/3 + R
      renderVictory(ctx, state, canvas);
      break;
  }

  requestAnimationFrame(gameLoop);
}

// Kick off the game loop.
requestAnimationFrame(gameLoop);
