<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  type RoleDoc = {
    id: string;
    name: string;
    color?: string | null;
  };

  type MemberRow = {
    uid: string;
    label: string;
    avatar: string | null;
    status: 'online' | 'idle' | 'offline';
    baseRole: 'owner' | 'admin' | 'member' | null;
    roles: RoleDoc[];
  };

  type ProfileDoc = {
    displayName?: string | null;
    name?: string | null;
    email?: string | null;
    bio?: string | null;
    about?: string | null;
  };

  const presenceLabels: Record<'online' | 'idle' | 'offline', string> = {
    online: 'Online',
    idle: 'Idle',
    offline: 'Offline'
  };

  export let open = false;
  export let member: MemberRow | null = null;
  export let profile: ProfileDoc | null = null;
  export let statusClassName = 'presence-dot--offline';
  export let isMobile = false;
  export let anchorTop = 0;
  export let anchorLeft = 0;
  export let loading = false;
  export let canMessage = true;
  export let error: string | null = null;

  const dispatch = createEventDispatcher<{ close: void; dm: void }>();

  let touchStartX: number | null = null;
  let swipeOffset = 0;
  let isSwiping = false;

  const statusText = () => {
    if (!member) return 'Offline';
    return presenceLabels[member.status] ?? 'Offline';
  };

  const preferredIdentifier = () =>
    profile?.displayName ?? profile?.name ?? profile?.email ?? member?.label ?? 'Member';

  const summaryLine = () => profile?.email ?? null;
  const aboutText = () => profile?.bio ?? profile?.about ?? null;

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      dispatch('close');
    }
  }

  function handleTouchStart(event: TouchEvent) {
    if (!isMobile) return;
    touchStartX = event.touches?.[0]?.clientX ?? null;
    swipeOffset = 0;
    isSwiping = true;
  }

  function handleTouchMove(event: TouchEvent) {
    if (!isMobile || touchStartX === null) return;
    const delta = event.touches?.[0]?.clientX ?? touchStartX;
    const diff = delta - touchStartX;
    if (diff > 0) {
      swipeOffset = diff;
    } else {
      swipeOffset = 0;
    }
    if (diff > 120) {
      touchStartX = null;
      swipeOffset = 0;
      isSwiping = false;
      dispatch('close');
    }
    event.preventDefault();
  }

  const resetTouch = () => {
    touchStartX = null;
    if (isMobile && isSwiping) {
      swipeOffset = 0;
    }
    isSwiping = false;
  };

  const inlineStyle = () => {
    if (isMobile) {
      return `transform: translateX(${swipeOffset}px);`;
    }
    return `--member-popover-top: ${anchorTop}px; --member-popover-left: ${anchorLeft}px;`;
  };
</script>

{#if open && member}
  <div
    class={`member-profile-overlay ${isMobile ? 'member-profile-overlay--mobile' : 'member-profile-overlay--popover'}`}
    role="presentation"
    on:click={handleBackdropClick}
    on:touchstart={handleTouchStart}
    on:touchmove={handleTouchMove}
    on:touchend={resetTouch}
    on:touchcancel={resetTouch}
  >
    <div
      class={`member-profile ${isMobile ? 'member-profile--mobile' : 'member-profile--popover'}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${member.label} profile`}
      style={inlineStyle()}
    >
      <button class="member-profile__close" aria-label="Close profile" on:click={() => dispatch('close')}>
        <i class="bx bx-x"></i>
      </button>
      <div class="member-profile__header">
        <div class="member-profile__avatar">
          {#if member.avatar}
            <img src={member.avatar} alt={member.label} />
          {:else}
            <i class="bx bx-user text-2xl text-soft"></i>
          {/if}
          <span class={`presence-dot ${statusClassName}`} aria-hidden="true"></span>
        </div>
        <div class="member-profile__summary">
          <h3>{preferredIdentifier()}</h3>
          {#if summaryLine()}
            <p>{summaryLine()}</p>
          {/if}
          <span class="member-profile__status">{statusText()}</span>
        </div>
      </div>
      <div class="member-profile__body">
        <div>
          <p class="member-profile__label">Server role</p>
          {#if member.baseRole && member.baseRole !== 'member'}
            <span class="member-role member-role--large" data-tone={member.baseRole}>
              {member.baseRole === 'owner' ? 'Owner' : 'Admin'}
            </span>
          {:else}
            <span class="member-role member-role--large">Member</span>
          {/if}
        </div>
        {#if member.roles.length}
          <div class="member-profile__roles">
            <p class="member-profile__label">Custom roles</p>
            <div class="member-roles">
              {#each member.roles as role}
                <span
                  class="member-role"
                  style={role.color ? `--member-role-color: ${role.color}` : undefined}
                >
                  {role.name}
                </span>
              {/each}
            </div>
          </div>
        {/if}
        {#if aboutText()}
          <div>
            <p class="member-profile__label">About</p>
            <p class="member-profile__about">{aboutText()}</p>
          </div>
        {/if}
      </div>
      <div class="member-profile__actions">
        <button
          class="member-profile__action member-profile__action--primary"
          on:click={() => dispatch('dm')}
          disabled={!canMessage || loading}
        >
          {#if loading}
            Starting…
          {:else}
            Start DM
          {/if}
        </button>
        <button class="member-profile__action member-profile__action--secondary" on:click={() => dispatch('close')}>
          Close
        </button>
        {#if !canMessage}
          <p class="member-profile__hint">You can’t message yourself.</p>
        {/if}
        {#if error}
          <p class="member-profile__error">{error}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
