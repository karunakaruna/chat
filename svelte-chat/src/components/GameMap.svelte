<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Position, User, SpatialState } from '../utils.js';
  import { cartesianToPolar, polarToCartesian, normalizeAngle } from '../utils.js';
  import { spatialStore, clickRingsStore, hudStore } from '../stores';

  export let user: User | null;
  export let users: User[] = [];
  
  // Game state
  let playerSpeed = 5;
  let keys = new Set<string>();
  let gameHasFocus = false;
  
  // Position state
  let currentR = 0;
  let currentTheta = 0;
  let targetR = 0;
  let targetTheta = 0;

  let centerX = window.innerWidth / 2;
  let centerY = window.innerHeight / 2;

  // Update center point when window resizes
  const updateCenterPoint = () => {
    centerX = window.innerWidth / 2;
    centerY = window.innerHeight / 2;
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!user) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - centerX;
    const y = event.clientY - rect.top - centerY;
    const polar = cartesianToPolar(x, y);
    
    hudStore.update(state => ({
      ...state,
      mouseCartesian: { x, y },
      mousePolar: polar
    }));

    spatialStore.update(state => ({
      ...state,
      [user.id]: {
        ...state[user.id],
        position: polar,
        lastActive: Date.now(),
        cohered: true
      }
    }));
  };

  const handleClick = (event: MouseEvent) => {
    if (!user) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    clickRingsStore.update(rings => [
      ...rings,
      { x, y, timestamp: Date.now() }
    ]);
  };

  const getUserPosition = (user: User): Position => {
    const spatial = $spatialStore[user.id];
    if (!spatial?.position) return { x: 0, y: 0 };
    return polarToCartesian(spatial.position.r, spatial.position.theta);
  };

  const isUserCohered = (user: User): boolean => {
    const spatial = $spatialStore[user.id];
    if (!spatial) return false;
    return Date.now() - spatial.lastActive < 60000; // 1 minute timeout
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!gameHasFocus) return;
    keys.add(event.key);
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    keys.delete(event.key);
  };

  const handleGameFocus = () => {
    gameHasFocus = true;
  };

  const handleGameBlur = () => {
    gameHasFocus = false;
    keys.clear();
  };

  onMount(() => {
    updateCenterPoint();
    window.addEventListener('resize', updateCenterPoint);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('resize', updateCenterPoint);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  });
</script>

<div 
  class="game-container" 
  tabindex="0"
  on:focus={handleGameFocus}
  on:blur={handleGameBlur}
  on:click={handleClick}
  on:mousemove={handleMouseMove}
  class:has-focus={gameHasFocus}
>
  <div class="radial-grid"></div>
  <div class="center-anchor" style="left: {centerX}px; top: {centerY}px;"></div>
  
  {#each $clickRingsStore as ring (ring.timestamp)}
    <div 
      class="click-ring" 
      style="left: {ring.x}px; top: {ring.y}px;"
    ></div>
  {/each}

  <div class="user-space">
    {#each users as otherUser (otherUser.id)}
      {@const position = getUserPosition(otherUser)}
      <div 
        class="user-avatar {otherUser.id === user?.id ? 'self' : ''} {isUserCohered(otherUser) ? 'cohered' : 'decohered'}"
        style="transform: translate(
          calc(-50% + {centerX + position.x}px), 
          calc(-50% + {centerY + position.y}px)
        )"
      >
        <img
          src={otherUser.avatar}
          alt={otherUser.username}
          class="w-8 h-8 rounded-full"
        />
        <div class="username">{otherUser.username}</div>
      </div>
    {/each}
  </div>
</div>

<style>
  .game-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 0;
    background: white;
    outline: none;
    transition: background-color 0.3s;
  }

  .game-container:focus {
    background: #e0ffe0;
  }

  .game-container.has-focus {
    background: #e0ffe0;
  }

  .radial-grid {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 200vmax;
    height: 200vmax;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .radial-grid::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: 
      repeating-conic-gradient(
        from 0deg,
        transparent 0deg,
        transparent 14.5deg,
        rgba(0,0,0,0.05) 15deg,
        transparent 15.5deg
      ),
      repeating-radial-gradient(
        circle at center,
        transparent 0,
        transparent 49px,
        rgba(0,0,0,0.05) 50px,
        transparent 51px
      );
  }

  .center-anchor {
    position: absolute;
    width: 10px;
    height: 10px;
    background: #4CAF50;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
  }

  .user-space {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }

  .user-avatar {
    position: absolute;
    transition: all 0.5s ease-out;
  }

  .user-avatar.cohered {
    opacity: 1;
    transition: transform 0.3s ease-out;
  }

  .user-avatar.decohered {
    opacity: 0.3;
    transition: all 1s ease-out;
  }

  .user-avatar.self img {
    border: 3px solid #4CAF50;
    box-shadow: 0 0 10px rgba(76, 175, 80, 0.5);
  }

  .user-avatar img {
    width: 40px;
    height: 40px;
    border: 2px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .user-avatar .username {
    position: absolute;
    bottom: -20px;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }

  .click-ring {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    animation: ring-expand 0.5s ease-out forwards;
  }

  @keyframes ring-expand {
    0% {
      width: 0;
      height: 0;
      border: 2px solid rgba(76, 175, 80, 1);
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }
    100% {
      width: 50px;
      height: 50px;
      border: 2px solid rgba(76, 175, 80, 0);
      transform: translate(-50%, -50%) scale(2);
      opacity: 0;
    }
  }
</style>
