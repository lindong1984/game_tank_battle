/**
 * Tank Battle Game — Property-Based Test Suite
 *
 * Tests are registered via window.test() and window.property() provided by
 * tests/index.html. fast-check is available as the "fast-check" import map
 * entry defined in tests/index.html.
 *
 * Property tests use a minimum of 100 iterations per property.
 *
 * game.js runs a main game loop on import (calls document.getElementById and
 * requestAnimationFrame). We stub those DOM elements before the dynamic import
 * so the module loads without errors in the test environment.
 */

import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Stub DOM elements required by game.js main loop before importing the module.
// game.js calls document.getElementById('gameCanvas') at module evaluation time.
// ---------------------------------------------------------------------------

// Create a minimal stub canvas with a no-op getContext
const stubCanvas = document.createElement('canvas');
stubCanvas.id = 'gameCanvas';
stubCanvas.getContext = () => ({
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: '',
  textBaseline: '',
  fillRect: () => {},
  strokeRect: () => {},
  clearRect: () => {},
  beginPath: () => {},
  arc: () => {},
  fill: () => {},
  stroke: () => {},
  fillText: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  rotate: () => {},
  setTransform: () => {},
  setLineDash: () => {},
  moveTo: () => {},
  lineTo: () => {},
});
document.body.appendChild(stubCanvas);

// Stub error-msg element
const stubErrorMsg = document.createElement('div');
stubErrorMsg.id = 'error-msg';
document.body.appendChild(stubErrorMsg);

// Stub requestAnimationFrame to be a no-op (prevents the game loop from running)
if (!window._rafStubbed) {
  window._rafStubbed = true;
  const origRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => {
    // Only allow the very first call (game loop kickoff) to be a no-op
    return 0;
  };
}

// ---------------------------------------------------------------------------
// Dynamic import of game.js (after DOM stubs are in place)
// ---------------------------------------------------------------------------

const {
  clampTankToBounds,
  tankRect,
  rectsOverlap,
  pushTankOutOfRect,
  createMapData,
  createPlayerTank,
  createEnemyTank,
  resolveCollisions,
  computeHealthBarRatio,
  fireProjectile,
  updateSpawns,
  createGameState,
} = await import('../game.js');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal game state for collision tests.
 * @param {object} overrides
 * @returns {object}
 */
function makeState(overrides = {}) {
  const map = createMapData();
  const playerTank = createPlayerTank();
  return {
    phase: 'playing',
    score: 0,
    map,
    playerTank,
    enemyTanks: [],
    projectiles: [],
    spawnTimer: 5,
    spawnRetryTimers: [0, 0, 0],
    ...overrides,
  };
}

/**
 * Creates a projectile object directly (without firing through the normal path).
 * @param {number} x
 * @param {number} y
 * @param {boolean} isPlayer
 * @param {number} [damage]
 * @returns {object}
 */
function makeProjectile(x, y, isPlayer, damage) {
  return {
    id: `test_${Math.random()}`,
    x,
    y,
    angle: 0,
    speed: 400,
    ownerId: isPlayer ? 'player' : 'enemy_test',
    isPlayerProjectile: isPlayer,
    damage: damage ?? (isPlayer ? 50 : 20),
    radius: 4,
  };
}

// ---------------------------------------------------------------------------
// Property 1 — Tank boundary clamping
// Validates: Requirements 2.5, 5.5
// ---------------------------------------------------------------------------

await property('Property 1: tank bounding box contained within map', async () => {
  await fc.assert(
    fc.property(
      fc.float({ min: -500, max: 1700, noNaN: true }),
      fc.float({ min: -500, max: 1300, noNaN: true }),
      fc.integer({ min: 20, max: 50 }),
      (x, y, size) => {
        const map = createMapData();
        const tank = { x, y, width: size, height: size };
        clampTankToBounds(tank, map);
        const r = tankRect(tank);
        return (
          r.x >= 0 &&
          r.y >= 0 &&
          r.x + r.width <= map.width &&
          r.y + r.height <= map.height
        );
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 2 — Tank blocked by solid obstacles
// Validates: Requirements 2.7, 2.8, 5.6, 5.7, 11.2, 11.4
// ---------------------------------------------------------------------------

await property('Property 2: tank does not overlap solid obstacles after push', async () => {
  await fc.assert(
    fc.property(
      // Tank position anywhere on map
      fc.float({ min: 0, max: 1200, noNaN: true }),
      fc.float({ min: 0, max: 800, noNaN: true }),
      fc.integer({ min: 20, max: 50 }),
      // Obstacle rect (random position and size within map)
      fc.integer({ min: 0, max: 1100 }),
      fc.integer({ min: 0, max: 700 }),
      fc.integer({ min: 20, max: 100 }),
      fc.integer({ min: 20, max: 100 }),
      (tx, ty, tsize, rx, ry, rw, rh) => {
        const tank = { x: tx, y: ty, width: tsize, height: tsize };
        const obstacle = { x: rx, y: ry, width: rw, height: rh };
        pushTankOutOfRect(tank, obstacle);
        const tr = tankRect(tank);
        // After push, tank bounding box must not overlap the obstacle
        return !rectsOverlap(tr, obstacle);
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 3 — Projectile removed on boundary or Rock
// Validates: Requirements 3.5, 6.4, 6.6, 11.5
// ---------------------------------------------------------------------------

await property('Property 3: projectile removed on boundary or rock', async () => {
  const map = createMapData();

  // Generate positions that are either outside map bounds or inside a rock
  const outsideMapArb = fc.oneof(
    // Left of map
    fc.record({
      x: fc.float({ min: -100, max: -1, noNaN: true }),
      y: fc.float({ min: 0, max: 800, noNaN: true }),
    }),
    // Right of map
    fc.record({
      x: fc.float({ min: 1201, max: 1400, noNaN: true }),
      y: fc.float({ min: 0, max: 800, noNaN: true }),
    }),
    // Above map
    fc.record({
      x: fc.float({ min: 0, max: 1200, noNaN: true }),
      y: fc.float({ min: -100, max: -1, noNaN: true }),
    }),
    // Below map
    fc.record({
      x: fc.float({ min: 0, max: 1200, noNaN: true }),
      y: fc.float({ min: 801, max: 1000, noNaN: true }),
    })
  );

  // Generate positions inside one of the rocks
  const insideRockArb = fc.integer({ min: 0, max: map.rocks.length - 1 }).chain(rockIdx => {
    const rock = map.rocks[rockIdx];
    return fc.record({
      x: fc.float({ min: rock.x, max: rock.x + rock.width, noNaN: true }),
      y: fc.float({ min: rock.y, max: rock.y + rock.height, noNaN: true }),
    });
  });

  await fc.assert(
    fc.property(
      fc.oneof(outsideMapArb, insideRockArb),
      ({ x, y }) => {
        const proj = makeProjectile(x, y, true);
        const state = makeState({ projectiles: [proj] });
        resolveCollisions(state);
        // Projectile must be removed
        return !state.projectiles.some(p => p.id === proj.id);
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 4 — River does not remove projectiles
// Validates: Requirements 6.7, 11.3
// ---------------------------------------------------------------------------

await property('Property 4: river does not remove projectiles', async () => {
  const map = createMapData();

  await fc.assert(
    fc.property(
      // Pick a random river
      fc.integer({ min: 0, max: map.rivers.length - 1 }),
      // Position inside that river
      fc.float({ min: 0, max: 1, noNaN: true }),
      fc.float({ min: 0, max: 1, noNaN: true }),
      (riverIdx, fx, fy) => {
        const river = map.rivers[riverIdx];
        const x = river.x + fx * river.width;
        const y = river.y + fy * river.height;
        const proj = makeProjectile(x, y, true);
        const state = makeState({ projectiles: [proj] });
        resolveCollisions(state);
        // Projectile must still be present (rivers are pass-through)
        return state.projectiles.some(p => p.id === proj.id);
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 5 — Player projectile damages enemy by 50
// Validates: Requirements 6.2
// ---------------------------------------------------------------------------

await property('Property 5: player projectile reduces enemy health by 50', async () => {
  await fc.assert(
    fc.property(
      // Enemy position — use a safe open area away from rocks and rivers
      // Safe zone: center strip 400-800 x, 200-600 y (no rocks or rivers there)
      fc.integer({ min: 400, max: 800 }),
      fc.integer({ min: 200, max: 500 }),
      (ex, ey) => {
        const map = createMapData();
        const enemy = createEnemyTank({ x: ex, y: ey }, 0);
        enemy.x = ex;
        enemy.y = ey;
        const initialHealth = enemy.health; // 100

        // Pre-clamp the enemy so we know its final position before placing the projectile.
        // resolveCollisions will clamp/push tanks first, then check projectile hits.
        // We simulate that by clamping here and placing the projectile at the clamped position.
        clampTankToBounds(enemy, map);
        for (const rock of map.rocks) pushTankOutOfRect(enemy, rock);
        for (const river of map.rivers) pushTankOutOfRect(enemy, river);

        // Place player projectile at enemy center after clamping (guaranteed to intersect)
        const proj = makeProjectile(enemy.x, enemy.y, true, 50);

        const state = makeState({
          map,
          enemyTanks: [enemy],
          projectiles: [proj],
        });

        resolveCollisions(state);

        // Enemy health should be reduced by 50 (100 - 50 = 50 > 0, so enemy stays alive)
        const enemyAfter = state.enemyTanks.find(e => e.id === enemy.id);
        const projRemoved = !state.projectiles.some(p => p.id === proj.id);

        return (
          enemyAfter !== undefined &&
          enemyAfter.health === initialHealth - 50 &&
          projRemoved
        );
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 6 — Enemy projectile damages player by 20
// Validates: Requirements 6.3
// ---------------------------------------------------------------------------

await property('Property 6: enemy projectile reduces player health by 20', async () => {
  await fc.assert(
    fc.property(
      // Player health must be > 20 so player doesn't die (which triggers game-over)
      fc.integer({ min: 21, max: 100 }),
      (initialHealth) => {
        const player = createPlayerTank();
        player.health = initialHealth;

        // Place enemy projectile at player center (guaranteed to intersect)
        const proj = makeProjectile(player.x, player.y, false, 20);

        const state = makeState({
          playerTank: player,
          projectiles: [proj],
        });

        resolveCollisions(state);

        const projRemoved = !state.projectiles.some(p => p.id === proj.id);
        const expectedHealth = initialHealth - 20;

        return (
          state.playerTank.health === expectedHealth &&
          projRemoved
        );
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 7 — Score increases monotonically (N kills = N * 100)
// Validates: Requirements 7.1, 7.2
// ---------------------------------------------------------------------------

await property('Property 7: score equals 100 times kills and never decreases', async () => {
  await fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 10 }),
      (n) => {
        const map = createMapData();
        // Place N enemies at safe positions (away from rocks/rivers/edges)
        // Use a grid of positions in the open center of the map
        const enemies = [];
        for (let i = 0; i < n; i++) {
          const ex = 100 + (i % 5) * 80;
          const ey = 650 + Math.floor(i / 5) * 50;
          const enemy = createEnemyTank({ x: ex, y: ey }, 0);
          enemy.x = ex;
          enemy.y = ey;
          // Pre-clamp so we know the final position before placing projectiles
          clampTankToBounds(enemy, map);
          for (const rock of map.rocks) pushTankOutOfRect(enemy, rock);
          for (const river of map.rivers) pushTankOutOfRect(enemy, river);
          enemies.push(enemy);
        }

        // Place one player projectile at each enemy center (after clamping)
        const projectiles = enemies.map(e => makeProjectile(e.x, e.y, true, 50));

        const state = makeState({
          map,
          enemyTanks: enemies,
          projectiles,
        });

        const prevScore = state.score; // 0
        resolveCollisions(state);

        const scoreNeverDecreased = state.score >= prevScore;

        return (
          state.score === n * 100 &&
          scoreNeverDecreased
        );
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 8 — Health bar ratio invariant
// Validates: Requirements 7.4, 7.5
// ---------------------------------------------------------------------------

await property('Property 8: health bar fill ratio equals health/maxHealth', async () => {
  await fc.assert(
    fc.property(
      fc.float({ min: 0, max: 100, noNaN: true }),
      (health) => {
        const maxHealth = 100;
        const ratio = computeHealthBarRatio(health, maxHealth);
        const expected = health / maxHealth;
        return Math.abs(ratio - expected) < 1e-9;
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 9 — Fire cooldown enforced
// Validates: Requirements 3.4, 5.3
// ---------------------------------------------------------------------------

await property('Property 9: tank cannot fire while cooldown is active', async () => {
  await fc.assert(
    fc.property(
      fc.float({ min: 0.01, max: 10, noNaN: true }),
      (fireCooldown) => {
        const map = createMapData();
        const player = createPlayerTank();
        player.fireCooldown = fireCooldown;

        const state = makeState({
          map,
          playerTank: player,
          projectiles: [],
        });

        const countBefore = state.projectiles.length;
        fireProjectile(state, player);
        const countAfter = state.projectiles.length;

        // No new projectile should be added when cooldown > 0
        return countAfter === countBefore;
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 10 — Enemy cap enforced
// Validates: Requirements 4.5
// ---------------------------------------------------------------------------

await property('Property 10: active enemy count never exceeds 10', async () => {
  await fc.assert(
    fc.property(
      fc.float({ min: 0, max: 10, noNaN: true }),
      (delta) => {
        const map = createMapData();
        // Create exactly 10 enemies (at the cap)
        const enemies = [];
        for (let i = 0; i < 10; i++) {
          const sp = map.spawnPoints[i % map.spawnPoints.length];
          // Spread enemies out so they don't all stack on spawn points
          const enemy = createEnemyTank({ x: sp.x + i * 50, y: sp.y }, i % 3);
          enemy.x = sp.x + i * 50;
          enemy.y = sp.y;
          enemies.push(enemy);
        }

        const state = {
          phase: 'playing',
          score: 0,
          map,
          playerTank: createPlayerTank(),
          enemyTanks: enemies,
          projectiles: [],
          spawnTimer: 0, // Force spawn attempt
          spawnRetryTimers: [0, 0, 0],
        };

        updateSpawns(state, delta);

        return state.enemyTanks.length <= 10;
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 11 — Opposing projectile cancellation
// Validates: Requirements 6.5
// ---------------------------------------------------------------------------

await property('Property 11: intersecting opposing projectiles are both removed', async () => {
  await fc.assert(
    fc.property(
      // Position for both projectiles (inside map, away from rocks)
      fc.integer({ min: 100, max: 1100 }),
      fc.integer({ min: 100, max: 700 }),
      (x, y) => {
        // Place player and enemy projectile at the same position (guaranteed overlap)
        const playerProj = makeProjectile(x, y, true);
        const enemyProj  = makeProjectile(x, y, false);

        const state = makeState({
          projectiles: [playerProj, enemyProj],
        });

        resolveCollisions(state);

        const playerProjRemoved = !state.projectiles.some(p => p.id === playerProj.id);
        const enemyProjRemoved  = !state.projectiles.some(p => p.id === enemyProj.id);

        return playerProjRemoved && enemyProjRemoved;
      }
    ),
    { numRuns: 100 }
  );
});
