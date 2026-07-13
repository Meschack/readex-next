interface PlayableAudioSourceDependencies {
  fetchSource?: typeof fetch;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

export interface PlayableAudioSource {
  url: string;
  data?: ArrayBuffer;
  dispose: () => void;
}

export async function createPlayableAudioSource(
  sourceUrl: string,
  dependencies: PlayableAudioSourceDependencies = {}
): Promise<PlayableAudioSource> {
  if (!isTauriAssetAudioSource(sourceUrl)) {
    return { url: sourceUrl, dispose: () => undefined };
  }

  const fetchSource = dependencies.fetchSource ?? fetch;
  const response = await fetchSource(sourceUrl);
  if (!response.ok) {
    throw new Error("We couldn't open prepared narration. Please try again.");
  }

  const data = await response.arrayBuffer();
  const audioBlob = new Blob([data], { type: "audio/wav" });
  const createObjectUrl = dependencies.createObjectUrl ?? URL.createObjectURL;
  const revokeObjectUrl = dependencies.revokeObjectUrl ?? URL.revokeObjectURL;
  const playableUrl = createObjectUrl(audioBlob);
  let disposed = false;

  return {
    url: playableUrl,
    data,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      revokeObjectUrl(playableUrl);
    }
  };
}

export function isTauriAssetAudioSource(sourceUrl: string): boolean {
  return sourceUrl.startsWith("asset:") || /^https?:\/\/asset\.localhost(?:\/|$)/u.test(sourceUrl);
}
