<script lang="ts">
  import { onMount } from 'svelte';
  import { isSchemaWindowOpen } from '../stores';

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

  const handleDragEnd = () => {
    isDragging = false;
  };

  const handleDragMove = (e: MouseEvent) => {
    if (!isDragging) return;
    
    schemaWindowPos = {
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y
    };
  };
</script>

<svelte:window 
  on:mousemove={handleDragMove}
  on:mouseup={handleDragEnd}
/>

{#if $isSchemaWindowOpen}
  <div
    class="schema-window"
    style="
      left: {schemaWindowPos.x}px;
      top: {schemaWindowPos.y}px;
    "
  >
    <div class="schema-header" on:mousedown={handleDragStart}>
      <h2>Schema Documentation</h2>
      <div class="schema-actions">
        <button class="schema-action-btn" on:click={expandAllSchemas}>Expand All</button>
        <button class="schema-action-btn" on:click={collapseAllSchemas}>Collapse All</button>
        <button class="schema-action-btn" on:click={() => isSchemaWindowOpen.set(false)}>Close</button>
      </div>
    </div>
    
    <div class="schema-content">
      {#each Object.entries(schemas) as [name, schema]}
        <div class="schema-section">
          <div class="schema-title" on:click={() => toggleSchema(name)}>
            <span class="collapse-indicator">
              {collapsedSchemas.has(name) ? '▶' : '▼'}
            </span>
            <h3>{name}</h3>
          </div>
          
          {#if !collapsedSchemas.has(name)}
            <p class="schema-description">{schema.description}</p>
            <div class="schema-fields">
              {#each Object.entries(schema.fields) as [field, description]}
                <div class="field">
                  <span class="field-name">{field}:</span>
                  <span class="field-description">{description}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .schema-window {
    position: fixed;
    width: 600px;
    max-height: 80vh;
    background: white;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    display: flex;
    flex-direction: column;
    z-index: 1000;
  }

  .schema-header {
    padding: 1rem;
    border-bottom: 1px solid #eee;
    cursor: move;
    user-select: none;
  }

  .schema-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .schema-content {
    padding: 1rem;
    overflow-y: auto;
  }

  .schema-section {
    margin-bottom: 1rem;
  }

  .schema-title {
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
  }

  .collapse-indicator {
    margin-right: 0.5rem;
  }

  .schema-description {
    margin: 0.5rem 0;
    color: #666;
  }

  .schema-fields {
    margin-left: 1rem;
  }

  .field {
    margin: 0.25rem 0;
  }

  .field-name {
    font-weight: bold;
    margin-right: 0.5rem;
  }

  .field-description {
    color: #444;
  }

  .schema-action-btn {
    font-size: 0.75rem;
    padding: 2px 6px;
  }
</style>
