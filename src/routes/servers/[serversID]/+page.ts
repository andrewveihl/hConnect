export const ssr = false;
export async function load({ params }) { return { serverId: params.serverId }; }
