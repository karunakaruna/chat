<script lang="ts">
  import type { CloudAuthUser, User } from '../utils.js';
  import { createClient, createVerifier, LoginRequiredError } from '@featherscloud/auth';
  import { sha256 } from '../utils.js';

  export let user: User | null;
  export let cloudAuthUser: CloudAuthUser | null;
  export let handle: any;

  // Initialize Feathers Cloud Auth
  const appId = import.meta.env.VITE_CLOUD_APP_ID as string;
  const auth = createClient({ appId });
  const verifier = createVerifier({ appId });

  const createUser = async (ev: Event) => {
    ev.preventDefault();
    const formElement = ev.target as HTMLFormElement;
    const input: string = formElement.username.value;
    const username = input.trim().toLowerCase();

    if (!username) return;

    try {
      // Get the access token and verify it
      const accessToken = await auth.getAccessToken();
      const { user: verifiedUser } = await verifier.verify(accessToken);
      cloudAuthUser = verifiedUser;

      if (!cloudAuthUser) {
        window.location.href = await auth.getLoginUrl();
        return;
      }

      const emailHash = await sha256(cloudAuthUser.email || 'unknown');
      
      handle.change(doc => {
        if (cloudAuthUser) {
          if (!doc.users) doc.users = [];
          if (!doc.users.find(u => u.id === cloudAuthUser.id)) {
            doc.users.push({
              id: cloudAuthUser.id,
              avatar: `https://www.gravatar.com/avatar/${emailHash}?s=40&d=identicon`,
              username,
              position: { x: 0, y: 0 },
              lastActive: Date.now()
            });
          }
        }
      });
    } catch (error) {
      if (error instanceof LoginRequiredError) {
        window.location.href = await auth.getLoginUrl(error);
      } else {
        console.error('Failed to create user:', error);
      }
    }
  };
</script>

{#if user === null}
  <div class="login flex min-h-screen bg-neutral justify-center items-center">
    <div class="card w-full max-w-sm bg-base-100 px-4 py-8 shadow-xl">
      <div class="px-4">
        <h1 class="text-3xl font-bold text-center my-5 bg-clip-text bg-gradient-to-br">
          Pick a username
        </h1>
      </div>
      <form class="card-body pt-2" on:submit={createUser}>
        <div class="form-control">
          <label for="username" class="label">
            <span class="label-text">Your username</span>
          </label>
          <input type="text" name="username" class="input input-bordered" />
        </div>
        <div class="form-control mt-6">
          <button id="login" type="submit" class="btn">Start chatting</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .login {
    background: #f8f9fa;
  }
  
  .card {
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .form-control {
    margin-bottom: 1rem;
  }

  .label {
    display: block;
    margin-bottom: 0.5rem;
  }

  .label-text {
    color: #333;
  }

  .input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 1rem;
  }

  .input:focus {
    outline: none;
    border-color: #6366f1;
  }

  .btn {
    width: 100%;
    padding: 0.75rem;
    background: #6366f1;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 1rem;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .btn:hover {
    background: #4f46e5;
  }
</style>
