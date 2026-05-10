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
      const gameKeys = ['w', 'a', 's', 'd', 'ArrowLeft', 'ArrowRight', ' '];
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
    /** @type {'start'|'playing'|'gameover'} */
    phase: 'start',
    score: 0,
    playerTank: null,
    enemyTanks: [],
    projectiles: [],
    map: null,
    /** Seconds until next enemy spawn attempt. */
    spawnTimer: 5,
    /** Per-spawn-point retry countdowns (one entry per spawn point). */
    spawnRetryTimers: [0, 0, 0],
  };
}

// ---------------------------------------------------------------------------
// Map data
// ---------------------------------------------------------------------------

/**
 * Returns the fixed MapData object describing the 1200×800 map.
 * @returns {object}
 */
export function createMapData() {
  return {
    width: 1200,
    height: 800,
    rivers: [
      { x: 300, y: 150, width: 80, height: 300 },
      { x: 820, y: 350, width: 80, height: 300 },
    ],
    rocks: [
      { x: 500, y: 100, width: 80, height: 80 },
      { x: 620, y: 550, width: 80, height: 80 },
      { x: 200, y: 500, width: 100, height: 60 },
      { x: 900, y: 200, width: 100, height: 60 },
    ],
    spawnPoints: [
      { x: 60,   y: 60  },   // top-left
      { x: 1140, y: 60  },   // top-right
      { x: 600,  y: 740 },   // bottom-center
    ],
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
  return {
    id: `proj_${Date.now()}_${Math.random()}`,
    x: tank.x + Math.cos(tank.turretAngle) * (tank.height / 2 + 8),
    y: tank.y + Math.sin(tank.turretAngle) * (tank.height / 2 + 8),
    angle: tank.turretAngle,
    speed: 400,
    ownerId: tank.id,
    isPlayerProjectile: tank.isPlayer,
    damage: tank.isPlayer ? 50 : 20,
    radius: 4,
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
  const projectile = createProjectile(tank);
  state.projectiles.push(projectile);
  tank.fireCooldown = tank.fireRate;
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

  // Body movement
  if (input.isDown('w') || input.isDown('W')) {
    tank.x += Math.cos(tank.bodyAngle) * tank.speed * delta;
    tank.y += Math.sin(tank.bodyAngle) * tank.speed * delta;
  }
  if (input.isDown('s') || input.isDown('S')) {
    tank.x -= Math.cos(tank.bodyAngle) * tank.reverseSpeed * delta;
    tank.y -= Math.sin(tank.bodyAngle) * tank.reverseSpeed * delta;
  }

  // Body rotation
  if (input.isDown('a') || input.isDown('A')) {
    tank.bodyAngle -= tank.rotationRate * delta;
  }
  if (input.isDown('d') || input.isDown('D')) {
    tank.bodyAngle += tank.rotationRate * delta;
  }

  // Turret rotation
  if (input.isDown('ArrowLeft')) {
    tank.turretAngle -= tank.turretRotationRate * delta;
  }
  if (input.isDown('ArrowRight')) {
    tank.turretAngle += tank.turretRotationRate * delta;
  }

  // Normalize angles to [0, 2π)
  const TWO_PI = 2 * Math.PI;
  tank.bodyAngle   = ((tank.bodyAngle   % TWO_PI) + TWO_PI) % TWO_PI;
  tank.turretAngle = ((tank.turretAngle % TWO_PI) + TWO_PI) % TWO_PI;

  // Fire
  if (input.isDown(' ')) {
    fireProjectile(state, tank);
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
    // Decrement fire cooldown, clamp to 0
    enemy.fireCooldown = Math.max(0, enemy.fireCooldown - delta);

    // Angle from enemy to player
    const angleToPlayer = Math.atan2(player.y - enemy.y, player.x - enemy.x);

    // Rotate body toward player
    enemy.bodyAngle = rotateToward(enemy.bodyAngle, angleToPlayer, enemy.rotationRate * delta);

    // Move forward in body direction
    enemy.x += Math.cos(enemy.bodyAngle) * enemy.speed * delta;
    enemy.y += Math.sin(enemy.bodyAngle) * enemy.speed * delta;

    // Distance to player
    const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);

    // Rotate turret toward player when within 300px
    if (dist <= 300) {
      enemy.turretAngle = rotateToward(enemy.turretAngle, angleToPlayer, enemy.turretRotationRate * delta);
    }

    // Fire if aimed within 10° and cooldown expired
    const angleDiff = Math.abs(normalizeAngle(enemy.turretAngle - angleToPlayer));
    if (angleDiff <= 0.1745 && enemy.fireCooldown === 0) {
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
    if (state.spawnRetryTimers[i] > 0) {
      state.spawnRetryTimers[i] -= delta;
      if (state.spawnRetryTimers[i] <= 0) {
        state.spawnRetryTimers[i] = 0;
        // Retry spawn at this point if cap not reached and point not occupied
        if (state.enemyTanks.length < 10) {
          const sp = state.map.spawnPoints[i];
          const occupied = state.enemyTanks.some(
            e => Math.hypot(e.x - sp.x, e.y - sp.y) < 40
          );
          if (!occupied) {
            state.enemyTanks.push(createEnemyTank(sp, i));
          }
        }
      }
    }
  }

  // Enforce enemy cap
  if (state.enemyTanks.length >= 10) return;

  // Decrement main spawn timer
  state.spawnTimer -= delta;
  if (state.spawnTimer > 0) return;

  // Reset spawn timer
  state.spawnTimer = 5;

  // Find spawn point with fewest active enemies
  const counts = state.map.spawnPoints.map((_, i) =>
    state.enemyTanks.filter(e => e.spawnPointIndex === i).length
  );
  let selectedIndex = 0;
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] < counts[selectedIndex]) selectedIndex = i;
  }

  // Check if selected spawn point is occupied
  const sp = state.map.spawnPoints[selectedIndex];
  const occupied = state.enemyTanks.some(
    e => Math.hypot(e.x - sp.x, e.y - sp.y) < 40
  );
  if (occupied) {
    state.spawnRetryTimers[selectedIndex] = 1;
    return;
  }

  // Spawn new enemy
  state.enemyTanks.push(createEnemyTank(sp, selectedIndex));
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
 * Handles start-screen input: transitions to 'playing' when Enter is pressed.
 * Full implementation in Task 12.
 * @param {object} state
 * @param {InputHandler} input
 */
export function updateStartScreen(state, input) {
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

  // --- 2. Push tanks out of Rivers and Rocks ---
  const allTanks = player ? [player, ...state.enemyTanks] : [...state.enemyTanks];
  for (const tank of allTanks) {
    for (const river of map.rivers) pushTankOutOfRect(tank, river);
    for (const rock of map.rocks)   pushTankOutOfRect(tank, rock);
  }

  // --- 3. Resolve tank ↔ tank collisions ---
  if (player) {
    for (const enemy of state.enemyTanks) {
      resolveTankTankCollision(player, enemy);
    }
  }
  // Enemy ↔ enemy (prevents stacking)
  for (let i = 0; i < state.enemyTanks.length; i++) {
    for (let j = i + 1; j < state.enemyTanks.length; j++) {
      resolveTankTankCollision(state.enemyTanks[i], state.enemyTanks[j]);
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
        player.health = Math.max(0, player.health - p.damage); // 20 damage, clamped
        toRemove.add(p.id);
        if (player.health <= 0) {
          triggerGameOver(state);
        }
      }
    }
  }

  // Remove all flagged projectiles
  state.projectiles = state.projectiles.filter(p => !toRemove.has(p.id));

  // Remove dead enemies and award score
  const deadEnemies = state.enemyTanks.filter(e => e.health <= 0);
  state.score += deadEnemies.length * 100;
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

  // Rocks: gray fill with darker border
  for (const rock of map.rocks) {
    ctx.fillStyle = '#888888';
    ctx.fillRect(rock.x, rock.y, rock.width, rock.height);
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 2;
    ctx.strokeRect(rock.x, rock.y, rock.width, rock.height);
  }

  // Spawn point markers: dashed red circle with semi-transparent fill and "S" label
  for (const sp of map.spawnPoints) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 12, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(255,68,68,0.2)';
    ctx.fill();
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff4444';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('S', sp.x, sp.y - 14);
    ctx.restore();
  }
}

/**
 * Draws a single tank (body + turret barrel) at its current position.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} tank
 */
export function renderTank(ctx, tank) {
  const bodyColor   = tank.isPlayer ? '#44aa44' : '#cc3333';
  const size        = tank.isPlayer ? 40 : 36;

  // --- Draw body ---
  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.rotate(tank.bodyAngle);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.restore();

  // --- Draw turret base circle ---
  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, 2 * Math.PI);
  ctx.fillStyle = bodyColor;
  ctx.fill();
  ctx.restore();

  // --- Draw turret barrel ---
  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.rotate(tank.turretAngle);
  ctx.fillStyle = '#333333';
  // Barrel: 4px wide × 20px long, starting from center
  ctx.fillRect(0, -2, 20, 4);
  ctx.restore();
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
    ctx.fillStyle = p.isPlayerProjectile ? '#ffdd00' : '#ff8800';
    ctx.fill();
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
  ctx.fillText('TANK BATTLE', mapW / 2, mapH / 2 - 140);

  // Subtitle
  ctx.fillStyle = '#ffffff';
  ctx.font = '28px sans-serif';
  ctx.fillText('Destroy all enemy tanks!', mapW / 2, mapH / 2 - 80);

  // Controls box
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.fillRect(mapW / 2 - 260, mapH / 2 - 50, 520, 200);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mapW / 2 - 260, mapH / 2 - 50, 520, 200);

  ctx.fillStyle = '#cccccc';
  ctx.font = '22px monospace';
  ctx.textAlign = 'center';
  const lines = [
    'W / S       — Move forward / backward',
    'A / D       — Rotate tank body',
    '← / →      — Rotate gun turret',
    'SPACE       — Fire',
  ];
  lines.forEach((line, i) => {
    ctx.fillText(line, mapW / 2, mapH / 2 - 10 + i * 36);
  });

  // Press Enter prompt (blinking effect via opacity based on time)
  ctx.fillStyle = '#44ff44';
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText('Press ENTER to Start', mapW / 2, mapH / 2 + 190);
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
  ctx.fillText('Press R to Restart', mapW / 2, mapH / 2 + 90);
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
  state.phase = 'playing';
  state.map = createMapData();
  state.playerTank = createPlayerTank();
  state.enemyTanks = [];
  state.projectiles = [];
  state.score = 0;
  state.spawnTimer = 5;
  state.spawnRetryTimers = [0, 0, 0];
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
  state.phase = 'playing';
  state.map = createMapData();
  state.playerTank = createPlayerTank();
  state.enemyTanks = [];
  state.projectiles = [];
  state.score = 0;
  state.spawnTimer = 5;
  state.spawnRetryTimers = [0, 0, 0];
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

  // Dispatch update and render based on current game phase.
  switch (state.phase) {
    case 'start':
      updateStartScreen(state, input);
      renderStartScreen(ctx, canvas);
      break;

    case 'playing':
      updatePlayer(state, input, delta);
      updateEnemies(state, delta);
      updateSpawns(state, delta);
      updateProjectiles(state, delta);
      resolveCollisions(state);

      if (state.map) renderMap(ctx, state.map);
      state.enemyTanks.forEach(enemy => renderTank(ctx, enemy));
      if (state.playerTank) renderTank(ctx, state.playerTank);
      renderProjectiles(ctx, state.projectiles);
      renderHUD(ctx, state);
      break;

    case 'gameover':
      updateGameOver(state, input);
      renderGameOver(ctx, state, canvas);
      break;
  }

  requestAnimationFrame(gameLoop);
}

// Kick off the game loop.
requestAnimationFrame(gameLoop);
