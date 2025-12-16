<script lang="ts">
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import { superAdminEmailsStore } from '$lib/admin/superAdmin';

	const superAdminEmails = superAdminEmailsStore();
	const isSuperAdmin = $derived(
		(() => {
			const email = $user?.email ? $user.email.toLowerCase() : null;
			if (!email) return false;
			const allowList = Array.isArray($superAdminEmails) ? $superAdminEmails : [];
			return allowList.includes(email);
		})()
	);

	const openAdmin = () => goto('/admin');
</script>

{#if isSuperAdmin}
	<button
		type="button"
		class="super-admin-fab"
		onclick={openAdmin}
		aria-label="Open Super Admin Center"
		title="Super Admin Center"
	>
		<i class="bx bx-shield-quarter" aria-hidden="true"></i>
	</button>
{/if}

<style>
	.super-admin-fab {
		width: var(--floating-fab-size, 3.1rem);
		height: var(--floating-fab-size, 3.1rem);
		border-radius: 999px;
		border: 1px solid rgba(125, 211, 252, 0.65);
		background: linear-gradient(135deg, rgba(46, 196, 182, 0.98), rgba(14, 165, 233, 0.92));
		box-shadow: 0 14px 26px rgba(14, 165, 233, 0.32);
		color: #f8fafc;
		display: grid;
		place-items: center;
		font-size: 1.2rem;
		cursor: pointer;
		transition:
			transform 180ms cubic-bezier(0.2, 0.65, 0.25, 1),
			box-shadow 180ms ease;
	}

	.super-admin-fab:hover,
	.super-admin-fab:focus-visible {
		transform: translateY(-2px);
		box-shadow: 0 18px 32px rgba(14, 165, 233, 0.45);
		outline: none;
	}
</style>
