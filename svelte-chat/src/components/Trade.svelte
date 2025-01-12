<script lang="ts">
  import { tradeStore } from '../stores';
  import type { User } from '../utils';

  export let user: User | null;

  const initiateTrade = (position: { x: number, y: number }, targetUserId: string) => {
    if (!user) return;
    
    const trade = {
      id: crypto.randomUUID(),
      initiatorId: user.id,
      acceptorId: targetUserId,
      state: 'invited' as const,
      position,
      mousePositions: {},
      rulesAccepted: {},
      createdAt: "2025-01-12T15:10:55-08:00",
      updatedAt: "2025-01-12T15:10:55-08:00"
    };

    tradeStore.update(state => ({
      ...state,
      [trade.id]: trade
    }));
  };

  const updateTradeState = (tradeId: string, newState: string) => {
    tradeStore.update(state => {
      if (!state[tradeId]) return state;
      return {
        ...state,
        [tradeId]: {
          ...state[tradeId],
          state: newState as any,
          updatedAt: "2025-01-12T15:10:55-08:00"
        }
      };
    });
  };

  const updateMousePosition = (tradeId: string, userId: string, position: { x: number, y: number }) => {
    tradeStore.update(state => {
      if (!state[tradeId]) return state;
      return {
        ...state,
        [tradeId]: {
          ...state[tradeId],
          mousePositions: {
            ...state[tradeId].mousePositions,
            [userId]: position
          }
        }
      };
    });
  };
</script>

{#if $tradeStore}
  {#each Object.entries($tradeStore) as [tradeId, trade]}
    {#if trade.initiatorId === user?.id || trade.acceptorId === user?.id}
      <div 
        class="trade-window"
        style="left: {trade.position.x}px; top: {trade.position.y}px"
      >
        <div class="trade-header">
          <h3>Trade Window</h3>
          <span>Status: {trade.state}</span>
        </div>
        
        {#if trade.state === 'invited'}
          <div class="trade-content">
            <p>Trade invitation {trade.initiatorId === user?.id ? 'sent' : 'received'}</p>
            {#if trade.acceptorId === user?.id}
              <div class="trade-actions">
                <button on:click={() => updateTradeState(tradeId, 'rules_review')}>Accept</button>
                <button on:click={() => updateTradeState(tradeId, 'cancelled')}>Decline</button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/each}
{/if}

<style>
  .trade-window {
    position: absolute;
    background: white;
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 1rem;
    min-width: 300px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  }

  .trade-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #eee;
  }

  .trade-content {
    text-align: center;
  }

  .trade-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-top: 1rem;
  }

  button {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  button:first-child {
    background: #4CAF50;
    color: white;
  }

  button:last-child {
    background: #f44336;
    color: white;
  }
</style>
