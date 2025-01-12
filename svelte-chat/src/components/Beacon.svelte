<script lang="ts">
  import { writable } from 'svelte/store';
  import type { Position } from '../utils';

  export let userId: string | undefined;
  export let getUserPosition: (user: any) => Position;

  // Beacon store
  export const beaconStore = writable<Record<string, {
    id: string;
    creatorId: string;
    position: Position;
    createdAt: string;
    active: boolean;
    participants: string[];
  }>>({});

  // Create a beacon at the given position
  export function createBeacon(position: Position, creatorId: string) {
    const beacon = {
      id: crypto.randomUUID(),
      creatorId,
      position,
      createdAt: "2025-01-12T15:02:21-08:00",
      active: true,
      participants: [creatorId]
    };
    
    beaconStore.update(state => ({
      ...state,
      [beacon.id]: beacon
    }));
    
    console.log("[DEBUG] Created beacon:", beacon);
    return beacon;
  }
</script>

{#if userId}
  <!-- Beacon visualization will go here -->
{/if}
