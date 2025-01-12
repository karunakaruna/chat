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
  let text = '';  // Chat input text
  let users: Array<{
    id: string;
    username: string;
    avatar?: string;
    position?: { x: number; y: number };
    lastActive?: number;
    connected?: boolean;
    cohered?: boolean;
  }> = [];

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

  // Click ring management
  interface ClickRing {
    id: string;
    x: number;
    y: number;
    createdAt: number;
  }

  const clickRingsStore = writable<ClickRing[]>([]);
  const chatVisible = writable(true);
  const spatialStore = writable<Record<string, SpatialState>>({});
  const connectedUsers = writable<Array<{
    id: string;
    username: string;
    avatar?: string;
    position?: { x: number; y: number };
    lastActive?: number;
    connected?: boolean;
    cohered?: boolean;
  }>>([]);

  const addClickRing = (x: number, y: number) => {
    const ring: ClickRing = {
      id: crypto.randomUUID(),
      x,
      y,
      createdAt: Date.now()
    };
    clickRingsStore.update(rings => [...rings, ring]);

    // Remove ring after animation
    setTimeout(() => {
      clickRingsStore.update(rings => rings.filter(r => r.id !== ring.id));
    }, 500);
  };

  // Clean up old click rings periodically
  setInterval(() => {
    clickRingsStore.update(rings => 
      rings.filter(ring => Date.now() - ring.createdAt < 1000)
    );
  }, 1000);

  interface SpatialState {
    cohered: boolean;
    position?: { x: number; y: number };
    lastActive?: number;
  }

  interface UserState {
    username: string;
    avatar?: string;
    position?: { x: number; y: number };
    lastActive?: number;
    connected?: boolean;
    cohered?: boolean;
  }

  interface HUDStore {
    userState: {
      cohered: boolean;
      lastActive: number;
      lastMessage: number;
    };
    performance: {
      fps: number;
    };
    users: Record<string, UserState>;
    mouseCartesian: { x: number; y: number };
    mousePolar: { r: number; theta: number };
  }

  const hudStore = writable<HUDStore>({
    userState: {
      cohered: false,
      lastActive: Date.now(),
      lastMessage: Date.now()
    },
    performance: {
      fps: 0
    },
    users: {},
    mouseCartesian: { x: 0, y: 0 },
    mousePolar: { r: 0, theta: 0 }
  });

  // Update users when spatial state changes
  $: {
    if ($spatialStore) {
      users = Object.entries($spatialStore).map(([id, state]) => ({
        id,
        username: state.username || 'Anonymous',
        avatar: state.avatar,
        position: state.position,
        lastActive: state.lastActive,
        connected: state.connected,
        cohered: state.cohered
      }));
    }
  }

  // Sort users by coherence status
  $: sortedUsers = users.sort((a, b) => {
    if (a.cohered === b.cohered) {
      return a.username.localeCompare(b.username);
    }
    return a.cohered ? -1 : 1;
  });

  // Update user function
  const updateUser = (userId: string, userData: Partial<UserState>) => {
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex >= 0) {
      users[userIndex] = { ...users[userIndex], ...userData };
      users = users; // Trigger reactivity
    } else {
      users = [...users, { id: userId, ...userData } as UserState];
    }
  };

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
    const spatial = $spatialStore[user.id];
    if (!spatial) return { x: 0, y: 0 };
    return spatial.position || { x: 0, y: 0 };
  };

  // Coherence check functions
  const COHERENCE_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds

  const isUserCohered = (userId: string): boolean => {
    const spatial = $spatialStore[userId];
    if (!spatial) return false;
    
    const now = Date.now();
    const timeSinceActive = now - spatial.lastActive;
    
    // User must have both:
    // 1. Active websocket connection
    // 2. Recent activity within timeout
    return spatial.cohered;
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
        cohered: connected
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
        cohered: true
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
          spatial.position = { x: 0, y: 0 };
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
  const userDisplayClass = (userId: string): string => {
    const user = $connectedUsers.find(u => u.id === userId);
    if (!user) return 'decohered';
    return user.cohered ? 'cohered' : 'decohered';
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

  // WebSocket message handlers
  const handleWebSocketMessage = (event: MessageEvent) => {
    const message = JSON.parse(event.data);
    
    switch (message.type) {
      case 'spatial_sync':
        handleSpatialSync(message.data);
        break;

      case 'user_update':
        connectedUsers.update(users => {
          const userIndex = users.findIndex(u => u.id === message.data.userId);
          if (userIndex >= 0) {
            users[userIndex] = { ...users[userIndex], ...message.data.state };
            return [...users];
          }
          return users;
        });
        break;

      case 'user_joined':
        connectedUsers.update(users => {
          if (!users.find(u => u.id === message.data.userId)) {
            return [...users, {
              id: message.data.userId,
              username: message.data.username,
              avatar: message.data.avatar,
              connected: true,
              cohered: true,
              lastActive: Date.now()
            }];
          }
          return users;
        });
        break;

      case 'user_left':
        connectedUsers.update(users => 
          users.filter(u => u.id !== message.data.userId)
        );
        break;

      // ... existing message handlers ...
    }
  };

  // Initialize spatial state
  let spatialState: Record<string, {
    username: string;
    avatar?: string;
    position?: { x: number; y: number };
    lastActive?: number;
    connected?: boolean;
    cohered?: boolean;
  }> = {};

  // Update spatial state from WebSocket
  const updateSpatialState = (state: typeof spatialState) => {
    spatialState = state;
  };

  // Handle spatial state sync message
  const handleSpatialSync = (data: any) => {
    updateSpatialState(data);
  };

  // Debug logging system
  interface DebugEvent {
    id: string;
    type: 'beacon' | 'trade' | 'system' | 'error';
    message: string;
    timestamp: string;
    details?: any;
  }

  const debugTimeline = writable<DebugEvent[]>([]);
  let showDebugPanel = true;

  const logDebug = (type: DebugEvent['type'], message: string, details?: any) => {
    debugTimeline.update(events => {
      const newEvent = {
        id: crypto.randomUUID(),
        type,
        message,
        timestamp: new Date().toISOString(),
        details
      };
      // Keep last 100 events
      return [...events.slice(-99), newEvent];
    });
  };

  const toggleDebugPanel = () => {
    showDebugPanel = !showDebugPanel;
  };

  // Add new state for beacons and trades
  let activeBeacons: Map<string, typeof schemas.Beacon> = new Map();
  let activeTrades: Map<string, typeof schemas.Trade> = new Map();

  // Functions for beacon management
  const createBeacon = (position: { x: number, y: number }) => {
    if (!user) return;
    
    const beacon = {
      id: crypto.randomUUID(),
      creatorId: user.id,
      position,
      createdAt: new Date().toISOString(),
      active: true,
      participants: [user.id]
    };
    activeBeacons.set(beacon.id, beacon);
    
    // Log to debug timeline
    logDebug('beacon', `Created beacon at [${position.x.toFixed(2)}, ${position.y.toFixed(2)}]`, {
      beacon,
      creator: user.username,
      timestamp: beacon.createdAt
    });

    // Send to chat
    sendMessage(`*${user.username} set a beacon at [${position.x.toFixed(2)}, ${position.y.toFixed(2)}]`);
    
    // Trigger WebSocket sync
    ws.send(JSON.stringify({ type: 'beacon_created', data: beacon }));
  };

  // Join beacon function with debug logging
  const joinBeacon = (beaconId: string) => {
    const beacon = activeBeacons.get(beaconId);
    if (beacon && !beacon.participants.includes(user?.id)) {
      logDebug('beacon', `Joining beacon created by ${users.get(beacon.creatorId)?.username}`, {
        beaconId,
        joiner: users.get(user?.id)?.username,
        position: beacon.position
      });

      ws.send(JSON.stringify({
        type: 'beacon_joined',
        data: { beaconId, userId: user?.id }
      }));
    }
  };

  // Functions for trade management
  const initiateTrade = (position: { x: number, y: number }, targetUserId: string) => {
    const trade = {
      id: crypto.randomUUID(),
      initiatorId: user?.id,
      acceptorId: targetUserId,
      state: 'invited',
      position,
      mousePositions: {},
      rulesAccepted: { [user?.id]: false, [targetUserId]: false },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    activeTrades.set(trade.id, trade);
    // Trigger WebSocket sync
    // ws.send(JSON.stringify({ type: 'trade_initiated', data: trade }));
  };

  const updateTradeMousePosition = (tradeId: string, position: { x: number, y: number }) => {
    const trade = activeTrades.get(tradeId);
    if (trade) {
      trade.mousePositions[user?.id] = position;
      trade.updatedAt = new Date().toISOString();
      activeTrades.set(trade.id, trade);
      // Trigger WebSocket sync
      // ws.send(JSON.stringify({ 
      //   type: 'trade_mouse_update', 
      //   data: { tradeId, userId: user?.id, position } 
      // }));
    }
  };

  const acceptTradeRules = (tradeId: string) => {
    const trade = activeTrades.get(tradeId);
    if (trade) {
      trade.rulesAccepted[user?.id] = true;
      trade.updatedAt = new Date().toISOString();
      if (Object.values(trade.rulesAccepted).every(accepted => accepted)) {
        trade.state = 'trading';
      }
      activeTrades.set(trade.id, trade);
      // Trigger WebSocket sync
      // ws.send(JSON.stringify({ 
      //   type: 'trade_rules_accepted', 
      //   data: { tradeId, userId: user?.id } 
      // }));
    }
  };

  // Add context menu state
  let contextMenu = {
    visible: false,
    x: 0,
    y: 0,
    targetUserId: null as string | null
  };

  // Handle right click on map
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    const target = event.target as HTMLElement;
    const userElement = target.closest('[data-user-id]');
    
    contextMenu = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      targetUserId: userElement?.getAttribute('data-user-id') || null
    };
  };

  // Hide context menu when clicking outside
  const handleClick = (e: MouseEvent) => {
    if (contextMenu.visible) {
      const target = e.target as HTMLElement;
      if (!target.closest('.context-menu')) {
        contextMenu.visible = false;
      }
    }
  };

  // Chat input handlers
  const handleChatKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (text.trim()) {
        sendMessage(text.trim());
        text = '';
      }
    }
  };

  const sendMessage = (content: string) => {
    if (!user) return;

    const message = {
      id: crypto.randomUUID(),
      userId: user.id,
      text: content,
      createdAt: new Date().toISOString()
    };

    messages = [...messages, message];
    scrollToBottom();

    // Send to WebSocket
    ws.send(JSON.stringify({
      type: 'chat_message',
      data: message
    }));

    // Update user activity
    updateUserActivity(user.id);
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
    },
    Beacon: {
      description: "A spatial marker that invites users to gather",
      fields: {
        id: "string (UUID) - Unique identifier",
        creatorId: "string (UUID) - User who created the beacon",
        position: "{ x: number, y: number } - Beacon coordinates",
        createdAt: "string (ISO date) - Creation timestamp",
        active: "boolean - Whether beacon is still active",
        participants: "string[] - Array of user IDs who joined"
      }
    },
    Trade: {
      description: "A trade interaction between two users",
      fields: {
        id: "string (UUID) - Unique identifier",
        initiatorId: "string (UUID) - User who started the trade",
        acceptorId: "string (UUID) - User who accepted the trade invite",
        state: "enum ('invited', 'rules_review', 'trading', 'completed', 'cancelled')",
        position: "{ x: number, y: number } - Trade window position",
        mousePositions: "{ [userId: string]: { x: number, y: number } } - Real-time cursor positions",
        rulesAccepted: "{ [userId: string]: boolean } - Track who accepted rules",
        createdAt: "string (ISO date) - Trade start timestamp",
        updatedAt: "string (ISO date) - Last state change timestamp"
      }
    }
  };

  // Initialize all schemas as collapsed
  let collapsedSchemas = new Set(Object.keys(schemas));

  // Toggle schema section
  const toggleSchema = (name: string) => {
    if (collapsedSchemas.has(name)) {
      collapsedSchemas.delete(name);
    } else {
      collapsedSchemas.add(name);
    }
    collapsedSchemas = collapsedSchemas; // trigger reactivity
  };

  // Add expand/collapse all functionality
  const expandAllSchemas = () => {
    collapsedSchemas = new Set();
  };

  const collapseAllSchemas = () => {
    collapsedSchemas = new Set(Object.keys(schemas));
  };

  let isSchemaWindowOpen = false;
  let schemaWindowPos = { x: window.innerWidth - 620, y: 20 };
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  onMount(() => {
    const updatePosition = () => {
      schemaWindowPos = { x: window.innerWidth - 620, y: 20 };
    };
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  });

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

  // Removed duplicate addClickRing function
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
    right: 0;
    bottom: 0;
    width: 400px;
    background: rgba(0, 0, 0, 0.8);
    border-left: 1px solid rgba(255, 255, 255, 0.1);
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
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    width: 300px;
    z-index: 1000;
    overflow: hidden;
    transition: height 0.3s ease;
  }

  .schema-header {
    padding: 0.75rem;
    background: white;
    border-bottom: 1px solid #e5e7eb;
    cursor: move;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.875rem;
    color: #374151;
  }

  .schema-content {
    padding: 1rem;
    max-height: 400px;
    overflow-y: auto;
    background: white;
    color: #374151;
  }

  .schema-toggle {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 2px;
    border-radius: 4px;
    transition: background 0.2s;
  }

  .schema-toggle:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  .schema-section {
    margin-bottom: 1.5rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    overflow: hidden;
  }

  .schema-section-header {
    padding: 0.75rem;
    background: #f9fafb;
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: background 0.2s;
  }

  .schema-section-header:hover {
    background: #f3f4f6;
  }

  .schema-section-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #2563eb;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .schema-section-content {
    padding: 0.75rem;
    border-top: 1px solid #e5e7eb;
  }

  .schema-toggle-arrow {
    display: inline-block;
    transition: transform 0.2s;
    font-size: 0.75rem;
    color: #6b7280;
  }

  .schema-toggle-arrow.collapsed {
    transform: rotate(-90deg);
  }

  .schema-field {
    margin: 0.5rem 0;
    padding: 0.5rem;
    background: #f3f4f6;
    border-radius: 4px;
    font-size: 0.875rem;
  }

  .schema-field-name {
    color: #059669;
    font-family: monospace;
    font-weight: 500;
  }

  .schema-description {
    font-style: italic;
    color: #6b7280;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  .schema-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .schema-action-btn {
    font-size: 0.75rem;
    padding: 2px 6px;
    border-radius: 4px;
    background: #f3f4f6;
    color: #4b5563;
    border: 1px solid #e5e7eb;
    cursor: pointer;
    transition: all 0.2s;
  }

  .schema-action-btn:hover {
    background: #e5e7eb;
    color: #374151;
  }

  .beacon {
    position: absolute;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(59, 130, 246, 0.5);
    border: 2px solid #3b82f6;
    animation: pulse 2s infinite;
    transform: translate(-50%, -50%);
    cursor: pointer;
  }

  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
    70% { box-shadow: 0 0 0 20px rgba(59, 130, 246, 0); }
    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
  }

  .trade-window {
    position: absolute;
    width: 600px;
    height: 400px;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .trade-header {
    padding: 1rem;
    background: #f9fafb;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .trade-content {
    flex: 1;
    display: flex;
    padding: 1rem;
  }

  .trade-rules {
    width: 200px;
    padding: 1rem;
    background: #f3f4f6;
    border-radius: 4px;
    font-size: 0.875rem;
  }

  .trade-area {
    flex: 1;
    position: relative;
    margin-left: 1rem;
  }

  .trade-cursor {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .trade-cursor.initiator {
    background: #3b82f6;
  }

  .trade-cursor.acceptor {
    background: #10b981;
  }

  .trade-footer {
    padding: 1rem;
    background: #f9fafb;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .context-menu {
    position: fixed;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    padding: 0.5rem;
    min-width: 160px;
    z-index: 1000;
  }

  .context-menu-item {
    padding: 0.5rem;
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #374151;
    font-size: 0.875rem;
  }

  .context-menu-item:hover {
    background: #f3f4f6;
  }

  .context-menu-item.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .context-menu-separator {
    height: 1px;
    background: #e5e7eb;
    margin: 0.5rem 0;
  }

  .context-menu-icon {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6b7280;
  }

  .debug-panel {
    position: fixed;
    top: 0;
    right: 400px; /* Chat panel width */
    bottom: 0;
    width: 300px;
    background: rgba(0, 0, 0, 0.8);
    color: #4CAF50;
    padding: 1rem;
    overflow-y: auto;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    z-index: 100;
  }

  .debug-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .debug-title {
    font-weight: 500;
    color: #4CAF50;
  }

  .debug-toggle {
    background: none;
    border: none;
    color: #4CAF50;
    cursor: pointer;
    font-size: 1.5rem;
    padding: 0;
    line-height: 1;
  }

  .debug-timeline {
    flex: 1;
    overflow-y: auto;
  }

  .debug-event {
    margin-bottom: 0.5rem;
    padding: 0.5rem;
    background: rgba(76, 175, 80, 0.1);
    border-radius: 4px;
  }

  .debug-event-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }

  .debug-event-type {
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    font-size: 0.75rem;
    text-transform: uppercase;
  }

  .debug-event-type.beacon { background: #3b82f6; color: white; }
  .debug-event-type.trade { background: #10b981; color: white; }
  .debug-event-type.system { background: #6b7280; color: white; }
  .debug-event-type.error { background: #ef4444; color: white; }

  .debug-event-time {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.75rem;
  }

  .debug-event-message {
    color: white;
    margin-bottom: 0.25rem;
  }

  .debug-event-details {
    margin-top: 0.25rem;
    padding: 0.25rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 2px;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.8);
    white-space: pre-wrap;
    overflow-x: auto;
  }

  /* Chat message styles */
  .chat {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.5rem 1rem;
  }

  .chat-image {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
  }

  .chat-image img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .chat-bubble {
    background: rgba(33, 150, 243, 0.1);
    padding: 0.5rem 1rem;
    border-radius: 4px;
    color: white;
  }

  /* User list styles */
  .user-list {
    position: absolute;
    right: 0;
    top: 0;
    width: 200px;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 1rem;
    overflow-y: auto;
  }

  .user-list-header {
    font-size: 1.2rem;
    font-weight: bold;
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  }

  .user-item {
    display: flex;
    align-items: center;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    transition: all 0.2s ease;
  }

  .user-item:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .user-item.cohered {
    border-left: 3px solid #4CAF50;
  }

  .user-item.decohered {
    border-left: 3px solid #f44336;
    opacity: 0.7;
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
        on:click={handleClick}
        on:contextmenu={handleContextMenu}
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
        
        {#each $clickRingsStore as ring (ring.id)}
          <div 
            class="click-ring" 
            style="left: {ring.x}px; top: {ring.y}px;"
          />
        {/each}

        <div class="user-space">
          {#each $connectedUsers as otherUser (otherUser.id)}
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

        {#each Array.from(activeBeacons.values()) as beacon}
          {#if beacon.active}
            <div 
              class="beacon" 
              style="left: {beacon.position.x}px; top: {beacon.position.y}px"
              title={$connectedUsers.find(u => u.id === beacon.creatorId)?.username + "'s beacon"}
            />
          {/if}
        {/each}

        {#each Array.from(activeTrades.values()) as trade}
          {#if trade.initiatorId === user?.id || trade.acceptorId === user?.id}
            <div class="trade-window" style="left: {trade.position.x}px; top: {trade.position.y}px">
              <div class="trade-header">
                <div>
                  Trade with {$connectedUsers.find(u => 
                    u.id === (trade.initiatorId === user?.id ? trade.acceptorId : trade.initiatorId)
                  )?.username}
                </div>
                <div>Status: {trade.state}</div>
              </div>
              <div class="trade-content">
                <div class="trade-rules">
                  <h3>Trade Rules</h3>
                  <ul>
                    <li>Both users must accept the rules</li>
                    <li>Items can be dragged between inventories</li>
                    <li>Both users must confirm to complete trade</li>
                  </ul>
                  {#if !trade.rulesAccepted[user?.id]}
                    <button on:click={() => acceptTradeRules(trade.id)}>Accept Rules</button>
                  {/if}
                </div>
                <div class="trade-area" on:mousemove={e => updateTradeMousePosition(trade.id, { x: e.offsetX, y: e.offsetY })}>
                  {#each Object.entries(trade.mousePositions) as [userId, pos]}
                    <div 
                      class="trade-cursor {userId === trade.initiatorId ? 'initiator' : 'acceptor'}"
                      style="left: {pos.x}px; top: {pos.y}px"
                    />
                  {/each}
                </div>
              </div>
              <div class="trade-footer">
                {#if trade.state === 'trading'}
                  <button>Confirm Trade</button>
                {/if}
                <button on:click={() => cancelTrade(trade.id)}>Cancel Trade</button>
              </div>
            </div>
          {/if}
        {/each}
      </div>

      {#if contextMenu.visible}
        <div 
          class="context-menu"
          style="left: {contextMenu.x}px; top: {contextMenu.y}px"
        >
          <div 
            class="context-menu-item"
            on:click={() => {
              createBeacon({ x: contextMenu.x, y: contextMenu.y });
              contextMenu.visible = false;
            }}
          >
            <span class="context-menu-icon">📍</span>
            Set Beacon
          </div>

          {#if contextMenu.targetUserId && contextMenu.targetUserId !== user?.id}
            <div class="context-menu-separator" />
            <div 
              class="context-menu-item"
              on:click={() => {
                initiateTrade({ x: contextMenu.x, y: contextMenu.y }, contextMenu.targetUserId);
                contextMenu.visible = false;
              }}
            >
              <span class="context-menu-icon">🤝</span>
              Trade with {$connectedUsers.find(u => u.id === contextMenu.targetUserId)?.username}
            </div>
          {/if}

          {#each Array.from(activeBeacons.values()) as beacon}
            {#if beacon.active && !beacon.participants.includes(user?.id)}
              <div class="context-menu-separator" />
              <div 
                class="context-menu-item"
                on:click={() => {
                  joinBeacon(beacon.id);
                  contextMenu.visible = false;
                }}
              >
                <span class="context-menu-icon">➡️</span>
                Join {$connectedUsers.find(u => u.id === beacon.creatorId)?.username}'s Beacon
              </div>
            {/if}
          {/each}
        </div>
      {/if}

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

        <div class="user-list-header">Users ({$connectedUsers.length})</div>
        <div class="user-list-container">
          {#each $connectedUsers as user (user.id)}
            <div class="user-item {user.cohered ? 'cohered' : 'decohered'}">
              <div class="user-avatar">
                {#if user.avatar}
                  <img src={user.avatar} alt={user.username} />
                {:else}
                  <div class="default-avatar">{user.username[0]}</div>
                {/if}
              </div>
              <div class="user-info">
                <div class="username">{user.username}</div>
                <div class="status">
                  {#if user.connected}
                    {#if user.cohered}
                      Active
                    {:else}
                      Idle
                    {/if}
                  {:else}
                    Offline
                  {/if}
                </div>
              </div>
              <div class="coherence-indicator">
                <div class="coherence-dot {user.cohered ? 'cohered' : 'decohered'}"></div>
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
                    <time class="text-xs opacity-50">
                      {formatDate(message.createdAt)}
                    </time>
                  </div>
                  <div class="chat-bubble">{message.text}</div>
                </div>
              {/each}
              <div id="message-end" />
            </div>
          </div>

          <div class="form-control w-full py-2 px-3">
            <form
              class="input-group overflow-hidden"
              id="send-message"
              on:submit={createMessage}
            >
              <input
                name="text"
                type="text"
                placeholder="Compose message"
                class="input input-bordered w-full"
                bind:value={text}
              />
              <button type="submit" class="btn">Send</button>
            </form>
          </div>
        </div>
      {/if}

      <div class="chat-input">
        <input
          type="text"
          bind:value={text}
          placeholder="Type a message..."
          class="input"
          on:keydown={handleChatKeyDown}
        />
      </div>
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
        <span style="transform: rotate({isSchemaWindowOpen ? '90deg' : '0deg'}); display: inline-block; transition: transform 0.2s">▶</span>
        Schemas
      </div>
      {#if isSchemaWindowOpen}
        <div 
          class="schema-toggle" 
          on:click={() => isSchemaWindowOpen = false}
          style="font-size: 1.2rem; line-height: 1;"
        >×</div>
      {/if}
    </div>

    {#if isSchemaWindowOpen}
      <div class="schema-content">
        <div class="schema-description">
          Data structures synchronized between users via WebSocket connections
          <div class="schema-actions">
            <button class="schema-action-btn" on:click={expandAllSchemas}>Expand All</button>
            <button class="schema-action-btn" on:click={collapseAllSchemas}>Collapse All</button>
          </div>
        </div>
        {#each Object.entries(schemas) as [name, schema]}
          <div class="schema-section">
            <div class="schema-section-header" on:click={() => toggleSchema(name)}>
              <div class="schema-section-title">
                <span class="schema-toggle-arrow {collapsedSchemas.has(name) ? 'collapsed' : ''}">
                  ▼
                </span>
                {name}
              </div>
            </div>
            {#if !collapsedSchemas.has(name)}
              <div class="schema-section-content">
                <div class="schema-description">{schema.description}</div>
                {#each Object.entries(schema.fields) as [field, description]}
                  <div class="schema-field">
                    <span class="schema-field-name">{field}:</span> {description}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="debug-panel" class:hidden={!showDebugPanel}>
    <div class="debug-header">
      <div class="debug-title">Debug Timeline</div>
      <button on:click={toggleDebugPanel}>×</button>
    </div>
    <div class="debug-timeline">
      {#each $debugTimeline as event (event.id)}
        <div class="debug-event">
          <div class="debug-event-header">
            <span class="debug-event-type {event.type}">{event.type}</span>
            <span class="debug-event-time">
              {new Date(event.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <div class="debug-event-message">{event.message}</div>
          {#if event.details}
            <div class="debug-event-details">
              {JSON.stringify(event.details, null, 2)}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <button 
    class="debug-toggle" 
    on:click={toggleDebugPanel}
    style="left: {showDebugPanel ? '300px' : '0'}"
  >
    {showDebugPanel ? '◀' : '▶'}
  </button>
</main>
