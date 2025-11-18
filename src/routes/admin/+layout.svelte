<script lang="ts">
  import type { LayoutData } from './$types';
  import AdminShell from '$lib/admin/components/AdminShell.svelte';
  import { ADMIN_NAV_ITEMS } from '$lib/admin/types';
  import { page } from '$app/stores';

  interface Props {
    data: LayoutData;
    children?: import('svelte').Snippet;
  }

  let { data, children }: Props = $props();

  const navItems = ADMIN_NAV_ITEMS;
  const currentPath = $derived($page?.url?.pathname ?? '/admin');
  const activeItem =
    $derived(navItems.find((item) => currentPath === item.href || currentPath.startsWith(`${item.href}/`)));

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
    '/admin/settings': 'Tune retention and safety preferences.'
  };

  const resolvedDescription = $derived(descriptions[activeItem?.href ?? '/admin'] ?? 'Super Admin area.');
</script>

<AdminShell
  title={activeItem?.label ?? 'Admin'}
  description={resolvedDescription}
  userEmail={data.userEmail}
  currentPath={currentPath}
  navItems={navItems}
>
  {@render children?.()}
</AdminShell>
