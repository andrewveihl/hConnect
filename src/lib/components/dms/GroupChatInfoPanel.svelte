<script lang="ts">
	/**
	 * GroupChatInfoPanel - Panel for viewing and editing group chat settings
	 *
	 * Features:
	 * - Edit group name and description
	 * - Change group icon (upload or select emoji)
	 * - View and manage members
	 * - Add/remove participants
	 * - Mute notifications
	 * - Leave group
	 */
	import { createEventDispatcher } from 'svelte';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import {
		updateGroupDM,
		addGroupDMParticipant,
		leaveGroupDM,
		muteGroupDM,
		unmuteGroupDM,
		isGroupAdmin,
		isGroupMuted,
		searchUsersByName,
		type DMThread
	} from '$lib/firestore/dms';
	import { uploadDMFile } from '$lib/firebase/storage';
	import { resolveProfilePhotoURL } from '$lib/utils/profile';

	const dispatch = createEventDispatcher<{
		close: void;
		leave: void;
		update: Partial<DMThread>;
	}>();

	interface Props {
		thread: DMThread & { id: string };
		currentUid: string;
		participantProfiles: Record<string, any>;
		onClose?: () => void;
	}

	let { thread, currentUid, participantProfiles, onClose }: Props = $props();

	// Editing states
	let isEditingName = $state(false);
	let isEditingDescription = $state(false);
	let editName = $state('');
	let editDescription = $state('');
	let isSaving = $state(false);
	let showAddMember = $state(false);
	let memberSearchTerm = $state('');
	let memberSearchResults: any[] = $state([]);
	let isSearching = $state(false);
	let isAddingMember = $state(false);
	let showMuteOptions = $state(false);
	let isLeaving = $state(false);
	let uploadingIcon = $state(false);

	// Initialize edit values from thread
	$effect(() => {
		editName = thread.name ?? '';
		editDescription = thread.description ?? '';
	});

	// Computed values
	let isAdmin = $derived(isGroupAdmin(thread, currentUid));
	let isCreator = $derived(thread.createdBy === currentUid);
	let isMuted = $derived(isGroupMuted(thread, currentUid));
	let participantCount = $derived(thread.participants?.length ?? 0);
	let otherParticipants = $derived(
		(thread.participants ?? []).filter((uid) => uid !== currentUid)
	);

	// Icon display
	let displayIcon = $derived(thread.iconURL);

	// Format participant name
	function getParticipantName(uid: string): string {
		const profile = participantProfiles[uid];
		return profile?.displayName || profile?.name || profile?.email || uid.slice(0, 8);
	}

	function getParticipantPhoto(uid: string): string | null {
		const profile = participantProfiles[uid];
		return resolveProfilePhotoURL(profile);
	}

	// Save group name
	async function saveName() {
		if (isSaving) return;
		isSaving = true;
		try {
			await updateGroupDM(thread.id, { name: editName.trim() || null });
			isEditingName = false;
			dispatch('update', { name: editName.trim() || null });
		} catch (err: any) {
			console.error('Failed to update group name:', err);
			alert(err?.message ?? 'Failed to update name');
		} finally {
			isSaving = false;
		}
	}

	// Save group description
	async function saveDescription() {
		if (isSaving) return;
		isSaving = true;
		try {
			await updateGroupDM(thread.id, { description: editDescription.trim() || null });
			isEditingDescription = false;
			dispatch('update', { description: editDescription.trim() || null });
		} catch (err: any) {
			console.error('Failed to update group description:', err);
			alert(err?.message ?? 'Failed to update description');
		} finally {
			isSaving = false;
		}
	}

	// Handle icon upload
	async function handleIconUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || uploadingIcon) return;

		// Validate file type
		if (!file.type.startsWith('image/')) {
			alert('Please select an image file');
			return;
		}

		// Validate file size (max 5MB)
		if (file.size > 5 * 1024 * 1024) {
			alert('Image must be less than 5MB');
			return;
		}

		uploadingIcon = true;
		try {
			const result = await uploadDMFile({
				threadId: thread.id,
				uid: currentUid,
				file
			});
			if (result?.url) {
				await updateGroupDM(thread.id, { iconURL: result.url });
				dispatch('update', { iconURL: result.url });
			}
		} catch (err: any) {
			console.error('Failed to upload group icon:', err);
			alert(err?.message ?? 'Failed to upload icon');
		} finally {
			uploadingIcon = false;
			input.value = '';
		}
	}

	// Remove icon
	async function removeIcon() {
		if (isSaving) return;
		isSaving = true;
		try {
			await updateGroupDM(thread.id, { iconURL: null });
			dispatch('update', { iconURL: null });
		} catch (err: any) {
			console.error('Failed to remove group icon:', err);
		} finally {
			isSaving = false;
		}
	}

	// Search for members to add
	let searchDebounce: ReturnType<typeof setTimeout>;
	async function searchMembers() {
		clearTimeout(searchDebounce);
		if (memberSearchTerm.trim().length < 2) {
			memberSearchResults = [];
			return;
		}
		searchDebounce = setTimeout(async () => {
			isSearching = true;
			try {
				const results = await searchUsersByName(memberSearchTerm.trim(), { limitTo: 20 });
				// Filter out existing participants
				memberSearchResults = results.filter(
					(u) => !thread.participants?.includes(u.uid)
				);
			} catch (err) {
				console.error('Search failed:', err);
				memberSearchResults = [];
			} finally {
				isSearching = false;
			}
		}, 300);
	}

	// Add a new member
	async function addMember(uid: string) {
		if (isAddingMember) return;
		isAddingMember = true;
		try {
			await addGroupDMParticipant(thread.id, uid, currentUid);
			memberSearchResults = memberSearchResults.filter((u) => u.uid !== uid);
			memberSearchTerm = '';
			showAddMember = false;
		} catch (err: any) {
			console.error('Failed to add member:', err);
			alert(err?.message ?? 'Failed to add member');
		} finally {
			isAddingMember = false;
		}
	}

	// Leave the group
	async function handleLeave() {
		if (isLeaving) return;
		if (!confirm('Are you sure you want to leave this group?')) return;
		
		isLeaving = true;
		try {
			await leaveGroupDM(thread.id, currentUid);
			dispatch('leave');
		} catch (err: any) {
			console.error('Failed to leave group:', err);
			alert(err?.message ?? 'Failed to leave group');
		} finally {
			isLeaving = false;
		}
	}

	// Mute options
	const muteOptions = [
		{ label: '1 hour', duration: 60 * 60 * 1000 },
		{ label: '8 hours', duration: 8 * 60 * 60 * 1000 },
		{ label: '24 hours', duration: 24 * 60 * 60 * 1000 },
		{ label: '1 week', duration: 7 * 24 * 60 * 60 * 1000 },
		{ label: 'Until I turn it back on', duration: null }
	];

	async function handleMute(duration: number | null) {
		try {
			const muteUntil = duration ? Date.now() + duration : null;
			await muteGroupDM(thread.id, currentUid, muteUntil);
			showMuteOptions = false;
		} catch (err: any) {
			console.error('Failed to mute:', err);
		}
	}

	async function handleUnmute() {
		try {
			await unmuteGroupDM(thread.id, currentUid);
		} catch (err: any) {
			console.error('Failed to unmute:', err);
		}
	}

	function cancelEditing() {
		isEditingName = false;
		isEditingDescription = false;
		editName = thread.name ?? '';
		editDescription = thread.description ?? '';
	}

	function handleKeydown(event: KeyboardEvent, action: () => void) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			action();
		} else if (event.key === 'Escape') {
			cancelEditing();
		}
	}
</script>

<div class="group-info-panel">
	<!-- Header -->
	<div class="group-info-panel__header">
		<div class="text-xs font-medium uppercase tracking-wider text-white/50">Group Info</div>
		<button
			class="group-info-panel__close"
			type="button"
			aria-label="Close panel"
			onclick={() => {
				onClose?.();
				dispatch('close');
			}}
		>
			<i class="bx bx-x text-lg"></i>
		</button>
	</div>

	<!-- Group Icon -->
	<div class="group-info-panel__icon-section">
		<div class="group-info-panel__icon-wrapper">
			{#if displayIcon}
				<img
					src={displayIcon}
					alt="Group icon"
					class="group-info-panel__icon-image"
				/>
			{:else}
				<div class="group-info-panel__icon-placeholder">
					<i class="bx bx-group"></i>
				</div>
			{/if}
			
			<label class="group-info-panel__icon-edit">
				<input
					type="file"
					accept="image/*"
					class="sr-only"
					onchange={handleIconUpload}
					disabled={uploadingIcon}
				/>
				{#if uploadingIcon}
					<i class="bx bx-loader-alt animate-spin"></i>
				{:else}
					<i class="bx bx-camera"></i>
				{/if}
			</label>
		</div>
		
		{#if displayIcon}
			<button
				class="group-info-panel__remove-icon"
				type="button"
				onclick={removeIcon}
				disabled={isSaving}
			>
				Remove icon
			</button>
		{/if}
	</div>

	<!-- Group Name -->
	<div class="group-info-panel__section">
		<div class="group-info-panel__section-header">
			<span class="group-info-panel__section-label">Name</span>
			{#if !isEditingName}
				<button
					class="group-info-panel__edit-btn"
					type="button"
					aria-label="Edit name"
					onclick={() => {
						editName = thread.name ?? '';
						isEditingName = true;
					}}
				>
					<i class="bx bx-pencil"></i>
				</button>
			{/if}
		</div>
		{#if isEditingName}
			<div class="group-info-panel__edit-field">
				<input
					type="text"
					class="group-info-panel__input"
					bind:value={editName}
					placeholder="Enter group name"
					maxlength={100}
					onkeydown={(e) => handleKeydown(e, saveName)}
				/>
				<div class="group-info-panel__edit-actions">
					<button
						class="btn btn-ghost btn-sm"
						type="button"
						onclick={cancelEditing}
						disabled={isSaving}
					>
						Cancel
					</button>
					<button
						class="btn btn-primary btn-sm"
						type="button"
						onclick={saveName}
						disabled={isSaving}
					>
						{isSaving ? 'Saving...' : 'Save'}
					</button>
				</div>
			</div>
		{:else}
			<div class="group-info-panel__value">
				{thread.name || 'Unnamed Group'}
			</div>
		{/if}
	</div>

	<!-- Group Description -->
	<div class="group-info-panel__section">
		<div class="group-info-panel__section-header">
			<span class="group-info-panel__section-label">Description</span>
			{#if !isEditingDescription}
				<button
					class="group-info-panel__edit-btn"
					type="button"
					aria-label="Edit description"
					onclick={() => {
						editDescription = thread.description ?? '';
						isEditingDescription = true;
					}}
				>
					<i class="bx bx-pencil"></i>
				</button>
			{/if}
		</div>
		{#if isEditingDescription}
			<div class="group-info-panel__edit-field">
				<textarea
					class="group-info-panel__textarea"
					bind:value={editDescription}
					placeholder="What's this group about?"
					maxlength={500}
					rows={3}
					onkeydown={(e) => {
						if (e.key === 'Escape') cancelEditing();
					}}
				></textarea>
				<div class="group-info-panel__edit-actions">
					<button
						class="btn btn-ghost btn-sm"
						type="button"
						onclick={cancelEditing}
						disabled={isSaving}
					>
						Cancel
					</button>
					<button
						class="btn btn-primary btn-sm"
						type="button"
						onclick={saveDescription}
						disabled={isSaving}
					>
						{isSaving ? 'Saving...' : 'Save'}
					</button>
				</div>
			</div>
		{:else}
			<div class="group-info-panel__value group-info-panel__value--muted">
				{thread.description || 'No description'}
			</div>
		{/if}
	</div>

	<!-- Notifications -->
	<div class="group-info-panel__section">
		<div class="group-info-panel__section-header">
			<span class="group-info-panel__section-label">Notifications</span>
		</div>
		<div class="group-info-panel__notifications">
			{#if isMuted}
				<div class="group-info-panel__muted-badge">
					<i class="bx bx-bell-off"></i>
					<span>Muted</span>
				</div>
				<button
					class="btn btn-ghost btn-sm"
					type="button"
					onclick={handleUnmute}
				>
					Unmute
				</button>
			{:else}
				<button
					class="btn btn-ghost btn-sm"
					type="button"
					onclick={() => (showMuteOptions = !showMuteOptions)}
				>
					<i class="bx bx-bell"></i>
					Mute
				</button>
			{/if}
		</div>
		{#if showMuteOptions && !isMuted}
			<div class="group-info-panel__mute-options">
				{#each muteOptions as opt}
					<button
						class="group-info-panel__mute-option"
						type="button"
						onclick={() => handleMute(opt.duration)}
					>
						{opt.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Members -->
	<div class="group-info-panel__section group-info-panel__section--members">
		<div class="group-info-panel__section-header">
			<span class="group-info-panel__section-label">
				Members ({participantCount})
			</span>
			<button
				class="group-info-panel__edit-btn"
				type="button"
				onclick={() => (showAddMember = !showAddMember)}
				title="Add member"
			>
				<i class="bx bx-user-plus"></i>
			</button>
		</div>

		{#if showAddMember}
			<div class="group-info-panel__add-member">
				<input
					type="text"
					class="group-info-panel__input"
					placeholder="Search by name or email..."
					bind:value={memberSearchTerm}
					oninput={searchMembers}
				/>
				{#if isSearching}
					<div class="group-info-panel__search-loading">
						<i class="bx bx-loader-alt animate-spin"></i>
						Searching...
					</div>
				{:else if memberSearchResults.length > 0}
					<ul class="group-info-panel__search-results">
						{#each memberSearchResults as user}
							<li class="group-info-panel__search-result">
								<Avatar {user} size="sm" />
								<span class="group-info-panel__result-name">
									{user.displayName || user.name || user.email || user.uid.slice(0, 8)}
								</span>
								<button
									class="btn btn-ghost btn-sm"
									type="button"
									onclick={() => addMember(user.uid)}
									disabled={isAddingMember}
								>
									Add
								</button>
							</li>
						{/each}
					</ul>
				{:else if memberSearchTerm.trim().length >= 2}
					<div class="group-info-panel__no-results">No users found</div>
				{/if}
			</div>
		{/if}

		<ul class="group-info-panel__members-list">
			{#each thread.participants ?? [] as uid}
				{@const profile = participantProfiles[uid]}
				{@const isMe = uid === currentUid}
				{@const memberIsCreator = uid === thread.createdBy}
				{@const memberIsAdmin = thread.adminUids?.includes(uid)}
				<li class="group-info-panel__member">
					<Avatar user={profile} name={getParticipantName(uid)} size="sm" />
					<div class="group-info-panel__member-info">
						<span class="group-info-panel__member-name">
							{getParticipantName(uid)}
							{#if isMe}
								<span class="group-info-panel__you-badge">(You)</span>
							{/if}
						</span>
						{#if memberIsCreator}
							<span class="group-info-panel__role-badge group-info-panel__role-badge--creator">
								Creator
							</span>
						{:else if memberIsAdmin}
							<span class="group-info-panel__role-badge">Admin</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</div>

	<!-- Leave Group -->
	<div class="group-info-panel__section group-info-panel__section--danger">
		<button
			class="group-info-panel__leave-btn"
			type="button"
			onclick={handleLeave}
			disabled={isLeaving || participantCount <= 2}
		>
			<i class="bx bx-log-out"></i>
			{isLeaving ? 'Leaving...' : 'Leave Group'}
		</button>
		{#if participantCount <= 2}
			<p class="group-info-panel__leave-hint">
				Cannot leave - group needs at least 2 members
			</p>
		{/if}
	</div>
</div>

<style>
	.group-info-panel {
		width: 100%;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.group-info-panel__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.group-info-panel__close {
		width: 1.75rem;
		height: 1.75rem;
		display: grid;
		place-items: center;
		border-radius: 0.375rem;
		color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
		transition: background 150ms ease, color 150ms ease;
	}

	.group-info-panel__close:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--color-text-primary, white);
	}

	/* Icon Section */
	.group-info-panel__icon-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.group-info-panel__icon-wrapper {
		position: relative;
		width: 5rem;
		height: 5rem;
	}

	.group-info-panel__icon-image {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		object-fit: cover;
	}

	.group-info-panel__icon-placeholder {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-accent, #5865f2) 0%, #7c3aed 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-size: 2rem;
	}

	.group-info-panel__icon-edit {
		position: absolute;
		bottom: -0.25rem;
		right: -0.25rem;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--color-panel, #1e1e2e);
		border: 2px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1));
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
		transition: background 150ms ease, color 150ms ease;
	}

	.group-info-panel__icon-edit:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--color-text-primary, white);
	}

	.group-info-panel__remove-icon {
		font-size: 0.75rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
		transition: color 150ms ease;
	}

	.group-info-panel__remove-icon:hover {
		color: var(--color-danger, #ef4444);
	}

	/* Sections */
	.group-info-panel__section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.group-info-panel__section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.group-info-panel__section-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
	}

	.group-info-panel__edit-btn {
		width: 1.5rem;
		height: 1.5rem;
		display: grid;
		place-items: center;
		border-radius: 0.25rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
		transition: background 150ms ease, color 150ms ease;
	}

	.group-info-panel__edit-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--color-text-primary, white);
	}

	.group-info-panel__value {
		font-size: 0.9375rem;
		color: var(--color-text-primary, white);
	}

	.group-info-panel__value--muted {
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
		font-style: italic;
	}

	/* Edit Fields */
	.group-info-panel__edit-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.group-info-panel__input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		background: rgba(0, 0, 0, 0.2);
		border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1));
		border-radius: 0.375rem;
		color: var(--color-text-primary, white);
		outline: none;
		transition: border-color 150ms ease;
	}

	.group-info-panel__input:focus {
		border-color: var(--color-accent, #5865f2);
	}

	.group-info-panel__input::placeholder {
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
	}

	.group-info-panel__textarea {
		width: 100%;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		background: rgba(0, 0, 0, 0.2);
		border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1));
		border-radius: 0.375rem;
		color: var(--color-text-primary, white);
		outline: none;
		resize: vertical;
		min-height: 4rem;
		transition: border-color 150ms ease;
	}

	.group-info-panel__textarea:focus {
		border-color: var(--color-accent, #5865f2);
	}

	.group-info-panel__edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	/* Notifications */
	.group-info-panel__notifications {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.group-info-panel__muted-badge {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.625rem;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 1rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
	}

	.group-info-panel__mute-options {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.5rem;
		background: rgba(0, 0, 0, 0.2);
		border-radius: 0.5rem;
		margin-top: 0.5rem;
	}

	.group-info-panel__mute-option {
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		text-align: left;
		color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
		border-radius: 0.375rem;
		transition: background 150ms ease, color 150ms ease;
	}

	.group-info-panel__mute-option:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--color-text-primary, white);
	}

	/* Members Section */
	.group-info-panel__section--members {
		flex: 1;
		min-height: 0;
	}

	.group-info-panel__add-member {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		background: rgba(0, 0, 0, 0.2);
		border-radius: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.group-info-panel__search-loading,
	.group-info-panel__no-results {
		font-size: 0.8125rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0;
	}

	.group-info-panel__search-results {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 12rem;
		overflow-y: auto;
	}

	.group-info-panel__search-result {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.375rem;
		border-radius: 0.375rem;
		transition: background 150ms ease;
	}

	.group-info-panel__search-result:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.group-info-panel__result-name {
		flex: 1;
		min-width: 0;
		font-size: 0.875rem;
		color: var(--color-text-primary, white);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.group-info-panel__members-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 20rem;
		overflow-y: auto;
	}

	.group-info-panel__member {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem;
		border-radius: 0.375rem;
		transition: background 150ms ease;
	}

	.group-info-panel__member:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.group-info-panel__member-info {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.group-info-panel__member-name {
		font-size: 0.875rem;
		color: var(--color-text-primary, white);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.group-info-panel__you-badge {
		font-size: 0.75rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
	}

	.group-info-panel__role-badge {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.125rem 0.375rem;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 0.25rem;
		color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
	}

	.group-info-panel__role-badge--creator {
		background: linear-gradient(135deg, var(--color-accent, #5865f2) 0%, #7c3aed 100%);
		color: white;
	}

	/* Danger Section */
	.group-info-panel__section--danger {
		margin-top: auto;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1));
	}

	.group-info-panel__leave-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-danger, #ef4444);
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 0.5rem;
		transition: background 150ms ease, border-color 150ms ease;
	}

	.group-info-panel__leave-btn:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.2);
		border-color: rgba(239, 68, 68, 0.3);
	}

	.group-info-panel__leave-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.group-info-panel__leave-hint {
		font-size: 0.75rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
		text-align: center;
		margin-top: 0.375rem;
	}

	/* Button utilities */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		font-weight: 500;
		border-radius: 0.375rem;
		transition: background 150ms ease, color 150ms ease;
	}

	.btn-sm {
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
	}

	.btn-ghost {
		background: transparent;
		color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
	}

	.btn-ghost:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
		color: var(--color-text-primary, white);
	}

	.btn-primary {
		background: var(--color-accent, #5865f2);
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--color-accent-hover, #4752c4);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Utility */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.animate-spin {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
