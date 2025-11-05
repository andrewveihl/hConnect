<script lang="ts">
  import LeftPane from '$lib/components/app/LeftPane.svelte';
</script>

<div class="flex h-dvh app-bg text-primary overflow-hidden">
  <LeftPane activeServerId={null} />

  <div class="relative flex flex-1 flex-col overflow-hidden panel-muted">
    <main
      class="home-main flex-1 overflow-auto"
      style="padding-top: calc(env(safe-area-inset-top) + 1.25rem); padding-bottom: calc(env(safe-area-inset-bottom) + 1.25rem)"
    >
      <div class="home-frame mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pb-8 sm:px-6 lg:px-10">
        <section class="surface home-hero px-6 py-7 sm:px-8 sm:py-9">
          <div class="relative z-10 grid gap-7 text-center md:grid-cols-[auto_1fr] md:items-center md:text-left">
            <div class="flex flex-col items-center gap-4 md:items-start">
              <div class="home-logo-circle flex h-16 w-16 items-center justify-center sm:h-[4.25rem] sm:w-[4.25rem]">
                <img src="/Logo_transparent.png" alt="hConnect logo" class="h-12 w-12 object-contain sm:h-14 sm:w-14" />
              </div>
              <span class="text-[11px] font-semibold uppercase tracking-[0.38em] text-muted">hConnect</span>
            </div>

            <div class="flex flex-col items-center gap-6 md:items-start">
              <div class="max-w-xl space-y-4">
                <h1 class="text-3xl font-semibold leading-tight sm:text-4xl md:text-5xl">Welcome to hConnect</h1>
                <p class="text-base text-muted md:text-lg">
                  Keep conversations, calls, and updates aligned in one organised hub.
                </p>
              </div>

              <div class="flex w-full flex-wrap justify-center gap-3 md:justify-start">
                <a href="/dms" class="btn btn-primary px-6">
                  <i class="bx bx-message-dots text-lg"></i>
                  Enter direct messages
                </a>
                <a href="/dms/notes" class="btn btn-ghost px-6">
                  <i class="bx bx-notepad text-lg"></i>
                  Open private notes
                </a>
                <a href="/settings" class="btn btn-ghost px-6">
                  <i class="bx bx-cog text-lg"></i>
                  Workspace settings
                </a>
              </div>

              <div class="home-highlights">
                <span class="home-chip">Sync across devices</span>
                <span class="home-chip">Surface key spaces</span>
                <span class="home-chip">Spin up channels fast</span>
              </div>
            </div>
          </div>
        </section>

        <section class="grid gap-5 md:grid-cols-2">
          <article class="surface home-info-card">
            <h2 class="text-lg font-semibold text-primary">Jump back in</h2>
            <p class="text-sm text-muted">Pick where youâ€™d like to start today.</p>
            <ul class="home-card-list">
              <li>
                <a href="/dms" class="home-card-link">
                  <span>Direct messages</span>
                  <i class="bx bx-chevron-right"></i>
                </a>
              </li>
              <li>
                <a href="/dms/notes" class="home-card-link">
                  <span>Personal notes board</span>
                  <i class="bx bx-chevron-right"></i>
                </a>
              </li>
              <li>
                <a href="/settings" class="home-card-link">
                  <span>Notification controls</span>
                  <i class="bx bx-chevron-right"></i>
                </a>
              </li>
            </ul>
          </article>

          <article class="surface home-info-card">
            <h2 class="text-lg font-semibold text-primary">Workspace tips</h2>
            <p class="text-sm text-muted">A few reminders to keep things tidy.</p>
            <ul class="home-card-list home-card-list--bullets">
              <li>Pin important conversations so they stay at the top.</li>
              <li>Drop quick todos into your notes and sync across devices.</li>
              <li>Set channel topics to align everyone before meeting.</li>
              <li>Use the rail to hop between servers or voice rooms.</li>
            </ul>
          </article>
        </section>
      </div>
    </main>

  </div>
</div>

<style>
  :global(.home-hero) {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-lg);
  }

  :global(.home-hero::before),
  :global(.home-hero::after) {
    content: '';
    position: absolute;
    border-radius: 9999px;
    filter: blur(110px);
    opacity: 0.6;
    pointer-events: none;
  }

  :global(.home-hero::before) {
    top: -28%;
    right: -18%;
    width: 16rem;
    height: 16rem;
    background: color-mix(in srgb, var(--color-accent) 35%, transparent);
  }

  :global(.home-hero::after) {
    bottom: -20%;
    left: -12%;
    width: 14rem;
    height: 14rem;
    background: color-mix(in srgb, var(--color-app-overlay) 60%, transparent);
  }

  :global(.home-logo-circle) {
    border-radius: 9999px;
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
    box-shadow: var(--shadow-elevated);
  }

  :global(.home-info-card) {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.5rem;
  }

  @media (min-width: 640px) {
    :global(.home-info-card) {
      padding: 1.75rem;
    }
  }

  :global(.home-frame) {
    gap: 1.25rem;
  }

  @media (min-width: 768px) {
    :global(.home-frame) {
      gap: 1.5rem;
    }
  }

  @media (min-width: 1024px) {
    :global(.home-main) {
      overflow-y: hidden;
    }

    :global(.home-frame) {
      gap: 1.75rem;
    }
  }

  :global(.home-highlights) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
    color: var(--text-60);
  }

  @media (min-width: 768px) {
    :global(.home-highlights) {
      justify-content: flex-start;
    }
  }

  :global(.home-chip) {
    border-radius: 999px;
    padding: 0.45rem 0.9rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    background: color-mix(in srgb, var(--color-panel) 40%, transparent);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 600;
  }

  :global(.home-card-list) {
    display: grid;
    gap: 0.75rem;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  :global(.home-card-link) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.6rem 0.9rem;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    background: color-mix(in srgb, var(--color-panel) 35%, transparent);
    color: var(--text-80);
    text-decoration: none;
    transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
  }

  :global(.home-card-link:hover) {
    border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
    background: color-mix(in srgb, var(--color-panel) 55%, transparent);
    color: var(--text-90);
  }

  :global(.home-card-list--bullets) {
    gap: 0.65rem;
    color: var(--text-70);
  }

  :global(.home-card-list--bullets li) {
    line-height: 1.4;
  }
</style>
