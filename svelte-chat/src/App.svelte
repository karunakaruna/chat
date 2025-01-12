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
    },
    performance: {
      fps: 0
    }
  });

  // Visual state store (for smooth animations)
  const visualStore = writable<Record<string, {
    currentR: number;
    currentTheta: number;
    targetR: number;
    targetTheta: number;
  }>>({});

  // FPS tracking
  let fps = 0;
  let lastFrameTime = performance.now();
  let frameCount = 0;
  let lastFpsUpdate = performance.now();

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

  const lerp = (start: number, end: number, t: number): number => {
    return start * (1 - t) + end * t;
  };

  const handleMouseMove = (event: MouseEvent) => {
    // Only update HUD, no movement
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - centerX;
    const y = event.clientY - rect.top - centerY;
    const polar = cartesianToPolar(x, y);
    
    hudStore.update(state => ({
      ...state,
      mouseCartesian: { x, y },
      mousePolar: polar
    }));

    // Debounced activity update
    let moveTimeout: number | null = null;
    if (moveTimeout) clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      handleUserInteraction();
      moveTimeout = null;
    }, 1000) as unknown as number;
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
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    
    addClickRing(clickX, clickY);
    handleUserInteraction();
  };

  // Initialize visual state for a user
  const initVisualState = (userId: string, r: number = 0, theta: number = 0) => {
    visualStore.update(state => ({
      ...state,
      [userId]: {
        currentR: r,
        currentTheta: theta,
        targetR: r,
        targetTheta: theta
      }
    }));
  };

  // Update target position (called on click)
  const updateTargetPosition = (userId: string, r: number, theta: number) => {
    visualStore.update(state => {
      const visual = state[userId] || { currentR: 0, currentTheta: 0, targetR: 0, targetTheta: 0 };
      return {
        ...state,
        [userId]: {
          ...visual,
          targetR: r,
          targetTheta: theta
        }
      };
    });
  };

  // Game loop for smooth movement in polar coordinates
  const gameLoop = () => {
    const currentTime = performance.now();
    
    // Only update FPS
    frameCount++;
    if (currentTime - lastFpsUpdate > 1000) {
      fps = Math.round((frameCount * 1000) / (currentTime - lastFpsUpdate));
      hudStore.update(state => ({
        ...state,
        performance: { fps }
      }));
      frameCount = 0;
      lastFpsUpdate = currentTime;
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

  let connectionError = false;

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
        position: { x: 0, y: 0 },
        lastActive: Date.now(),
        connected: false,
        cohered: false
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

  let username = '';

  // Sets the current user's username and stores it in the document
  const createUser = async (ev: Event) => {
    ev.preventDefault();
    if (!username.trim()) return;
    
    try {
      const newUser: User = {
        id: crypto.randomUUID(),
        username: username.trim(),
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`,
        createdAt: new Date().toISOString(),
      };
      
      user = newUser;
      users = [...users, newUser];
      
      // Initialize spatial state for new user
      initUserSpatial(newUser.id);
      initVisualState(newUser.id);

      // Try to connect to automerge, but don't block on it
      try {
        const existingUser = users.find((u) => u.id === cloudAuthUser?.id);
        if (existingUser) {
          console.log('Existing user found:', existingUser);
        } else if (users.find((u) => u.username === username)) {
          throw new Error('Username already taken');
        } else {
          // Attempt automerge connection in background
          connectToAutomerge().catch(err => {
            console.warn('Automerge connection failed:', err);
            connectionError = true;
          });
        }
      } catch (err) {
        console.warn('Automerge setup failed:', err);
        connectionError = true;
      }
    } catch (err) {
      console.error('User creation failed:', err);
      alert('Failed to create user. Please try again.');
    }
  };

  $: {
    if (connectionError) {
      console.warn('Running in local-only mode due to connection error');
    }
  }

  const createMessage = (ev: Event) => {
    ev.preventDefault();
    if (!user || !text.trim()) return;

    const newMessage = {
      id: crypto.randomUUID(),
      userId: user.id,
      text: text.trim(),
      createdAt: new Date().toISOString(),
      timestamp: Date.now()
    };

    messages = [...messages, newMessage];
    text = '';
    updateUserActivity(user.id);
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
    return { x: 0, y: 0 };
  };

  // Coherence check functions
  const COHERENCE_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds

  const isUserCohered = (user: User): boolean => {
    const spatial = $spatialStore[user.id];
    if (!spatial) return false;
    
    const now = Date.now();
    const timeSinceActive = now - spatial.lastActive;
    
    // User must have both:
    // 1. Active websocket connection
    // 2. Recent activity within timeout
    return spatial.connected && timeSinceActive < COHERENCE_TIMEOUT;
  };

  // Track websocket connections
  let activeConnections = new Set<string>();

  // Handle websocket connection updates
  const handleWebSocketConnection = (userId: string, connected: boolean) => {
    if (connected) {
      activeConnections.add(userId);
    } else {
      activeConnections.delete(userId);
    }
    
    spatialStore.update(state => ({
      ...state,
      [userId]: {
        ...state[userId],
        connected,
        cohered: connected && (Date.now() - state[userId].lastActive < COHERENCE_TIMEOUT)
      }
    }));
  };

  // Update user activity
  const updateUserActivity = (userId: string) => {
    const now = Date.now();
    spatialStore.update(state => ({
      ...state,
      [userId]: {
        ...state[userId],
        lastActive: now,
        cohered: state[userId].connected && true // If connected, activity makes them cohered
      }
    }));

    if (user?.id === userId) {
      hudStore.update(state => ({
        ...state,
        userState: {
          ...state.userState,
          lastActive: now
        }
      }));
    }
  };

  // Handle user interactions that should trigger activity
  const handleUserInteraction = () => {
    if (!user) return;
    updateUserActivity(user.id);
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
    clickRingsStore.update(rings => [
      ...rings,
      {
        x,
        y,
        timestamp: Date.now()
      }
    ]);

    // Remove ring after animation
    setTimeout(() => {
      clickRingsStore.update(rings => rings.slice(1));
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

  const RADIAL_DIVISIONS = 23;

  const generateRadialGrid = () => {
    const lines = [];
    for (let i = 0; i < RADIAL_DIVISIONS; i++) {
      const angle = (i * 2 * Math.PI) / RADIAL_DIVISIONS;
      lines.push(angle);
    }
    return lines;
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
    // Don't auto-scroll
  });

  const getUserById = (id: string) => users.find((user) => user.id === id);

  init();

  // Sort users by coherence status
  $: sortedUsers = users.sort((a, b) => {
    const aActive = isUserCohered(a);
    const bActive = isUserCohered(b);
    if (aActive === bActive) {
      // If same coherence status, sort by username
      return a.username.localeCompare(b.username);
    }
    // Active users first
    return aActive ? -1 : 1;
  });

  // Scroll chat to bottom
  const scrollToBottom = () => {
    const messagesContainer = document.querySelector('.messages-container');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  };

  // Watch messages for changes and scroll
  $: {
    messages; // reactive dependency
    // Use setTimeout to ensure DOM is updated
    setTimeout(scrollToBottom, 0);
  }

  // Scroll on mount
  onMount(() => {
    scrollToBottom();
  });

  // Schema window state
  let isSchemaWindowOpen = false;
  let schemaWindowPos = { x: 20, y: 20 };
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  const handleDragStart = (e: MouseEvent) => {
    isDragging = true;
    const rect = (e.target as HTMLElement).closest('.schema-window')?.getBoundingClientRect();
    if (rect) {
      dragOffset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
  };

  const handleDrag = (e: MouseEvent) => {
    if (!isDragging) return;
    schemaWindowPos = {
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y
    };
  };

  const handleDragEnd = () => {
    isDragging = false;
  };

  // Schema documentation
  const schemas = {
    User: {
      description: "Represents a user in the chat system",
      fields: {
        id: "string (UUID) - Unique identifier",
        username: "string - Display name",
        avatar: "string (URL) - User's avatar image",
        createdAt: "string (ISO date) - Account creation timestamp"
      }
    },
    Message: {
      description: "A chat message sent by a user",
      fields: {
        id: "string (UUID) - Unique identifier",
        userId: "string (UUID) - Reference to sender",
        text: "string - Message content",
        createdAt: "string (ISO date) - Message timestamp"
      }
    },
    SpatialState: {
      description: "User's position and activity state",
      fields: {
        position: "{ x: number, y: number } - Coordinates",
        lastActive: "number (timestamp) - Last activity time",
        connected: "boolean - WebSocket connection status",
        cohered: "boolean - Active within timeout"
      }
    }
  };
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
    scroll-behavior: smooth;
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
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .radial-grid::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 1px;
    height: 1px;
    background: rgba(0, 0, 0, 0.1);
    box-shadow: 0 0 100vmax 100vmax rgba(0, 0, 0, 0.05);
    border-radius: 50%;
  }

  .radial-line {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100vmax;
    height: 1px;
    background: rgba(0, 0, 0, 0.1);
    transform-origin: 0 0;
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
    padding: 0.5rem;
    gap: 0.5rem;
    border-radius: 0.5rem;
    transition: all 0.3s ease;
    position: relative;
  }

  .user-item.cohered {
    background: rgba(76, 175, 80, 0.1);
  }

  .user-item.decohered {
    opacity: 0.5;
    background: rgba(255, 0, 0, 0.1);
  }

  .coherence-indicator {
    position: absolute;
    right: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
  }

  .coherence-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    transition: all 0.3s ease;
  }

  .coherence-dot.cohered {
    background: #4CAF50;
    box-shadow: 0 0 5px #4CAF50;
  }

  .coherence-dot.decohered {
    background: #FF5252;
    box-shadow: 0 0 5px #FF5252;
  }

  .hud-display {
    position: sticky;
    top: 0;
    background: rgba(0, 0, 0, 0.8);
    color: #4CAF50;
    padding: 15px;
    border-radius: 8px;
    font-family: monospace;
    font-size: 12px;
    pointer-events: none;
    text-shadow: 0 0 2px rgba(76, 175, 80, 0.5);
    margin-bottom: 10px;
  }

  .hud-section {
    margin-bottom: 8px;
  }

  .hud-section:last-child {
    margin-bottom: 0;
  }

  .hud-section h3 {
    color: #fff;
    margin: 0 0 4px 0;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .hud-section div {
    line-height: 1.3;
    font-size: 11px;
  }

  .messages-container {
    overflow-y: auto;
    max-height: calc(100vh - 200px);
    padding: 1rem;
    scroll-behavior: smooth;
  }

  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden; /* Prevent container from scrolling */
  }

  .game-container {
    position: fixed; /* Keep game container fixed */
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
  }

  .connection-status {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
    margin-top: 4px;
  }

  .connection-status.ok {
    background: rgba(76, 175, 80, 0.2);
    color: #4CAF50;
  }

  .connection-status.error {
    background: rgba(244, 67, 54, 0.2);
    color: #f44336;
  }

  .user-list-container {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
    /* Add subtle scrollbar styling */
    scrollbar-width: thin;
    scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
  }

  .user-list-container::-webkit-scrollbar {
    width: 6px;
  }

  .user-list-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .user-list-container::-webkit-scrollbar-thumb {
    background-color: rgba(156, 163, 175, 0.5);
    border-radius: 3px;
  }

  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    /* Match scrollbar styling */
    scrollbar-width: thin;
    scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
  }

  .messages-container::-webkit-scrollbar {
    width: 6px;
  }

  .messages-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .messages-container::-webkit-scrollbar-thumb {
    background-color: rgba(156, 163, 175, 0.5);
    border-radius: 3px;
  }

  .user-list-panel {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 300px;
    background: var(--background-color);
    border-left: 1px solid var(--border-color);
    overflow: hidden; /* Prevent panel from scrolling */
  }

  .panel-header {
    padding: 1rem;
    border-bottom: 1px solid var(--border-color);
    font-weight: bold;
  }

  .schema-window {
    position: fixed;
    background: var(--background-color);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    min-width: 300px;
    max-width: 500px;
    z-index: 1000;
    overflow: hidden;
    transition: height 0.3s ease;
  }

  .schema-header {
    padding: 0.5rem;
    background: var(--background-color);
    border-bottom: 1px solid var(--border-color);
    cursor: move;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .schema-content {
    padding: 1rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .schema-toggle {
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.2s;
  }

  .schema-toggle:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .schema-section {
    margin-bottom: 1.5rem;
  }

  .schema-section h3 {
    margin-bottom: 0.5rem;
    color: #64B5F6;
  }

  .schema-field {
    margin: 0.5rem 0;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 4px;
  }

  .schema-field-name {
    color: #81C784;
    font-family: monospace;
  }

  .schema-description {
    font-style: italic;
    opacity: 0.8;
    margin-bottom: 1rem;
  }
</style>

<main>
  {#if ready}
    {#if user === null}
      <div class="hero min-h-screen bg-base-200">
        <div class="hero-content flex-col lg:flex-row-reverse">
          <div class="text-center lg:text-left">
            <h1 class="text-5xl font-bold">Join Now!</h1>
            <p class="py-6">Enter a username to start chatting.</p>
          </div>
          <div class="card flex-shrink-0 w-full max-w-sm shadow-2xl bg-base-100">
            <form class="card-body" on:submit={createUser}>
              <div class="form-control">
                <label class="label" for="username">
                  <span class="label-text">Username</span>
                </label>
                <input
                  type="text"
                  id="username"
                  bind:value={username}
                  placeholder="Enter username"
                  class="input input-bordered"
                  required
                />
              </div>
              <div class="form-control mt-6">
                <button type="submit" class="btn btn-primary">Start Chatting</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    {:else}
      <div 
        class="game-container" 
        tabindex="0"
        on:focus={handleGameFocus}
        on:blur={handleGameBlur}
        on:click={handleGameClick}
        on:mousemove={handleMouseMove}
        class:has-focus={gameHasFocus}
      >
        <div class="radial-grid">
          {#each generateRadialGrid() as angle}
            <div
              class="radial-line"
              style="transform: rotate({(angle * 180) / Math.PI}deg)"
            />
          {/each}
        </div>
        <div class="center-anchor" style="left: {centerX}px; top: {centerY}px;" />
        
        {#each $clickRingsStore as ring (ring.timestamp)}
          <div 
            class="click-ring" 
            style="left: {ring.x}px; top: {ring.y}px;"
          />
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

      <div class="user-list-panel" class:visible={$chatVisible}>
        <!-- HUD Display -->
        <div class="hud-display">
          <div class="hud-section">
            <h3>System Status</h3>
            <div>Mode: {connectionError ? 'Local Only' : 'Connected'}</div>
            <div class="connection-status {connectionError ? 'error' : 'ok'}">
              {connectionError ? '⚠️ Connection Failed' : '✓ Online'}
            </div>
          </div>
          <div class="hud-section">
            <h3>Performance</h3>
            <div>FPS: {$hudStore.performance.fps}</div>
          </div>
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

        <div class="user-list-header">Users</div>
        <div class="user-list-container">
          {#each sortedUsers as otherUser (otherUser.id)}
            <div class="user-item {isUserCohered(otherUser) ? 'cohered' : 'decohered'}">
              <img
                src={otherUser.avatar}
                alt={otherUser.username}
                class="w-8 h-8 rounded-full"
              />
              <span class="username">{otherUser.username}</span>
              <div class="coherence-indicator">
                <div class="coherence-dot {isUserCohered(otherUser) ? 'cohered' : 'decohered'}"></div>
                <span>{isUserCohered(otherUser) ? 'Active' : 'Inactive'}</span>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <button 
        class="chat-toggle {$chatVisible ? '' : 'closed'}" 
        on:click={() => chatVisible.update(v => !v)}
      >
        {$chatVisible ? '←' : '→'}
      </button>

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
            <div class="messages-container">
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

  <div
    class="schema-window"
    style="
      left: {schemaWindowPos.x}px;
      top: {schemaWindowPos.y}px;
      height: {isSchemaWindowOpen ? 'auto' : '40px'};
    "
    on:mouseup={handleDragEnd}
  >
    <div
      class="schema-header"
      on:mousedown={handleDragStart}
      on:mousemove={handleDrag}
    >
      <div class="schema-toggle" on:click={() => isSchemaWindowOpen = !isSchemaWindowOpen}>
        {isSchemaWindowOpen ? '▼' : '▶'} Schemas
      </div>
      {#if isSchemaWindowOpen}
        <div class="schema-toggle" on:click={() => isSchemaWindowOpen = false}>✕</div>
      {/if}
    </div>

    {#if isSchemaWindowOpen}
      <div class="schema-content">
        <div class="schema-description">
          Data structures synchronized between users via WebSocket connections
        </div>
        {#each Object.entries(schemas) as [name, schema]}
          <div class="schema-section">
            <h3>{name}</h3>
            <div class="schema-description">{schema.description}</div>
            {#each Object.entries(schema.fields) as [field, description]}
              <div class="schema-field">
                <span class="schema-field-name">{field}:</span> {description}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</main>
