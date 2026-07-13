import { describe, expect, it, vi } from "vitest";
import { createPlayableAudioSource, isTauriAssetAudioSource } from "./playable-audio-source";

describe("playable Tauri audio sources", () => {
  it("turns asset protocol WAV files into disposable browser media URLs", async () => {
    const fetchSource = vi.fn(async () => new Response(new Uint8Array([82, 73, 70, 70])));
    const createObjectUrl = vi.fn((_blob: Blob) => "blob:sonelle-narration");
    const revokeObjectUrl = vi.fn();

    const source = await createPlayableAudioSource("asset://localhost/audio/sentence.wav", {
      fetchSource,
      createObjectUrl,
      revokeObjectUrl
    });

    expect(fetchSource).toHaveBeenCalledOnce();
    expect(createObjectUrl.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(createObjectUrl.mock.calls[0]?.[0].type).toBe("audio/wav");
    expect(source.url).toBe("blob:sonelle-narration");
    expect(new Uint8Array(source.data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([82, 73, 70, 70])
    );

    source.dispose();
    source.dispose();
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
  });

  it("keeps data and ordinary web sources on their direct playback path", async () => {
    const dataSource = await createPlayableAudioSource("data:audio/wav;base64,UklGRg==");
    const webSource = await createPlayableAudioSource("https://example.com/narration.wav");

    expect(dataSource.url).toBe("data:audio/wav;base64,UklGRg==");
    expect(webSource.url).toBe("https://example.com/narration.wav");
    expect(isTauriAssetAudioSource("http://asset.localhost/audio/sentence.wav")).toBe(true);
  });

  it("reports an unavailable prepared file with reader-facing language", async () => {
    await expect(
      createPlayableAudioSource("asset://localhost/audio/missing.wav", {
        fetchSource: async () => new Response(null, { status: 404 })
      })
    ).rejects.toThrow("We couldn't open prepared narration. Please try again.");
  });
});
