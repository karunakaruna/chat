import { writable } from 'svelte/store';
import type { SpatialState } from '../utils';

// Chat visibility store
export const chatVisible = writable(true);

// Spatial store for user positions
export const spatialStore = writable<Record<string, SpatialState>>({});

// Debug panel visibility
export const showDebugPanel = writable(false);

// Schema window state
export const isSchemaWindowOpen = writable(false);

// Click rings store
interface ClickRing {
  x: number;
  y: number;
  timestamp: number;
}
export const clickRingsStore = writable<ClickRing[]>([]);

// HUD State
export const hudStore = writable({
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
export const visualStore = writable<Record<string, {
  currentR: number;
  currentTheta: number;
  targetR: number;
  targetTheta: number;
}>>({});

// Trade store
export const tradeStore = writable<Record<string, {
  id: string;
  initiatorId: string;
  acceptorId: string;
  state: 'invited' | 'rules_review' | 'trading' | 'completed' | 'cancelled';
  position: { x: number; y: number };
  mousePositions: Record<string, { x: number; y: number }>;
  rulesAccepted: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}>>({});
