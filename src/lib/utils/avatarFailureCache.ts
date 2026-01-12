const failedAvatarUrls = new Set<string>();
const loggedFailedAvatarUrls = new Set<string>();

export function shouldSkipAvatarUrl(url: string | null | undefined): boolean {
	return typeof url === 'string' && failedAvatarUrls.has(url);
}

export function markAvatarUrlFailed(url: string | null | undefined): void {
	if (typeof url !== 'string' || !url) return;
	failedAvatarUrls.add(url);
}

export function shouldLogAvatarFailure(url: string | null | undefined): boolean {
	if (typeof url !== 'string' || !url) return false;
	if (loggedFailedAvatarUrls.has(url)) return false;
	loggedFailedAvatarUrls.add(url);
	return true;
}
