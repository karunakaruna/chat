<script lang="ts">
  import { showDebugPanel } from '../stores';
  import type { User } from '../utils';

  export let user: User | null;
  export let spatialState: any;  // Replace with proper type
  export let messages: any[];     // Replace with proper type

  const toggleDebugPanel = () => {
    showDebugPanel.update(v => !v);
  };
</script>

{#if $showDebugPanel}
  <div class="debug-panel">
    <h3>Debug Information</h3>
    <div class="debug-section">
      <h4>Current User</h4>
      <pre>{JSON.stringify(user, null, 2)}</pre>
    </div>
    <div class="debug-section">
      <h4>Spatial State</h4>
      <pre>{JSON.stringify(spatialState, null, 2)}</pre>
    </div>
    <div class="debug-section">
      <h4>Messages</h4>
      <pre>{JSON.stringify(messages, null, 2)}</pre>
    </div>
  </div>
{/if}

<button 
  class="debug-toggle" 
  on:click={toggleDebugPanel}
  style="left: {$showDebugPanel ? '300px' : '0'}"
>
  {$showDebugPanel ? '◀' : '▶'}
</button>

<style>
  .debug-panel {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 300px;
    background: rgba(0, 0, 0, 0.9);
    color: #4CAF50;
    padding: 1rem;
    font-family: monospace;
    overflow-y: auto;
    z-index: 1000;
  }

  .debug-section {
    margin-bottom: 1rem;
  }

  .debug-section h4 {
    margin: 0.5rem 0;
    color: #8BC34A;
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-size: 0.8rem;
  }

  .debug-toggle {
    position: fixed;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: #4CAF50;
    border: none;
    padding: 1rem 0.5rem;
    cursor: pointer;
    transition: left 0.3s ease;
    z-index: 1000;
  }
</style>
