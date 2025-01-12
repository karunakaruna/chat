<script lang="ts">
  import { slide } from 'svelte/transition';
  import type { Message, User } from '../utils.js';
  import { formatDate } from '../utils.js';
  import { writable } from 'svelte/store';

  export let user: User | null;
  export let messages: Message[] = [];
  export let text: string = '';

  // Chat visibility store
  export const chatVisible = writable(true);

  const sendMessage = () => {
    if (!user || !text.trim()) return;
    
    const message: Message = {
      id: crypto.randomUUID(),
      userId: user.id,
      text: text.trim(),
      createdAt: "2025-01-12T15:04:42-08:00"
    };
    
    messages = [...messages, message];
    text = '';
  };

  const toggleChat = () => {
    chatVisible.update(v => !v);
  };
</script>

{#if $chatVisible}
  <div class="chat-panel" transition:slide={{duration: 300, axis: 'x'}}>
    <div class="navbar w-full">
      <div class="navbar-center flex flex-col">
        <p>Local-First Chat</p>
        <button class="btn btn-sm" on:click={toggleChat}>Hide Chat</button>
      </div>
    </div>
    
    <div class="messages">
      {#each messages as message}
        <div class="message">
          <img src={user?.avatar} alt="avatar" class="avatar" />
          <div class="content">
            <div class="header">
              <span class="username">{user?.username}</span>
              <span class="timestamp">{formatDate(message.createdAt)}</span>
            </div>
            <p>{message.text}</p>
          </div>
        </div>
      {/each}
    </div>

    <form class="input-form" on:submit|preventDefault={sendMessage}>
      <input
        type="text"
        placeholder="Type a message..."
        bind:value={text}
      />
      <button type="submit">Send</button>
    </form>
  </div>
{:else}
  <button class="show-chat-btn" on:click={toggleChat}>
    Show Chat
  </button>
{/if}

<style>
  .chat-panel {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    width: 300px;
    background: white;
    border-left: 1px solid #ccc;
    display: flex;
    flex-direction: column;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }

  .message {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
  }

  .content {
    flex: 1;
  }

  .header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }

  .username {
    font-weight: bold;
  }

  .timestamp {
    color: #666;
    font-size: 0.8rem;
  }

  .input-form {
    padding: 1rem;
    border-top: 1px solid #ccc;
    display: flex;
    gap: 0.5rem;
  }

  input {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }

  .show-chat-btn {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    padding: 0.5rem 1rem;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
