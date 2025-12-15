<script lang="ts">
  import type { LayoutData } from './$types';
  import AdminShell from '$lib/admin/components/AdminShell.svelte';
  import { ADMIN_NAV_ITEMS } from '$lib/admin/types';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { startAuthListener } from '$lib/firebase';
  import { startPresenceService } from '$lib/firebase/presence';

  interface Props {
    data: LayoutData;
    children?: import('svelte').Snippet;
  }

  let { data, children }: Props = $props();

  const navItems = ADMIN_NAV_ITEMS;
  const currentPath = $derived($page?.url?.pathname ?? '/admin');
  const navHighlightPath = $derived(
    currentPath.startsWith('/admin/settings') ? '/admin/archive' : currentPath
  );
  const activeItem =
    $derived(
      navItems.find((item) => navHighlightPath === item.href || navHighlightPath.startsWith(`${item.href}/`))
    );

  const descriptions: Record<string, string> = {
    '/admin': 'Full visibility into hConnect.',
    '/admin/servers': 'Manage, archive, and delete servers.',
    '/admin/channels': 'Tune channel behavior and visibility.',
    '/admin/dms': 'Audit DM activity with read-only viewer.',
    '/admin/messages': 'Search and moderate all messages.',
    '/admin/users': 'Review accounts, bans, and elevated roles.',
    '/admin/features': 'Flip global feature toggles instantly.',
    '/admin/logs': 'Inspect system logs with filters.',
    '/admin/archive': 'Restore or purge archived content.',
    '/admin/super-admins': 'Manage Super Admin allow list.',
    '/admin/settings': 'Tune retention and safety preferences.',
    '/admin/health': 'Monitor system health and performance.',
    '/admin/announcements': 'Create and manage system alerts.'
  };

  const manualTitles: Record<string, string> = {
    '/admin/settings': 'Settings',
    '/admin/super-admins': 'Super Admins',
    '/admin/health': 'System Health',
    '/admin/announcements': 'Announcements'
  };

  const fallbackDescription = $derived(descriptions[currentPath] ?? 'Super Admin area.');
  const resolvedDescription = $derived(
    activeItem?.href ? descriptions[activeItem.href] ?? fallbackDescription : fallbackDescription
  );
  const resolvedTitle = $derived(activeItem?.label ?? manualTitles[currentPath] ?? 'Admin');

  onMount(() => {
    const stopAuth = startAuthListener();
    const stopPresence = startPresenceService();

    return () => {
      stopAuth?.();
      stopPresence?.();
    };
  });
</script>

<AdminShell
  title={resolvedTitle}
  description={resolvedDescription}
  userEmail={data.userEmail}
  currentPath={navHighlightPath}
  navItems={navItems}
>
  {@render children?.()}
</AdminShell>
