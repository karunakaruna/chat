<script lang="ts">
  import { hudStore } from '../stores';
  import type { User } from '../utils';

  export let user: User | null;

  const formatDegrees = (radians: number) => {
    return `${Math.round(radians * (180 / Math.PI))}°`;
  };

  const getTimeSince = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };
</script>

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

<style>
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
