import { writable } from 'svelte/store';

// Store for HUD display data
export const hudStore = writable({
  mouseCartesian: { x: 0, y: 0 },
  mousePolar: { r: 0, theta: 0 },
  userState: {
    cohered: false,
    lastActive: Date.now(),
    lastMessage: Date.now()
  }
});

// Store for click ring animations
export const clickRingsStore = writable([]);

// Store for debug messages
export const debugStore = writable({
  lastUpdate: Date.now(),
  messages: [],
  userCount: 0,
  spatialStates: {}
});

// Store for spatial data
export const spatialStore = writable({});
