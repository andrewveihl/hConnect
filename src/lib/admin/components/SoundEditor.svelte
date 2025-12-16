<script lang="ts">
	import type { User } from 'firebase/auth';
	import {
		DEFAULT_SOUND_SOURCES,
		type SoundSources,
		type SoundEffect,
		playSound,
		setSoundOverrides
	} from '$lib/utils/sounds';
	import {
		uploadSoundFile,
		saveSoundConfig,
		resetSoundConfig,
		type SoundKind
	} from '$lib/admin/customization';
	import { showAdminToast } from '$lib/admin/stores/toast';

	interface Props {
		sounds: SoundSources | null;
		user: User | null;
	}

	let { sounds: soundsInput, user }: Props = $props();
	let sounds = $state<SoundSources>({ ...DEFAULT_SOUND_SOURCES });
	let saving = $state(false);
	let uploading: SoundKind | null = $state(null);
	let error: string | null = $state(null);

	const rows: Array<{
		id: SoundKind;
		effect: SoundEffect;
		label: string;
		description: string;
		key: keyof SoundSources;
	}> = [
		{
			id: 'notification',
			effect: 'notification',
			label: 'Notification',
			description: 'In-app mentions and notification toast sound.',
			key: 'notificationUrl'
		},
		{
			id: 'callJoin',
			effect: 'call-join',
			label: 'Call join',
			description: 'Played when a user successfully joins a call.',
			key: 'callJoinUrl'
		},
		{
			id: 'callLeave',
			effect: 'call-leave',
			label: 'Call leave',
			description: 'Played when a user leaves or is disconnected from a call.',
			key: 'callLeaveUrl'
		},
		{
			id: 'messageSend',
			effect: 'message-send',
			label: 'Message send',
			description: 'Played when you send a message in any channel or DM.',
			key: 'messageSendUrl'
		}
	];

	$effect(() => {
		if (soundsInput) {
			sounds = { ...DEFAULT_SOUND_SOURCES, ...soundsInput };
		}
	});

	function handleUrlChange(key: keyof SoundSources, value: string) {
		sounds = { ...sounds, [key]: value };
	}

	async function handleUpload(kind: SoundKind, file: File | null | undefined) {
		if (!file) return;
		uploading = kind;
		error = null;
		try {
			const url = await uploadSoundFile(kind, file, user);
			const key = rows.find((r) => r.id === kind)?.key;
			if (key) {
				handleUrlChange(key, url);
			}
			showAdminToast({ type: 'success', message: `${kind} sound uploaded.` });
		} catch (err: any) {
			console.error(err);
			error = err?.message ?? 'Upload failed.';
			showAdminToast({ type: 'error', message: error ?? 'Upload failed.' });
		} finally {
			uploading = null;
		}
	}

	async function handleSave() {
		saving = true;
		error = null;
		try {
			await saveSoundConfig(sounds, user);
			setSoundOverrides(sounds);
			showAdminToast({ type: 'success', message: 'Sound settings saved globally.' });
		} catch (err: any) {
			console.error(err);
			error = err?.message ?? 'Failed to save.';
			showAdminToast({ type: 'error', message: error ?? 'Failed to save.' });
		} finally {
			saving = false;
		}
	}

	async function handleReset() {
		saving = true;
		error = null;
		try {
			await resetSoundConfig(user);
			sounds = { ...DEFAULT_SOUND_SOURCES };
			setSoundOverrides(sounds);
			showAdminToast({ type: 'success', message: 'Sounds reset to defaults.' });
		} catch (err: any) {
			console.error(err);
			error = err?.message ?? 'Failed to reset.';
			showAdminToast({ type: 'error', message: error ?? 'Failed to reset.' });
		} finally {
			saving = false;
		}
	}

	function preview(effect: SoundEffect) {
		setSoundOverrides(sounds);
		// Force play for preview, bypassing user preferences
		playSound(effect, true);
	}
</script>

<div class="sound-editor">
	<div class="sound-grid">
		{#each rows as row (row.id)}
			<div class="sound-card">
				<div class="sound-meta">
					<div class="meta-text">
						<h3>{row.label}</h3>
						<p>{row.description}</p>
					</div>
					<button class="preview-btn" onclick={() => preview(row.effect)}>
						<i class="bx bx-play-circle"></i>
						Preview
					</button>
				</div>

				<label class="input-label" for="sound-url-{row.key}">Sound URL</label>
				<input
					id="sound-url-{row.key}"
					class="text-input"
					type="url"
					placeholder="https://cdn.example.com/sound.wav"
					value={sounds[row.key]}
					oninput={(e) => handleUrlChange(row.key, (e.currentTarget as HTMLInputElement).value)}
				/>

				<div class="upload-row">
					<label class="upload-btn">
						<input
							type="file"
							accept="audio/*"
							onchange={(e) =>
								handleUpload(row.id, (e.currentTarget as HTMLInputElement).files?.[0])}
						/>
						<i class="bx bx-cloud-upload"></i>
						{uploading === row.id ? 'Uploading…' : 'Upload new sound'}
					</label>
					<span class="hint">Uploads go to the storage bucket (admin/sounds).</span>
				</div>
			</div>
		{/each}
	</div>

	<div class="actions">
		<button class="reset-btn" onclick={handleReset} disabled={saving}>
			<i class="bx bx-revision"></i>
			Reset to defaults
		</button>
		<button class="save-btn" onclick={handleSave} disabled={saving}>
			<i class="bx bx-save"></i>
			{saving ? 'Saving…' : 'Save sounds'}
		</button>
	</div>

	{#if error}
		<div class="error-banner">
			<i class="bx bx-error-circle"></i>
			<span>{error}</span>
		</div>
	{/if}
</div>

<style>
	.sound-editor {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.sound-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1rem;
	}

	.sound-card {
		background: var(--panel-bg, #11161c);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 12px;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.sound-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.meta-text h3 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-text-primary, #f5f7fa);
	}

	.meta-text p {
		margin: 0.15rem 0 0;
		color: var(--color-text-secondary, rgba(245, 247, 250, 0.68));
		font-size: 0.9rem;
	}

	.preview-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.75rem;
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.04);
		color: #f5f7fa;
		cursor: pointer;
	}

	.preview-btn i {
		font-size: 1.1rem;
	}

	.input-label {
		font-size: 0.85rem;
		color: var(--color-text-secondary, rgba(245, 247, 250, 0.68));
	}

	.text-input {
		width: 100%;
		padding: 0.65rem 0.75rem;
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(255, 255, 255, 0.03);
		color: var(--color-text-primary, #f5f7fa);
	}

	.upload-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.9rem;
		border-radius: 10px;
		border: 1px dashed rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.04);
		color: #f5f7fa;
		cursor: pointer;
	}

	.upload-btn input {
		display: none;
	}

	.hint {
		font-size: 0.82rem;
		color: var(--color-text-secondary, rgba(245, 247, 250, 0.6));
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.save-btn,
	.reset-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.6rem 1rem;
		border-radius: 12px;
		border: none;
		cursor: pointer;
	}

	.save-btn {
		background: linear-gradient(135deg, #44d8cf, #36b9d6);
		color: #0a0f14;
	}

	.reset-btn {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: #f5f7fa;
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(208, 83, 83, 0.12);
		border: 1px solid rgba(208, 83, 83, 0.35);
		color: #f8d7da;
		padding: 0.75rem 1rem;
		border-radius: 10px;
	}
</style>
