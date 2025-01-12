<script lang="ts">
  import {
    type AnyDocumentId,
    Repo,
    type Doc
  } from '@automerge/automerge-repo';
  import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
  import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';

  import {
    LoginRequiredError,
    createClient,
    createVerifier
  } from '@featherscloud/auth';

  import type { ChatDocument, CloudAuthUser, Message, User, Position, PolarPosition, SpatialState } from './utils.js';
  import { formatDate, sha256, cartesianToPolar, polarToCartesian, normalizeAngle } from './utils.js';
  import { afterUpdate, onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { writable, type Writable } from 'svelte/store';

  // Initialize Feathers Cloud Auth
  const appId = import.meta.env.VITE_CLOUD_APP_ID as string;
  const auth = createClient({ appId });
  const verifier = createVerifier({ appId });

  // Initialize Automerge
  const repo = new Repo({
    network: [new BrowserWebSocketClientAdapter('wss://sync.automerge.org')],
    storage: new IndexedDBStorageAdapter()
  });
  const automergeUrl = import.meta.env.VITE_AUTOMERGE_URL as AnyDocumentId;
  const handle = repo.find<ChatDocument>(automergeUrl);

  let ready = false;
  let cloudAuthUser: CloudAuthUser | null = null;
  let user: User | null = null;
  let messages: Message[] = [];
  let users: User[] = [];
  let text: string = '';

  let playerSpeed = 5;
  let keys = new Set<string>();

  let gameHasFocus = false;

  // Current position for lerping (in polar coordinates)
  let currentR = 0;
  let currentTheta = 0;
  let targetR = 0;
  let targetTheta = 0;
  const lerpSpeed = 0.15; // Adjust this to change movement speed

  let centerX = window.innerWidth / 2;
  let centerY = window.innerHeight / 2;
  let animationFrame: number | null = null;

  interface ClickRing {
    x: number;
    y: number;
    timestamp: number;
  }

  const clickRingsStore = writable<ClickRing[]>([]);
  const chatVisible = writable(true);
  const spatialStore: Writable<Record<string, SpatialState>> = writable({});

  let clickRings: ClickRing[] = [];
  clickRingsStore.subscribe(value => {
    clickRings = value;
  });

  // HUD State
  const hudStore = writable({
    mouseCartesian: { x: 0, y: 0 },
    mousePolar: { r: 0, theta: 0 },
    userState: {
      cohered: true,
      lastActive: Date.now(),
      lastMessage: Date.now()
    }
  });

  // Polar coordinate lerping
  const lerpPolar = (start: PolarPosition, end: PolarPosition, t: number): PolarPosition => {
    // Normalize angles before lerping
    const startTheta = normalizeAngle(start.theta);
    const endTheta = normalizeAngle(end.theta);
    
    // Find shortest path for angle
    let deltaTheta = endTheta - startTheta;
    if (deltaTheta > Math.PI) deltaTheta -= 2 * Math.PI;
    if (deltaTheta < -Math.PI) deltaTheta += 2 * Math.PI;
    
    const theta = startTheta + deltaTheta * t;
    const r = start.r * (1 - t) + end.r * t;
    
    return { r, theta };
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (user) {
      updatePosition(event.clientX, event.clientY);
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - centerX;
    const y = event.clientY - rect.top - centerY;
    const polar = cartesianToPolar(x, y);
    
    hudStore.update(state => ({
      ...state,
      mouseCartesian: { x, y },
      mousePolar: polar
    }));
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    keys.add(event.key.toLowerCase());
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    keys.delete(event.key.toLowerCase());
  };

  const updatePlayerPosition = () => {
    if (!user) return;
    
    const currentPos = getUserPosition(user);
    let newX = currentPos.x;
    let newY = currentPos.y;

    // WASD or Arrow keys
    if (keys.has('w') || keys.has('arrowup')) newY -= playerSpeed;
    if (keys.has('s') || keys.has('arrowdown')) newY += playerSpeed;
    if (keys.has('a') || keys.has('arrowleft')) newX -= playerSpeed;
    if (keys.has('d') || keys.has('arrowright')) newX += playerSpeed;

    // Keep player in bounds
    newX = Math.max(0, Math.min(window.innerWidth - 50, newX));
    newY = Math.max(0, Math.min(window.innerHeight - 50, newY));

    if (newX !== currentPos.x || newY !== currentPos.y) {
      updatePosition(newX, newY);
    }
  };

  const handleGameClick = (event: MouseEvent) => {
    if (!user) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left - centerX;
    const clickY = event.clientY - rect.top - centerY;
    
    // Convert click position to polar coordinates
    const polarPos = cartesianToPolar(clickX, clickY);
    
    targetR = polarPos.r;
    targetTheta = polarPos.theta;

    // Initialize spatial state if needed
    if (!$spatialStore[user.id]) {
      initUserSpatial(user.id);
    }

    // If this is our first movement, set current position
    if (currentR === 0) {
      currentR = targetR;
      currentTheta = targetTheta;
    }
    
    // Update spatial store
    spatialStore.update(state => ({
      ...state,
      [user.id]: {
        position: { r: currentR, theta: currentTheta },
        lastActive: Date.now(),
        cohered: true
      }
    }));
    
    addClickRing(event.clientX, event.clientY);
  };

  // Game loop for smooth movement in polar coordinates
  const gameLoop = () => {
    if (user) {
      // Get current position in polar coordinates
      const currentPolar = { r: currentR, theta: currentTheta };
      const targetPolar = { r: targetR, theta: targetTheta };
      
      // Lerp in polar space
      const newPolar = lerpPolar(currentPolar, targetPolar, lerpSpeed);
      currentR = newPolar.r;
      currentTheta = newPolar.theta;
      
      // Update spatial store with new position
      spatialStore.update(state => ({
        ...state,
        [user.id]: {
          position: { r: currentR, theta: currentTheta },
          lastActive: Date.now(),
          cohered: true
        }
      }));
    }
    animationFrame = window.requestAnimationFrame(gameLoop);
  };

  const getDefaultPosition = () => ({
    x: 0,
    y: 0
  });

  const updateCenterPoint = () => {
    centerX = window.innerWidth / 2;
    centerY = window.innerHeight / 2;
  };

  const init = async () => {
    try {
      // Get Feathers Cloud Auth access token
      const accessToken = await auth.getAccessToken();
      // Verify our token (this will redirect to the login screen if necessary)
      const { user: verifiedUser } = await verifier.verify(accessToken);
      const loadDocument = (doc?: Doc<ChatDocument>) => {
        if (doc) {
          // Ensure all users have position data
          doc.users = doc.users.map(u => ({
            ...u,
            position: u.position || getDefaultPosition(),
            lastActive: u.lastActive || Date.now()
          }));
          
          user =
            doc.users.find((user) => user.id === cloudAuthUser?.id) || null;
          messages = doc.messages;
          users = doc.users;
        }
        ready = true;
      };

      cloudAuthUser = verifiedUser;
      // Update application data when document changes
      handle.on('change', ({ doc }) => loadDocument(doc));
      // Initialise the document if it is already available
      if (handle.isReady()) {
        loadDocument(await handle.doc());
      }
    } catch (error) {
      // Redirect to Feathers Cloud Auth login
      if (error instanceof LoginRequiredError) {
        window.location.href = await auth.getLoginUrl(error);
      }
      throw error;
    }
  };

  // Initialize a new user in the spatial store
  const initUserSpatial = (userId: string) => {
    spatialStore.update(state => ({
      ...state,
      [userId]: {
        position: { r: 0, theta: 0 },
        lastActive: Date.now(),
        cohered: true
      }
    }));
  };

  // When users list changes, make sure all users are in spatial store
  $: {
    users.forEach(user => {
      if (!$spatialStore[user.id]) {
        initUserSpatial(user.id);
      }
    });
  }

  // Sets the current user's username and stores it in the document
  const createUser = async (ev: Event) => {
    const formElement = ev.target as HTMLFormElement;
    const input: string = formElement.username.value;
    const username = input.trim().toLowerCase();
    const existingUser = users.find((user) => user.id === cloudAuthUser?.id);

    ev.preventDefault();

    if (existingUser) {
      user = existingUser;
    } else if (users.find((user) => user.username === username)) {
      alert('Username already taken, please choose another one');
    } else {
      const emailHash = await sha256(cloudAuthUser?.email || 'unknown');

      handle.change((doc) => {
        if (cloudAuthUser !== null) {
          doc.users.push({
            id: cloudAuthUser.id,
            avatar: `https://www.gravatar.com/avatar/${emailHash}?s=40&d=identicon`,
            username,
            position: getDefaultPosition(),
            lastActive: Date.now()
          });
        }
      });
    }
  };

  const createMessage = (ev: Event) => {
    ev.preventDefault();

    handle.change((doc) => {
      if (user !== null) {
        doc.messages.push({
          id: crypto.randomUUID(),
          text: text,
          createdAt: Date.now(),
          userId: user.id
        });
        text = '';
      }
    });
  };

  const updatePosition = (x: number, y: number) => {
    if (!user) return;
    handle.change((doc) => {
      const userToUpdate = doc.users.find((u) => u.id === user?.id);
      if (userToUpdate) {
        userToUpdate.position = { x, y };
        userToUpdate.lastActive = Date.now();
      }
    });
  };

  const handleGameFocus = () => {
    gameHasFocus = true;
  };

  const handleGameBlur = () => {
    gameHasFocus = false;
  };

  const getRandomPosition = () => ({
    x: (Math.random() - 0.5) * 200,
    y: (Math.random() - 0.5) * 200
  });

  $: decoherentPositions = users.reduce((acc, u) => {
    if (!isUserCohered(u)) {
      acc[u.id] = getRandomPosition();
    }
    return acc;
  }, {} as Record<string, Position>);

  // Update decoherent positions periodically
  setInterval(() => {
    decoherentPositions = users.reduce((acc, u) => {
      if (!isUserCohered(u)) {
        acc[u.id] = getRandomPosition();
      }
      return acc;
    }, {} as Record<string, Position>);
  }, 2000);

  // Get user position from spatial store
  const getUserPosition = (user: User): Position => {
    const spatial = $spatialStore[user.id];
    if (!spatial || !isUserCohered(user)) {
      // Return center position for decohered or new users
      return { x: 0, y: 0 };
    }
    return polarToCartesian(spatial.position.r, spatial.position.theta);
  };

  // Coherence check functions
  const COHERENCE_TIMEOUT = 60000; // 1 minute

  const isUserCohered = (user: User): boolean => {
    const spatial = $spatialStore[user.id];
    if (!spatial) return false;
    return Date.now() - spatial.lastActive < COHERENCE_TIMEOUT;
  };

  // Check coherence and update positions periodically
  setInterval(() => {
    spatialStore.update(state => {
      const newState = { ...state };
      for (const userId in newState) {
        const spatial = newState[userId];
        const isActive = Date.now() - spatial.lastActive < COHERENCE_TIMEOUT;
        
        // Update coherence state
        spatial.cohered = isActive;
        
        // Move to center if decohered
        if (!isActive) {
          spatial.position = { r: 0, theta: 0 };
        }
      }
      return newState;
    });
  }, 1000);

  // Subscribe to spatial store to log changes
  spatialStore.subscribe(state => {
    if (user && state[user.id]) {
      const spatial = state[user.id];
      hudStore.update(hud => ({
        ...hud,
        userState: {
          cohered: spatial.cohered,
          lastActive: spatial.lastActive,
          lastMessage: messages[messages.length - 1]?.timestamp || Date.now()
        }
      }));
    }
  });

  // Update the user display with coherence classes
  $: userDisplayClass = (userId: string) => {
    const spatial = $spatialStore[userId];
    if (!spatial) return 'decohered';
    return spatial.cohered ? 'cohered' : 'decohered';
  };

  const addClickRing = (x: number, y: number) => {
    const timestamp = Date.now();
    clickRingsStore.update(rings => [...rings, { x, y, timestamp }]);
    setTimeout(() => {
      clickRingsStore.update(rings => rings.filter(ring => ring.timestamp !== timestamp));
    }, 500);
  };

  const getTimeSince = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const formatDegrees = (radians: number) => {
    return `${Math.round(radians * (180 / Math.PI))}°`;
  };

  onMount(() => {
    updateCenterPoint();
    window.addEventListener('resize', updateCenterPoint);
    
    // Set initial position to center
    if (user && !user.position) {
      currentR = 0;
      currentTheta = 0;
      targetR = 0;
      targetTheta = 0;
      updatePosition(0, 0);
    }

    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
      gameContainer.focus();
      
      // Refocus on game container when clicking anywhere in it
      gameContainer.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent default to ensure focus works
        gameContainer.focus();
      });
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    // Start game loop
    animationFrame = window.requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener('resize', updateCenterPoint);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (gameContainer) {
        gameContainer.removeEventListener('mousedown', () => {
          gameContainer.focus();
        });
      }
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  });

  onDestroy(() => {
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
    }
  });

  afterUpdate(() => {
    document
      .getElementById('message-end')
      ?.scrollIntoView({ behavior: 'smooth' });
  });

  const updateUserActivity = () => {
    if (!user) return;
    handle.change((doc) => {
      const userToUpdate = doc.users.find((u) => u.id === user.id);
      if (userToUpdate) {
        userToUpdate.lastActive = Date.now();
      }
    });
  };

  const getUserById = (id: string) => users.find((user) => user.id === id);

  init();
</script>

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

  .chat-overlay {
    position: relative;
    z-index: 1;
    pointer-events: none;
  }

  .chat-overlay > * {
    pointer-events: auto;
  }

  .user-space {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }

  .chat-panel {
    position: fixed;
    top: 0;
    left: 0;
    width: 400px;
    height: 100vh;
    background: white;
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
    z-index: 10;
    display: flex;
    flex-direction: column;
  }

  .chat-toggle {
    position: fixed;
    top: 50%;
    left: 400px;
    transform: translateY(-50%);
    background: white;
    border: none;
    border-radius: 0 8px 8px 0;
    padding: 16px 8px;
    cursor: pointer;
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
    z-index: 10;
    transition: left 0.3s ease;
  }

  .chat-toggle.closed {
    left: 0;
  }

  .chat-toggle:hover {
    background: #f0f0f0;
  }

  .chat-container {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
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

  .user-avatar.self .username {
    background: rgba(76, 175, 80, 0.9);
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

  .coordinate-grid {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100%;
    height: 100%;
    transform: translate(-50%, -50%);
    background-image: 
      linear-gradient(to right, rgba(0,0,0,0.1) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(0,0,0,0.1) 1px, transparent 1px);
    background-size: 50px 50px;
    pointer-events: none;
  }

  .user-list-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 250px;
    height: 100vh;
    background: white;
    box-shadow: -2px 0 10px rgba(0, 0, 0, 0.1);
    z-index: 10;
    transform: translateX(100%);
    transition: transform 0.3s ease;
  }

  .user-list-panel.visible {
    transform: translateX(0);
  }

  .user-list-header {
    padding: 1rem;
    font-weight: bold;
    border-bottom: 1px solid #eee;
  }

  .user-list {
    padding: 1rem;
  }

  .user-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    border-radius: 4px;
    transition: background-color 0.2s;
  }

  .user-item:hover {
    background: #f5f5f5;
  }

  .coherence-status {
    margin-left: auto;
    font-size: 1.2rem;
  }

  .coherence-status:not(.cohered) {
    opacity: 0.3;
  }

  .hud-display {
    position: fixed;
    top: 20px;
    left: 20px;
    background: rgba(0, 0, 0, 0.8);
    color: #4CAF50;
    padding: 15px;
    border-radius: 8px;
    font-family: monospace;
    font-size: 14px;
    z-index: 1000;
    pointer-events: none;
    text-shadow: 0 0 2px rgba(76, 175, 80, 0.5);
  }

  .hud-section {
    margin-bottom: 10px;
  }

  .hud-section:last-child {
    margin-bottom: 0;
  }

  .hud-section h3 {
    color: #fff;
    margin: 0 0 5px 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .hud-section div {
    line-height: 1.4;
  }
</style>

<main>
  <!-- HUD Display -->
  <div class="hud-display">
    <div class="hud-section">
      <h3>Mouse Position</h3>
      <div>X: {Math.round($hudStore.mouseCartesian.x)}px</div>
      <div>Y: {Math.round($hudStore.mouseCartesian.y)}px</div>
      <div>R: {Math.round($hudStore.mousePolar.r)}px</div>
      <div>θ: {formatDegrees($hudStore.mousePolar.theta)}</div>
    </div>
    <div class="hud-section">
      <h3>User State</h3>
      <div>Cohered: {$hudStore.userState.cohered ? 'Yes' : 'No'}</div>
      <div>Last Active: {getTimeSince($hudStore.userState.lastActive)} ago</div>
      <div>Last Message: {getTimeSince($hudStore.userState.lastMessage)} ago</div>
    </div>
  </div>

  {#if ready}
    {#if user === null}
      <div
        class="login flex min-h-screen bg-neutral justify-center items-center"
      >
        <div class="card w-full max-w-sm bg-base-100 px-4 py-8 shadow-xl">
          <div class="px-4">
            <h1
              class="text-3xl font-bold text-center my-5 bg-clip-text bg-gradient-to-br"
            >
              Pick a username
            </h1>
          </div>
          <form class="card-body pt-2" on:submit={createUser}>
            <div class="form-control">
              <label for="username" class="label"
                ><span class="label-text">Your username</span></label
              >
              <input type="text" name="username" class="input input-bordered" />
            </div>
            <div class="form-control mt-6">
              <button id="login" type="submit" class="btn"
                >Start chatting</button
              >
            </div>
          </form>
        </div>
      </div>
    {/if}

    {#if user !== null}
      <!-- Game container for movement -->
      <div 
        class="game-container" 
        tabindex="0"
        on:focus={handleGameFocus}
        on:blur={handleGameBlur}
        on:click={handleGameClick}
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
              class="user-avatar {otherUser.id === user?.id ? 'self' : ''} {userDisplayClass(otherUser.id)}"
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

      <!-- User List Panel -->
      <div class="user-list-panel" class:visible={$chatVisible}>
        <div class="user-list-header">Users</div>
        <div class="user-list">
          {#each users as otherUser (otherUser.id)}
            <div class="user-item {isUserCohered(otherUser) ? 'cohered' : 'decohered'}">
              <img
                src={otherUser.avatar}
                alt={otherUser.username}
                class="w-8 h-8 rounded-full"
              />
              <span>{otherUser.username}</span>
              <span class="coherence-status">
                {isUserCohered(otherUser) ? '●' : '○'}
              </span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Chat Toggle Button -->
      <button 
        class="chat-toggle {$chatVisible ? '' : 'closed'}" 
        on:click={() => chatVisible.update(v => !v)}
      >
        {$chatVisible ? '←' : '→'}
      </button>

      <!-- Chat Panel -->
      {#if $chatVisible}
        <div class="chat-panel" transition:slide={{duration: 300, axis: 'x'}}>
          <div class="navbar w-full">
            <div class="navbar-center flex flex-col">
              <p>Local-First Chat</p>
              <label class="text-xs">
                <span class="online-count">{users.length}</span> User(s)
              </label>
            </div>
          </div>

          <div class="chat-container">
            {#each messages as message (message.id)}
              <div class="chat chat-start py-2">
                <div class="chat-image avatar">
                  <div class="w-10 rounded-full">
                    <img
                      src={getUserById(message.userId)?.avatar}
                      alt={getUserById(message.userId)?.username}
                    />
                  </div>
                </div>
                <div class="chat-header pb-1">
                  {getUserById(message.userId)?.username}
                  <time class="text-xs opacity-50"
                    >{formatDate(message.createdAt)}</time
                  >
                </div>
                <div class="chat-bubble">{message.text}</div>
              </div>
            {/each}
            <div id="message-end" />
          </div>

          <div class="form-control w-full p-4 bg-base-200">
            <form class="input-group" on:submit={createMessage}>
              <input
                type="text"
                bind:value={text}
                placeholder="Type a message..."
                class="input input-bordered flex-1"
              />
              <button type="submit" class="btn">Send</button>
            </form>
          </div>
        </div>
      {/if}
    {/if}
  {/if}
</main>
